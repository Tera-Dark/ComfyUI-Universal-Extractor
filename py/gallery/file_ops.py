"""file ops domain. Dependencies are injected by the host."""
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
from .catalog import source_namespace

def ensure_trash_storage_dir(env) -> str:
    env.ensure_trash_dir()
    storage_dir = os.path.join(env.TRASH_DIR, "storage")
    os.makedirs(storage_dir, exist_ok=True)
    return storage_dir


def send_to_system_recycle_bin(env, path: str):
    normalized_path = os.path.abspath(path)
    if not os.path.exists(normalized_path):
        return

    from send2trash import send2trash

    send2trash(normalized_path)


def add_trash_item(env,
    *,
    kind: str,
    name: str,
    original_path: str,
    storage_path: str,
    state_snapshot: dict[str, dict] | None = None,
    image_count: int | None = None,
    trash_id: str | None = None,
    asset_id: str | None = None,
) -> dict[str, Any]:
    trash_state = env.load_trash_state()
    item = {
        "id": trash_id or uuid.uuid4().hex,
        "asset_id": asset_id,
        "kind": kind,
        "name": name,
        "original_path": original_path,
        "storage_path": storage_path,
        "deleted_at": int(time.time()),
        "state_snapshot": state_snapshot or {},
        "image_count": image_count or 0,
    }
    trash_state.setdefault("items", []).insert(0, item)
    env.save_trash_state(trash_state)
    return item


def list_trash_items(env) -> list[dict[str, Any]]:
    trash_state = env.load_trash_state()
    output_dir = env.get_output_dir()
    items = []
    for item in trash_state.get("items", []):
        storage_path = item.get("storage_path", "")
        full_storage_path = os.path.join(env.TRASH_DIR, storage_path) if storage_path else ""
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


def get_trash_item(env, item_id: str) -> dict[str, Any] | None:
    trash_state = env.load_trash_state()
    return next((item for item in trash_state.get("items", []) if item.get("id") == item_id), None)


def remove_trash_item(env, item_id: str):
    trash_state = env.load_trash_state()
    trash_state["items"] = [item for item in trash_state.get("items", []) if item.get("id") != item_id]
    env.save_trash_state(trash_state)


def resolve_trash_storage_path(env, item: dict[str, Any]) -> str:
    trash_root = os.path.realpath(os.path.abspath(env.TRASH_DIR))
    storage_path = os.path.realpath(os.path.abspath(os.path.join(env.TRASH_DIR, str(item.get("storage_path", "")))))
    try:
        if os.path.commonpath([trash_root, storage_path]) != trash_root:
            raise ValueError("trash path must stay within trash directory")
    except ValueError as error:
        raise ValueError("invalid trash storage path") from error
    return storage_path


def move_path_to_trash(env, *, full_path: str, kind: str, original_path: str, state_snapshot: dict[str, dict] | None = None, image_count: int | None = None):
    if not os.path.exists(full_path):
        raise FileNotFoundError("path not found")

    if kind in {"image", "folder"}:
        entry = {"full_path": full_path, "kind": kind, "original_path": original_path, "state_snapshot": state_snapshot or {}}
        env._trash_batch([entry])
        return env.get_trash_item(entry["trash_id"])

    storage_dir = env.ensure_trash_storage_dir()
    extension = os.path.splitext(full_path)[1] if os.path.isfile(full_path) else ""
    storage_name = f"{uuid.uuid4().hex}{extension}"
    target_path = os.path.join(storage_dir, storage_name)
    shutil.move(full_path, target_path)

    try:
        return env.add_trash_item(
            kind=kind,
            name=os.path.basename(original_path.rstrip("/")) or os.path.basename(full_path),
            original_path=original_path,
            storage_path=os.path.relpath(target_path, env.TRASH_DIR),
            state_snapshot=state_snapshot,
            image_count=image_count,
        )
    except Exception:
        if not os.path.lexists(full_path) and os.path.exists(target_path):
            shutil.move(target_path, full_path)
        raise


def restore_trash_item(env, item_id: str) -> dict[str, Any]:
    item = env.get_trash_item(item_id)
    if not item:
        raise FileNotFoundError("trash item not found")

    kind = item.get("kind")
    storage_path = env.resolve_trash_storage_path(item)
    if not os.path.exists(storage_path):
        raise FileNotFoundError("trash storage not found")

    if kind in {"image", "folder"}:
        original_path = env.normalize_relative_path(item.get("original_path", ""))
        source_id, source_relative = env.parse_image_ref(original_path)
        source = env.get_gallery_source(source_id)
        if not source.get("writable"):
            raise ValueError("restore source is read-only")
        output_dir = source["path"]
        target_path = env._ensure_within_directory(output_dir, os.path.join(output_dir, source_relative))
        if os.path.lexists(target_path):
            raise FileExistsError("restore target already exists; rename it before restoring")
        parent_dir = os.path.dirname(target_path)
        if parent_dir:
            os.makedirs(parent_dir, exist_ok=True)
        with env.FILE_OPERATION_LOCK, env._state_store.GALLERY_STATE_LOCK:
            state_before, trash_before = env._state_store.load_gallery_state(), env.load_trash_state()
            catalog = env.get_runtime().require_catalog()
            before = catalog.trash_assets(item_id)
            after = [{**row, "availability": "online", "trash_id": ""} for row in before]
            def commit_restore():
                if item.get("state_snapshot"):
                    env.restore_image_states(item["state_snapshot"])
                env.remove_trash_item(item_id)
                catalog.apply(after)
            def rollback_restore():
                env._state_store.save_gallery_state(state_before)
                env.save_trash_state(trash_before)
                catalog.apply(before)
            try:
                env.execute_moves([(storage_path, target_path)], os.path.join(env.DATA_DIR, "operation_journal"),
                              commit_restore, rollback_restore, {"gallery": state_before, "trash": trash_before, "catalog_before": before, "catalog_after": after})
            finally:
                env.invalidate_image_index_cache()
        env.ensure_image_index_db_current(force_refresh=True)
        return {"ok": True, "id": item_id, "subfolders": env.collect_subfolders(output_dir), "categories": env.collect_categories()}

    if kind == "library":
        env.ensure_data_dir()
        original_name = env.normalize_library_filename(item.get("original_path", ""))
        target_path = os.path.join(env.DATA_DIR, original_name)
        if os.path.lexists(target_path):
            raise FileExistsError("restore target already exists")
        shutil.move(storage_path, target_path)
        env.invalidate_library_cache(original_name)
        env.remove_trash_item(item_id)
        return {"ok": True, "id": item_id}

    raise ValueError("unsupported trash item kind")


def purge_trash_item(env, item_id: str) -> dict[str, Any]:
    catalog = env.get_runtime().require_catalog()
    with env.FILE_OPERATION_LOCK:
        item = env.get_trash_item(item_id)
        if not item:
            raise FileNotFoundError("trash item not found")
        storage_path = env.resolve_trash_storage_path(item)
        journal_dir = os.path.join(env.DATA_DIR, "operation_journal")
        # Refuse all new operations if an earlier file transaction needs recovery.
        env.execute_moves([], journal_dir, lambda: None, lambda: None, {})
        journal = os.path.join(journal_dir, f"purge-{uuid.uuid4().hex}.json")
        evidence = {"version": 1, "kind": "purge", "status": "pending", "trash": item,
                    "catalog_before": catalog.trash_assets(item_id)}
        env.save_json(journal, evidence)
        removed = False
        try:
            if os.path.exists(storage_path):
                env.send_to_system_recycle_bin(storage_path)
            removed = True
            catalog.purge(item_id)
            env.remove_trash_item(item_id)
            evidence["status"] = "committed"
            env.save_json(journal, evidence)
            os.remove(journal)
        except BaseException:
            if not removed and os.path.exists(storage_path):
                os.remove(journal)
            else:
                evidence["status"] = "needs_recovery"
                env.save_json(journal, evidence)
            raise
        return {"ok": True, "id": item_id}


def get_import_target_for_filename(env,
    filename: str,
    target_source_id: str = "",
    target_subfolder: str = 'universal_gallery_imports',
) -> tuple[str | None, str | None, dict[str, str] | None]:
    env.get_runtime().require_file_operations_ready()
    env.ensure_data_dir()

    original_name = os.path.basename(filename)
    extension = os.path.splitext(original_name)[1].lower()

    if extension in env.SUPPORTED_IMAGE_EXTENSIONS:
        sources = env.list_gallery_sources()
        target_source = None
        if target_source_id:
            normalized_target_source_id = env._sanitize_source_id(target_source_id)
            target_source = next((source for source in sources if source["id"] == normalized_target_source_id), None)
        if target_source is None:
            target_source = next(
                (source for source in sources if source.get("enabled") and source.get("writable") and source.get("import_target")),
                None,
            )
        if target_source is None:
            target_source = next((source for source in sources if source["id"] == env.DEFAULT_OUTPUT_SOURCE_ID), None)
        if target_source is None or not target_source.get("path"):
            raise FileNotFoundError("import target not found")
        if not target_source.get("enabled"):
            raise ValueError("import target source is disabled")
        if not target_source.get("writable"):
            raise ValueError("import target source is read-only")
        normalized_target_subfolder = env.normalize_relative_path(target_subfolder or env.IMPORT_IMAGE_SUBFOLDER)
        image_import_dir = os.path.join(target_source["path"], normalized_target_subfolder)
        image_import_dir = env._ensure_within_directory(target_source["path"], image_import_dir, target_source["name"])
        os.makedirs(image_import_dir, exist_ok=True)
        target = env.ensure_unique_path(image_import_dir, original_name)
        catalog = env.get_runtime().require_catalog()
        stem, extension = os.path.splitext(original_name)
        number = 1
        while catalog.find(target_source, env.normalize_relative_path(os.path.relpath(target, target_source["path"]))):
            target = env.ensure_unique_path(image_import_dir, f"{stem}_{number}{extension}")
            number += 1
        return "image", target, None
    if extension in env.SUPPORTED_LIBRARY_EXTENSIONS:
        if original_name.lower() in env.RUNTIME_STATE_FILENAMES:
            raise ValueError("runtime state cannot be imported as a prompt library")
        return "library", env.ensure_unique_path(env.DATA_DIR, original_name), None

    return None, None, {"filename": original_name, "reason": "unsupported file type"}


def build_import_result(env, imported_images: list[dict], imported_libraries: list[dict], skipped: list[dict]) -> dict:
    for image in imported_images:
        image["asset_id"] = env.get_asset_identity(image["relative_path"])["asset_id"]
    env.invalidate_image_index_cache()
    return {
        "ok": True,
        "imported_images": imported_images,
        "imported_libraries": imported_libraries,
        "skipped": skipped,
    }


def import_files_from_parts(env, parts) -> dict:
    # Kept for compatibility with older callers; aiohttp routes stream parts directly.
    imported_images = []
    imported_libraries = []
    skipped = []

    for part in parts:
        kind, target_path, skipped_item = env.get_import_target_for_filename(part.filename)
        if skipped_item:
            skipped.append(skipped_item)
            continue

        yield ("write", part, target_path)

        if kind == "image":
            imported_images.append(
                {
                    "filename": os.path.basename(target_path),
                    "relative_path": env.image_ref_for_full_path(target_path),
                }
            )
        else:
            imported_libraries.append({"filename": os.path.basename(target_path)})

    yield ("result", env.build_import_result(imported_images, imported_libraries, skipped))


def persist_image_state(env, relative_path: str, updates: dict) -> dict:
    state, categories = env.update_image_state(env.normalize_relative_path(relative_path), updates)
    return {"ok": True, "state": state, "categories": categories}


def _asset_rows_for_path(env, ref, full_path):
    catalog = env.get_runtime().require_catalog()
    source_id, relative = env.parse_image_ref(ref)
    source = env.get_gallery_source(source_id)
    candidates = []
    if os.path.isdir(full_path):
        for root, dirs, files in os.walk(full_path, followlinks=False):
            dirs[:] = [name for name in dirs if not os.path.islink(os.path.join(root, name))]
            candidates.extend(os.path.join(root, name) for name in files)
    else:
        candidates.append(full_path)
    rows = []
    for path in candidates:
        if not path.lower().endswith(env.SUPPORTED_IMAGE_EXTENSIONS) or os.path.islink(path):
            continue
        relative = env.normalize_relative_path(os.path.relpath(path, source["path"]))
        env.resolve_image_path(env.make_image_ref(source_id, relative))
        stat = os.stat(path)
        identity = catalog.observe_many(source, [(relative, stat.st_size, stat.st_mtime_ns)])[0]
        rows.append(catalog.get(identity["asset_id"]))
    return rows


def _execute_image_moves(env, path_mapping: dict[str, str], full_moves: list[tuple[str, str]]):
    catalog = env.get_runtime().require_catalog()
    with env.FILE_OPERATION_LOCK, env._state_store.GALLERY_STATE_LOCK:
        snapshot = env._state_store.load_gallery_state()
        before, after = [], []
        for old_ref, new_ref in path_mapping.items():
            if not old_ref.lower().endswith(env.SUPPORTED_IMAGE_EXTENSIONS):
                continue
            _, full_path = env.resolve_image_path(old_ref)
            rows = _asset_rows_for_path(env, old_ref, full_path)
            target_id, target_relative = env.parse_image_ref(new_ref)
            target_source = env.get_gallery_source(target_id)
            for row in rows:
                before.append(row)
                after.append({**row, "source_id": target_id, "namespace": source_namespace(target_source["path"]),
                              "relative_path": target_relative, "location_key": os.path.normcase(target_relative), "availability": "online"})
        def commit():
            categories = env.move_image_states(path_mapping)
            catalog.apply(after)
            return categories
        def rollback():
            env._state_store.save_gallery_state(snapshot)
            catalog.apply(before)
        try:
            return env.execute_moves(full_moves, os.path.join(env.DATA_DIR, "operation_journal"), commit, rollback,
                                     {"gallery": snapshot, "catalog_before": before, "catalog_after": after})
        finally:
            env.invalidate_image_index_cache()


def rename_image(env, relative_path: str, new_filename: str) -> dict:
    source_id, source_relative_path = env.parse_image_ref(relative_path)
    normalized = env.make_image_ref(source_id, source_relative_path)
    source = env.get_gallery_source(source_id)
    if not source.get("writable"):
        raise ValueError("gallery source is read-only")
    output_dir, full_path = env.resolve_image_path(normalized)
    if not os.path.exists(full_path):
        raise FileNotFoundError("image not found")

    clean_name = os.path.basename(new_filename).strip()
    if not clean_name:
        raise ValueError("new filename required")

    original_ext = os.path.splitext(source_relative_path)[1]
    if not os.path.splitext(clean_name)[1]:
        clean_name = f"{clean_name}{original_ext}"
    if not clean_name.lower().endswith(env.SUPPORTED_IMAGE_EXTENSIONS):
        raise ValueError("unsupported image extension")

    target_source_relative = env.normalize_relative_path(os.path.join(os.path.dirname(source_relative_path), clean_name))
    target_relative = env.make_image_ref(source_id, target_source_relative)
    target_full_path = env._ensure_within_directory(output_dir, os.path.join(output_dir, target_source_relative), source["name"])
    if os.path.exists(target_full_path):
        raise FileExistsError("target filename already exists")

    categories = env._execute_image_moves({normalized: target_relative}, [(full_path, target_full_path)])
    state = env.get_image_state(target_relative)
    url, subfolder = env.build_view_url(target_relative)
    stat = os.stat(target_full_path)

    return {
        "ok": True,
        "image": {
            "asset_id": env.get_asset_identity(target_relative)["asset_id"],
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
            "thumb_url": env.build_thumb_url(target_relative),
            "size": stat.st_size,
            "created_at": int(stat.st_ctime),
            **state,
        },
        "categories": categories,
    }


def batch_rename_images(env,
    relative_paths: list[str],
    template: str,
    start_number: int = 1,
    padding: int = 2,
    current_page: int = 1,
) -> dict[str, Any]:
    if not relative_paths:
        raise ValueError("relative_paths required")

    if len(set(relative_paths)) != len(relative_paths):
        raise ValueError("duplicate image paths")
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
        current_source_id, source_relative_path = env.parse_image_ref(normalized)
        if source_id and current_source_id != source_id:
            raise ValueError("batch rename only supports one source at a time")
        source_id = current_source_id
        source_meta = env.get_gallery_source(source_id)
        if not source_meta.get("writable"):
            raise ValueError("gallery source is read-only")
        normalized_source = env.make_image_ref(source_id, source_relative_path)
        selected_set.add(normalized_source)
        _, full_path = env.resolve_image_path(normalized_source)
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
        target_source_relative = env.normalize_relative_path(os.path.join(os.path.dirname(source_relative_path), next_filename))
        target_relative = env.make_image_ref(source_id, target_source_relative)

        if target_relative in seen_targets:
            raise FileExistsError(f"duplicate target filename: {next_filename}")
        seen_targets.add(target_relative)

        target_full_path = env._ensure_within_directory(source_root, os.path.join(source_root, target_source_relative), source_meta["name"])
        if os.path.exists(target_full_path) and target_relative not in selected_set:
            raise FileExistsError(f"target filename already exists: {next_filename}")

        target_mapping[source_relative] = target_relative

    full_moves = [
        (os.path.join(source_root, env.parse_image_ref(old)[1]),
         os.path.join(source_root, env.parse_image_ref(new)[1]))
        for old, new in target_mapping.items()
    ]
    categories = env._execute_image_moves(target_mapping, full_moves)
    return {
        "ok": True,
        "renamed": list(target_mapping.values()),
        "categories": categories,
    }


def create_folder(env, subfolder: str) -> dict[str, Any]:
    env.get_runtime().require_file_operations_ready()
    source, normalized_subfolder, full_path = env._resolve_folder_ref_path(subfolder, require_writable=True)
    if not normalized_subfolder:
        raise ValueError("folder path required")
    os.makedirs(full_path, exist_ok=True)
    env.invalidate_image_index_cache()
    return {
        "ok": True,
        "path": env._normalize_folder_ref_for_source(source["id"], normalized_subfolder),
        "subfolders": env.collect_subfolders(env._ensure_output_dir(), force_refresh=True),
    }


def delete_folder(env, subfolder: str) -> dict[str, Any]:
    source, normalized_subfolder, full_path = env._resolve_folder_ref_path(subfolder, require_writable=True)
    if not normalized_subfolder:
        raise ValueError("cannot delete root gallery source directory")
    if not os.path.exists(full_path):
        raise FileNotFoundError("folder not found")

    normalized_folder_ref = env._normalize_folder_ref_for_source(source["id"], normalized_subfolder)
    prefix = env._image_state_folder_prefix(source["id"], normalized_subfolder)
    state_snapshot = {key: value for key, value in env.get_image_state_map().items()
                      if key == prefix or key.startswith(prefix + "/")}
    categories = env._trash_batch([{"full_path": full_path, "kind": "folder",
                               "original_path": normalized_folder_ref, "state_snapshot": state_snapshot}])
    env.invalidate_image_index_cache()
    return {
        "ok": True,
        "path": normalized_folder_ref,
        "subfolders": env.collect_subfolders(env._ensure_output_dir(), force_refresh=True),
        "categories": categories,
    }


def merge_folder(env, source_subfolder: str, target_subfolder: str) -> dict[str, Any]:
    source, source_relative, source_full_path = env._resolve_folder_ref_path(source_subfolder, require_writable=True)
    target_source_id, target_relative_from_ref = env.parse_folder_ref(env._coerce_target_folder_ref(target_subfolder, source["id"]))
    if target_source_id != source["id"]:
        raise ValueError("source and target folders must stay in the same gallery source")
    target_source, target_relative, target_full_path = env.resolve_source_subfolder_path(
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
    if target_relative.startswith(source_relative + "/"):
        raise ValueError("target folder cannot be inside source folder")
    os.makedirs(target_full_path, exist_ok=True)

    path_mapping: dict[str, str] = {}
    full_moves = []
    # Materialize and validate before creating descendants or moving any files.
    tree = list(os.walk(source_full_path))
    for root, dirs, files in tree:
        if any(os.path.islink(os.path.join(root, name)) for name in dirs + files):
            raise ValueError("folder merge does not follow symbolic links")
    for root, dirs, files in tree:
        relative_root = os.path.relpath(root, source_full_path)
        relative_root = "" if relative_root == "." else env.normalize_relative_path(relative_root)
        destination_root = os.path.join(target_full_path, relative_root) if relative_root else target_full_path
        os.makedirs(destination_root, exist_ok=True)

        for directory in dirs:
            os.makedirs(os.path.join(destination_root, directory), exist_ok=True)

        for filename in files:
            source_file = os.path.join(root, filename)
            destination_file = env.ensure_unique_path(destination_root, filename)
            full_moves.append((source_file, destination_file))

            source_rel_path = env.normalize_relative_path(os.path.relpath(source_file, source["path"]))
            destination_rel_path = env.normalize_relative_path(os.path.relpath(destination_file, target_source["path"]))
            path_mapping[env.make_image_ref(source["id"], source_rel_path)] = env.make_image_ref(target_source["id"], destination_rel_path)

    categories = env._execute_image_moves(path_mapping, full_moves)
    # Remove only empty directories. Never delete files created by another app.
    for root, _dirs, _files in reversed(tree):
        try:
            os.rmdir(root)
        except OSError:
            pass
    return {
        "ok": True,
        "source_path": env._normalize_folder_ref_for_source(source["id"], source_relative),
        "target_path": env._normalize_folder_ref_for_source(target_source["id"], target_relative),
        "moved": len(path_mapping),
        "subfolders": env.collect_subfolders(env._ensure_output_dir(), force_refresh=True),
        "categories": categories,
    }


def rename_folder(env, source_subfolder: str, target_subfolder: str) -> dict[str, Any]:
    source, source_relative, source_full_path = env._resolve_folder_ref_path(source_subfolder, require_writable=True)
    target_source_id, target_relative_from_ref = env.parse_folder_ref(env._coerce_target_folder_ref(target_subfolder, source["id"]))
    if target_source_id != source["id"]:
        raise ValueError("source and target folders must stay in the same gallery source")
    target_source, target_relative, target_full_path = env.resolve_source_subfolder_path(
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
            source_rel_path = env.normalize_relative_path(os.path.relpath(source_file, source["path"]))
            relative_to_source = env.normalize_relative_path(os.path.relpath(source_file, source_full_path))
            destination_rel_path = env.normalize_relative_path(os.path.join(target_relative, relative_to_source))
            path_mapping[env.make_image_ref(source["id"], source_rel_path)] = env.make_image_ref(target_source["id"], destination_rel_path)

    categories = env._execute_image_moves(path_mapping, [(source_full_path, target_full_path)])
    return {
        "ok": True,
        "source_path": env._normalize_folder_ref_for_source(source["id"], source_relative),
        "target_path": env._normalize_folder_ref_for_source(target_source["id"], target_relative),
        "subfolders": env.collect_subfolders(env._ensure_output_dir(), force_refresh=True),
        "categories": categories,
    }


def move_images(env, relative_paths: list[str], target_subfolder: str, target_source_id: str = "") -> dict[str, Any]:
    parsed_target_source_id, parsed_target_subfolder = env.parse_folder_ref(target_subfolder)
    target_source_id = env._sanitize_source_id(target_source_id or parsed_target_source_id)
    target_subfolder = parsed_target_subfolder
    target_source, normalized_target, target_full_path = env.resolve_source_subfolder_path(
        target_source_id,
        target_subfolder,
        require_writable=True,
    )
    os.makedirs(target_full_path, exist_ok=True)

    moved: list[str] = []
    missing: list[str] = []
    blocked: list[str] = []
    unchanged: list[str] = []
    path_mapping: dict[str, str] = {}
    full_moves: list[tuple[str, str]] = []
    reserved: set[str] = set()

    for relative_path in dict.fromkeys(relative_paths):
        source_id, source_relative_path = env.parse_image_ref(relative_path)
        source = env.get_gallery_source(source_id)
        if not source.get("writable"):
            blocked.append(env.make_image_ref(source_id, source_relative_path))
            continue
        normalized_source = env.make_image_ref(source_id, source_relative_path)
        _, source_full_path = env.resolve_image_path(normalized_source)
        if not os.path.exists(source_full_path):
            missing.append(normalized_source)
            continue

        destination_file = env.ensure_unique_path(target_full_path, os.path.basename(source_relative_path))
        if os.path.dirname(source_full_path) == os.path.abspath(target_full_path):
            unchanged.append(normalized_source)
            continue  # Moving into the same folder is a no-op, not a rename.
        stem, ext = os.path.splitext(os.path.basename(source_relative_path))
        counter = 1
        while os.path.normcase(destination_file) in reserved or os.path.exists(destination_file):
            destination_file = os.path.join(target_full_path, f"{stem}_{counter}{ext}")
            counter += 1
        reserved.add(os.path.normcase(destination_file))
        full_moves.append((source_full_path, destination_file))
        destination_source_relative = env.normalize_relative_path(os.path.relpath(destination_file, target_source["path"]))
        destination_relative = env.make_image_ref(target_source["id"], destination_source_relative)
        path_mapping[normalized_source] = destination_relative
        moved.append(destination_relative)

    categories = env._execute_image_moves(path_mapping, full_moves)
    return {
        "ok": True,
        "moved": moved,
        "moved_sources": list(path_mapping),
        "missing": missing,
        "blocked": blocked,
        "unchanged": unchanged,
        "categories": categories,
        "subfolders": env.get_image_index(force_refresh=True)["subfolders"],
        "target_source_id": target_source["id"],
        "target_subfolder": normalized_target,
    }


def _trash_batch(env, entries):
    catalog = env.get_runtime().require_catalog()
    with env.FILE_OPERATION_LOCK, env._state_store.GALLERY_STATE_LOCK:
        state_before, trash_before = env._state_store.load_gallery_state(), env.load_trash_state()
        storage = env.ensure_trash_storage_dir()
        moves, before, after = [], [], []
        for entry in entries:
            entry["trash_id"] = uuid.uuid4().hex
            extension = os.path.splitext(entry["full_path"])[1] if entry["kind"] == "image" else ""
            entry["storage_full"] = os.path.join(storage, uuid.uuid4().hex + extension)
            moves.append((entry["full_path"], entry["storage_full"]))
            rows = _asset_rows_for_path(env, entry["original_path"], entry["full_path"])
            entry["asset_id"] = rows[0]["asset_id"] if len(rows) == 1 and entry["kind"] == "image" else None
            before.extend(rows)
            after.extend({**row, "availability": "trashed", "trash_id": entry["trash_id"]} for row in rows)
        def commit():
            removed = []
            for entry in entries:
                env.add_trash_item(kind=entry["kind"], name=os.path.basename(entry["full_path"]), original_path=entry["original_path"],
                    storage_path=os.path.relpath(entry["storage_full"], env.TRASH_DIR), state_snapshot=entry["state_snapshot"],
                    image_count=len(entry["state_snapshot"]), trash_id=entry["trash_id"], asset_id=entry["asset_id"])
                removed.extend(entry["state_snapshot"])
            categories = env.remove_image_states(removed) if removed else env.collect_categories()
            catalog.apply(after)
            return categories
        def rollback():
            env._state_store.save_gallery_state(state_before)
            env.save_trash_state(trash_before)
            catalog.apply(before)
        try:
            return env.execute_moves(moves, os.path.join(env.DATA_DIR, "operation_journal"), commit, rollback,
                {"gallery": state_before, "trash": trash_before, "catalog_before": before, "catalog_after": after})
        finally:
            env.invalidate_image_index_cache()


def delete_images(env, relative_paths: list[str]) -> dict:
    entries, deleted, missing = [], [], []
    for relative_path in dict.fromkeys(relative_paths):
        source_id, source_relative = env.parse_image_ref(relative_path)
        source = env.get_gallery_source(source_id)
        normalized = env.make_image_ref(source_id, source_relative)
        if not source.get("writable"):
            missing.append(normalized)
            continue
        _, full_path = env.resolve_image_path(normalized)
        if not os.path.exists(full_path):
            missing.append(normalized)
            continue
        entries.append({"full_path": full_path, "kind": "image", "original_path": normalized,
                        "state_snapshot": {normalized: env.get_image_state(normalized)}})
        deleted.append(normalized)
    categories = env._trash_batch(entries) if entries else env.collect_categories()
    return {"ok": True, "deleted": deleted, "missing": missing, "categories": categories}


def batch_update_images(env, relative_paths: list[str], updates: dict) -> dict:
    touched, missing, failed = [], [], []
    for relative_path in dict.fromkeys(relative_paths):
        try:
            source_id, source_relative = env.parse_image_ref(relative_path)
            normalized = env.make_image_ref(source_id, source_relative)
            _, full_path = env.resolve_image_path(normalized)
            if not os.path.exists(full_path):
                missing.append(normalized)
                continue
            touched.append(normalized)
        except (ValueError, FileNotFoundError) as error:
            failed.append({"path": relative_path, "error": str(error)})
    last_state, categories = env._state_store.update_image_states(touched, updates)
    states = env.get_image_state_map()
    return {"ok": True, "updated": touched, "states": {path: states[path] for path in touched if path in states}, "missing": missing, "failed": failed,
            "last_state": last_state, "categories": categories}
