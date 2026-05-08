from __future__ import annotations

import hashlib
import colorsys
import json
import os
import sqlite3
import shutil
import subprocess
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import BoundedSemaphore, Lock
from typing import Any

from ..constants import (
    DATA_DIR,
    GALLERY_SOURCES_FILE,
    IMPORT_IMAGE_SUBFOLDER,
    SUPPORTED_IMAGE_EXTENSIONS,
    SUPPORTED_LIBRARY_EXTENSIONS,
    RUNTIME_STATE_FILENAMES,
    THUMB_CACHE_DIR,
    TRASH_DIR,
)
from ..paths import (
    build_relative_display,
    ensure_data_dir,
    ensure_unique_path,
    ensure_trash_dir,
    get_comfy_base_dir,
    get_input_dir,
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
    create_board,
    delete_board,
    default_image_state,
    extract_image_states,
    extract_image_states_by_prefix,
    get_image_state_map,
    get_image_state,
    get_raw_boards,
    move_image_states,
    normalize_board_ids,
    remove_image_states,
    remove_image_states_by_prefix,
    rename_image_state,
    restore_image_states,
    set_image_board_membership,
    update_board,
    update_image_state,
)

try:
    from PIL import Image

    HAS_PIL = True
except ImportError:
    HAS_PIL = False


THUMB_SIZE = 480
IMAGE_REF_SEPARATOR = "::"
DEFAULT_OUTPUT_SOURCE_ID = "default_output"
DEFAULT_INPUT_SOURCE_ID = "default_input"
GALLERY_INDEX_DB_FILE = os.path.join(DATA_DIR, "gallery_index.sqlite3")
GALLERY_INDEX_SCHEMA_VERSION = 4
COLOR_INDEX_VERSION = "3"
COLOR_FAMILY_MIN_RATIO = 0.25
IMAGE_FRESHNESS_CACHE_TTL_SECONDS = 3.0
IMAGE_INDEX_CACHE: dict[str, Any] = {
    "signature": None,
    "output_dir": None,
    "built_at": 0.0,
    "images": [],
    "subfolders": [],
    "sources": [],
    "dirty": False,
}
IMAGE_INDEX_LOCK = Lock()
IMAGE_FRESHNESS_CACHE: dict[str, dict[str, Any]] = {}
IMAGE_FRESHNESS_LOCK = Lock()
LIBRARY_CACHE: dict[str, dict[str, Any]] = {}
LIBRARY_CACHE_LOCK = Lock()
THUMB_GENERATION_SEMAPHORE = BoundedSemaphore(2)
THUMB_LOCKS: dict[str, Lock] = {}
THUMB_LOCKS_GUARD = Lock()

COLOR_PROFILE_DEFAULT = {
    "dominant_color": "",
    "color_family": "",
    "color_families_text": "",
    "color_family_scores_json": "{}",
    "palette_json": "[]",
    "color_saturation": 0.0,
    "color_luma": 0.0,
}
THUMB_PREWARM_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ue-thumb")
THUMB_PREWARM_PENDING: set[str] = set()
THUMB_PREWARM_LOCK = Lock()
THUMB_PREWARM_STATS: dict[str, Any] = {
    "queued": 0,
    "completed": 0,
    "failed": 0,
    "last_error": "",
    "updated_at": 0.0,
}
COLOR_INDEX_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ue-color")
COLOR_INDEX_BACKFILL_LOCK = Lock()
COLOR_INDEX_BACKFILL_RUNNING = False
COLOR_INDEX_QUEUED_PATHS: set[str] = set()


def _sanitize_source_id(value: str) -> str:
    clean = "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in str(value or "").strip())
    clean = clean.strip("_-").lower()
    return clean or f"source_{uuid.uuid4().hex[:10]}"


def _real_abs(path: str) -> str:
    return os.path.realpath(os.path.abspath(os.path.expanduser(str(path or "").strip())))


def _ensure_within_directory(root_dir: str, full_path: str, label: str = "source") -> str:
    normalized_root = _real_abs(root_dir)
    normalized_path = _real_abs(full_path)
    try:
        common = os.path.commonpath([normalized_root, normalized_path])
    except ValueError as error:
        raise ValueError("invalid path") from error

    if common != normalized_root:
        raise ValueError(f"path must stay within {label} directory")
    return normalized_path


def _env_flag(name: str) -> bool:
    return str(os.environ.get(name, "")).strip().lower() in {"1", "true", "yes", "on"}


def _path_is_within_any(path: str, roots: list[str]) -> bool:
    normalized_path = _real_abs(path)
    for root in roots:
        if not root:
            continue
        try:
            if os.path.commonpath([_real_abs(root), normalized_path]) == _real_abs(root):
                return True
        except ValueError:
            continue
    return False


def _safe_source_roots() -> list[str]:
    return [path for path in [get_comfy_base_dir(), get_output_dir(), get_input_dir()] if path]


def _external_sources_allowed() -> bool:
    return _env_flag("UNIVERSAL_EXTRACTOR_ALLOW_EXTERNAL_SOURCES")


def _validate_source_path(source: dict[str, Any]) -> str:
    path = source.get("path", "")
    if not path:
        raise ValueError("source path required")

    full_path = _real_abs(path)
    if not os.path.isdir(full_path):
        raise FileNotFoundError("source directory not found")
    if not os.access(full_path, os.R_OK):
        raise ValueError("source directory is not readable")
    if not _external_sources_allowed() and not _path_is_within_any(full_path, _safe_source_roots()):
        raise ValueError(
            "custom source path must stay within the ComfyUI directory; "
            "set UNIVERSAL_EXTRACTOR_ALLOW_EXTERNAL_SOURCES=1 to allow external read-only sources"
        )
    return full_path


def _harden_source(source: dict[str, Any]) -> dict[str, Any]:
    hardened = {**source}
    try:
        full_path = _validate_source_path(hardened)
    except (FileNotFoundError, ValueError) as error:
        hardened["enabled"] = False
        hardened["writable"] = False
        hardened["import_target"] = False
        hardened["exists"] = bool(hardened.get("path") and os.path.isdir(os.path.expanduser(str(hardened.get("path")))))
        hardened["security_error"] = str(error)
        return hardened

    within_safe_root = _path_is_within_any(full_path, _safe_source_roots())
    requested_writable = bool(hardened.get("writable"))
    writable = requested_writable and within_safe_root and os.access(full_path, os.W_OK)
    if requested_writable and not within_safe_root:
        hardened["security_error"] = "external source directories are read-only"
    if hardened.get("writable") and not writable:
        hardened["security_error"] = hardened.get("security_error") or "source directory is not writable"
    hardened["path"] = full_path
    hardened["exists"] = True
    hardened["writable"] = writable
    if not writable:
        hardened["import_target"] = False
    return hardened


def _ensure_supported_image_path(path: str):
    if not path.lower().endswith(SUPPORTED_IMAGE_EXTENSIONS):
        raise ValueError("path must reference a supported image file")
    if os.path.exists(path) and not os.path.isfile(path):
        raise ValueError("path must reference a regular image file")


def make_image_ref(source_id: str, relative_path: str) -> str:
    normalized_path = normalize_relative_path(relative_path)
    clean_source_id = _sanitize_source_id(source_id)
    if clean_source_id == DEFAULT_OUTPUT_SOURCE_ID:
        return normalized_path
    return f"{clean_source_id}{IMAGE_REF_SEPARATOR}{normalized_path}"


def parse_image_ref(image_ref: str) -> tuple[str, str]:
    value = str(image_ref or "").strip()
    if IMAGE_REF_SEPARATOR in value:
        source_id, relative_path = value.split(IMAGE_REF_SEPARATOR, 1)
        source_id = _sanitize_source_id(source_id)
        relative_path = normalize_relative_path(relative_path)
    else:
        source_id = DEFAULT_OUTPUT_SOURCE_ID
        relative_path = normalize_relative_path(value)
    if not relative_path:
        raise ValueError("relative_path required")
    return source_id, relative_path


def make_folder_ref(source_id: str, subfolder: str = "") -> str:
    return f"{_sanitize_source_id(source_id)}{IMAGE_REF_SEPARATOR}{normalize_relative_path(subfolder)}"


def parse_folder_ref(folder_ref: str) -> tuple[str, str]:
    value = str(folder_ref or "").strip()
    if IMAGE_REF_SEPARATOR in value:
        source_id, subfolder = value.split(IMAGE_REF_SEPARATOR, 1)
        return _sanitize_source_id(source_id), normalize_relative_path(subfolder)
    return DEFAULT_OUTPUT_SOURCE_ID, normalize_relative_path(value)


def _default_gallery_sources() -> list[dict[str, Any]]:
    output_dir = get_output_dir()
    input_dir = get_input_dir()
    sources = [
        {
            "id": DEFAULT_OUTPUT_SOURCE_ID,
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
            "id": DEFAULT_INPUT_SOURCE_ID,
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


def _source_exists(path: str) -> bool:
    return bool(path) and os.path.isdir(os.path.expanduser(str(path)))


def _normalize_source(raw: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
    existing = existing or {}
    source_id = _sanitize_source_id(raw.get("id") or existing.get("id") or raw.get("name") or "custom")
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
    source["exists"] = _source_exists(source["path"])
    return _harden_source(source)


def _load_gallery_sources_file() -> list[dict[str, Any]]:
    ensure_data_dir()
    data = load_json(GALLERY_SOURCES_FILE, {"sources": []})
    if isinstance(data, dict):
        raw_sources = data.get("sources", [])
    elif isinstance(data, list):
        raw_sources = data
    else:
        raw_sources = []
    return [item for item in raw_sources if isinstance(item, dict)]


def _write_gallery_sources_file(sources: list[dict[str, Any]]):
    stored_sources = [
        {key: value for key, value in source.items() if key not in {"exists", "image_count", "security_error"}}
        for source in sources
    ]
    save_json(GALLERY_SOURCES_FILE, {"sources": stored_sources})


def list_gallery_sources() -> list[dict[str, Any]]:
    defaults = _default_gallery_sources()
    default_by_id = {source["id"]: source for source in defaults}
    custom_sources: list[dict[str, Any]] = []

    for raw_source in _load_gallery_sources_file():
        source_id = _sanitize_source_id(raw_source.get("id") or raw_source.get("name") or "custom")
        if source_id in default_by_id:
            default_by_id[source_id] = _normalize_source(raw_source, default_by_id[source_id])
        else:
            custom_sources.append(_normalize_source({**raw_source, "id": source_id, "kind": "custom"}))

    sources = [_normalize_source(default_by_id[source["id"]], source) for source in defaults]
    sources.extend(custom_sources)
    import_targets = [source for source in sources if source.get("enabled") and source.get("writable") and source.get("import_target")]
    if not import_targets:
        for source in sources:
            if source["id"] == DEFAULT_OUTPUT_SOURCE_ID and source.get("enabled") and source.get("writable"):
                source["import_target"] = True
                break
    return sources


def _source_signature(sources: list[dict[str, Any]]) -> str:
    payload = [
        {
            "id": source.get("id"),
            "path": _real_abs(source.get("path", "")) if source.get("path") else "",
            "enabled": bool(source.get("enabled")),
            "exists": bool(source.get("exists")),
            "recursive": bool(source.get("recursive", True)),
        }
        for source in sources
    ]
    return json.dumps(payload, sort_keys=True, ensure_ascii=False)


def get_gallery_source(source_id: str) -> dict[str, Any]:
    normalized_id = _sanitize_source_id(source_id)
    for source in list_gallery_sources():
        if source["id"] == normalized_id:
            return source
    raise FileNotFoundError("gallery source not found")


def save_gallery_source(payload: dict[str, Any]) -> dict[str, Any]:
    sources = list_gallery_sources()
    incoming_id = _sanitize_source_id(payload.get("id") or payload.get("name") or "custom")
    existing = next((source for source in sources if source["id"] == incoming_id), None)
    source = _normalize_source({**payload, "id": incoming_id}, existing)
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
            source = _normalize_source(source, existing)
        sources = [source if item["id"] == source["id"] else item for item in sources]
    else:
        source["kind"] = "custom"
        source["locked"] = False
        source = _normalize_source(source)
        sources.append(source)

    if source.get("import_target"):
        for item in sources:
            if item["id"] != source["id"]:
                item["import_target"] = False

    _write_gallery_sources_file(sources)
    invalidate_image_index_cache()
    return {"ok": True, "source": source, "sources": list_gallery_sources()}


def delete_gallery_source(source_id: str) -> dict[str, Any]:
    normalized_id = _sanitize_source_id(source_id)
    sources = list_gallery_sources()
    source = next((item for item in sources if item["id"] == normalized_id), None)
    if not source:
        raise FileNotFoundError("gallery source not found")
    if source.get("locked"):
        raise ValueError("default sources cannot be deleted")
    remaining = [item for item in sources if item["id"] != normalized_id]
    _write_gallery_sources_file(remaining)
    invalidate_image_index_cache()
    return {"ok": True, "id": normalized_id, "sources": list_gallery_sources()}


def test_gallery_source_path(path: str) -> dict[str, Any]:
    clean_path = str(path or "").strip()
    if not clean_path:
        raise ValueError("source path required")
    full_path = _real_abs(clean_path)
    exists = os.path.isdir(full_path)
    writable = False
    image_count = 0
    if exists:
        writable = os.access(full_path, os.W_OK)
        try:
            for entry in os.scandir(full_path):
                if entry.is_file(follow_symlinks=False) and entry.name.lower().endswith(SUPPORTED_IMAGE_EXTENSIONS):
                    image_count += 1
        except OSError:
            pass
    within_safe_root = _path_is_within_any(full_path, _safe_source_roots()) if exists else False
    allowed = exists and (_external_sources_allowed() or within_safe_root)
    return {
        "ok": bool(exists and allowed),
        "path": full_path,
        "exists": exists,
        "writable": writable if allowed and within_safe_root else False,
        "image_count": image_count if allowed else 0,
        "security_error": "" if allowed else "source path is outside the allowed ComfyUI directory",
    }


def diagnose_gallery_sources() -> dict[str, Any]:
    diagnostics: list[dict[str, Any]] = []
    normalized_paths: dict[str, str] = {}
    for source in list_gallery_sources():
        path = source.get("path", "")
        full_path = _real_abs(path) if path else ""
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
                        image_count += sum(1 for filename in files if filename.lower().endswith(SUPPORTED_IMAGE_EXTENSIONS))
                else:
                    with os.scandir(full_path) as iterator:
                        for entry in iterator:
                            if entry.is_dir(follow_symlinks=False):
                                directory_count += 1
                            elif entry.is_file(follow_symlinks=False) and entry.name.lower().endswith(SUPPORTED_IMAGE_EXTENSIONS):
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


def image_ref_for_full_path(full_path: str) -> str:
    normalized_path = _real_abs(full_path)
    for source in list_gallery_sources():
        source_path = source.get("path", "")
        if not source_path:
            continue
        try:
            if os.path.commonpath([_real_abs(source_path), normalized_path]) != _real_abs(source_path):
                continue
        except ValueError:
            continue
        relative_path = normalize_relative_path(os.path.relpath(normalized_path, _real_abs(source_path)))
        return make_image_ref(source["id"], relative_path)
    output_dir = _ensure_output_dir()
    return normalize_relative_path(os.path.relpath(normalized_path, output_dir))


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
                    "pinned": False,
                    "boards": [],
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
        target_path = _ensure_within_output(output_dir, os.path.join(output_dir, original_path))
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
    return _ensure_within_directory(output_dir, full_path, "output")


def resolve_subfolder_path(subfolder: str) -> tuple[str, str]:
    output_dir = _ensure_output_dir()
    normalized_subfolder = normalize_relative_path(subfolder)
    full_path = _ensure_within_output(output_dir, os.path.join(output_dir, normalized_subfolder))
    return normalized_subfolder, full_path


def _resolve_folder_ref_path(folder_ref: str, *, require_writable: bool = True) -> tuple[dict[str, Any], str, str]:
    source_id, relative_dir = parse_folder_ref(folder_ref)
    return resolve_source_subfolder_path(source_id, relative_dir, require_writable=require_writable)


def _normalize_folder_ref_for_source(source_id: str, relative_dir: str) -> str:
    return make_folder_ref(source_id, relative_dir)


def _image_state_folder_prefix(source_id: str, relative_dir: str) -> str:
    return relative_dir if _sanitize_source_id(source_id) == DEFAULT_OUTPUT_SOURCE_ID else make_folder_ref(source_id, relative_dir)


def _coerce_target_folder_ref(target_folder: str, default_source_id: str) -> str:
    value = str(target_folder or "").strip()
    if IMAGE_REF_SEPARATOR in value:
        return value
    return _normalize_folder_ref_for_source(default_source_id, value)


def resolve_source_subfolder_path(source_id: str, subfolder: str = "", *, require_writable: bool = False) -> tuple[dict[str, Any], str, str]:
    source = get_gallery_source(source_id)
    if not source.get("enabled", True):
        raise ValueError("gallery source is disabled")
    if require_writable and not source.get("writable"):
        raise ValueError("target gallery source is read-only")
    source_path = source.get("path", "")
    if not source_path or not os.path.isdir(os.path.expanduser(source_path)):
        raise FileNotFoundError("gallery source directory not found")
    normalized_subfolder = normalize_relative_path(subfolder)
    full_path = _ensure_within_directory(source_path, os.path.join(source_path, normalized_subfolder), source["name"])
    return source, normalized_subfolder, full_path


def resolve_image_path(relative_path: str) -> tuple[str, str]:
    source_id, source_relative_path = parse_image_ref(relative_path)
    if not source_relative_path.lower().endswith(SUPPORTED_IMAGE_EXTENSIONS):
        raise ValueError("relative_path must reference a supported image file")
    source = get_gallery_source(source_id)
    if not source.get("enabled", True):
        raise ValueError("gallery source is disabled")
    source_path = source.get("path", "")
    if not source_path or not os.path.isdir(os.path.expanduser(source_path)):
        raise FileNotFoundError("gallery source directory not found")
    full_path = _ensure_within_directory(source_path, os.path.join(source_path, source_relative_path), source["name"])
    _ensure_supported_image_path(full_path)
    return source_path, full_path


def build_view_url(relative_path: str) -> tuple[str, str]:
    import urllib.parse

    source_id, source_relative_path = parse_image_ref(relative_path)
    image_ref = make_image_ref(source_id, source_relative_path)
    filename = os.path.basename(source_relative_path)
    subfolder = to_posix(os.path.dirname(source_relative_path)).strip(".")
    if source_id != DEFAULT_OUTPUT_SOURCE_ID:
        params = urllib.parse.urlencode({"relative_path": image_ref})
        return f"/universal_gallery/api/image-file?{params}", subfolder

    params: dict[str, str] = {"filename": filename, "type": "output"}
    if subfolder:
        params["subfolder"] = subfolder
    return f"/view?{urllib.parse.urlencode(params)}", subfolder


def build_thumb_url(relative_path: str) -> str:
    import urllib.parse

    source_id, source_relative_path = parse_image_ref(relative_path)
    image_ref = make_image_ref(source_id, source_relative_path)
    params = urllib.parse.urlencode({"relative_path": image_ref, "size": str(THUMB_SIZE)})
    return f"/universal_gallery/api/thumb?{params}"


def _rgb_to_hex(red: int, green: int, blue: int) -> str:
    return f"#{max(0, min(255, red)):02x}{max(0, min(255, green)):02x}{max(0, min(255, blue)):02x}"


def _color_family_from_rgb(red: int, green: int, blue: int) -> str:
    hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
    hue_degrees = hue * 360
    luma = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255

    if value < 0.16:
        return "black"
    if value > 0.92 and saturation < 0.14:
        return "white"
    if saturation < 0.16:
        return "gray"
    if 18 <= hue_degrees < 48 and saturation > 0.26 and luma < 0.52:
        return "brown"
    if hue_degrees < 15 or hue_degrees >= 345:
        return "red"
    if hue_degrees < 42:
        return "orange"
    if hue_degrees < 68:
        return "yellow"
    if hue_degrees < 155:
        return "green"
    if hue_degrees < 190:
        return "cyan"
    if hue_degrees < 250:
        return "blue"
    if hue_degrees < 292:
        return "purple"
    if hue_degrees < 345:
        return "pink"
    return "gray"


def _encode_color_families(families: list[str]) -> str:
    unique_families: list[str] = []
    for family in families:
        if family and family not in unique_families:
            unique_families.append(family)
    return "\n" + "\n".join(unique_families) + "\n" if unique_families else ""


def _thumb_cache_path_if_exists(relative_path: str, size: int = THUMB_SIZE) -> str:
    source_id, source_relative_path = parse_image_ref(relative_path)
    cache_key = hashlib.sha1(f"{source_id}:{source_relative_path}:{size}".encode("utf-8")).hexdigest()
    thumb_path = os.path.join(THUMB_CACHE_DIR, f"{cache_key}.webp")
    return thumb_path if os.path.exists(thumb_path) else ""


def _extract_image_color_profile(full_path: str, relative_path: str = "") -> dict[str, Any]:
    if not HAS_PIL:
        return dict(COLOR_PROFILE_DEFAULT)

    sample_path = _thumb_cache_path_if_exists(relative_path) if relative_path else ""
    if not sample_path:
        sample_path = full_path

    try:
        with Image.open(sample_path) as image:
            image.thumbnail((96, 96))
            rgba_image = image.convert("RGBA")
            pixels = list(rgba_image.getdata())
    except Exception:
        if sample_path != full_path:
            return _extract_image_color_profile(full_path, "")
        return dict(COLOR_PROFILE_DEFAULT)

    visible_pixels: list[tuple[int, int, int]] = [
        (int(red), int(green), int(blue))
        for red, green, blue, alpha in pixels
        if int(alpha) >= 24
    ]
    if not visible_pixels:
        return dict(COLOR_PROFILE_DEFAULT)

    bucket_map: dict[tuple[int, int, int], list[int]] = {}
    family_pixel_counts: dict[str, int] = {}
    saturation_sum = 0.0
    luma_sum = 0.0

    for red, green, blue in visible_pixels:
        _hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
        luma = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
        saturation_sum += saturation
        luma_sum += luma
        bucket = (red // 32, green // 32, blue // 32)
        if bucket not in bucket_map:
            bucket_map[bucket] = [0, 0, 0, 0]
        bucket_map[bucket][0] += 1
        bucket_map[bucket][1] += red
        bucket_map[bucket][2] += green
        bucket_map[bucket][3] += blue
        family = _color_family_from_rgb(red, green, blue)
        family_pixel_counts[family] = family_pixel_counts.get(family, 0) + 1

    if not bucket_map:
        return dict(COLOR_PROFILE_DEFAULT)

    total_pixels = len(visible_pixels)

    def bucket_score(bucket: list[int]) -> float:
        count, red_sum, green_sum, blue_sum = bucket
        red = round(red_sum / count)
        green = round(green_sum / count)
        blue = round(blue_sum / count)
        _hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
        family = _color_family_from_rgb(red, green, blue)
        neutral_penalty = 0.26 if family in {"white", "gray"} else 0.72 if family == "black" else 1.0
        highlight_bonus = 1.0 + min(0.85, saturation * 1.35)
        value_penalty = 0.68 if value > 0.95 and saturation < 0.2 else 1.0
        return count * neutral_penalty * highlight_bonus * value_penalty

    ranked_buckets = sorted(bucket_map.values(), key=bucket_score, reverse=True)
    dominant_count, dominant_red, dominant_green, dominant_blue = ranked_buckets[0]
    dominant_rgb = (
        round(dominant_red / dominant_count),
        round(dominant_green / dominant_count),
        round(dominant_blue / dominant_count),
    )
    palette = []
    seen_colors: set[str] = set()
    color_family_scores = {
        family: round(count / total_pixels, 4)
        for family, count in sorted(family_pixel_counts.items(), key=lambda item: item[1], reverse=True)
    }
    base_color_families = [
        family
        for family, score in color_family_scores.items()
        if score >= COLOR_FAMILY_MIN_RATIO
    ]
    color_families = list(base_color_families)
    warm_score = sum(color_family_scores.get(family, 0) for family in ["red", "orange", "yellow", "pink", "brown"])
    cool_score = sum(color_family_scores.get(family, 0) for family in ["green", "cyan", "blue", "purple"])
    if warm_score >= COLOR_FAMILY_MIN_RATIO:
        color_families.append("warm")
    if cool_score >= COLOR_FAMILY_MIN_RATIO:
        color_families.append("cool")
    if (saturation_sum / len(visible_pixels)) < 0.18:
        color_families.append("low_saturation")
    for count, red_sum, green_sum, blue_sum in ranked_buckets[:10]:
        red = round(red_sum / count)
        green = round(green_sum / count)
        blue = round(blue_sum / count)
        color = _rgb_to_hex(red, green, blue)
        if color not in seen_colors:
            palette.append(color)
            seen_colors.add(color)
        if len(palette) >= 6:
            break

    dominant_family = _color_family_from_rgb(*dominant_rgb)
    primary_family = base_color_families[0] if base_color_families else dominant_family

    return {
        "dominant_color": _rgb_to_hex(*dominant_rgb),
        "color_family": primary_family,
        "color_families_text": _encode_color_families(color_families),
        "color_family_scores_json": json.dumps(
            {
                **color_family_scores,
                "warm": round(warm_score, 4),
                "cool": round(cool_score, 4),
                "low_saturation": round(1.0 if (saturation_sum / len(visible_pixels)) < 0.18 else 0.0, 4),
            },
            ensure_ascii=False,
        ),
        "palette_json": json.dumps(palette, ensure_ascii=False),
        "color_saturation": round(saturation_sum / len(visible_pixels), 4),
        "color_luma": round(luma_sum / len(visible_pixels), 4),
    }


def _connect_gallery_index_db() -> sqlite3.Connection:
    ensure_data_dir()
    connection = sqlite3.connect(GALLERY_INDEX_DB_FILE)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS gallery_images (
            relative_path TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            source_relative_path TEXT NOT NULL,
            filename TEXT NOT NULL,
            relative_dir TEXT NOT NULL,
            subfolder TEXT NOT NULL,
            display_subfolder TEXT NOT NULL,
            size INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            modified_at INTEGER NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            pinned INTEGER NOT NULL DEFAULT 0,
            boards_text TEXT NOT NULL DEFAULT '',
            dominant_color TEXT NOT NULL DEFAULT '',
            color_family TEXT NOT NULL DEFAULT '',
            color_families_text TEXT NOT NULL DEFAULT '',
            color_family_scores_json TEXT NOT NULL DEFAULT '{}',
            palette_json TEXT NOT NULL DEFAULT '[]',
            color_saturation REAL NOT NULL DEFAULT 0,
            color_luma REAL NOT NULL DEFAULT 0,
            scanned_at REAL NOT NULL
        )
        """
    )
    columns = {row["name"] for row in connection.execute("PRAGMA table_info(gallery_images)").fetchall()}
    for column_name, column_definition in {
        "title": "TEXT NOT NULL DEFAULT ''",
        "category": "TEXT NOT NULL DEFAULT ''",
        "notes": "TEXT NOT NULL DEFAULT ''",
        "pinned": "INTEGER NOT NULL DEFAULT 0",
        "boards_text": "TEXT NOT NULL DEFAULT ''",
        "dominant_color": "TEXT NOT NULL DEFAULT ''",
        "color_family": "TEXT NOT NULL DEFAULT ''",
        "color_families_text": "TEXT NOT NULL DEFAULT ''",
        "color_family_scores_json": "TEXT NOT NULL DEFAULT '{}'",
        "palette_json": "TEXT NOT NULL DEFAULT '[]'",
        "color_saturation": "REAL NOT NULL DEFAULT 0",
        "color_luma": "REAL NOT NULL DEFAULT 0",
    }.items():
        if column_name not in columns:
            connection.execute(f"ALTER TABLE gallery_images ADD COLUMN {column_name} {column_definition}")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS gallery_index_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS gallery_image_color_family (
            relative_path TEXT NOT NULL,
            family TEXT NOT NULL,
            score REAL NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(relative_path, family)
        )
        """
    )
    try:
        connection.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS gallery_images_fts
            USING fts5(relative_path UNINDEXED, search_text, tokenize='trigram')
            """
        )
        connection.execute(
            "INSERT OR IGNORE INTO gallery_index_meta(key, value) VALUES('fts_available', '1')"
        )
    except sqlite3.OperationalError as error:
        connection.execute(
            "INSERT OR REPLACE INTO gallery_index_meta(key, value) VALUES('fts_available', '0')"
        )
        print(f"[Universal Extractor] Gallery FTS unavailable, falling back to LIKE search: {error}")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_source ON gallery_images(source_id)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_created ON gallery_images(created_at DESC)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_dir ON gallery_images(relative_dir)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_category ON gallery_images(category)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_pinned ON gallery_images(pinned)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_color_family ON gallery_images(color_family)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_source_dir_created ON gallery_images(source_id, relative_dir, created_at DESC)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_pinned_created ON gallery_images(pinned, created_at DESC)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_category_created ON gallery_images(category, created_at DESC)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_color_created ON gallery_images(color_family, created_at DESC)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_filename_nocase ON gallery_images(filename COLLATE NOCASE)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_size_desc ON gallery_images(size DESC)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_color_family_created ON gallery_image_color_family(family, created_at DESC)")
    current_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
    if current_version < GALLERY_INDEX_SCHEMA_VERSION:
        connection.execute(f"PRAGMA user_version = {GALLERY_INDEX_SCHEMA_VERSION}")
    connection.commit()
    return connection


def _index_meta_get(connection: sqlite3.Connection, key: str) -> str:
    row = connection.execute("SELECT value FROM gallery_index_meta WHERE key = ?", (key,)).fetchone()
    return str(row["value"]) if row else ""


def _index_meta_set(connection: sqlite3.Connection, key: str, value: str):
    connection.execute(
        "INSERT INTO gallery_index_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def _collect_index_subfolders(source_id: str, relative_dir: str, subfolders: set[str]):
    if not relative_dir:
        return
    parts = [part for part in relative_dir.split("/") if part]
    for index in range(len(parts)):
        folder_path = "/".join(parts[: index + 1])
        subfolders.add(make_folder_ref(source_id, folder_path))


def _folder_ref_key(folder_ref: str) -> tuple[str, str]:
    source_id, relative_dir = parse_folder_ref(folder_ref)
    return source_id, relative_dir.casefold()


def _merge_subfolder_refs(*groups: set[str]) -> set[str]:
    merged: dict[tuple[str, str], str] = {}
    for group in groups:
        for folder_ref in group:
            normalized_ref = normalize_relative_path(folder_ref)
            if not normalized_ref:
                continue
            merged.setdefault(_folder_ref_key(normalized_ref), normalized_ref)
    return set(merged.values())


def _collect_directory_subfolder_details(sources: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    subfolders: dict[str, dict[str, Any]] = {}
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
                continue

            for entry in entries:
                if not entry.is_dir(follow_symlinks=False):
                    continue

                relative_dir = normalize_relative_path(os.path.relpath(entry.path, source_root))
                if relative_dir:
                    folder_ref = make_folder_ref(source["id"], relative_dir)
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


def _collect_directory_subfolders(sources: list[dict[str, Any]]) -> set[str]:
    return set(_collect_directory_subfolder_details(sources))


def _image_row_to_payload(row: sqlite3.Row, source: dict[str, Any]) -> dict[str, Any]:
    relative_path = str(row["relative_path"])
    original_url, resolved_subfolder = build_view_url(relative_path)
    relative_dir = str(row["relative_dir"])
    return {
        "filename": str(row["filename"]),
        "relative_path": relative_path,
        "source_id": source["id"],
        "source_name": source["name"],
        "source_kind": source["kind"],
        "source_path": source["path"],
        "source_relative_path": str(row["source_relative_path"]),
        "relative_dir": relative_dir,
        "subfolder": str(row["subfolder"]) if relative_dir or source["id"] != DEFAULT_OUTPUT_SOURCE_ID else resolved_subfolder,
        "display_subfolder": str(row["display_subfolder"]),
        "url": original_url,
        "original_url": original_url,
        "thumb_url": build_thumb_url(relative_path),
        "size": int(row["size"]),
        "created_at": int(row["created_at"]),
        "dominant_color": str(row["dominant_color"] or ""),
        "color_family": str(row["color_family"] or ""),
        "color_families": [
            family for family in str(row["color_families_text"] or "").splitlines() if family
        ],
        "color_family_scores": json.loads(str(row["color_family_scores_json"] or "{}")),
        "palette": json.loads(str(row["palette_json"] or "[]")),
        "color_saturation": float(row["color_saturation"] or 0),
        "color_luma": float(row["color_luma"] or 0),
    }


def _color_index_is_current(connection: sqlite3.Connection) -> bool:
    if _index_meta_get(connection, "color_index_version") != COLOR_INDEX_VERSION:
        return False
    missing_count = int(
        connection.execute(
            """
            SELECT COUNT(*) AS total
            FROM gallery_images
            WHERE dominant_color = '' OR color_family_scores_json = '{}'
            """
        ).fetchone()["total"]
    )
    return missing_count == 0


def _schedule_color_index_backfill(
    sources: list[dict[str, Any]],
    signature: str,
    priority_paths: list[str] | None = None,
):
    global COLOR_INDEX_BACKFILL_RUNNING
    if not HAS_PIL:
        return

    normalized_priority_paths = [
        normalize_relative_path(path)
        for path in (priority_paths or [])
        if normalize_relative_path(path)
    ]
    with COLOR_INDEX_BACKFILL_LOCK:
        COLOR_INDEX_QUEUED_PATHS.update(normalized_priority_paths)
        if COLOR_INDEX_BACKFILL_RUNNING:
            return
        COLOR_INDEX_BACKFILL_RUNNING = True

    source_snapshot = [
        {
            "id": str(source.get("id", "")),
            "path": str(source.get("path", "")),
            "enabled": bool(source.get("enabled", True)),
            "exists": bool(source.get("exists", False)),
        }
        for source in sources
    ]

    def run_backfill():
        global COLOR_INDEX_BACKFILL_RUNNING
        try:
            source_by_id = {
                source["id"]: source
                for source in source_snapshot
                if source["id"] and source["enabled"] and source["exists"] and source["path"]
            }
            processed = 0
            with _connect_gallery_index_db() as connection:
                while True:
                    if _index_meta_get(connection, "source_signature") != signature:
                        return

                    with COLOR_INDEX_BACKFILL_LOCK:
                        priority_batch = list(COLOR_INDEX_QUEUED_PATHS)[:80]
                        for path in priority_batch:
                            COLOR_INDEX_QUEUED_PATHS.discard(path)

                    rows = []
                    if priority_batch:
                        placeholders = ",".join("?" for _ in priority_batch)
                        rows = connection.execute(
                            f"""
                            SELECT relative_path, source_id, source_relative_path
                            FROM gallery_images
                            WHERE relative_path IN ({placeholders})
                              AND (dominant_color = '' OR color_family_scores_json = '{{}}')
                            LIMIT 80
                            """,
                            priority_batch,
                        ).fetchall()

                    if not rows:
                        rows = connection.execute(
                            """
                            SELECT relative_path, source_id, source_relative_path
                            FROM gallery_images
                            WHERE dominant_color = '' OR color_family_scores_json = '{}'
                            LIMIT 80
                            """
                        ).fetchall()
                    if not rows:
                        _index_meta_set(connection, "color_index_version", COLOR_INDEX_VERSION)
                        connection.commit()
                        return

                    updates = []
                    failed_paths = []
                    for row in rows:
                        source = source_by_id.get(str(row["source_id"]))
                        if not source:
                            continue
                        full_path = os.path.join(source["path"], str(row["source_relative_path"]))
                        if not os.path.isfile(full_path) or not full_path.lower().endswith(SUPPORTED_IMAGE_EXTENSIONS):
                            continue
                        color_profile = _extract_image_color_profile(full_path, str(row["relative_path"]))
                        if (
                            color_profile["dominant_color"] == COLOR_PROFILE_DEFAULT["dominant_color"]
                            and color_profile["color_family_scores_json"] == COLOR_PROFILE_DEFAULT["color_family_scores_json"]
                        ):
                            failed_paths.append(str(row["relative_path"]))
                            continue
                        updates.append(
                            (
                                color_profile["dominant_color"],
                                color_profile["color_family"],
                                color_profile["color_families_text"],
                                color_profile["color_family_scores_json"],
                                color_profile["palette_json"],
                                color_profile["color_saturation"],
                                color_profile["color_luma"],
                                str(row["relative_path"]),
                            )
                        )

                    if updates:
                        connection.executemany(
                            """
                            UPDATE gallery_images
                            SET dominant_color = ?,
                                color_family = ?,
                                color_families_text = ?,
                                color_family_scores_json = ?,
                                palette_json = ?,
                                color_saturation = ?,
                                color_luma = ?
                            WHERE relative_path = ?
                            """,
                            updates,
                        )
                        updated_paths = [path for *_color_fields, path in updates]
                        placeholders = ",".join("?" for _ in updated_paths)
                        updated_rows = connection.execute(
                            f"""
                            SELECT relative_path, filename, title, category, notes, color_family, color_families_text,
                                   color_family_scores_json, created_at
                            FROM gallery_images
                            WHERE relative_path IN ({placeholders})
                            """,
                            updated_paths,
                        ).fetchall()
                        _sync_auxiliary_rows(connection, updated_rows)
                        processed += len(updates)
                    skipped_paths = failed_paths if failed_paths else ([] if updates else [str(row["relative_path"]) for row in rows])
                    if skipped_paths:
                        connection.executemany(
                            """
                            UPDATE gallery_images
                            SET dominant_color = '#000000',
                                color_family = 'black',
                                color_families_text = '\nblack\n',
                                color_family_scores_json = '{"black": 1.0}',
                                palette_json = '["#000000"]'
                            WHERE relative_path = ?
                            """,
                            [(path,) for path in skipped_paths],
                        )
                        placeholders = ",".join("?" for _ in skipped_paths)
                        skipped_rows = connection.execute(
                            f"""
                            SELECT relative_path, filename, title, category, notes, color_family, color_families_text,
                                   color_family_scores_json, created_at
                            FROM gallery_images
                            WHERE relative_path IN ({placeholders})
                            """,
                            skipped_paths,
                        ).fetchall()
                        _sync_auxiliary_rows(connection, skipped_rows)
                    connection.commit()

                    if processed and processed % 800 == 0:
                        invalidate_image_index_cache()
        finally:
            with COLOR_INDEX_BACKFILL_LOCK:
                COLOR_INDEX_BACKFILL_RUNNING = False

    COLOR_INDEX_EXECUTOR.submit(run_backfill)


def _boards_to_search_text(boards: list[str]) -> str:
    return "\n".join(["", *normalize_board_ids(boards), ""])


def _image_row_state(row: sqlite3.Row) -> dict[str, Any]:
    boards = [board_id for board_id in str(row["boards_text"] or "").split("\n") if board_id]
    pinned = bool(int(row["pinned"] or 0))
    return {
        "favorite": pinned,
        "pinned": pinned,
        "boards": boards,
        "category": str(row["category"] or ""),
        "title": str(row["title"] or ""),
        "notes": str(row["notes"] or ""),
        "updated_at": 0,
    }


def _gallery_state_file_path() -> str:
    return os.path.join(DATA_DIR, "gallery_state.json")


def _gallery_state_signature(state_map: dict[str, dict[str, Any]] | None = None) -> tuple[str, str]:
    if state_map is None:
        state_file = _gallery_state_file_path()
        try:
            with open(state_file, "rb") as file:
                payload = file.read()
            return str(os.stat(state_file).st_mtime_ns), hashlib.sha256(payload).hexdigest()
        except OSError:
            state_map = {}

    payload = json.dumps(state_map, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return "memory", hashlib.sha256(payload).hexdigest()


def _current_state_paths_from_db(connection: sqlite3.Connection) -> set[str]:
    encoded_paths = _index_meta_get(connection, "gallery_state_paths_json")
    if encoded_paths:
        try:
            parsed = json.loads(encoded_paths)
            if isinstance(parsed, list):
                return {normalize_relative_path(path) for path in parsed if str(path).strip()}
        except json.JSONDecodeError:
            pass

    rows = connection.execute(
        """
        SELECT relative_path
        FROM gallery_images
        WHERE title <> '' OR category <> '' OR notes <> '' OR pinned = 1 OR boards_text <> ''
        """
    ).fetchall()
    return {str(row["relative_path"]) for row in rows}


def _search_text_for_row(row: sqlite3.Row | dict[str, Any]) -> str:
    return " ".join(
        [
            str(row["filename"] or ""),
            str(row["relative_path"] or ""),
            str(row["title"] or ""),
            str(row["category"] or ""),
            str(row["notes"] or ""),
        ]
    )


def _fts_match_query(search: str) -> str:
    value = str(search or "").strip()
    if len(value) < 3:
        return ""
    return f'"{value.replace(chr(34), chr(34) + chr(34))}"'


def _color_family_rows_for_image(row: sqlite3.Row | dict[str, Any]) -> list[tuple[str, str, float, int]]:
    relative_path = str(row["relative_path"])
    created_at = int(row["created_at"] or 0)
    families: dict[str, float] = {}
    primary_family = str(row["color_family"] or "").strip()
    if primary_family:
        families[primary_family] = max(families.get(primary_family, 0), 1.0)
    for family in str(row["color_families_text"] or "").splitlines():
        family = family.strip()
        if family:
            families[family] = max(families.get(family, 0), COLOR_FAMILY_MIN_RATIO)
    try:
        score_map = json.loads(str(row["color_family_scores_json"] or "{}"))
    except json.JSONDecodeError:
        score_map = {}
    if isinstance(score_map, dict):
        for family, score in score_map.items():
            try:
                parsed_score = float(score)
            except (TypeError, ValueError):
                continue
            if parsed_score >= COLOR_FAMILY_MIN_RATIO or family in {"warm", "cool", "low_saturation"} and parsed_score > 0:
                families[str(family)] = max(families.get(str(family), 0), parsed_score)
    return [(relative_path, family, score, created_at) for family, score in sorted(families.items())]


def _sync_auxiliary_rows(connection: sqlite3.Connection, rows: list[sqlite3.Row | dict[str, Any]], remove_paths: list[str] | None = None):
    removed_paths = [normalize_relative_path(path) for path in (remove_paths or []) if normalize_relative_path(path)]
    if removed_paths:
        connection.executemany("DELETE FROM gallery_image_color_family WHERE relative_path = ?", [(path,) for path in removed_paths])
        if _index_meta_get(connection, "fts_available") == "1":
            connection.executemany("DELETE FROM gallery_images_fts WHERE relative_path = ?", [(path,) for path in removed_paths])

    if not rows:
        return

    relative_paths = [str(row["relative_path"]) for row in rows]
    connection.executemany("DELETE FROM gallery_image_color_family WHERE relative_path = ?", [(path,) for path in relative_paths])
    color_rows: list[tuple[str, str, float, int]] = []
    for row in rows:
        color_rows.extend(_color_family_rows_for_image(row))
    if color_rows:
        connection.executemany(
            """
            INSERT OR REPLACE INTO gallery_image_color_family(relative_path, family, score, created_at)
            VALUES(?, ?, ?, ?)
            """,
            color_rows,
        )

    if _index_meta_get(connection, "fts_available") == "1":
        connection.executemany("DELETE FROM gallery_images_fts WHERE relative_path = ?", [(path,) for path in relative_paths])
        connection.executemany(
            "INSERT INTO gallery_images_fts(relative_path, search_text) VALUES(?, ?)",
            [(str(row["relative_path"]), _search_text_for_row(row)) for row in rows],
        )


def _ensure_auxiliary_tables_current(connection: sqlite3.Connection):
    if _index_meta_get(connection, "auxiliary_schema_version") == str(GALLERY_INDEX_SCHEMA_VERSION):
        return
    rows = connection.execute(
        """
        SELECT relative_path, filename, title, category, notes, color_family, color_families_text,
               color_family_scores_json, created_at
        FROM gallery_images
        """
    ).fetchall()
    connection.execute("DELETE FROM gallery_image_color_family")
    if _index_meta_get(connection, "fts_available") == "1":
        connection.execute("DELETE FROM gallery_images_fts")
    _sync_auxiliary_rows(connection, rows)
    _index_meta_set(connection, "auxiliary_schema_version", str(GALLERY_INDEX_SCHEMA_VERSION))


def _sync_image_state_to_index_db(connection: sqlite3.Connection, state_map: dict[str, dict[str, Any]] | None = None):
    state_mtime, state_digest = _gallery_state_signature(state_map)
    if (
        _index_meta_get(connection, "gallery_state_mtime") == state_mtime
        and _index_meta_get(connection, "gallery_state_digest") == state_digest
    ):
        return False

    state_map = state_map if state_map is not None else get_image_state_map()
    previous_paths = _current_state_paths_from_db(connection)
    current_paths = {normalize_relative_path(path) for path in state_map if normalize_relative_path(path)}
    cleared_paths = sorted(previous_paths - current_paths)
    rows = [
        (
            str(image_state.get("title", "")),
            str(image_state.get("category", "")),
            str(image_state.get("notes", "")),
            1 if image_state.get("pinned", image_state.get("favorite", False)) else 0,
            _boards_to_search_text(image_state.get("boards", [])),
            relative_path,
        )
        for relative_path, image_state in state_map.items()
    ]
    if rows:
        connection.executemany(
            """
            UPDATE gallery_images
            SET title = ?, category = ?, notes = ?, pinned = ?, boards_text = ?
            WHERE relative_path = ?
            """,
            rows,
        )
    if cleared_paths:
        connection.executemany(
            """
            UPDATE gallery_images
            SET title = '', category = '', notes = '', pinned = 0, boards_text = ''
            WHERE relative_path = ?
            """,
            [(path,) for path in cleared_paths],
        )
    affected_paths = sorted(current_paths | set(cleared_paths))
    if affected_paths:
        placeholders = ",".join("?" for _ in affected_paths)
        affected_rows = connection.execute(
            f"""
            SELECT relative_path, filename, title, category, notes, color_family, color_families_text,
                   color_family_scores_json, created_at
            FROM gallery_images
            WHERE relative_path IN ({placeholders})
            """,
            affected_paths,
        ).fetchall()
        _sync_auxiliary_rows(connection, affected_rows)
    _index_meta_set(connection, "gallery_state_mtime", state_mtime)
    _index_meta_set(connection, "gallery_state_digest", state_digest)
    _index_meta_set(connection, "gallery_state_paths_json", json.dumps(sorted(current_paths), ensure_ascii=False))
    return True


def _load_image_index_from_db(sources: list[dict[str, Any]], signature: str) -> dict[str, Any] | None:
    if not os.path.exists(GALLERY_INDEX_DB_FILE):
        return None

    source_by_id = {source["id"]: source for source in sources}
    with _connect_gallery_index_db() as connection:
        if _index_meta_get(connection, "source_signature") != signature:
            return None
        if not _color_index_is_current(connection):
            _schedule_color_index_backfill(sources, signature)
        rows = connection.execute(
            """
            SELECT relative_path, source_id, source_relative_path, filename, relative_dir,
                   subfolder, display_subfolder, size, created_at, modified_at,
                   dominant_color, color_family, color_families_text,
                   color_family_scores_json, palette_json, color_saturation, color_luma
            FROM gallery_images
            ORDER BY created_at DESC
            """
        ).fetchall()

    images: list[dict[str, Any]] = []
    subfolders: set[str] = set()
    source_counts: dict[str, int] = {source["id"]: 0 for source in sources}
    for row in rows:
        source = source_by_id.get(str(row["source_id"]))
        if not source or not source.get("enabled", True) or not source.get("exists"):
            continue
        relative_dir = str(row["relative_dir"])
        _collect_index_subfolders(source["id"], relative_dir, subfolders)
        source_counts[source["id"]] = source_counts.get(source["id"], 0) + 1
        images.append(_image_row_to_payload(row, source))

    indexed_sources = [{**source, "image_count": source_counts.get(source["id"], 0)} for source in sources]
    return {
        "signature": signature,
        "output_dir": get_output_dir(),
        "images": images,
        "subfolders": sorted(subfolders, key=lambda value: value.lower()),
        "sources": indexed_sources,
        "built_at": time.time(),
    }


def _image_index_db_has_signature(signature: str) -> bool:
    if not os.path.exists(GALLERY_INDEX_DB_FILE):
        return False
    with _connect_gallery_index_db() as connection:
        return _index_meta_get(connection, "source_signature") == signature


def get_color_index_status() -> dict[str, Any]:
    with COLOR_INDEX_BACKFILL_LOCK:
        running = COLOR_INDEX_BACKFILL_RUNNING
        queued = len(COLOR_INDEX_QUEUED_PATHS)

    if not os.path.exists(GALLERY_INDEX_DB_FILE):
        return {
            "running": running,
            "queued": queued,
            "total": 0,
            "indexed": 0,
            "missing": 0,
            "complete": False,
            "version": COLOR_INDEX_VERSION,
            "threshold": COLOR_FAMILY_MIN_RATIO,
        }

    with _connect_gallery_index_db() as connection:
        total = int(connection.execute("SELECT COUNT(*) AS total FROM gallery_images").fetchone()["total"])
        missing = int(
            connection.execute(
                """
                SELECT COUNT(*) AS total
                FROM gallery_images
                WHERE dominant_color = '' OR color_family_scores_json = '{}'
                """
            ).fetchone()["total"]
        )
        current_version = _index_meta_get(connection, "color_index_version")

    return {
        "running": running,
        "queued": queued,
        "total": total,
        "indexed": max(0, total - missing),
        "missing": missing,
        "complete": total > 0 and missing == 0 and current_version == COLOR_INDEX_VERSION,
        "version": current_version or "",
        "target_version": COLOR_INDEX_VERSION,
        "threshold": COLOR_FAMILY_MIN_RATIO,
    }


def _save_image_index_to_db(index: dict[str, Any]):
    image_states = get_image_state_map()
    with _connect_gallery_index_db() as connection:
        connection.execute("DELETE FROM gallery_images")
        scanned_at = time.time()
        rows = []
        for image in index.get("images", []):
            image_state = image_states.get(image["relative_path"], default_image_state())
            rows.append(
                (
                    image["relative_path"],
                    image["source_id"],
                    image["source_relative_path"],
                    image["filename"],
                    image["relative_dir"],
                    image["subfolder"],
                    image["display_subfolder"],
                    int(image["size"]),
                    int(image["created_at"]),
                    int(image.get("modified_at", image["created_at"])),
                    str(image_state.get("title", "")),
                    str(image_state.get("category", "")),
                    str(image_state.get("notes", "")),
                    1 if image_state.get("pinned", image_state.get("favorite", False)) else 0,
                    _boards_to_search_text(image_state.get("boards", [])),
                    str(image.get("dominant_color", "")),
                    str(image.get("color_family", "")),
                    str(image.get("color_families_text", _encode_color_families([str(image.get("color_family", ""))]))),
                    json.dumps(image.get("color_family_scores", {}), ensure_ascii=False),
                    json.dumps(image.get("palette", []), ensure_ascii=False),
                    float(image.get("color_saturation", 0) or 0),
                    float(image.get("color_luma", 0) or 0),
                    scanned_at,
                )
            )
        connection.executemany(
            """
            INSERT INTO gallery_images(
                relative_path, source_id, source_relative_path, filename, relative_dir,
                subfolder, display_subfolder, size, created_at, modified_at,
                title, category, notes, pinned, boards_text,
                dominant_color, color_family, color_families_text,
                color_family_scores_json, palette_json, color_saturation, color_luma,
                scanned_at
            )
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        connection.execute("DELETE FROM gallery_image_color_family")
        if _index_meta_get(connection, "fts_available") == "1":
            connection.execute("DELETE FROM gallery_images_fts")
        auxiliary_rows = connection.execute(
            """
            SELECT relative_path, filename, title, category, notes, color_family, color_families_text,
                   color_family_scores_json, created_at
            FROM gallery_images
            """
        ).fetchall()
        _sync_auxiliary_rows(connection, auxiliary_rows)
        _index_meta_set(connection, "auxiliary_schema_version", str(GALLERY_INDEX_SCHEMA_VERSION))
        _sync_image_state_to_index_db(connection, image_states)
        _index_meta_set(connection, "source_signature", str(index.get("signature") or ""))
        _index_meta_set(connection, "color_index_version", COLOR_INDEX_VERSION if index.get("color_index_complete") else "")
        _index_meta_set(connection, "built_at", str(index.get("built_at") or scanned_at))
        connection.commit()


def invalidate_image_index_cache():
    with IMAGE_INDEX_LOCK:
        IMAGE_INDEX_CACHE["images"] = []
        IMAGE_INDEX_CACHE["subfolders"] = []
        IMAGE_INDEX_CACHE["sources"] = []
        IMAGE_INDEX_CACHE["built_at"] = 0.0
        IMAGE_INDEX_CACHE["output_dir"] = None
        IMAGE_INDEX_CACHE["signature"] = None
        IMAGE_INDEX_CACHE["dirty"] = True
    with IMAGE_FRESHNESS_LOCK:
        IMAGE_FRESHNESS_CACHE.clear()


def _build_image_index(sources: list[dict[str, Any]], include_color_profiles: bool = False) -> dict[str, Any]:
    images: list[dict[str, Any]] = []
    subfolders = _collect_directory_subfolders(sources)
    source_counts: dict[str, int] = {source["id"]: 0 for source in sources}

    for source in sources:
        if not source.get("enabled", True) or not source.get("exists"):
            continue
        source_root = source.get("path", "")
        if not source_root:
            continue
        stack = [source_root]

        while stack:
            current_dir = stack.pop()
            try:
                with os.scandir(current_dir) as iterator:
                    entries = list(iterator)
            except (FileNotFoundError, PermissionError, OSError):
                continue

            for entry in entries:
                if entry.is_dir(follow_symlinks=False):
                    if source.get("recursive", True):
                        stack.append(entry.path)
                    continue

                if not entry.is_file(follow_symlinks=False) or not entry.name.lower().endswith(SUPPORTED_IMAGE_EXTENSIONS):
                    continue

                try:
                    stat = entry.stat()
                except FileNotFoundError:
                    continue

                relative_path = normalize_relative_path(os.path.relpath(entry.path, source_root))
                image_ref = make_image_ref(source["id"], relative_path)
                relative_dir = normalize_relative_path(os.path.dirname(relative_path))
                display_dir = relative_dir
                subfolder_ref = relative_dir
                if source["id"] != DEFAULT_OUTPUT_SOURCE_ID:
                    subfolder_ref = f'{source["id"]}{IMAGE_REF_SEPARATOR}{relative_dir}' if relative_dir else source["id"]
                if relative_dir:
                    _collect_index_subfolders(source["id"], relative_dir, subfolders)

                original_url, resolved_subfolder = build_view_url(image_ref)
                color_profile = _extract_image_color_profile(entry.path) if include_color_profiles else dict(COLOR_PROFILE_DEFAULT)
                source_counts[source["id"]] = source_counts.get(source["id"], 0) + 1
                images.append(
                    {
                        "filename": entry.name,
                        "relative_path": image_ref,
                        "source_id": source["id"],
                        "source_name": source["name"],
                        "source_kind": source["kind"],
                        "source_path": source["path"],
                        "source_relative_path": relative_path,
                        "relative_dir": relative_dir,
                        "subfolder": subfolder_ref if relative_dir or source["id"] != DEFAULT_OUTPUT_SOURCE_ID else resolved_subfolder,
                        "display_subfolder": display_dir,
                        "url": original_url,
                        "original_url": original_url,
                        "thumb_url": build_thumb_url(image_ref),
                        "size": stat.st_size,
                        "created_at": int(stat.st_ctime),
                        "modified_at": int(stat.st_mtime),
                        "dominant_color": color_profile["dominant_color"],
                        "color_family": color_profile["color_family"],
                        "color_families_text": color_profile["color_families_text"],
                        "color_family_scores": json.loads(color_profile["color_family_scores_json"]),
                        "palette": json.loads(color_profile["palette_json"]),
                        "color_saturation": color_profile["color_saturation"],
                        "color_luma": color_profile["color_luma"],
                    }
                )

    images.sort(key=lambda item: item["created_at"], reverse=True)
    indexed_sources = [{**source, "image_count": source_counts.get(source["id"], 0)} for source in sources]
    index = {
        "signature": _source_signature(sources),
        "output_dir": get_output_dir(),
        "images": images,
        "subfolders": sorted(subfolders, key=lambda value: value.lower()),
        "sources": indexed_sources,
        "built_at": time.time(),
        "color_index_complete": include_color_profiles,
    }
    _save_image_index_to_db(index)
    if not include_color_profiles:
        _schedule_color_index_backfill(sources, index["signature"])
    return index


def _image_record_for_file(source: dict[str, Any], full_path: str, stat: os.stat_result) -> dict[str, Any]:
    source_root = source.get("path", "")
    relative_path = normalize_relative_path(os.path.relpath(full_path, source_root))
    image_ref = make_image_ref(source["id"], relative_path)
    relative_dir = normalize_relative_path(os.path.dirname(relative_path))
    display_dir = relative_dir
    subfolder_ref = relative_dir
    if source["id"] != DEFAULT_OUTPUT_SOURCE_ID:
        subfolder_ref = f'{source["id"]}{IMAGE_REF_SEPARATOR}{relative_dir}' if relative_dir else source["id"]
    original_url, resolved_subfolder = build_view_url(image_ref)
    return {
        "filename": os.path.basename(full_path),
        "relative_path": image_ref,
        "source_id": source["id"],
        "source_relative_path": relative_path,
        "relative_dir": relative_dir,
        "subfolder": subfolder_ref if relative_dir or source["id"] != DEFAULT_OUTPUT_SOURCE_ID else resolved_subfolder,
        "display_subfolder": display_dir,
        "size": stat.st_size,
        "created_at": int(stat.st_ctime),
        "modified_at": int(stat.st_mtime),
        "title": "",
        "category": "",
        "notes": "",
        "pinned": 0,
        "boards_text": "",
        **COLOR_PROFILE_DEFAULT,
    }


def _scan_index_records_for_scope(sources: list[dict[str, Any]], scope: str = "") -> dict[str, dict[str, Any]]:
    scoped_sources, _ = _freshness_sources_for_subfolder(sources, scope)
    records: dict[str, dict[str, Any]] = {}
    for source, relative_scope in scoped_sources:
        if not source.get("enabled", True) or not source.get("exists"):
            continue
        source_root = source.get("path", "")
        if not source_root:
            continue
        try:
            scan_root = (
                _ensure_within_directory(source_root, os.path.join(source_root, relative_scope), source.get("name", "source"))
                if relative_scope
                else _real_abs(source_root)
            )
        except ValueError:
            continue
        if not os.path.isdir(scan_root):
            continue

        stack = [scan_root]
        while stack:
            current_dir = stack.pop()
            try:
                with os.scandir(current_dir) as iterator:
                    entries = list(iterator)
            except (FileNotFoundError, PermissionError, OSError):
                continue
            for entry in entries:
                try:
                    if entry.is_dir(follow_symlinks=False):
                        if source.get("recursive", True):
                            stack.append(entry.path)
                        continue
                    if not entry.is_file(follow_symlinks=False) or not entry.name.lower().endswith(SUPPORTED_IMAGE_EXTENSIONS):
                        continue
                    stat = entry.stat()
                except (FileNotFoundError, PermissionError, OSError):
                    continue
                record = _image_record_for_file(source, entry.path, stat)
                records[record["relative_path"]] = record
    return records


def _scope_where_sql(sources: list[dict[str, Any]], scope: str = "") -> tuple[str, list[Any]]:
    scoped_sources, _ = _freshness_sources_for_subfolder(sources, scope)
    clauses: list[str] = []
    params: list[Any] = []
    for source, relative_scope in scoped_sources:
        source_id = source.get("id")
        if not source_id:
            continue
        if relative_scope:
            clauses.append("(source_id = ? AND (lower(relative_dir) = ? OR lower(relative_dir) LIKE ?))")
            normalized_scope = relative_scope.lower()
            params.extend([source_id, normalized_scope, f"{normalized_scope}/%"])
        else:
            clauses.append("source_id = ?")
            params.append(source_id)
    return " OR ".join(clauses) if clauses else "0 = 1", params


def _sync_image_index_incremental_locked(sources: list[dict[str, Any]], signature: str, scope: str = "") -> dict[str, Any]:
    if not os.path.exists(GALLERY_INDEX_DB_FILE) or not _image_index_db_has_signature(signature):
        return _build_image_index(sources)

    scanned_records = _scan_index_records_for_scope(sources, scope)
    where_sql, params = _scope_where_sql(sources, scope)
    scanned_at = time.time()
    state_map = get_image_state_map()
    upsert_rows: list[tuple[Any, ...]] = []
    upsert_payloads: list[dict[str, Any]] = []
    priority_paths: list[str] = []

    with _connect_gallery_index_db() as connection:
        existing_rows = connection.execute(
            f"""
            SELECT relative_path, size, modified_at
            FROM gallery_images
            WHERE {where_sql}
            """,
            params,
        ).fetchall()
        existing = {str(row["relative_path"]): row for row in existing_rows}
        scanned_paths = set(scanned_records)
        deleted_paths = sorted(set(existing) - scanned_paths)

        for relative_path, record in scanned_records.items():
            existing_row = existing.get(relative_path)
            if (
                existing_row
                and int(existing_row["size"]) == int(record["size"])
                and int(existing_row["modified_at"]) == int(record["modified_at"])
            ):
                continue
            image_state = state_map.get(relative_path, default_image_state())
            record = {
                **record,
                "title": str(image_state.get("title", "")),
                "category": str(image_state.get("category", "")),
                "notes": str(image_state.get("notes", "")),
                "pinned": 1 if image_state.get("pinned", image_state.get("favorite", False)) else 0,
                "boards_text": _boards_to_search_text(image_state.get("boards", [])),
            }
            upsert_payloads.append(record)
            priority_paths.append(relative_path)
            upsert_rows.append(
                (
                    record["relative_path"],
                    record["source_id"],
                    record["source_relative_path"],
                    record["filename"],
                    record["relative_dir"],
                    record["subfolder"],
                    record["display_subfolder"],
                    int(record["size"]),
                    int(record["created_at"]),
                    int(record["modified_at"]),
                    record["title"],
                    record["category"],
                    record["notes"],
                    int(record["pinned"]),
                    record["boards_text"],
                    record["dominant_color"],
                    record["color_family"],
                    record["color_families_text"],
                    record["color_family_scores_json"],
                    record["palette_json"],
                    float(record["color_saturation"]),
                    float(record["color_luma"]),
                    scanned_at,
                )
            )

        if deleted_paths:
            connection.executemany("DELETE FROM gallery_images WHERE relative_path = ?", [(path,) for path in deleted_paths])
            _sync_auxiliary_rows(connection, [], remove_paths=deleted_paths)
        if upsert_rows:
            connection.executemany(
                """
                INSERT INTO gallery_images(
                    relative_path, source_id, source_relative_path, filename, relative_dir,
                    subfolder, display_subfolder, size, created_at, modified_at,
                    title, category, notes, pinned, boards_text,
                    dominant_color, color_family, color_families_text,
                    color_family_scores_json, palette_json, color_saturation, color_luma,
                    scanned_at
                )
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(relative_path) DO UPDATE SET
                    source_id = excluded.source_id,
                    source_relative_path = excluded.source_relative_path,
                    filename = excluded.filename,
                    relative_dir = excluded.relative_dir,
                    subfolder = excluded.subfolder,
                    display_subfolder = excluded.display_subfolder,
                    size = excluded.size,
                    created_at = excluded.created_at,
                    modified_at = excluded.modified_at,
                    title = excluded.title,
                    category = excluded.category,
                    notes = excluded.notes,
                    pinned = excluded.pinned,
                    boards_text = excluded.boards_text,
                    dominant_color = excluded.dominant_color,
                    color_family = excluded.color_family,
                    color_families_text = excluded.color_families_text,
                    color_family_scores_json = excluded.color_family_scores_json,
                    palette_json = excluded.palette_json,
                    color_saturation = excluded.color_saturation,
                    color_luma = excluded.color_luma,
                    scanned_at = excluded.scanned_at
                """,
                upsert_rows,
            )
            _sync_auxiliary_rows(connection, upsert_payloads)
            _index_meta_set(connection, "color_index_version", "")
        _sync_image_state_to_index_db(connection, state_map)
        _index_meta_set(connection, "source_signature", signature)
        _index_meta_set(connection, "built_at", str(scanned_at))
        connection.commit()

    if priority_paths:
        _schedule_color_index_backfill(sources, signature, priority_paths)
    return {
        "signature": signature,
        "output_dir": get_output_dir(),
        "images": [],
        "subfolders": [],
        "sources": sources,
        "built_at": scanned_at,
    }


def ensure_image_index_db_current(force_refresh: bool = False, scope: str = "") -> tuple[list[dict[str, Any]], str]:
    sources = list_gallery_sources()
    signature = _source_signature(sources)
    with IMAGE_INDEX_LOCK:
        should_sync = force_refresh or IMAGE_INDEX_CACHE.get("dirty") or not _image_index_db_has_signature(signature)
        if should_sync:
            if force_refresh or _image_index_db_has_signature(signature):
                _sync_image_index_incremental_locked(sources, signature, scope=scope)
            else:
                _build_image_index(sources)
            IMAGE_INDEX_CACHE.update(
                {
                    "signature": signature,
                    "output_dir": get_output_dir(),
                    "built_at": time.time(),
                    "images": [],
                    "subfolders": [],
                    "sources": [],
                    "dirty": False,
                }
            )
    return sources, signature


def build_move_target_options(image_index: dict[str, Any]) -> list[dict[str, str]]:
    sources = image_index.get("sources", [])
    options: list[dict[str, str]] = []
    for source in sources:
        if not source.get("enabled") or not source.get("exists") or not source.get("writable"):
            continue
        source_id = source["id"]
        source_name = source["name"]
        options.append(
            {
                "value": make_folder_ref(source_id, ""),
                "source_id": source_id,
                "source_name": source_name,
                "subfolder": "",
                "label": f"{source_name} / ./",
            }
        )
        for subfolder in image_index.get("subfolders", []):
            folder_source_id, folder_relative = parse_folder_ref(subfolder)
            if folder_source_id != source_id or not folder_relative:
                continue
            options.append(
                {
                    "value": make_folder_ref(source_id, folder_relative),
                    "source_id": source_id,
                    "source_name": source_name,
                    "subfolder": folder_relative,
                    "label": f"{source_name} / {folder_relative}",
                }
            )
    return options


def get_image_index(force_refresh: bool = False) -> dict[str, Any]:
    sources = list_gallery_sources()
    signature = _source_signature(sources)

    with IMAGE_INDEX_LOCK:
        should_rebuild = (
            force_refresh
            or IMAGE_INDEX_CACHE.get("dirty")
            or IMAGE_INDEX_CACHE["signature"] != signature
            or not IMAGE_INDEX_CACHE["built_at"]
        )

        if should_rebuild:
            if force_refresh or (IMAGE_INDEX_CACHE.get("dirty") and _image_index_db_has_signature(signature)):
                _sync_image_index_incremental_locked(sources, signature)
                cached_index = _load_image_index_from_db(sources, signature)
            else:
                cached_index = _load_image_index_from_db(sources, signature)
            IMAGE_INDEX_CACHE.update(cached_index if cached_index is not None else _build_image_index(sources))
            IMAGE_INDEX_CACHE["dirty"] = False

        return {
            "signature": IMAGE_INDEX_CACHE["signature"],
            "output_dir": IMAGE_INDEX_CACHE["output_dir"],
            "images": list(IMAGE_INDEX_CACHE["images"]),
            "subfolders": list(IMAGE_INDEX_CACHE["subfolders"]),
            "sources": list(IMAGE_INDEX_CACHE["sources"]),
            "built_at": IMAGE_INDEX_CACHE["built_at"],
        }


def _collect_subfolders_from_db(sources: list[dict[str, Any]]) -> set[str]:
    if not os.path.exists(GALLERY_INDEX_DB_FILE):
        return set()
    subfolders: set[str] = set()
    with _connect_gallery_index_db() as connection:
        rows = connection.execute(
            """
            SELECT DISTINCT source_id, relative_dir
            FROM gallery_images
            WHERE relative_dir <> ''
            """
        ).fetchall()
    source_ids = {source["id"] for source in sources}
    for row in rows:
        source_id = str(row["source_id"])
        if source_id not in source_ids:
            continue
        _collect_index_subfolders(source_id, str(row["relative_dir"]), subfolders)
    return subfolders


def collect_subfolders(output_dir: str, force_refresh: bool = False) -> list[str]:
    if not output_dir or not os.path.exists(output_dir):
        return []
    sources, _ = ensure_image_index_db_current(force_refresh=force_refresh)
    directory_subfolders = set(_collect_directory_subfolder_details(sources))
    database_subfolders = _collect_subfolders_from_db(sources)
    subfolders = _merge_subfolder_refs(directory_subfolders, database_subfolders)
    return sorted(subfolders, key=lambda value: value.lower())


def collect_subfolder_details(output_dir: str, force_refresh: bool = False) -> list[dict[str, Any]]:
    if not output_dir or not os.path.exists(output_dir):
        return []
    sources, _ = ensure_image_index_db_current(force_refresh=force_refresh)
    directory_details = _collect_directory_subfolder_details(sources)
    database_subfolders = _collect_subfolders_from_db(sources)
    merged_refs = _merge_subfolder_refs(set(directory_details), database_subfolders)
    details: list[dict[str, Any]] = []
    for folder_ref in merged_refs:
        source_id, relative_path = parse_folder_ref(folder_ref)
        detail = directory_details.get(folder_ref)
        if detail is None:
            detail = {
                "path": folder_ref,
                "source_id": source_id,
                "relative_path": relative_path,
                "modified_at": 0,
            }
        details.append(detail)
    return sorted(details, key=lambda item: str(item["path"]).lower())


def list_images(
    search: str = "",
    category: str = "",
    subfolder: str = "",
    board_id: str = "",
    date_from: str = "",
    date_to: str = "",
    favorites_only: bool = False,
    sort_by: str = "created_at",
    sort_order: str = "desc",
    force_refresh: bool = False,
) -> list[dict]:
    normalized_search = search.strip().lower()
    normalized_category = category.strip().lower()
    normalized_subfolder = normalize_relative_path(subfolder).lower()
    filter_source_id = ""
    filter_relative_dir = normalized_subfolder
    if IMAGE_REF_SEPARATOR in normalized_subfolder:
        filter_source_id, filter_relative_dir = normalized_subfolder.split(IMAGE_REF_SEPARATOR, 1)
    normalized_board_id = str(board_id or "").strip()
    date_from_ts = None
    date_to_ts = None

    if date_from.strip():
        date_from_ts = int(datetime.strptime(date_from.strip(), "%Y-%m-%d").timestamp())
    if date_to.strip():
        date_to_ts = int((datetime.strptime(date_to.strip(), "%Y-%m-%d") + timedelta(days=1)).timestamp())

    indexed_images = get_image_index(force_refresh=force_refresh)["images"]
    image_states = get_image_state_map()
    images: list[dict[str, Any]] = []

    for indexed_image in indexed_images:
        image_state = image_states.get(indexed_image["relative_path"], default_image_state())
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
        if normalized_subfolder:
            if filter_source_id and indexed_image.get("source_id", "").lower() != filter_source_id:
                continue
            image_relative_dir = str(indexed_image["relative_dir"]).lower()
            if filter_relative_dir and not (
                image_relative_dir == filter_relative_dir
                or image_relative_dir.startswith(f"{filter_relative_dir}/")
            ):
                continue
        if normalized_board_id and normalized_board_id not in image_state.get("boards", []):
            continue
        if date_from_ts is not None and indexed_image["created_at"] < date_from_ts:
            continue
        if date_to_ts is not None and indexed_image["created_at"] >= date_to_ts:
            continue
        if favorites_only and not image_state.get("pinned", image_state.get("favorite", False)):
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


def _freshness_scope_key(signature: str, subfolder: str) -> str:
    return json.dumps(
        {
            "signature": signature,
            "subfolder": normalize_relative_path(subfolder),
        },
        sort_keys=True,
        ensure_ascii=False,
    )


def _freshness_sources_for_subfolder(
    sources: list[dict[str, Any]],
    subfolder: str,
) -> tuple[list[tuple[dict[str, Any], str]], str]:
    normalized_subfolder = normalize_relative_path(subfolder)
    if not normalized_subfolder:
        return [(source, "") for source in sources], ""

    source_id, relative_dir = parse_folder_ref(normalized_subfolder)
    scoped_sources = [(source, relative_dir) for source in sources if source.get("id") == source_id]
    return scoped_sources, make_folder_ref(source_id, relative_dir) if source_id != DEFAULT_OUTPUT_SOURCE_ID or relative_dir else relative_dir


def _scan_image_freshness(sources: list[dict[str, Any]], subfolder: str) -> dict[str, Any]:
    scoped_sources, normalized_subfolder = _freshness_sources_for_subfolder(sources, subfolder)
    records: list[str] = []
    image_count = 0
    latest_created_ns = -1
    latest_created_at = 0
    latest_relative_path = ""

    for source, relative_scope in scoped_sources:
        if not source.get("enabled", True) or not source.get("exists"):
            continue
        source_root = source.get("path", "")
        if not source_root:
            continue
        try:
            scan_root = (
                _ensure_within_directory(source_root, os.path.join(source_root, relative_scope), source.get("name", "source"))
                if relative_scope
                else _real_abs(source_root)
            )
        except ValueError:
            continue
        if not os.path.isdir(scan_root):
            continue

        stack = [scan_root]
        while stack:
            current_dir = stack.pop()
            try:
                with os.scandir(current_dir) as iterator:
                    entries = list(iterator)
            except (FileNotFoundError, PermissionError, OSError):
                continue

            for entry in entries:
                try:
                    if entry.is_dir(follow_symlinks=False):
                        if source.get("recursive", True):
                            stack.append(entry.path)
                        continue
                    if not entry.is_file(follow_symlinks=False) or not entry.name.lower().endswith(SUPPORTED_IMAGE_EXTENSIONS):
                        continue
                    stat = entry.stat()
                except (FileNotFoundError, PermissionError, OSError):
                    continue

                relative_path = normalize_relative_path(os.path.relpath(entry.path, source_root))
                image_ref = make_image_ref(source["id"], relative_path)
                image_count += 1
                created_ns = getattr(stat, "st_ctime_ns", int(stat.st_ctime * 1_000_000_000))
                if created_ns > latest_created_ns:
                    latest_created_ns = created_ns
                    latest_created_at = int(stat.st_ctime)
                    latest_relative_path = image_ref
                modified_ns = getattr(stat, "st_mtime_ns", int(stat.st_mtime * 1_000_000_000))
                records.append(f"{image_ref}\0{stat.st_size}\0{modified_ns}")

    digest = hashlib.sha256()
    digest.update(_source_signature(sources).encode("utf-8"))
    digest.update(b"\0")
    digest.update(normalized_subfolder.encode("utf-8"))
    for record in sorted(records):
        digest.update(b"\0")
        digest.update(record.encode("utf-8", errors="surrogateescape"))

    return {
        "fingerprint": digest.hexdigest(),
        "image_count": image_count,
        "latest_created_at": latest_created_at,
        "latest_relative_path": latest_relative_path,
        "checked_at": time.time(),
        "subfolder": normalized_subfolder,
    }


def get_image_freshness(subfolder: str = "", known: str = "") -> dict[str, Any]:
    sources = list_gallery_sources()
    signature = _source_signature(sources)
    cache_key = _freshness_scope_key(signature, subfolder)
    now = time.time()

    with IMAGE_FRESHNESS_LOCK:
        cached = IMAGE_FRESHNESS_CACHE.get(cache_key)
        if cached and now - float(cached.get("checked_at", 0)) < IMAGE_FRESHNESS_CACHE_TTL_SECONDS:
            payload = dict(cached)
        else:
            payload = _scan_image_freshness(sources, subfolder)
            IMAGE_FRESHNESS_CACHE[cache_key] = dict(payload)

    fingerprint = str(payload.get("fingerprint") or "")
    known_fingerprint = str(known or "").strip()
    return {
        **payload,
        "changed": bool(known_fingerprint and known_fingerprint != fingerprint),
    }


def list_images_page(
    page: int = 1,
    limit: int = 60,
    search: str = "",
    category: str = "",
    subfolder: str = "",
    board_id: str = "",
    date_from: str = "",
    date_to: str = "",
    favorites_only: bool = False,
    color_family: str = "",
    sort_by: str = "created_at",
    sort_order: str = "desc",
    force_refresh: bool = False,
) -> dict[str, Any]:
    sources, signature = ensure_image_index_db_current(force_refresh=force_refresh, scope=subfolder)
    source_by_id = {source["id"]: source for source in sources}
    normalized_search = search.strip().lower()
    normalized_category = category.strip().lower()
    normalized_color_family = color_family.strip().lower()
    normalized_subfolder = normalize_relative_path(subfolder).lower()
    filter_source_id = ""
    filter_relative_dir = normalized_subfolder
    if IMAGE_REF_SEPARATOR in normalized_subfolder:
        filter_source_id, filter_relative_dir = normalized_subfolder.split(IMAGE_REF_SEPARATOR, 1)
    normalized_board_id = str(board_id or "").strip()
    date_from_ts = None
    date_to_ts = None

    if date_from.strip():
        date_from_ts = int(datetime.strptime(date_from.strip(), "%Y-%m-%d").timestamp())
    if date_to.strip():
        date_to_ts = int((datetime.strptime(date_to.strip(), "%Y-%m-%d") + timedelta(days=1)).timestamp())

    where_clauses = ["1 = 1"]
    params: list[Any] = []

    fts_query = ""
    if normalized_search:
        fts_query = _fts_match_query(normalized_search)
        if fts_query:
            where_clauses.append("relative_path IN (SELECT relative_path FROM gallery_images_fts WHERE gallery_images_fts MATCH ?)")
            params.append(fts_query)
        else:
            where_clauses.append(
                "lower(filename || ' ' || relative_path || ' ' || title || ' ' || category || ' ' || notes) LIKE ?"
            )
            params.append(f"%{normalized_search}%")
    if normalized_category:
        where_clauses.append("lower(category) = ?")
        params.append(normalized_category)
    if normalized_subfolder:
        if filter_source_id:
            where_clauses.append("source_id = ?")
            params.append(filter_source_id)
        if filter_relative_dir:
            where_clauses.append("(lower(relative_dir) = ? OR lower(relative_dir) LIKE ?)")
            params.extend([filter_relative_dir, f"{filter_relative_dir}/%"])
    if normalized_board_id:
        where_clauses.append("boards_text LIKE ?")
        params.append(f"%\n{normalized_board_id}\n%")
    if date_from_ts is not None:
        where_clauses.append("created_at >= ?")
        params.append(date_from_ts)
    if date_to_ts is not None:
        where_clauses.append("created_at < ?")
        params.append(date_to_ts)
    if favorites_only:
        where_clauses.append("pinned = 1")
    if normalized_color_family:
        if normalized_color_family == "low_saturation":
            where_clauses.append(
                "(relative_path IN (SELECT relative_path FROM gallery_image_color_family WHERE family = ?) OR (color_saturation > 0 AND color_saturation < 0.18))"
            )
            params.append("low_saturation")
        else:
            where_clauses.append("relative_path IN (SELECT relative_path FROM gallery_image_color_family WHERE family = ?)")
            params.append(normalized_color_family)

    sort_field = {
        "filename": "filename COLLATE NOCASE",
        "size": "size",
        "created_at": "created_at",
    }.get(sort_by, "created_at")
    sort_direction = "ASC" if sort_order.lower() == "asc" else "DESC"
    safe_page = max(1, int(page or 1))
    safe_limit = max(1, min(200, int(limit or 60)))
    offset = (safe_page - 1) * safe_limit
    where_sql = " AND ".join(where_clauses)

    with _connect_gallery_index_db() as connection:
        _ensure_auxiliary_tables_current(connection)
        if not _color_index_is_current(connection):
            _schedule_color_index_backfill(sources, signature)
        _sync_image_state_to_index_db(connection)
        try:
            total = int(
                connection.execute(f"SELECT COUNT(*) AS total FROM gallery_images WHERE {where_sql}", params).fetchone()["total"]
            )
            rows = connection.execute(
                f"""
                SELECT relative_path, source_id, source_relative_path, filename, relative_dir,
                       subfolder, display_subfolder, size, created_at, modified_at,
                       title, category, notes, pinned, boards_text,
                       dominant_color, color_family, color_families_text,
                       color_family_scores_json, palette_json, color_saturation, color_luma
                FROM gallery_images
                WHERE {where_sql}
                ORDER BY {sort_field} {sort_direction}
                LIMIT ? OFFSET ?
                """,
                [*params, safe_limit, offset],
            ).fetchall()
        except sqlite3.OperationalError:
            if not fts_query:
                raise
            fallback_where = where_sql.replace(
                "relative_path IN (SELECT relative_path FROM gallery_images_fts WHERE gallery_images_fts MATCH ?)",
                "lower(filename || ' ' || relative_path || ' ' || title || ' ' || category || ' ' || notes) LIKE ?",
                1,
            )
            fallback_params = [f"%{normalized_search}%" if value == fts_query else value for value in params]
            total = int(
                connection.execute(f"SELECT COUNT(*) AS total FROM gallery_images WHERE {fallback_where}", fallback_params).fetchone()["total"]
            )
            rows = connection.execute(
                f"""
                SELECT relative_path, source_id, source_relative_path, filename, relative_dir,
                       subfolder, display_subfolder, size, created_at, modified_at,
                       title, category, notes, pinned, boards_text,
                       dominant_color, color_family, color_families_text,
                       color_family_scores_json, palette_json, color_saturation, color_luma
                FROM gallery_images
                WHERE {fallback_where}
                ORDER BY {sort_field} {sort_direction}
                LIMIT ? OFFSET ?
                """,
                [*fallback_params, safe_limit, offset],
            ).fetchall()
        connection.commit()

    _schedule_color_index_backfill(sources, signature, [str(row["relative_path"]) for row in rows])

    images: list[dict[str, Any]] = []
    for row in rows:
        source = source_by_id.get(str(row["source_id"]))
        if not source:
            continue
        images.append({**_image_row_to_payload(row, source), **_image_row_state(row)})

    return {
        "images": images,
        "total": total,
        "page": safe_page,
        "limit": safe_limit,
        "color_index_status": get_color_index_status(),
    }


def _board_cover_payload(relative_path: str) -> dict[str, str] | None:
    if not relative_path:
        return None
    try:
        _, full_path = resolve_image_path(relative_path)
    except (FileNotFoundError, ValueError):
        return None
    if not os.path.exists(full_path):
        return None
    original_url, _ = build_view_url(relative_path)
    return {
        "relative_path": normalize_relative_path(relative_path),
        "url": original_url,
        "thumb_url": build_thumb_url(relative_path),
    }


def list_boards(force_refresh: bool = False) -> list[dict[str, Any]]:
    boards = get_raw_boards()
    sources, _ = ensure_image_index_db_current(force_refresh=force_refresh)
    image_states = get_image_state_map()
    board_counts: dict[str, int] = {board_id: 0 for board_id in boards}
    first_cover_by_board: dict[str, str] = {}
    state_paths = sorted(image_states)
    existing_paths: list[str] = []
    if state_paths and os.path.exists(GALLERY_INDEX_DB_FILE):
        with _connect_gallery_index_db() as connection:
            _sync_image_state_to_index_db(connection, image_states)
            placeholders = ",".join("?" for _ in state_paths)
            rows = connection.execute(
                f"""
                SELECT relative_path
                FROM gallery_images
                WHERE relative_path IN ({placeholders})
                ORDER BY created_at DESC
                """,
                state_paths,
            ).fetchall()
            connection.commit()
        existing_paths = [str(row["relative_path"]) for row in rows]

    for relative_path in existing_paths:
        image_state = image_states.get(relative_path, default_image_state())
        for board_id in image_state.get("boards", []):
            if board_id not in boards:
                continue
            board_counts[board_id] = board_counts.get(board_id, 0) + 1
            first_cover_by_board.setdefault(board_id, relative_path)

    summaries = []
    for board_id, board in boards.items():
        preferred_cover = board.get("cover") or first_cover_by_board.get(board_id, "")
        cover = _board_cover_payload(preferred_cover)
        summaries.append(
            {
                **board,
                "count": board_counts.get(board_id, 0),
                "cover_image": cover,
            }
        )

    summaries.sort(key=lambda item: (item.get("updated_at") or 0, item.get("name", "").lower()), reverse=True)
    return summaries


def create_gallery_board(name: str, description: str = "") -> dict[str, Any]:
    board = create_board(name, description)
    return {"ok": True, "board": {**board, "count": 0, "cover_image": None}, "boards": list_boards()}


def update_gallery_board(board_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    board = update_board(board_id, updates)
    return {"ok": True, "board": board, "boards": list_boards()}


def delete_gallery_board(board_id: str) -> dict[str, Any]:
    categories = delete_board(board_id)
    return {"ok": True, "id": board_id, "boards": list_boards(), "categories": categories}


def update_board_images(board_id: str, relative_paths: list[str], pinned: bool = True) -> dict[str, Any]:
    normalized_paths = [normalize_relative_path(path) for path in relative_paths if str(path).strip()]
    if not normalized_paths:
        raise ValueError("relative_paths required")

    for relative_path in normalized_paths:
        _, full_path = resolve_image_path(relative_path)
        if not os.path.exists(full_path):
            raise FileNotFoundError(f"image not found: {relative_path}")

    updated, categories = set_image_board_membership(normalized_paths, board_id, pinned=pinned)
    return {
        "ok": True,
        "updated": updated,
        "boards": list_boards(),
        "categories": categories,
    }


def get_gallery_context(force_refresh: bool = False) -> dict:
    output_dir = get_output_dir()
    base_dir = get_comfy_base_dir()
    import_dir = os.path.join(output_dir, IMPORT_IMAGE_SUBFOLDER) if output_dir else ""
    sources, _ = ensure_image_index_db_current(force_refresh=force_refresh)
    subfolder_details = collect_subfolder_details(output_dir, force_refresh=False)
    subfolders = [str(item["path"]) for item in subfolder_details]
    source_counts: dict[str, int] = {source["id"]: 0 for source in sources}
    pinned_count = 0
    if os.path.exists(GALLERY_INDEX_DB_FILE):
        with _connect_gallery_index_db() as connection:
            _ensure_auxiliary_tables_current(connection)
            _sync_image_state_to_index_db(connection)
            for row in connection.execute("SELECT source_id, COUNT(*) AS total FROM gallery_images GROUP BY source_id"):
                source_counts[str(row["source_id"])] = int(row["total"])
            pinned_count = int(connection.execute("SELECT COUNT(*) AS total FROM gallery_images WHERE pinned = 1").fetchone()["total"])
            connection.commit()
    indexed_sources = [{**source, "image_count": source_counts.get(source["id"], 0)} for source in sources]

    return {
        "base_dir": base_dir,
        "output_dir_absolute": output_dir,
        "output_dir_relative": build_relative_display(output_dir, base_dir) if output_dir else "",
        "import_image_subfolder": IMPORT_IMAGE_SUBFOLDER,
        "import_image_target_relative": build_relative_display(import_dir, base_dir) if import_dir else "",
        "categories": collect_categories(),
        "subfolders": subfolders,
        "subfolder_details": subfolder_details,
        "move_targets": build_move_target_options({"sources": indexed_sources, "subfolders": subfolders}),
        "sources": indexed_sources,
        "active_source_count": sum(1 for source in indexed_sources if source.get("enabled") and source.get("exists")),
        "pinned_count": pinned_count,
        "color_index_status": get_color_index_status(),
        "boards": list_boards(force_refresh=force_refresh),
    }


def get_image_metadata(relative_path: str) -> dict:
    source_id, source_relative_path = parse_image_ref(relative_path)
    normalized = make_image_ref(source_id, source_relative_path)
    _, full_path = resolve_image_path(normalized)
    metadata = read_image_metadata(full_path)
    workflow = metadata.get("workflow")
    return {
        "filename": os.path.basename(source_relative_path),
        "relative_path": normalized,
        "source_id": source_id,
        "source_relative_path": source_relative_path,
        "metadata": metadata,
        "workflow": workflow if isinstance(workflow, dict) else None,
        "artist_prompts": extract_artist_prompts(metadata),
        "summary": build_prompt_summary(metadata),
        "state": get_image_state(normalized),
    }


def ensure_thumb_cache_dir():
    ensure_data_dir()
    os.makedirs(THUMB_CACHE_DIR, exist_ok=True)


def _get_thumb_generation_lock(cache_key: str) -> Lock:
    with THUMB_LOCKS_GUARD:
        thumb_lock = THUMB_LOCKS.get(cache_key)
        if thumb_lock is None:
            thumb_lock = Lock()
            THUMB_LOCKS[cache_key] = thumb_lock
        return thumb_lock


def get_thumbnail_path(relative_path: str, size: int = THUMB_SIZE) -> tuple[str, str]:
    source_id, source_relative_path = parse_image_ref(relative_path)
    normalized = make_image_ref(source_id, source_relative_path)
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
        thumb_lock = _get_thumb_generation_lock(cache_key)
        with thumb_lock:
            if not os.path.exists(thumb_path):
                with THUMB_GENERATION_SEMAPHORE:
                    if not os.path.exists(thumb_path):
                        temp_path = f"{thumb_path}.{uuid.uuid4().hex}.tmp"
                        try:
                            with Image.open(full_path) as image:
                                image = image.convert("RGB")
                                image.thumbnail((size, size))
                                image.save(temp_path, format="WEBP", quality=80, method=2)
                            os.replace(temp_path, thumb_path)
                        finally:
                            if os.path.exists(temp_path):
                                try:
                                    os.remove(temp_path)
                                except OSError:
                                    pass
        with THUMB_LOCKS_GUARD:
            if THUMB_LOCKS.get(cache_key) is thumb_lock:
                THUMB_LOCKS.pop(cache_key, None)

    return full_path, thumb_path


def _thumbnail_prewarm_key(relative_path: str, size: int) -> str:
    source_id, source_relative_path = parse_image_ref(relative_path)
    return f"{make_image_ref(source_id, source_relative_path)}|{int(size)}"


def _run_thumbnail_prewarm(relative_path: str, size: int, queue_key: str):
    try:
        get_thumbnail_path(relative_path, size=size)
    except Exception as error:
        with THUMB_PREWARM_LOCK:
            THUMB_PREWARM_STATS["failed"] = int(THUMB_PREWARM_STATS.get("failed", 0)) + 1
            THUMB_PREWARM_STATS["last_error"] = str(error)
            THUMB_PREWARM_STATS["updated_at"] = time.time()
    else:
        with THUMB_PREWARM_LOCK:
            THUMB_PREWARM_STATS["completed"] = int(THUMB_PREWARM_STATS.get("completed", 0)) + 1
            THUMB_PREWARM_STATS["updated_at"] = time.time()
    finally:
        with THUMB_PREWARM_LOCK:
            THUMB_PREWARM_PENDING.discard(queue_key)


def enqueue_thumbnail_prewarm(relative_paths: list[str], size: int = THUMB_SIZE, limit: int = 80) -> dict[str, Any]:
    queued: list[str] = []
    skipped: list[str] = []
    for relative_path in relative_paths[:limit]:
        try:
            source_id, source_relative_path = parse_image_ref(relative_path)
            normalized = make_image_ref(source_id, source_relative_path)
            queue_key = _thumbnail_prewarm_key(normalized, size)
        except ValueError:
            skipped.append(relative_path)
            continue

        with THUMB_PREWARM_LOCK:
            if queue_key in THUMB_PREWARM_PENDING:
                skipped.append(normalized)
                continue
            THUMB_PREWARM_PENDING.add(queue_key)
            THUMB_PREWARM_STATS["queued"] = int(THUMB_PREWARM_STATS.get("queued", 0)) + 1
            THUMB_PREWARM_STATS["updated_at"] = time.time()

        queued.append(normalized)
        THUMB_PREWARM_EXECUTOR.submit(_run_thumbnail_prewarm, normalized, size, queue_key)

    return {"ok": True, "queued": queued, "skipped": skipped, "status": get_thumbnail_prewarm_status()}


def get_thumbnail_prewarm_status() -> dict[str, Any]:
    with THUMB_PREWARM_LOCK:
        return {
            "pending": len(THUMB_PREWARM_PENDING),
            "queued": int(THUMB_PREWARM_STATS.get("queued", 0)),
            "completed": int(THUMB_PREWARM_STATS.get("completed", 0)),
            "failed": int(THUMB_PREWARM_STATS.get("failed", 0)),
            "last_error": str(THUMB_PREWARM_STATS.get("last_error", "")),
            "updated_at": float(THUMB_PREWARM_STATS.get("updated_at", 0.0)),
        }


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
        if filename in RUNTIME_STATE_FILENAMES or not filename.endswith(".json"):
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


def get_import_target_for_filename(
    filename: str,
    target_source_id: str = "",
    target_subfolder: str = IMPORT_IMAGE_SUBFOLDER,
) -> tuple[str | None, str | None, dict[str, str] | None]:
    ensure_data_dir()

    original_name = os.path.basename(filename)
    extension = os.path.splitext(original_name)[1].lower()

    if extension in SUPPORTED_IMAGE_EXTENSIONS:
        sources = list_gallery_sources()
        target_source = None
        if target_source_id:
            normalized_target_source_id = _sanitize_source_id(target_source_id)
            target_source = next((source for source in sources if source["id"] == normalized_target_source_id), None)
        if target_source is None:
            target_source = next(
                (source for source in sources if source.get("enabled") and source.get("writable") and source.get("import_target")),
                None,
            )
        if target_source is None:
            target_source = next((source for source in sources if source["id"] == DEFAULT_OUTPUT_SOURCE_ID), None)
        if target_source is None or not target_source.get("path"):
            raise FileNotFoundError("import target not found")
        if not target_source.get("enabled"):
            raise ValueError("import target source is disabled")
        if not target_source.get("writable"):
            raise ValueError("import target source is read-only")
        normalized_target_subfolder = normalize_relative_path(target_subfolder or IMPORT_IMAGE_SUBFOLDER)
        image_import_dir = os.path.join(target_source["path"], normalized_target_subfolder)
        image_import_dir = _ensure_within_directory(target_source["path"], image_import_dir, target_source["name"])
        os.makedirs(image_import_dir, exist_ok=True)
        return "image", ensure_unique_path(image_import_dir, original_name), None
    if extension in SUPPORTED_LIBRARY_EXTENSIONS:
        return "library", ensure_unique_path(DATA_DIR, original_name), None

    return None, None, {"filename": original_name, "reason": "unsupported file type"}


def build_import_result(imported_images: list[dict], imported_libraries: list[dict], skipped: list[dict]) -> dict:
    invalidate_image_index_cache()
    return {
        "ok": True,
        "imported_images": imported_images,
        "imported_libraries": imported_libraries,
        "skipped": skipped,
    }


def import_files_from_parts(parts) -> dict:
    # Kept for compatibility with older callers; aiohttp routes stream parts directly.
    imported_images = []
    imported_libraries = []
    skipped = []

    for part in parts:
        kind, target_path, skipped_item = get_import_target_for_filename(part.filename)
        if skipped_item:
            skipped.append(skipped_item)
            continue

        yield ("write", part, target_path)

        if kind == "image":
            imported_images.append(
                {
                    "filename": os.path.basename(target_path),
                    "relative_path": image_ref_for_full_path(target_path),
                }
            )
        else:
            imported_libraries.append({"filename": os.path.basename(target_path)})

    yield ("result", build_import_result(imported_images, imported_libraries, skipped))


def persist_image_state(relative_path: str, updates: dict) -> dict:
    state, categories = update_image_state(normalize_relative_path(relative_path), updates)
    return {"ok": True, "state": state, "categories": categories}


def rename_image(relative_path: str, new_filename: str) -> dict:
    source_id, source_relative_path = parse_image_ref(relative_path)
    normalized = make_image_ref(source_id, source_relative_path)
    source = get_gallery_source(source_id)
    if not source.get("writable"):
        raise ValueError("gallery source is read-only")
    output_dir, full_path = resolve_image_path(normalized)
    if not os.path.exists(full_path):
        raise FileNotFoundError("image not found")

    clean_name = os.path.basename(new_filename).strip()
    if not clean_name:
        raise ValueError("new filename required")

    original_ext = os.path.splitext(source_relative_path)[1]
    if not os.path.splitext(clean_name)[1]:
        clean_name = f"{clean_name}{original_ext}"

    target_source_relative = normalize_relative_path(os.path.join(os.path.dirname(source_relative_path), clean_name))
    target_relative = make_image_ref(source_id, target_source_relative)
    target_full_path = _ensure_within_directory(output_dir, os.path.join(output_dir, target_source_relative), source["name"])
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
            "filename": os.path.basename(target_source_relative),
            "relative_path": target_relative,
            "source_id": source_id,
            "source_name": source["name"],
            "source_kind": source["kind"],
            "source_path": source["path"],
            "source_relative_path": target_source_relative,
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

    padding = max(1, min(8, int(padding)))
    start_number = max(0, int(start_number))
    current_page = max(1, int(current_page))

    source_paths: list[tuple[str, str, str, str]] = []
    selected_set = set()
    source_id = ""
    source_root = ""
    source_meta: dict[str, Any] | None = None

    for normalized in relative_paths:
        current_source_id, source_relative_path = parse_image_ref(normalized)
        if source_id and current_source_id != source_id:
            raise ValueError("batch rename only supports one source at a time")
        source_id = current_source_id
        source_meta = get_gallery_source(source_id)
        if not source_meta.get("writable"):
            raise ValueError("gallery source is read-only")
        normalized_source = make_image_ref(source_id, source_relative_path)
        selected_set.add(normalized_source)
        _, full_path = resolve_image_path(normalized_source)
        source_root = os.path.dirname(full_path[: -len(source_relative_path)]).rstrip("\\/") if not source_root else source_root
        if not os.path.exists(full_path):
            raise FileNotFoundError(f"image not found: {normalized_source}")

        filename = os.path.basename(source_relative_path)
        stem, ext = os.path.splitext(filename)
        source_paths.append((normalized_source, source_relative_path, stem, ext))

    if not source_meta:
        raise ValueError("relative_paths required")
    source_root = source_meta["path"]

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

    for index, (source_relative, source_relative_path, original_stem, extension) in enumerate(source_paths):
        next_filename = build_target_name(original_stem, index, extension)
        target_source_relative = normalize_relative_path(os.path.join(os.path.dirname(source_relative_path), next_filename))
        target_relative = make_image_ref(source_id, target_source_relative)

        if target_relative in seen_targets:
            raise FileExistsError(f"duplicate target filename: {next_filename}")
        seen_targets.add(target_relative)

        target_full_path = _ensure_within_directory(source_root, os.path.join(source_root, target_source_relative), source_meta["name"])
        if os.path.exists(target_full_path) and target_relative not in selected_set:
            raise FileExistsError(f"target filename already exists: {next_filename}")

        target_mapping[source_relative] = target_relative

    temporary_mapping: dict[str, str] = {}
    for source_relative, source_relative_path, _, extension in source_paths:
        temp_filename = f".ue-rename-{uuid.uuid4().hex}{extension}"
        temp_source_relative = normalize_relative_path(os.path.join(os.path.dirname(source_relative_path), temp_filename))
        temp_relative = make_image_ref(source_id, temp_source_relative)
        temporary_mapping[source_relative] = temp_relative
        os.rename(os.path.join(source_root, source_relative_path), os.path.join(source_root, temp_source_relative))

    try:
        for source_relative, temp_relative in temporary_mapping.items():
            _, temp_source_relative = parse_image_ref(temp_relative)
            _, target_source_relative = parse_image_ref(target_mapping[source_relative])
            os.rename(os.path.join(source_root, temp_source_relative), os.path.join(source_root, target_source_relative))
    except Exception:
        for source_relative, temp_relative in temporary_mapping.items():
            _, temp_source_relative = parse_image_ref(temp_relative)
            _, source_relative_path = parse_image_ref(source_relative)
            temp_full_path = os.path.join(source_root, temp_source_relative)
            source_full_path = os.path.join(source_root, source_relative_path)
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
    source, normalized_subfolder, full_path = _resolve_folder_ref_path(subfolder, require_writable=True)
    if not normalized_subfolder:
        raise ValueError("folder path required")
    os.makedirs(full_path, exist_ok=True)
    invalidate_image_index_cache()
    return {
        "ok": True,
        "path": _normalize_folder_ref_for_source(source["id"], normalized_subfolder),
        "subfolders": collect_subfolders(_ensure_output_dir(), force_refresh=True),
    }


def delete_folder(subfolder: str) -> dict[str, Any]:
    source, normalized_subfolder, full_path = _resolve_folder_ref_path(subfolder, require_writable=True)
    if not normalized_subfolder:
        raise ValueError("cannot delete root gallery source directory")
    if not os.path.exists(full_path):
        raise FileNotFoundError("folder not found")

    normalized_folder_ref = _normalize_folder_ref_for_source(source["id"], normalized_subfolder)
    state_snapshot, categories = extract_image_states_by_prefix(_image_state_folder_prefix(source["id"], normalized_subfolder))
    image_count = len(state_snapshot)
    move_path_to_trash(
        full_path=full_path,
        kind="folder",
        original_path=normalized_folder_ref,
        state_snapshot=state_snapshot,
        image_count=image_count,
    )
    invalidate_image_index_cache()
    return {
        "ok": True,
        "path": normalized_folder_ref,
        "subfolders": collect_subfolders(_ensure_output_dir(), force_refresh=True),
        "categories": categories,
    }


def merge_folder(source_subfolder: str, target_subfolder: str) -> dict[str, Any]:
    source, source_relative, source_full_path = _resolve_folder_ref_path(source_subfolder, require_writable=True)
    target_source_id, target_relative_from_ref = parse_folder_ref(_coerce_target_folder_ref(target_subfolder, source["id"]))
    if target_source_id != source["id"]:
        raise ValueError("source and target folders must stay in the same gallery source")
    target_source, target_relative, target_full_path = resolve_source_subfolder_path(
        target_source_id,
        target_relative_from_ref,
        require_writable=True,
    )

    if not source_relative or not target_relative:
        raise ValueError("source and target folders required")
    if source_relative == target_relative:
        raise ValueError("source and target folder must be different")
    if not os.path.exists(source_full_path):
        raise FileNotFoundError("source folder not found")
    os.makedirs(target_full_path, exist_ok=True)

    path_mapping: dict[str, str] = {}
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

            source_rel_path = normalize_relative_path(os.path.relpath(source_file, source["path"]))
            destination_rel_path = normalize_relative_path(os.path.relpath(destination_file, target_source["path"]))
            path_mapping[make_image_ref(source["id"], source_rel_path)] = make_image_ref(target_source["id"], destination_rel_path)

    shutil.rmtree(source_full_path, ignore_errors=True)
    categories = move_image_states(path_mapping)
    invalidate_image_index_cache()
    return {
        "ok": True,
        "source_path": _normalize_folder_ref_for_source(source["id"], source_relative),
        "target_path": _normalize_folder_ref_for_source(target_source["id"], target_relative),
        "moved": len(path_mapping),
        "subfolders": collect_subfolders(_ensure_output_dir(), force_refresh=True),
        "categories": categories,
    }


def rename_folder(source_subfolder: str, target_subfolder: str) -> dict[str, Any]:
    source, source_relative, source_full_path = _resolve_folder_ref_path(source_subfolder, require_writable=True)
    target_source_id, target_relative_from_ref = parse_folder_ref(_coerce_target_folder_ref(target_subfolder, source["id"]))
    if target_source_id != source["id"]:
        raise ValueError("source and target folders must stay in the same gallery source")
    target_source, target_relative, target_full_path = resolve_source_subfolder_path(
        target_source_id,
        target_relative_from_ref,
        require_writable=True,
    )

    if not source_relative or not target_relative:
        raise ValueError("source and target folders required")
    if source_relative == target_relative:
        raise ValueError("source and target folder must be different")
    if target_relative.startswith(f"{source_relative}/"):
        raise ValueError("target folder cannot be inside source folder")
    if not os.path.exists(source_full_path):
        raise FileNotFoundError("source folder not found")
    if os.path.exists(target_full_path):
        raise FileExistsError("target folder already exists")

    parent_dir = os.path.dirname(target_full_path)
    os.makedirs(parent_dir, exist_ok=True)
    path_mapping: dict[str, str] = {}

    for root, _dirs, files in os.walk(source_full_path):
        for filename in files:
            source_file = os.path.join(root, filename)
            source_rel_path = normalize_relative_path(os.path.relpath(source_file, source["path"]))
            relative_to_source = normalize_relative_path(os.path.relpath(source_file, source_full_path))
            destination_rel_path = normalize_relative_path(os.path.join(target_relative, relative_to_source))
            path_mapping[make_image_ref(source["id"], source_rel_path)] = make_image_ref(target_source["id"], destination_rel_path)

    os.rename(source_full_path, target_full_path)
    categories = move_image_states(path_mapping)
    invalidate_image_index_cache()
    return {
        "ok": True,
        "source_path": _normalize_folder_ref_for_source(source["id"], source_relative),
        "target_path": _normalize_folder_ref_for_source(target_source["id"], target_relative),
        "subfolders": collect_subfolders(_ensure_output_dir(), force_refresh=True),
        "categories": categories,
    }


def move_images(relative_paths: list[str], target_subfolder: str, target_source_id: str = "") -> dict[str, Any]:
    parsed_target_source_id, parsed_target_subfolder = parse_folder_ref(target_subfolder)
    target_source_id = _sanitize_source_id(target_source_id or parsed_target_source_id)
    target_subfolder = parsed_target_subfolder
    target_source, normalized_target, target_full_path = resolve_source_subfolder_path(
        target_source_id,
        target_subfolder,
        require_writable=True,
    )
    os.makedirs(target_full_path, exist_ok=True)

    moved: list[str] = []
    missing: list[str] = []
    blocked: list[str] = []
    path_mapping: dict[str, str] = {}

    for relative_path in relative_paths:
        source_id, source_relative_path = parse_image_ref(relative_path)
        source = get_gallery_source(source_id)
        if not source.get("writable"):
            blocked.append(make_image_ref(source_id, source_relative_path))
            continue
        normalized_source = make_image_ref(source_id, source_relative_path)
        _, source_full_path = resolve_image_path(normalized_source)
        if not os.path.exists(source_full_path):
            missing.append(normalized_source)
            continue

        destination_file = ensure_unique_path(target_full_path, os.path.basename(source_relative_path))
        shutil.move(source_full_path, destination_file)
        destination_source_relative = normalize_relative_path(os.path.relpath(destination_file, target_source["path"]))
        destination_relative = make_image_ref(target_source["id"], destination_source_relative)
        path_mapping[normalized_source] = destination_relative
        moved.append(destination_relative)

    categories = move_image_states(path_mapping)
    invalidate_image_index_cache()
    return {
        "ok": True,
        "moved": moved,
        "missing": missing,
        "blocked": blocked,
        "categories": categories,
        "subfolders": get_image_index(force_refresh=True)["subfolders"],
        "target_source_id": target_source["id"],
        "target_subfolder": normalized_target,
    }


def delete_images(relative_paths: list[str]) -> dict:
    deleted = []
    missing = []

    for relative_path in relative_paths:
        source_id, source_relative_path = parse_image_ref(relative_path)
        source = get_gallery_source(source_id)
        normalized = make_image_ref(source_id, source_relative_path)
        if not source.get("writable"):
            missing.append(normalized)
            continue
        _, full_path = resolve_image_path(normalized)
        if os.path.exists(full_path):
            image_state = get_image_state(normalized)
            move_path_to_trash(
                full_path=full_path,
                kind="image",
                original_path=normalized,
                state_snapshot={normalized: image_state},
            )
            deleted.append(normalized)
        else:
            missing.append(normalized)

    categories = remove_image_states(deleted) if deleted else collect_categories()
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
