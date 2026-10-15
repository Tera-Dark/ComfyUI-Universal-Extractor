"""libraries domain. Dependencies are injected by the host."""
from __future__ import annotations

import os
import json
import uuid
import time
import shutil
import sqlite3
import hashlib
import colorsys
from threading import Lock, BoundedSemaphore
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Any

def validate_library_entries(env, data: Any) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []

    if not isinstance(data, list):
        return [{"index": None, "field": None, "message": "Library data must be a JSON array."}]

    text_fields = ("title", "prompt", "model", "description")

    for index, entry in enumerate(data):
        if not isinstance(entry, dict):
            issues.append({"index": index, "field": None, "message": "Each library entry must be an object."})
            continue

        for field in text_fields:
            value = entry.get(field)
            if value is not None and not isinstance(value, str):
                issues.append({"index": index, "field": field, "message": f"'{field}' must be a string."})

        tags = entry.get("tags")
        if tags is not None:
            if not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags):
                issues.append({"index": index, "field": "tags", "message": "'tags' must be an array of strings."})

    return issues


def ensure_valid_library_entries(env, data: Any) -> list[dict[str, Any]]:
    issues = env.validate_library_entries(data)
    if issues:
        raise env.LibraryValidationError(issues)
    return data


def normalize_library_filename(env, name: str) -> str:
    clean_name = os.path.basename((name or "").strip())
    if not clean_name:
        raise ValueError("library name required")
    if not clean_name.endswith(".json"):
        clean_name = f"{clean_name}.json"
    return clean_name


def import_library_data(env, 
    source_filename: str,
    raw_payload: bytes,
    mode: str = "create",
    target_name: str = "",
    new_name: str = "",
) -> dict[str, Any]:
    env.ensure_data_dir()

    try:
        parsed = json.loads(raw_payload.decode("utf-8"))
    except UnicodeDecodeError as error:
        raise ValueError("Library file must be UTF-8 encoded JSON.") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid JSON at line {error.lineno}, column {error.colno}.") from error

    entries = env.ensure_valid_library_entries(parsed)

    selected_mode = mode if mode in {"create", "replace", "merge"} else "create"
    source_name = env.normalize_library_filename(source_filename)

    if selected_mode == "create":
        preferred_name = env.normalize_library_filename(new_name or source_name)
        destination_path = env.ensure_unique_path(env.DATA_DIR, preferred_name)
        final_name = os.path.basename(destination_path)
        env.save_json(destination_path, entries)
        env.invalidate_library_cache(final_name)
        return {"ok": True, "name": final_name, "count": len(entries), "mode": selected_mode}

    final_name = env.normalize_library_filename(target_name)
    target_path = os.path.join(env.DATA_DIR, final_name)
    if not os.path.exists(target_path):
        raise FileNotFoundError("target library not found")

    if selected_mode == "replace":
        env.save_json(target_path, entries)
        env.invalidate_library_cache(final_name)
        return {"ok": True, "name": final_name, "count": len(entries), "mode": selected_mode}

    existing_entries = env.load_json(target_path, [])
    if not isinstance(existing_entries, list):
        existing_entries = []

    merged_entries = existing_entries + entries
    env.ensure_valid_library_entries(merged_entries)
    env.save_json(target_path, merged_entries)
    env.invalidate_library_cache(final_name)
    return {"ok": True, "name": final_name, "count": len(merged_entries), "mode": selected_mode}


def save_library(env, name: str, data):
    env.ensure_data_dir()
    validated_data = env.ensure_valid_library_entries(data)
    filename = env.normalize_library_filename(name)
    env.save_json(os.path.join(env.DATA_DIR, filename), validated_data)
    env.invalidate_library_cache(filename)
    return filename


def list_libraries(env) -> list[dict]:
    env.ensure_data_dir()
    libraries = []
    for filename in sorted(os.listdir(env.DATA_DIR)):
        if filename in env.RUNTIME_STATE_FILENAMES or not filename.endswith(".json"):
            continue
        full_path = os.path.join(env.DATA_DIR, filename)
        libraries.append(env._get_library_summary(filename, full_path))
    return libraries


def get_library(env, name: str):
    return env.load_library_data(os.path.basename(name))


def invalidate_library_cache(env, name: str | None = None):
    with env.LIBRARY_CACHE_LOCK:
        if name is None:
            env.LIBRARY_CACHE.clear()
            env.invalidate_library_summary_cache(None)
            return
        env.LIBRARY_CACHE.pop(os.path.basename(name), None)
        env.invalidate_library_summary_cache(name)


def _load_library_summary_cache_locked(env):
    pass  # state belongs to the injected environment
    if env.LIBRARY_SUMMARY_CACHE_LOADED:
        return
    cached = env.load_json(env.LIBRARY_SUMMARY_CACHE_FILE, {})
    env.LIBRARY_SUMMARY_CACHE = cached if isinstance(cached, dict) else {}
    env.LIBRARY_SUMMARY_CACHE_LOADED = True


def _save_library_summary_cache_locked(env):
    pass  # state belongs to the injected environment
    if not env.LIBRARY_SUMMARY_CACHE_DIRTY:
        return
    env.ensure_data_dir()
    env.save_json(env.LIBRARY_SUMMARY_CACHE_FILE, env.LIBRARY_SUMMARY_CACHE)
    env.LIBRARY_SUMMARY_CACHE_DIRTY = False


def _get_library_summary(env, filename: str, full_path: str) -> dict[str, Any]:
    pass  # state belongs to the injected environment
    stat = os.stat(full_path)
    size = int(stat.st_size)
    mtime_ns = int(getattr(stat, "st_mtime_ns", int(stat.st_mtime * 1_000_000_000)))
    with env.LIBRARY_SUMMARY_CACHE_LOCK:
        env._load_library_summary_cache_locked()
        cached = env.LIBRARY_SUMMARY_CACHE.get(filename)
        if (
            isinstance(cached, dict)
            and cached.get("size") == size
            and cached.get("mtime_ns") == mtime_ns
            and isinstance(cached.get("count"), int)
        ):
            return {"filename": filename, "count": int(cached["count"]), "size": size}

    data = env.load_json(full_path, [])
    count = len(data) if isinstance(data, list) else 0
    with env.LIBRARY_SUMMARY_CACHE_LOCK:
        env._load_library_summary_cache_locked()
        env.LIBRARY_SUMMARY_CACHE[filename] = {"size": size, "mtime_ns": mtime_ns, "count": count}
        valid_names = {
            name
            for name in os.listdir(env.DATA_DIR)
            if name.endswith(".json") and name not in env.RUNTIME_STATE_FILENAMES
        }
        for stale_name in list(env.LIBRARY_SUMMARY_CACHE):
            if stale_name not in valid_names:
                env.LIBRARY_SUMMARY_CACHE.pop(stale_name, None)
        env.LIBRARY_SUMMARY_CACHE_DIRTY = True
        env._save_library_summary_cache_locked()
    return {"filename": filename, "count": count, "size": size}


def invalidate_library_summary_cache(env, name: str | None = None):
    pass  # state belongs to the injected environment
    with env.LIBRARY_SUMMARY_CACHE_LOCK:
        env._load_library_summary_cache_locked()
        if name is None:
            env.LIBRARY_SUMMARY_CACHE.clear()
        else:
            env.LIBRARY_SUMMARY_CACHE.pop(os.path.basename(name), None)
        env.LIBRARY_SUMMARY_CACHE_DIRTY = True
        env._save_library_summary_cache_locked()


def load_library_data(env, name: str) -> list[dict[str, Any]]:
    env.ensure_data_dir()
    filename = os.path.basename(name)
    full_path = os.path.join(env.DATA_DIR, filename)
    if not os.path.exists(full_path):
        return []

    try:
        stat = os.stat(full_path)
    except FileNotFoundError:
        return []

    with env.LIBRARY_CACHE_LOCK:
        cached = env.LIBRARY_CACHE.get(filename)
        if cached and cached.get("mtime") == stat.st_mtime:
            return cached["data"]

    data = env.load_json(full_path, [])
    if not isinstance(data, list):
        data = []

    with env.LIBRARY_CACHE_LOCK:
        env.LIBRARY_CACHE[filename] = {"mtime": stat.st_mtime, "data": data}

    return data


def get_library_entries_page(env, name: str, search: str = "", page: int = 1, limit: int = 120) -> dict[str, Any]:
    data = env.load_library_data(name)
    normalized_search = search.strip().lower()

    indexed_entries = [
        {"source_index": index, "entry": entry}
        for index, entry in enumerate(data)
    ]

    if normalized_search:
        filtered = [
            entry
            for entry in indexed_entries
            if normalized_search in json.dumps(entry["entry"], ensure_ascii=False).lower()
        ]
    else:
        filtered = indexed_entries

    total = len(filtered)
    page = max(1, page)
    limit = max(1, limit)
    start = (page - 1) * limit
    end = start + limit
    return {
        "name": os.path.basename(name),
        "data": [
            {
                **item["entry"],
                "source_index": item["source_index"],
            }
            for item in filtered[start:end]
        ],
        "total": total,
        "page": page,
        "limit": limit,
    }


def _build_artist_candidates(env, data: list[dict[str, Any]]) -> list[dict[str, Any]]:
    candidates = []
    for entry in data:
        primary = str(entry.get("name") or entry.get("title") or entry.get("prompt") or "").strip()
        if not primary:
            continue

        raw_other_names = entry.get("other_names")
        if isinstance(raw_other_names, list):
            other_names = [str(name).strip() for name in raw_other_names if str(name).strip()]
        elif isinstance(raw_other_names, str) and raw_other_names.strip():
            other_names = [part.strip() for part in raw_other_names.replace("/", ",").split(",") if part.strip()]
        else:
            other_names = []

        candidates.append(
            {
                "name": primary,
                "other_names": other_names,
                "post_count": int(entry.get("post_count") or 0),
            }
        )

    return candidates


def search_library_artists(env, 
    name: str,
    query: str = "",
    filter_mode: str = "none",
    post_threshold: int = 0,
    limit: int = 12,
) -> dict[str, Any]:
    data = env.load_library_data(name)
    candidates = env._build_artist_candidates(data)
    normalized_query = query.strip().lower()
    limit = max(1, min(int(limit), env.MAX_ARTIST_SEARCH_RESULTS))

    def matches(candidate: dict[str, Any]) -> bool:
        if normalized_query:
            haystacks = [candidate["name"].lower(), *[alias.lower() for alias in candidate["other_names"]]]
            if not any(normalized_query in haystack for haystack in haystacks):
                return False

        posts = int(candidate.get("post_count") or 0)
        if filter_mode == "gt":
            return posts > post_threshold
        if filter_mode == "lt":
            return posts < post_threshold
        return True

    filtered = [candidate for candidate in candidates if matches(candidate)]
    filtered.sort(key=lambda candidate: candidate["post_count"], reverse=True)
    return {
        "name": os.path.basename(name),
        "total": len(filtered),
        "data": filtered[:limit],
    }


def generate_artist_string(env, 
    name: str,
    query: str = "",
    count: int = 3,
    mode: str = "standard",
    preselected_names: list[str] | None = None,
    filter_mode: str = "none",
    post_threshold: int = 0,
    creative_bracket_style: str = "paren",
    creative_nest_levels: int = 0,
    standard_weight_min: float = 0.5,
    standard_weight_max: float = 1.5,
    nai_weight_min: float = 0.5,
    nai_weight_max: float = 1.5,
    enable_custom_format: bool = False,
    custom_format_string: str = "{name}",
) -> dict[str, Any]:
    import random

    count = max(1, min(20, count))
    preselected_names = [str(item).strip() for item in (preselected_names or []) if str(item).strip()]
    pool = env.search_library_artists(
        name=name,
        query=query,
        filter_mode=filter_mode,
        post_threshold=post_threshold,
        limit=env.MAX_ARTIST_SEARCH_RESULTS,
    )["data"]

    exclude = set(preselected_names[:count])
    remaining_pool = [candidate for candidate in pool if candidate["name"] not in exclude]
    random.shuffle(remaining_pool)
    names = [*preselected_names[:count], *[candidate["name"] for candidate in remaining_pool[: max(0, count - len(exclude))]]]

    def clamp_weight(value: float) -> float:
        return max(0, min(2, float(value)))

    def wrap_with_brackets(text: str, style: str, layers: int) -> str:
        open_bracket, close_bracket = "(", ")"
        if style == "curly":
            open_bracket, close_bracket = "{", "}"
        elif style == "square":
            open_bracket, close_bracket = "[", "]"

        result = text
        for _ in range(layers):
            result = f"{open_bracket}{result}{close_bracket}"
        return result

    formatted_names = names[:]
    if mode == "standard":
        low = clamp_weight(standard_weight_min)
        high = clamp_weight(standard_weight_max)
        if low > high:
            low, high = high, low
        formatted_names = [
            f"({artist}:{(low if low == high else round(random.uniform(low, high), 1)):.1f})"
            for artist in names
        ]
    elif mode == "creative":
        layers = max(0, min(5, creative_nest_levels))
        formatted_names = [
            wrap_with_brackets(artist, creative_bracket_style, layers or random.randint(1, 5))
            for artist in names
        ]
    elif mode == "nai":
        low = clamp_weight(nai_weight_min)
        high = clamp_weight(nai_weight_max)
        if low > high:
            low, high = high, low
        formatted_names = [
            f"{(low if low == high else round(random.uniform(low, high), 1)):.1f}::{artist} ::"
            for artist in names
        ]

    if enable_custom_format:
        formatter = custom_format_string or "{name}"
        formatted_names = [formatter.replace("{name}", artist) for artist in formatted_names]

    return {
        "ok": True,
        "names": names,
        "formatted": ", ".join(formatted_names),
        "available": len(pool),
    }


def get_library_raw_text(env, name: str) -> str:
    env.ensure_data_dir()
    full_path = os.path.join(env.DATA_DIR, os.path.basename(name))
    if not os.path.exists(full_path):
        raise FileNotFoundError("library not found")
    with open(full_path, "r", encoding="utf-8") as file:
        return file.read()


def update_library_entry(env, name: str, index: int, entry: dict[str, Any]) -> dict[str, Any]:
    data = env.load_library_data(name)
    if index < 0 or index >= len(data):
        raise IndexError("library entry index out of range")
    env.ensure_valid_library_entries([entry])
    data[index] = entry
    filename = env.normalize_library_filename(name)
    env.save_json(os.path.join(env.DATA_DIR, filename), data)
    env.invalidate_library_cache(filename)
    return {"ok": True, "name": filename, "count": len(data), "index": index}


def create_library_entry(env, name: str, entry: dict[str, Any]) -> dict[str, Any]:
    data = env.load_library_data(name)
    env.ensure_valid_library_entries([entry])
    data.append(entry)
    filename = env.normalize_library_filename(name)
    env.save_json(os.path.join(env.DATA_DIR, filename), data)
    env.invalidate_library_cache(filename)
    return {"ok": True, "name": filename, "count": len(data), "index": len(data) - 1}


def delete_library_entry(env, name: str, index: int) -> dict[str, Any]:
    data = env.load_library_data(name)
    if index < 0 or index >= len(data):
        raise IndexError("library entry index out of range")
    data.pop(index)
    filename = env.normalize_library_filename(name)
    env.save_json(os.path.join(env.DATA_DIR, filename), data)
    env.invalidate_library_cache(filename)
    return {"ok": True, "name": filename, "count": len(data), "index": index}


def delete_library(env, name: str):
    path = os.path.join(env.DATA_DIR, os.path.basename(name))
    if os.path.exists(path):
        env.move_path_to_trash(
            full_path=path,
            kind="library",
            original_path=os.path.basename(name),
        )
    env.invalidate_library_cache(name)
