"""sources domain. Dependencies are injected by the host."""
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
from .environment import SOURCE_SNAPSHOT
from .execution import QUERY_ONLY, DEFER_INDEX_REFRESH

def _default_gallery_sources(env) -> list[dict[str, Any]]:
    output_dir = env.get_output_dir()
    input_dir = env.get_input_dir()
    sources = [
        {
            "id": env.DEFAULT_OUTPUT_SOURCE_ID,
            "name": "ComfyUI Output",
            "kind": "output",
            "path": output_dir,
            "enabled": True,
            "writable": True,
            "recursive": True,
            "import_target": True,
            "locked": True,
        }
    ]
    sources.append(
        {
            "id": env.DEFAULT_INPUT_SOURCE_ID,
            "name": "ComfyUI Input",
            "kind": "input",
            "path": input_dir,
            "enabled": True,
            "writable": False,
            "recursive": True,
            "import_target": False,
            "locked": True,
        }
    )
    return sources


def _source_exists(env, path: str) -> bool:
    return bool(path) and os.path.isdir(os.path.expanduser(str(path)))


def _normalize_source(env, raw: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
    existing = existing or {}
    source_id = env._sanitize_source_id(raw.get("id") or existing.get("id") or raw.get("name") or "custom")
    locked = bool(existing.get("locked", raw.get("locked", False)))
    kind = str(raw.get("kind") or existing.get("kind") or "custom").strip().lower()
    if kind not in {"output", "input", "custom"}:
        kind = "custom"
    path = str(raw.get("path") if "path" in raw else existing.get("path", "")).strip()
    source = {
        "id": source_id,
        "name": str(raw.get("name") or existing.get("name") or source_id).strip(),
        "kind": kind,
        "path": path,
        "enabled": bool(raw.get("enabled", existing.get("enabled", True))),
        "writable": bool(raw.get("writable", existing.get("writable", False))),
        "recursive": bool(raw.get("recursive", existing.get("recursive", True))),
        "import_target": bool(raw.get("import_target", raw.get("importTarget", existing.get("import_target", False)))),
        "locked": locked,
    }
    if locked and existing.get("path"):
        source["path"] = existing["path"]
    if not source["name"]:
        source["name"] = source_id
    source["exists"] = env._source_exists(source["path"])
    return env._harden_source(source)


def _load_gallery_sources_file(env) -> list[dict[str, Any]]:
    env.ensure_data_dir()
    data = env.load_json(env.GALLERY_SOURCES_FILE, {"sources": []})
    if isinstance(data, dict):
        raw_sources = data.get("sources", [])
    elif isinstance(data, list):
        raw_sources = data
    else:
        raw_sources = []
    return [item for item in raw_sources if isinstance(item, dict)]


def _write_gallery_sources_file(env, sources: list[dict[str, Any]]):
    stored_sources = [
        {key: value for key, value in source.items() if key not in {"exists", "image_count", "security_error"}}
        for source in sources
    ]
    env.save_json(env.GALLERY_SOURCES_FILE, {"sources": stored_sources})


def list_gallery_sources(env) -> list[dict[str, Any]]:
    snapshot = SOURCE_SNAPSHOT.get()
    if snapshot is not None:
        return snapshot
    defaults = env._default_gallery_sources()
    default_by_id = {source["id"]: source for source in defaults}
    custom_sources: list[dict[str, Any]] = []

    for raw_source in env._load_gallery_sources_file():
        source_id = env._sanitize_source_id(raw_source.get("id") or raw_source.get("name") or "custom")
        if source_id in default_by_id:
            default_by_id[source_id] = env._normalize_source(raw_source, default_by_id[source_id])
        else:
            custom_sources.append(env._normalize_source({**raw_source, "id": source_id, "kind": "custom"}))

    sources = [env._normalize_source(default_by_id[source["id"]], source) for source in defaults]
    sources.extend(custom_sources)
    import_targets = [source for source in sources if source.get("enabled") and source.get("writable") and source.get("import_target")]
    if not import_targets:
        for source in sources:
            if source["id"] == env.DEFAULT_OUTPUT_SOURCE_ID and source.get("enabled") and source.get("writable"):
                source["import_target"] = True
                break
    return sources


def _source_signature(env, sources: list[dict[str, Any]]) -> str:
    payload = [
        {
            "id": source.get("id"),
            "path": env._real_abs(source.get("path", "")) if source.get("path") else "",
            "enabled": bool(source.get("enabled")),
            "exists": bool(source.get("exists")),
            "recursive": bool(source.get("recursive", True)),
        }
        for source in sources
    ]
    return json.dumps(payload, sort_keys=True, ensure_ascii=False)


def get_gallery_source(env, source_id: str) -> dict[str, Any]:
    normalized_id = env._sanitize_source_id(source_id)
    for source in env.list_gallery_sources():
        if source["id"] == normalized_id:
            return source
    raise FileNotFoundError("gallery source not found")


def save_gallery_source(env, payload: dict[str, Any]) -> dict[str, Any]:
    sources = env.list_gallery_sources()
    incoming_id = env._sanitize_source_id(payload.get("id") or payload.get("name") or "custom")
    existing = next((source for source in sources if source["id"] == incoming_id), None)
    source = env._normalize_source({**payload, "id": incoming_id}, existing)
    if not source.get("path"):
        raise ValueError("source path required")
    if source.get("security_error"):
        raise ValueError(str(source["security_error"]))

    if existing:
        source["locked"] = bool(existing.get("locked", False))
        if source["locked"]:
            source["id"] = existing["id"]
            source["kind"] = existing["kind"]
            source["path"] = existing["path"]
            source["name"] = existing["name"]
            source = env._normalize_source(source, existing)
        sources = [source if item["id"] == source["id"] else item for item in sources]
    else:
        source["kind"] = "custom"
        source["locked"] = False
        source = env._normalize_source(source)
        sources.append(source)

    if source.get("import_target"):
        for item in sources:
            if item["id"] != source["id"]:
                item["import_target"] = False

    env._write_gallery_sources_file(sources)
    env.invalidate_image_index_cache()
    return {"ok": True, "source": source, "sources": env.list_gallery_sources()}


def delete_gallery_source(env, source_id: str) -> dict[str, Any]:
    normalized_id = env._sanitize_source_id(source_id)
    sources = env.list_gallery_sources()
    source = next((item for item in sources if item["id"] == normalized_id), None)
    if not source:
        raise FileNotFoundError("gallery source not found")
    if source.get("locked"):
        raise ValueError("default sources cannot be deleted")
    remaining = [item for item in sources if item["id"] != normalized_id]
    env._write_gallery_sources_file(remaining)
    env.invalidate_image_index_cache()
    return {"ok": True, "id": normalized_id, "sources": env.list_gallery_sources()}


def test_gallery_source_path(env, path: str) -> dict[str, Any]:
    clean_path = str(path or "").strip()
    if not clean_path:
        raise ValueError("source path required")
    full_path = env._real_abs(clean_path)
    exists = os.path.isdir(full_path)
    writable = False
    image_count = 0
    if exists:
        writable = os.access(full_path, os.W_OK)
        try:
            for entry in os.scandir(full_path):
                if entry.is_file(follow_symlinks=False) and entry.name.lower().endswith(env.SUPPORTED_IMAGE_EXTENSIONS):
                    image_count += 1
        except OSError:
            pass
    within_safe_root = env._path_is_within_any(full_path, env._safe_source_roots()) if exists else False
    allowed = exists and (env._external_sources_allowed() or within_safe_root)
    return {
        "ok": bool(exists and allowed),
        "path": full_path,
        "exists": exists,
        "writable": writable if allowed and within_safe_root else False,
        "image_count": image_count if allowed else 0,
        "security_error": "" if allowed else "source path is outside the allowed ComfyUI directory",
    }


def diagnose_gallery_sources(env) -> dict[str, Any]:
    diagnostics: list[dict[str, Any]] = []
    normalized_paths: dict[str, str] = {}
    for source in env.list_gallery_sources():
        path = source.get("path", "")
        full_path = env._real_abs(path) if path else ""
        exists = bool(full_path) and os.path.isdir(full_path)
        readable = bool(exists and os.access(full_path, os.R_OK))
        writable_actual = bool(exists and os.access(full_path, os.W_OK))
        image_count = 0
        directory_count = 0
        error = ""
        free_bytes = None
        total_bytes = None
        overlaps: list[str] = []

        if exists:
            try:
                usage = shutil.disk_usage(full_path)
                free_bytes = usage.free
                total_bytes = usage.total
            except OSError:
                pass
            try:
                if source.get("recursive", True):
                    for root, dirs, files in os.walk(full_path):
                        dirs[:] = [directory for directory in dirs if not os.path.islink(os.path.join(root, directory))]
                        directory_count += len(dirs)
                        image_count += sum(1 for filename in files if filename.lower().endswith(env.SUPPORTED_IMAGE_EXTENSIONS))
                else:
                    with os.scandir(full_path) as iterator:
                        for entry in iterator:
                            if entry.is_dir(follow_symlinks=False):
                                if entry.name == ".ue-uploads":
                                    continue
                                directory_count += 1
                            elif entry.is_file(follow_symlinks=False) and entry.name.lower().endswith(env.SUPPORTED_IMAGE_EXTENSIONS):
                                image_count += 1
            except OSError as scan_error:
                error = str(scan_error)

        for other_id, other_path in normalized_paths.items():
            try:
                if full_path and other_path and os.path.commonpath([full_path, other_path]) in {full_path, other_path}:
                    overlaps.append(other_id)
            except ValueError:
                continue
        if full_path:
            normalized_paths[source["id"]] = full_path

        if not exists:
            status = "missing"
        elif error:
            status = "error"
        elif not readable:
            status = "unreadable"
        elif source.get("writable") and not writable_actual:
            status = "write_blocked"
        elif overlaps:
            status = "overlap"
        else:
            status = "ok"

        diagnostics.append(
            {
                **source,
                "path": full_path or path,
                "status": status,
                "readable": readable,
                "writable_actual": writable_actual,
                "configured_writable": bool(source.get("writable")),
                "image_count": image_count,
                "directory_count": directory_count,
                "free_bytes": free_bytes,
                "total_bytes": total_bytes,
                "overlaps": overlaps,
                "error": error,
            }
        )

    return {"ok": True, "sources": diagnostics}


def image_ref_for_full_path(env, full_path: str) -> str:
    normalized_path = env._real_abs(full_path)
    for source in env.list_gallery_sources():
        source_path = source.get("path", "")
        if not source_path:
            continue
        try:
            if os.path.commonpath([env._real_abs(source_path), normalized_path]) != env._real_abs(source_path):
                continue
        except ValueError:
            continue
        relative_path = env.normalize_relative_path(os.path.relpath(normalized_path, env._real_abs(source_path)))
        return env.make_image_ref(source["id"], relative_path)
    output_dir = env._ensure_output_dir()
    return env.normalize_relative_path(os.path.relpath(normalized_path, output_dir))


def _ensure_output_dir(env) -> str:
    output_dir = env.get_output_dir()
    if not output_dir or not os.path.exists(output_dir):
        raise FileNotFoundError("output directory not found")
    return output_dir


def _ensure_within_output(env, output_dir: str, full_path: str) -> str:
    return env._ensure_within_directory(output_dir, full_path, "output")


def resolve_subfolder_path(env, subfolder: str) -> tuple[str, str]:
    output_dir = env._ensure_output_dir()
    normalized_subfolder = env.normalize_relative_path(subfolder)
    full_path = env._ensure_within_output(output_dir, os.path.join(output_dir, normalized_subfolder))
    return normalized_subfolder, full_path


def _resolve_folder_ref_path(env, folder_ref: str, *, require_writable: bool = True) -> tuple[dict[str, Any], str, str]:
    source_id, relative_dir = env.parse_folder_ref(folder_ref)
    return env.resolve_source_subfolder_path(source_id, relative_dir, require_writable=require_writable)


def _normalize_folder_ref_for_source(env, source_id: str, relative_dir: str) -> str:
    return env.make_folder_ref(source_id, relative_dir)


def _image_state_folder_prefix(env, source_id: str, relative_dir: str) -> str:
    return relative_dir if env._sanitize_source_id(source_id) == env.DEFAULT_OUTPUT_SOURCE_ID else env.make_folder_ref(source_id, relative_dir)


def _coerce_target_folder_ref(env, target_folder: str, default_source_id: str) -> str:
    value = str(target_folder or "").strip()
    if env.IMAGE_REF_SEPARATOR in value:
        return value
    return env._normalize_folder_ref_for_source(default_source_id, value)


def resolve_source_subfolder_path(env, source_id: str, subfolder: str = "", *, require_writable: bool = False) -> tuple[dict[str, Any], str, str]:
    source = env.get_gallery_source(source_id)
    if not source.get("enabled", True):
        raise ValueError("gallery source is disabled")
    if require_writable and not source.get("writable"):
        raise ValueError("target gallery source is read-only")
    source_path = source.get("path", "")
    if not source_path or not os.path.isdir(os.path.expanduser(source_path)):
        raise FileNotFoundError("gallery source directory not found")
    normalized_subfolder = env.normalize_relative_path(subfolder)
    full_path = env._ensure_within_directory(source_path, os.path.join(source_path, normalized_subfolder), source["name"])
    return source, normalized_subfolder, full_path


def resolve_image_path(env, relative_path: str) -> tuple[str, str]:
    source_id, source_relative_path = env.parse_image_ref(relative_path)
    if not source_relative_path.lower().endswith(env.SUPPORTED_IMAGE_EXTENSIONS):
        raise ValueError("relative_path must reference a supported image file")
    source = env.get_gallery_source(source_id)
    if not source.get("enabled", True):
        raise ValueError("gallery source is disabled")
    source_path = source.get("path", "")
    if not source_path or not os.path.isdir(os.path.expanduser(source_path)):
        raise FileNotFoundError("gallery source directory not found")
    full_path = env._ensure_within_directory(source_path, os.path.join(source_path, source_relative_path), source["name"])
    env._ensure_supported_image_path(full_path)
    return source_path, full_path


def build_view_url(env, relative_path: str) -> tuple[str, str]:
    import urllib.parse

    source_id, source_relative_path = env.parse_image_ref(relative_path)
    image_ref = env.make_image_ref(source_id, source_relative_path)
    filename = os.path.basename(source_relative_path)
    subfolder = env.to_posix(os.path.dirname(source_relative_path)).strip(".")
    if source_id != env.DEFAULT_OUTPUT_SOURCE_ID:
        params = urllib.parse.urlencode({"relative_path": image_ref})
        return f"/universal_gallery/api/image-file?{params}", subfolder

    params: dict[str, str] = {"filename": filename, "type": "output"}
    if subfolder:
        params["subfolder"] = subfolder
    return f"/view?{urllib.parse.urlencode(params)}", subfolder


def build_thumb_url(env, relative_path: str) -> str:
    import urllib.parse

    source_id, source_relative_path = env.parse_image_ref(relative_path)
    image_ref = env.make_image_ref(source_id, source_relative_path)
    params = urllib.parse.urlencode({"relative_path": image_ref, "size": str(env.THUMB_SIZE)})
    return f"/universal_gallery/api/thumb?{params}"


def _collect_index_subfolders(env, source_id: str, relative_dir: str, subfolders: set[str]):
    if not relative_dir:
        return
    parts = [part for part in relative_dir.split("/") if part]
    for index in range(len(parts)):
        folder_path = "/".join(parts[: index + 1])
        subfolders.add(env.make_folder_ref(source_id, folder_path))


def _folder_ref_key(env, folder_ref: str) -> tuple[str, str]:
    source_id, relative_dir = env.parse_folder_ref(folder_ref)
    return source_id, relative_dir.casefold()


def _merge_subfolder_refs(env, *groups: set[str]) -> set[str]:
    merged: dict[tuple[str, str], str] = {}
    for group in groups:
        for folder_ref in group:
            normalized_ref = env.normalize_relative_path(folder_ref)
            if not normalized_ref:
                continue
            merged.setdefault(env._folder_ref_key(normalized_ref), normalized_ref)
    return set(merged.values())


class FolderSnapshot(dict):
    def __init__(self):
        super().__init__()
        self.failed_sources = set()


def _collect_directory_subfolder_details(env, sources: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    subfolders = FolderSnapshot()
    if QUERY_ONLY.get() or DEFER_INDEX_REFRESH.get():
        if not os.path.exists(env.GALLERY_INDEX_DB_FILE):
            return subfolders
        source_by_id = {source["id"]: source for source in sources if source.get("enabled")}
        with env._connect_gallery_index_db() as db:
            for row in db.execute("SELECT * FROM gallery_folders"):
                source = source_by_id.get(row["source_id"])
                if source and source["path"] == row["source_path"]:
                    folder_ref = env.make_folder_ref(row["source_id"], row["relative_path"])
                    subfolders[folder_ref] = {"path": folder_ref, "source_id": row["source_id"],
                                             "relative_path": row["relative_path"], "modified_at": row["modified_at"]}
        return subfolders
    for source in sources:
        if not source.get("enabled", True) or not source.get("exists"):
            continue

        source_root = source.get("path", "")
        if not source_root or not os.path.isdir(source_root):
            continue

        stack = [source_root]
        while stack:
            current_dir = stack.pop()
            try:
                with os.scandir(current_dir) as iterator:
                    entries = list(iterator)
            except (FileNotFoundError, PermissionError, OSError):
                subfolders.failed_sources.add(source["id"])
                continue

            for entry in entries:
                if not entry.is_dir(follow_symlinks=False):
                    continue
                if entry.name == ".ue-uploads" or entry.name.startswith(".ue-move-"):
                    continue

                relative_dir = env.normalize_relative_path(os.path.relpath(entry.path, source_root))
                if relative_dir:
                    folder_ref = env.make_folder_ref(source["id"], relative_dir)
                    try:
                        stat = entry.stat(follow_symlinks=False)
                        modified_at = int(stat.st_mtime)
                    except OSError:
                        modified_at = 0
                    subfolders[folder_ref] = {
                        "path": folder_ref,
                        "source_id": source["id"],
                        "relative_path": relative_dir,
                        "modified_at": modified_at,
                    }

                if source.get("recursive", True):
                    stack.append(entry.path)

    return subfolders


def _collect_directory_subfolders(env, sources: list[dict[str, Any]]) -> set[str]:
    return set(env._collect_directory_subfolder_details(sources))


def build_move_target_options(env, image_index: dict[str, Any]) -> list[dict[str, str]]:
    sources = image_index.get("sources", [])
    options: list[dict[str, str]] = []
    for source in sources:
        if not source.get("enabled") or not source.get("exists") or not source.get("writable"):
            continue
        source_id = source["id"]
        source_name = source["name"]
        options.append(
            {
                "value": env.make_folder_ref(source_id, ""),
                "source_id": source_id,
                "source_name": source_name,
                "subfolder": "",
                "label": f"{source_name} / ./",
            }
        )
        for subfolder in image_index.get("subfolders", []):
            folder_source_id, folder_relative = env.parse_folder_ref(subfolder)
            if folder_source_id != source_id or not folder_relative:
                continue
            options.append(
                {
                    "value": env.make_folder_ref(source_id, folder_relative),
                    "source_id": source_id,
                    "source_name": source_name,
                    "subfolder": folder_relative,
                    "label": f"{source_name} / {folder_relative}",
                }
            )
    return options
