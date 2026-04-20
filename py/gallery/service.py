from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import time
import uuid
from threading import Lock
from typing import Any

from ..constants import (
    DATA_DIR,
    IMPORT_IMAGE_SUBFOLDER,
    SUPPORTED_IMAGE_EXTENSIONS,
    SUPPORTED_LIBRARY_EXTENSIONS,
    THUMB_CACHE_DIR,
    TRASH_DIR,
)
from ..paths import (
    build_relative_display,
    ensure_data_dir,
    ensure_unique_path,
    ensure_trash_dir,
    get_comfy_base_dir,
    get_output_dir,
    load_json,
    load_trash_state,
    normalize_relative_path,
    save_json,
    save_trash_state,
    to_posix,
)
from .metadata import build_prompt_summary, extract_artist_prompts, read_image_metadata
from .state_store import (
    collect_categories,
    extract_image_states,
    extract_image_states_by_prefix,
    get_image_state,
    move_image_states,
    remove_image_states,
    remove_image_states_by_prefix,
    rename_image_state,
    restore_image_states,
    update_image_state,
)

try:
    from PIL import Image

    HAS_PIL = True
except ImportError:
    HAS_PIL = False


THUMB_SIZE = 480
IMAGE_INDEX_CACHE: dict[str, Any] = {"output_dir": None, "built_at": 0.0, "images": [], "subfolders": []}
IMAGE_INDEX_LOCK = Lock()
LIBRARY_CACHE: dict[str, dict[str, Any]] = {}
LIBRARY_CACHE_LOCK = Lock()


def ensure_trash_storage_dir() -> str:
    ensure_trash_dir()
    storage_dir = os.path.join(TRASH_DIR, "storage")
    os.makedirs(storage_dir, exist_ok=True)
    return storage_dir


def send_to_system_recycle_bin(path: str):
    normalized_path = os.path.abspath(path)
    if not os.path.exists(normalized_path):
        return

    escaped_path = normalized_path.replace("'", "''")
    if os.path.isdir(normalized_path):
        command = (
            "Add-Type -AssemblyName Microsoft.VisualBasic; "
            "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory("
            f"'{escaped_path}', "
            "[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, "
            "[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)"
        )
    else:
        command = (
            "Add-Type -AssemblyName Microsoft.VisualBasic; "
            "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile("
            f"'{escaped_path}', "
            "[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, "
            "[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)"
        )

    subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", command],
        check=True,
        capture_output=True,
        text=True,
    )


def add_trash_item(
    *,
    kind: str,
    name: str,
    original_path: str,
    storage_path: str,
    state_snapshot: dict[str, dict] | None = None,
    image_count: int | None = None,
) -> dict[str, Any]:
    trash_state = load_trash_state()
    item = {
        "id": uuid.uuid4().hex,
        "kind": kind,
        "name": name,
        "original_path": original_path,
        "storage_path": storage_path,
        "deleted_at": int(time.time()),
        "state_snapshot": state_snapshot or {},
        "image_count": image_count or 0,
    }
    trash_state.setdefault("items", []).insert(0, item)
    save_trash_state(trash_state)
    return item


def list_trash_items() -> list[dict[str, Any]]:
    trash_state = load_trash_state()
    output_dir = get_output_dir()
    items = []
    for item in trash_state.get("items", []):
        storage_path = item.get("storage_path", "")
        full_storage_path = os.path.join(TRASH_DIR, storage_path) if storage_path else ""
        trash_item = {**item}
        if item.get("kind") == "image" and os.path.exists(full_storage_path):
            filename = os.path.basename(full_storage_path)
            stat = os.stat(full_storage_path)
            relative = f"trash/{item.get('id')}/{filename}"
            trash_item.update(
                {
                    "filename": filename,
                    "relative_path": relative,
                    "url": f"/universal_gallery/api/trash/file?id={item.get('id')}",
                    "original_url": f"/universal_gallery/api/trash/file?id={item.get('id')}",
                    "thumb_url": f"/universal_gallery/api/trash/file?id={item.get('id')}&thumb=true",
                    "size": stat.st_size,
                    "created_at": int(stat.st_ctime),
                    "subfolder": "__trash__",
                    "title": "",
                    "category": "",
                    "notes": "",
                    "favorite": False,
                }
            )
        items.append(trash_item)

    return items


def get_trash_item(item_id: str) -> dict[str, Any] | None:
    trash_state = load_trash_state()
    return next((item for item in trash_state.get("items", []) if item.get("id") == item_id), None)


def remove_trash_item(item_id: str):
    trash_state = load_trash_state()
    trash_state["items"] = [item for item in trash_state.get("items", []) if item.get("id") != item_id]
    save_trash_state(trash_state)


def move_path_to_trash(*, full_path: str, kind: str, original_path: str, state_snapshot: dict[str, dict] | None = None, image_count: int | None = None):
    if not os.path.exists(full_path):
        raise FileNotFoundError("path not found")

    storage_dir = ensure_trash_storage_dir()
    extension = os.path.splitext(full_path)[1] if os.path.isfile(full_path) else ""
    storage_name = f"{uuid.uuid4().hex}{extension}"
    target_path = os.path.join(storage_dir, storage_name)
    shutil.move(full_path, target_path)

    return add_trash_item(
        kind=kind,
        name=os.path.basename(original_path.rstrip("/")) or os.path.basename(full_path),
        original_path=original_path,
        storage_path=os.path.relpath(target_path, TRASH_DIR),
        state_snapshot=state_snapshot,
        image_count=image_count,
    )


def restore_trash_item(item_id: str) -> dict[str, Any]:
    item = get_trash_item(item_id)
    if not item:
        raise FileNotFoundError("trash item not found")

    kind = item.get("kind")
    storage_path = os.path.join(TRASH_DIR, item.get("storage_path", ""))
    if not os.path.exists(storage_path):
        raise FileNotFoundError("trash storage not found")

    if kind in {"image", "folder"}:
        output_dir = _ensure_output_dir()
        original_path = normalize_relative_path(item.get("original_path", ""))
        target_path = os.path.join(output_dir, original_path)
        parent_dir = os.path.dirname(target_path)
        if parent_dir:
            os.makedirs(parent_dir, exist_ok=True)
        shutil.move(storage_path, target_path)
        if item.get("state_snapshot"):
            restore_image_states(item["state_snapshot"])
        invalidate_image_index_cache()
        remove_trash_item(item_id)
        return {"ok": True, "id": item_id, "subfolders": collect_subfolders(output_dir), "categories": collect_categories()}

    if kind == "library":
        ensure_data_dir()
        original_name = normalize_library_filename(item.get("original_path", ""))
        target_path = os.path.join(DATA_DIR, original_name)
        shutil.move(storage_path, target_path)
        invalidate_library_cache(original_name)
        remove_trash_item(item_id)
        return {"ok": True, "id": item_id}

    raise ValueError("unsupported trash item kind")


def purge_trash_item(item_id: str) -> dict[str, Any]:
    item = get_trash_item(item_id)
    if not item:
        raise FileNotFoundError("trash item not found")
    storage_path = os.path.join(TRASH_DIR, item.get("storage_path", ""))
    if os.path.exists(storage_path):
        send_to_system_recycle_bin(storage_path)
    remove_trash_item(item_id)
    return {"ok": True, "id": item_id}


class LibraryValidationError(ValueError):
    def __init__(self, issues: list[dict[str, Any]]):
        super().__init__("library validation failed")
        self.issues = issues


def validate_library_entries(data: Any) -> list[dict[str, Any]]:
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


def ensure_valid_library_entries(data: Any) -> list[dict[str, Any]]:
    issues = validate_library_entries(data)
    if issues:
        raise LibraryValidationError(issues)
    return data


def normalize_library_filename(name: str) -> str:
    clean_name = os.path.basename((name or "").strip())
    if not clean_name:
        raise ValueError("library name required")
    if not clean_name.endswith(".json"):
        clean_name = f"{clean_name}.json"
    return clean_name


def import_library_data(
    source_filename: str,
    raw_payload: bytes,
    mode: str = "create",
    target_name: str = "",
    new_name: str = "",
) -> dict[str, Any]:
    ensure_data_dir()

    try:
        parsed = json.loads(raw_payload.decode("utf-8"))
    except UnicodeDecodeError as error:
        raise ValueError("Library file must be UTF-8 encoded JSON.") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid JSON at line {error.lineno}, column {error.colno}.") from error

    entries = ensure_valid_library_entries(parsed)

    selected_mode = mode if mode in {"create", "replace", "merge"} else "create"
    source_name = normalize_library_filename(source_filename)

    if selected_mode == "create":
        preferred_name = normalize_library_filename(new_name or source_name)
        destination_path = ensure_unique_path(DATA_DIR, preferred_name)
        final_name = os.path.basename(destination_path)
        save_json(destination_path, entries)
        invalidate_library_cache(final_name)
        return {"ok": True, "name": final_name, "count": len(entries), "mode": selected_mode}

    final_name = normalize_library_filename(target_name)
    target_path = os.path.join(DATA_DIR, final_name)
    if not os.path.exists(target_path):
        raise FileNotFoundError("target library not found")

    if selected_mode == "replace":
        save_json(target_path, entries)
        invalidate_library_cache(final_name)
        return {"ok": True, "name": final_name, "count": len(entries), "mode": selected_mode}

    existing_entries = load_json(target_path, [])
    if not isinstance(existing_entries, list):
        existing_entries = []

    merged_entries = existing_entries + entries
    ensure_valid_library_entries(merged_entries)
    save_json(target_path, merged_entries)
    invalidate_library_cache(final_name)
    return {"ok": True, "name": final_name, "count": len(merged_entries), "mode": selected_mode}


def _ensure_output_dir() -> str:
    output_dir = get_output_dir()
    if not output_dir or not os.path.exists(output_dir):
        raise FileNotFoundError("output directory not found")
    return output_dir


def _ensure_within_output(output_dir: str, full_path: str) -> str:
    normalized_output = os.path.abspath(output_dir)
    normalized_path = os.path.abspath(full_path)
    try:
        common = os.path.commonpath([normalized_output, normalized_path])
    except ValueError as error:
        raise ValueError("invalid path") from error

    if common != normalized_output:
        raise ValueError("path must stay within output directory")
    return normalized_path


def resolve_subfolder_path(subfolder: str) -> tuple[str, str]:
    output_dir = _ensure_output_dir()
    normalized_subfolder = normalize_relative_path(subfolder)
    full_path = _ensure_within_output(output_dir, os.path.join(output_dir, normalized_subfolder))
    return normalized_subfolder, full_path


def build_view_url(relative_path: str) -> tuple[str, str]:
    import urllib.parse

    normalized = normalize_relative_path(relative_path)
    filename = os.path.basename(normalized)
    subfolder = to_posix(os.path.dirname(normalized)).strip(".")
    params: dict[str, str] = {"filename": filename, "type": "output"}
    if subfolder:
        params["subfolder"] = subfolder
    return f"/view?{urllib.parse.urlencode(params)}", subfolder


def build_thumb_url(relative_path: str) -> str:
    import urllib.parse

    params = urllib.parse.urlencode({"relative_path": normalize_relative_path(relative_path), "size": str(THUMB_SIZE)})
    return f"/universal_gallery/api/thumb?{params}"


def invalidate_image_index_cache():
    with IMAGE_INDEX_LOCK:
        IMAGE_INDEX_CACHE["images"] = []
        IMAGE_INDEX_CACHE["subfolders"] = []
        IMAGE_INDEX_CACHE["built_at"] = 0.0
        IMAGE_INDEX_CACHE["output_dir"] = None


def _build_image_index(output_dir: str) -> dict[str, Any]:
    images: list[dict[str, Any]] = []
    subfolders = set()
    stack = [output_dir]

    while stack:
      current_dir = stack.pop()
      try:
          with os.scandir(current_dir) as iterator:
              entries = list(iterator)
      except FileNotFoundError:
          continue

      for entry in entries:
          if entry.is_dir(follow_symlinks=False):
              stack.append(entry.path)
              continue

          if not entry.is_file(follow_symlinks=False) or not entry.name.lower().endswith(SUPPORTED_IMAGE_EXTENSIONS):
              continue

          try:
              stat = entry.stat()
          except FileNotFoundError:
              continue

          relative_path = normalize_relative_path(os.path.relpath(entry.path, output_dir))
          relative_dir = normalize_relative_path(os.path.dirname(relative_path))
          if relative_dir:
              parts = [part for part in relative_dir.split("/") if part]
              for index in range(len(parts)):
                  subfolders.add("/".join(parts[: index + 1]))

          original_url, resolved_subfolder = build_view_url(relative_path)
          images.append(
              {
                  "filename": entry.name,
                  "relative_path": relative_path,
                  "relative_dir": relative_dir.lower(),
                  "subfolder": resolved_subfolder,
                  "url": original_url,
                  "original_url": original_url,
                  "thumb_url": build_thumb_url(relative_path),
                  "size": stat.st_size,
                  "created_at": int(stat.st_ctime),
              }
          )

    images.sort(key=lambda item: item["created_at"], reverse=True)
    return {
        "output_dir": output_dir,
        "images": images,
        "subfolders": sorted(subfolders, key=lambda value: value.lower()),
        "built_at": time.time(),
    }


def get_image_index(force_refresh: bool = False) -> dict[str, Any]:
    output_dir = _ensure_output_dir()

    with IMAGE_INDEX_LOCK:
        should_rebuild = (
            force_refresh
            or IMAGE_INDEX_CACHE["output_dir"] != output_dir
            or not IMAGE_INDEX_CACHE["images"]
        )

        if should_rebuild:
            IMAGE_INDEX_CACHE.update(_build_image_index(output_dir))

        return {
            "output_dir": IMAGE_INDEX_CACHE["output_dir"],
            "images": list(IMAGE_INDEX_CACHE["images"]),
            "subfolders": list(IMAGE_INDEX_CACHE["subfolders"]),
            "built_at": IMAGE_INDEX_CACHE["built_at"],
        }


def collect_subfolders(output_dir: str, force_refresh: bool = False) -> list[str]:
    if not output_dir or not os.path.exists(output_dir):
        return []
    return get_image_index(force_refresh=force_refresh)["subfolders"]


def list_images(
    search: str = "",
    category: str = "",
    subfolder: str = "",
    favorites_only: bool = False,
    sort_by: str = "created_at",
    sort_order: str = "desc",
    force_refresh: bool = False,
) -> list[dict]:
    output_dir = _ensure_output_dir()
    normalized_search = search.strip().lower()
    normalized_category = category.strip().lower()
    normalized_subfolder = normalize_relative_path(subfolder).lower()

    indexed_images = get_image_index(force_refresh=force_refresh)["images"]
    images: list[dict[str, Any]] = []

    for indexed_image in indexed_images:
        image_state = get_image_state(indexed_image["relative_path"])
        haystack = " ".join(
            [
                indexed_image["filename"],
                indexed_image["relative_path"],
                str(image_state.get("title", "")),
                str(image_state.get("category", "")),
                str(image_state.get("notes", "")),
            ]
        ).lower()

        if normalized_search and normalized_search not in haystack:
            continue
        if normalized_category and normalized_category != str(image_state.get("category", "")).strip().lower():
            continue
        if normalized_subfolder and not (
            indexed_image["relative_dir"] == normalized_subfolder
            or indexed_image["relative_dir"].startswith(f"{normalized_subfolder}/")
        ):
            continue
        if favorites_only and not image_state.get("favorite", False):
            continue

        images.append({**indexed_image, **image_state})

    reverse = sort_order.lower() != "asc"
    if sort_by == "filename":
        images.sort(key=lambda item: item["filename"].lower(), reverse=reverse)
    elif sort_by == "size":
        images.sort(key=lambda item: item["size"], reverse=reverse)
    else:
        images.sort(key=lambda item: item["created_at"], reverse=reverse)

    return images


def get_gallery_context(force_refresh: bool = False) -> dict:
    output_dir = get_output_dir()
    base_dir = get_comfy_base_dir()
    import_dir = os.path.join(output_dir, IMPORT_IMAGE_SUBFOLDER) if output_dir else ""
    subfolders = collect_subfolders(output_dir, force_refresh=force_refresh) if output_dir else []

    return {
        "base_dir": base_dir,
        "output_dir_absolute": output_dir,
        "output_dir_relative": build_relative_display(output_dir, base_dir) if output_dir else "",
        "import_image_subfolder": IMPORT_IMAGE_SUBFOLDER,
        "import_image_target_relative": build_relative_display(import_dir, base_dir) if import_dir else "",
        "categories": collect_categories(),
        "subfolders": subfolders,
    }


def resolve_image_path(relative_path: str) -> tuple[str, str]:
    output_dir = get_output_dir()
    return output_dir, os.path.join(output_dir, normalize_relative_path(relative_path))


def get_image_metadata(relative_path: str) -> dict:
    normalized = normalize_relative_path(relative_path)
    _, full_path = resolve_image_path(normalized)
    metadata = read_image_metadata(full_path)
    workflow = metadata.get("workflow")
    return {
        "filename": os.path.basename(normalized),
        "relative_path": normalized,
        "metadata": metadata,
        "workflow": workflow if isinstance(workflow, dict) else None,
        "artist_prompts": extract_artist_prompts(metadata),
        "summary": build_prompt_summary(metadata),
        "state": get_image_state(normalized),
    }


def ensure_thumb_cache_dir():
    ensure_data_dir()
    os.makedirs(THUMB_CACHE_DIR, exist_ok=True)


def get_thumbnail_path(relative_path: str, size: int = THUMB_SIZE) -> tuple[str, str]:
    normalized = normalize_relative_path(relative_path)
    _, full_path = resolve_image_path(normalized)
    if not os.path.exists(full_path):
        raise FileNotFoundError("image not found")

    ensure_thumb_cache_dir()
    stat = os.stat(full_path)
    cache_key = hashlib.sha1(f"{normalized}|{int(stat.st_mtime)}|{size}".encode("utf-8")).hexdigest()
    thumb_path = os.path.join(THUMB_CACHE_DIR, f"{cache_key}.webp")

    if not os.path.exists(thumb_path):
        if not HAS_PIL:
            raise RuntimeError("Pillow is required for thumbnail generation")
        with Image.open(full_path) as image:
            image = image.convert("RGB")
            image.thumbnail((size, size))
            image.save(thumb_path, format="WEBP", quality=82, method=4)

    return full_path, thumb_path


def save_library(name: str, data):
    ensure_data_dir()
    validated_data = ensure_valid_library_entries(data)
    filename = normalize_library_filename(name)
    save_json(os.path.join(DATA_DIR, filename), validated_data)
    invalidate_library_cache(filename)
    return filename


def list_libraries() -> list[dict]:
    ensure_data_dir()
    libraries = []
    for filename in sorted(os.listdir(DATA_DIR)):
        if filename == "gallery_state.json" or not filename.endswith(".json"):
            continue
        full_path = os.path.join(DATA_DIR, filename)
        data = load_json(full_path, [])
        count = len(data) if isinstance(data, list) else 0
        libraries.append({"filename": filename, "count": count, "size": os.path.getsize(full_path)})
    return libraries


def get_library(name: str):
    return load_library_data(os.path.basename(name))


def invalidate_library_cache(name: str | None = None):
    with LIBRARY_CACHE_LOCK:
        if name is None:
            LIBRARY_CACHE.clear()
            return
        LIBRARY_CACHE.pop(os.path.basename(name), None)


def load_library_data(name: str) -> list[dict[str, Any]]:
    ensure_data_dir()
    filename = os.path.basename(name)
    full_path = os.path.join(DATA_DIR, filename)
    if not os.path.exists(full_path):
        return []

    try:
        stat = os.stat(full_path)
    except FileNotFoundError:
        return []

    with LIBRARY_CACHE_LOCK:
        cached = LIBRARY_CACHE.get(filename)
        if cached and cached.get("mtime") == stat.st_mtime:
            return cached["data"]

    data = load_json(full_path, [])
    if not isinstance(data, list):
        data = []

    with LIBRARY_CACHE_LOCK:
        LIBRARY_CACHE[filename] = {"mtime": stat.st_mtime, "data": data}

    return data


def get_library_entries_page(name: str, search: str = "", page: int = 1, limit: int = 120) -> dict[str, Any]:
    data = load_library_data(name)
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


def _build_artist_candidates(data: list[dict[str, Any]]) -> list[dict[str, Any]]:
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


def search_library_artists(
    name: str,
    query: str = "",
    filter_mode: str = "none",
    post_threshold: int = 0,
    limit: int = 12,
) -> dict[str, Any]:
    data = load_library_data(name)
    candidates = _build_artist_candidates(data)
    normalized_query = query.strip().lower()

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
        "data": filtered[: max(1, limit)],
    }


def generate_artist_string(
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
    pool = search_library_artists(
        name=name,
        query=query,
        filter_mode=filter_mode,
        post_threshold=post_threshold,
        limit=1000000,
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


def get_library_raw_text(name: str) -> str:
    ensure_data_dir()
    full_path = os.path.join(DATA_DIR, os.path.basename(name))
    if not os.path.exists(full_path):
        raise FileNotFoundError("library not found")
    with open(full_path, "r", encoding="utf-8") as file:
        return file.read()


def update_library_entry(name: str, index: int, entry: dict[str, Any]) -> dict[str, Any]:
    data = load_library_data(name)
    if index < 0 or index >= len(data):
        raise IndexError("library entry index out of range")
    ensure_valid_library_entries([entry])
    data[index] = entry
    filename = normalize_library_filename(name)
    save_json(os.path.join(DATA_DIR, filename), data)
    invalidate_library_cache(filename)
    return {"ok": True, "name": filename, "count": len(data), "index": index}


def create_library_entry(name: str, entry: dict[str, Any]) -> dict[str, Any]:
    data = load_library_data(name)
    ensure_valid_library_entries([entry])
    data.append(entry)
    filename = normalize_library_filename(name)
    save_json(os.path.join(DATA_DIR, filename), data)
    invalidate_library_cache(filename)
    return {"ok": True, "name": filename, "count": len(data), "index": len(data) - 1}


def delete_library_entry(name: str, index: int) -> dict[str, Any]:
    data = load_library_data(name)
    if index < 0 or index >= len(data):
        raise IndexError("library entry index out of range")
    data.pop(index)
    filename = normalize_library_filename(name)
    save_json(os.path.join(DATA_DIR, filename), data)
    invalidate_library_cache(filename)
    return {"ok": True, "name": filename, "count": len(data), "index": index}


def delete_library(name: str):
    path = os.path.join(DATA_DIR, os.path.basename(name))
    if os.path.exists(path):
        move_path_to_trash(
            full_path=path,
            kind="library",
            original_path=os.path.basename(name),
        )
    invalidate_library_cache(name)


def import_files_from_parts(parts) -> dict:
    output_dir = get_output_dir()
    image_import_dir = os.path.join(output_dir, IMPORT_IMAGE_SUBFOLDER)
    os.makedirs(image_import_dir, exist_ok=True)
    ensure_data_dir()

    imported_images = []
    imported_libraries = []
    skipped = []

    for part in parts:
        original_name = os.path.basename(part.filename)
        extension = os.path.splitext(original_name)[1].lower()

        if extension in SUPPORTED_IMAGE_EXTENSIONS:
            target_path = ensure_unique_path(image_import_dir, original_name)
        elif extension in SUPPORTED_LIBRARY_EXTENSIONS:
            target_path = ensure_unique_path(DATA_DIR, original_name)
        else:
            skipped.append({"filename": original_name, "reason": "unsupported file type"})
            continue

        yield ("write", part, target_path)

        if extension in SUPPORTED_IMAGE_EXTENSIONS:
            imported_images.append(
                {
                    "filename": os.path.basename(target_path),
                    "relative_path": normalize_relative_path(
                        os.path.join(IMPORT_IMAGE_SUBFOLDER, os.path.basename(target_path))
                    ),
                }
            )
        else:
            imported_libraries.append({"filename": os.path.basename(target_path)})

    invalidate_image_index_cache()
    yield (
        "result",
        {
            "ok": True,
            "imported_images": imported_images,
            "imported_libraries": imported_libraries,
            "skipped": skipped,
        },
    )


def persist_image_state(relative_path: str, updates: dict) -> dict:
    state, categories = update_image_state(normalize_relative_path(relative_path), updates)
    return {"ok": True, "state": state, "categories": categories}


def rename_image(relative_path: str, new_filename: str) -> dict:
    normalized = normalize_relative_path(relative_path)
    output_dir, full_path = resolve_image_path(normalized)
    if not os.path.exists(full_path):
        raise FileNotFoundError("image not found")

    clean_name = os.path.basename(new_filename).strip()
    if not clean_name:
        raise ValueError("new filename required")

    original_ext = os.path.splitext(normalized)[1]
    if not os.path.splitext(clean_name)[1]:
        clean_name = f"{clean_name}{original_ext}"

    target_relative = normalize_relative_path(os.path.join(os.path.dirname(normalized), clean_name))
    target_full_path = os.path.join(output_dir, target_relative)
    if os.path.exists(target_full_path):
        raise FileExistsError("target filename already exists")

    os.rename(full_path, target_full_path)
    state, categories = rename_image_state(normalized, target_relative)
    invalidate_image_index_cache()
    url, subfolder = build_view_url(target_relative)
    stat = os.stat(target_full_path)

    return {
        "ok": True,
        "image": {
            "filename": os.path.basename(target_relative),
            "relative_path": target_relative,
            "subfolder": subfolder,
            "url": url,
            "original_url": url,
            "thumb_url": build_thumb_url(target_relative),
            "size": stat.st_size,
            "created_at": int(stat.st_ctime),
            **state,
        },
        "categories": categories,
    }


def batch_rename_images(
    relative_paths: list[str],
    template: str,
    start_number: int = 1,
    padding: int = 2,
    current_page: int = 1,
) -> dict[str, Any]:
    if not relative_paths:
        raise ValueError("relative_paths required")

    clean_template = str(template or "").strip()
    if not clean_template:
        raise ValueError("template required")

    output_dir = _ensure_output_dir()
    padding = max(1, min(8, int(padding)))
    start_number = max(0, int(start_number))
    current_page = max(1, int(current_page))

    source_paths: list[tuple[str, str, str]] = []
    selected_set = {normalize_relative_path(path) for path in relative_paths}

    for normalized in relative_paths:
        normalized_source = normalize_relative_path(normalized)
        _, full_path = resolve_image_path(normalized_source)
        if not os.path.exists(full_path):
            raise FileNotFoundError(f"image not found: {normalized_source}")

        filename = os.path.basename(normalized_source)
        stem, ext = os.path.splitext(filename)
        source_paths.append((normalized_source, stem, ext))

    def build_target_name(original_name: str, index: int, extension: str) -> str:
        serial = str(start_number + index).zfill(padding)
        rendered = (
            clean_template
            .replace("{n}", serial)
            .replace("{name}", original_name)
            .replace("{page}", str(current_page))
        )
        rendered = os.path.basename(rendered).strip().strip(".")
        if not rendered:
            raise ValueError("template generated an empty filename")
        return f"{rendered}{extension}"

    target_mapping: dict[str, str] = {}
    seen_targets: set[str] = set()

    for index, (source_relative, original_stem, extension) in enumerate(source_paths):
        next_filename = build_target_name(original_stem, index, extension)
        target_relative = normalize_relative_path(os.path.join(os.path.dirname(source_relative), next_filename))

        if target_relative in seen_targets:
            raise FileExistsError(f"duplicate target filename: {next_filename}")
        seen_targets.add(target_relative)

        target_full_path = os.path.join(output_dir, target_relative)
        if os.path.exists(target_full_path) and target_relative not in selected_set:
            raise FileExistsError(f"target filename already exists: {next_filename}")

        target_mapping[source_relative] = target_relative

    temporary_mapping: dict[str, str] = {}
    for source_relative, _, extension in source_paths:
        temp_filename = f".ue-rename-{uuid.uuid4().hex}{extension}"
        temp_relative = normalize_relative_path(os.path.join(os.path.dirname(source_relative), temp_filename))
        temporary_mapping[source_relative] = temp_relative
        os.rename(os.path.join(output_dir, source_relative), os.path.join(output_dir, temp_relative))

    try:
        for source_relative, temp_relative in temporary_mapping.items():
          os.rename(os.path.join(output_dir, temp_relative), os.path.join(output_dir, target_mapping[source_relative]))
    except Exception:
        for source_relative, temp_relative in temporary_mapping.items():
            temp_full_path = os.path.join(output_dir, temp_relative)
            source_full_path = os.path.join(output_dir, source_relative)
            if os.path.exists(temp_full_path) and not os.path.exists(source_full_path):
                os.rename(temp_full_path, source_full_path)
        raise

    categories = move_image_states(target_mapping)
    invalidate_image_index_cache()
    return {
        "ok": True,
        "renamed": list(target_mapping.values()),
        "categories": categories,
    }


def create_folder(subfolder: str) -> dict[str, Any]:
    normalized_subfolder, full_path = resolve_subfolder_path(subfolder)
    if not normalized_subfolder:
        raise ValueError("folder path required")
    os.makedirs(full_path, exist_ok=True)
    invalidate_image_index_cache()
    return {"ok": True, "path": normalized_subfolder, "subfolders": collect_subfolders(_ensure_output_dir())}


def delete_folder(subfolder: str) -> dict[str, Any]:
    normalized_subfolder, full_path = resolve_subfolder_path(subfolder)
    if not normalized_subfolder:
        raise ValueError("cannot delete root output directory")
    if not os.path.exists(full_path):
        raise FileNotFoundError("folder not found")

    state_snapshot, categories = extract_image_states_by_prefix(normalized_subfolder)
    image_count = len(state_snapshot)
    move_path_to_trash(
        full_path=full_path,
        kind="folder",
        original_path=normalized_subfolder,
        state_snapshot=state_snapshot,
        image_count=image_count,
    )
    invalidate_image_index_cache()
    return {
        "ok": True,
        "path": normalized_subfolder,
        "subfolders": collect_subfolders(_ensure_output_dir()),
        "categories": categories,
    }


def merge_folder(source_subfolder: str, target_subfolder: str) -> dict[str, Any]:
    source_relative, source_full_path = resolve_subfolder_path(source_subfolder)
    target_relative, target_full_path = resolve_subfolder_path(target_subfolder)

    if not source_relative or not target_relative:
        raise ValueError("source and target folders required")
    if source_relative == target_relative:
        raise ValueError("source and target folder must be different")
    if not os.path.exists(source_full_path):
        raise FileNotFoundError("source folder not found")
    os.makedirs(target_full_path, exist_ok=True)

    path_mapping: dict[str, str] = {}
    output_dir = _ensure_output_dir()
    for root, dirs, files in os.walk(source_full_path):
        relative_root = os.path.relpath(root, source_full_path)
        relative_root = "" if relative_root == "." else normalize_relative_path(relative_root)
        destination_root = os.path.join(target_full_path, relative_root) if relative_root else target_full_path
        os.makedirs(destination_root, exist_ok=True)

        for directory in dirs:
            os.makedirs(os.path.join(destination_root, directory), exist_ok=True)

        for filename in files:
            source_file = os.path.join(root, filename)
            destination_file = ensure_unique_path(destination_root, filename)
            shutil.move(source_file, destination_file)

            source_rel_path = normalize_relative_path(os.path.relpath(source_file, output_dir))
            destination_rel_path = normalize_relative_path(os.path.relpath(destination_file, output_dir))
            path_mapping[source_rel_path] = destination_rel_path

    shutil.rmtree(source_full_path, ignore_errors=True)
    categories = move_image_states(path_mapping)
    invalidate_image_index_cache()
    return {
        "ok": True,
        "source_path": source_relative,
        "target_path": target_relative,
        "moved": len(path_mapping),
        "subfolders": collect_subfolders(_ensure_output_dir()),
        "categories": categories,
    }


def move_images(relative_paths: list[str], target_subfolder: str) -> dict[str, Any]:
    normalized_target, target_full_path = resolve_subfolder_path(target_subfolder)
    os.makedirs(target_full_path, exist_ok=True)

    moved: list[str] = []
    missing: list[str] = []
    path_mapping: dict[str, str] = {}

    output_dir = _ensure_output_dir()
    for relative_path in relative_paths:
        normalized_source = normalize_relative_path(relative_path)
        _, source_full_path = resolve_image_path(normalized_source)
        if not os.path.exists(source_full_path):
            missing.append(normalized_source)
            continue

        destination_file = ensure_unique_path(target_full_path, os.path.basename(normalized_source))
        shutil.move(source_full_path, destination_file)
        destination_relative = normalize_relative_path(os.path.relpath(destination_file, output_dir))
        path_mapping[normalized_source] = destination_relative
        moved.append(destination_relative)

    categories = move_image_states(path_mapping)
    invalidate_image_index_cache()
    return {
        "ok": True,
        "moved": moved,
        "missing": missing,
        "categories": categories,
        "subfolders": collect_subfolders(output_dir),
    }


def delete_images(relative_paths: list[str]) -> dict:
    deleted = []
    missing = []
    output_dir = get_output_dir()
    state_snapshot, categories = extract_image_states(relative_paths)

    for relative_path in relative_paths:
        normalized = normalize_relative_path(relative_path)
        _, full_path = resolve_image_path(normalized)
        if os.path.exists(full_path):
            move_path_to_trash(
                full_path=full_path,
                kind="image",
                original_path=normalized,
                state_snapshot={normalized: state_snapshot.get(normalized, {})} if normalized in state_snapshot else {},
            )
            deleted.append(normalized)
        else:
            missing.append(normalized)

    invalidate_image_index_cache()
    return {"ok": True, "deleted": deleted, "missing": missing, "categories": categories}


def batch_update_images(relative_paths: list[str], updates: dict) -> dict:
    touched = []
    last_state = None
    categories = collect_categories()

    for relative_path in relative_paths:
        normalized = normalize_relative_path(relative_path)
        _, full_path = resolve_image_path(normalized)
        if not os.path.exists(full_path):
            continue
        last_state, categories = update_image_state(normalized, updates)
        touched.append(normalized)

    return {"ok": True, "updated": touched, "last_state": last_state, "categories": categories}
