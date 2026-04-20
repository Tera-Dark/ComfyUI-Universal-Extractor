from __future__ import annotations

import os
from pathlib import Path

from aiohttp import web

from ..constants import GALLERY_INDEX_FILE, GALLERY_UI_DIR, TRASH_DIR
from .service import (
    LibraryValidationError,
    batch_update_images,
    batch_rename_images,
    create_folder,
    delete_images,
    delete_folder,
    delete_library,
    get_gallery_context,
    get_image_metadata,
    get_library,
    get_library_entries_page,
    get_library_raw_text,
    get_thumbnail_path,
    get_trash_item,
    import_library_data,
    import_files_from_parts,
    list_images,
    list_libraries,
    list_trash_items,
    merge_folder,
    move_images,
    persist_image_state,
    purge_trash_item,
    restore_trash_item,
    search_library_artists,
    generate_artist_string,
    rename_image,
    resolve_image_path,
    save_library,
    create_library_entry,
    update_library_entry,
    delete_library_entry,
)


def _safe_add_route(router, method: str, path: str, handler):
    try:
        getattr(router, f"add_{method.lower()}")(path, handler)
    except Exception as error:
        print(f"[Universal Extractor] Skipping duplicate/conflicting route {method.upper()} {path}: {error}")


def _safe_add_static(router, prefix: str, path: str):
    try:
        router.add_static(prefix, path, show_index=False)
    except Exception as error:
        print(f"[Universal Extractor] Skipping duplicate/conflicting static route {prefix} -> {path}: {error}")


async def serve_gallery_index(_request: web.Request) -> web.StreamResponse:
    if not os.path.exists(GALLERY_INDEX_FILE):
        raise web.HTTPNotFound(text="Universal Gallery UI build not found. Run 'npm run build' in gallery_ui/.")
    return web.FileResponse(GALLERY_INDEX_FILE)


async def redirect_gallery_root(_request: web.Request) -> web.StreamResponse:
    raise web.HTTPFound("/gallery/")


async def api_gallery_context(request: web.Request) -> web.Response:
    force_refresh = request.query.get("force_refresh", "").lower() in {"1", "true", "yes"}
    return web.json_response(get_gallery_context(force_refresh=force_refresh))


async def api_list_images(request: web.Request) -> web.Response:
    search = request.query.get("search", "")
    category = request.query.get("category", "")
    subfolder = request.query.get("subfolder", "")
    favorites_only = request.query.get("favorites", "").lower() in {"1", "true", "yes"}
    force_refresh = request.query.get("force_refresh", "").lower() in {"1", "true", "yes"}
    sort_by = request.query.get("sort_by", "created_at")
    sort_order = request.query.get("sort_order", "desc")
    page = max(1, int(request.query.get("page", "1")))
    limit = max(1, int(request.query.get("limit", "60")))

    items = list_images(
        search=search,
        category=category,
        subfolder=subfolder,
        favorites_only=favorites_only,
        sort_by=sort_by,
        sort_order=sort_order,
        force_refresh=force_refresh,
    )
    total = len(items)
    start = (page - 1) * limit
    paged_items = items[start : start + limit]
    return web.json_response({"images": paged_items, "total": total, "page": page, "limit": limit})


async def api_image_metadata(request: web.Request) -> web.Response:
    relative_path = request.query.get("relative_path", "")
    if not relative_path:
        return web.json_response({"error": "relative_path required"}, status=400)

    _, full_path = resolve_image_path(relative_path)
    if not os.path.exists(full_path):
        return web.json_response({"error": "not found"}, status=404)

    return web.json_response(get_image_metadata(relative_path))


async def api_thumbnail(request: web.Request) -> web.StreamResponse:
    relative_path = request.query.get("relative_path", "")
    size = max(64, min(1024, int(request.query.get("size", "480"))))
    if not relative_path:
        return web.json_response({"error": "relative_path required"}, status=400)

    try:
        _, thumb_path = get_thumbnail_path(relative_path, size=size)
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)
    except (RuntimeError, ValueError) as error:
        return web.json_response({"error": str(error)}, status=400)

    return web.FileResponse(Path(thumb_path))


async def api_list_trash(_request: web.Request) -> web.Response:
    return web.json_response({"items": list_trash_items()})


async def api_trash_file(request: web.Request) -> web.StreamResponse:
    item_id = request.query.get("id", "")
    item = get_trash_item(item_id)
    if not item:
        return web.Response(status=404)

    storage_path = Path(os.path.join(TRASH_DIR, item.get("storage_path", "")))
    if not storage_path.exists():
        return web.Response(status=404)

    if request.query.get("thumb", "").lower() in {"1", "true", "yes"}:
        return web.FileResponse(storage_path)

    return web.FileResponse(storage_path)


async def api_restore_trash_item(request: web.Request) -> web.Response:
    body = await request.json()
    item_id = str(body.get("id", "")).strip()
    if not item_id:
        return web.json_response({"error": "id required"}, status=400)
    try:
        return web.json_response(restore_trash_item(item_id))
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)


async def api_purge_trash_item(request: web.Request) -> web.Response:
    body = await request.json()
    item_id = str(body.get("id", "")).strip()
    if not item_id:
        return web.json_response({"error": "id required"}, status=400)
    try:
        return web.json_response(purge_trash_item(item_id))
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)


async def api_update_image_state(request: web.Request) -> web.Response:
    body = await request.json()
    relative_path = str(body.get("relative_path", "")).strip()
    updates = body.get("updates", {})
    if not relative_path or not isinstance(updates, dict):
        return web.json_response({"error": "relative_path and updates required"}, status=400)

    _, full_path = resolve_image_path(relative_path)
    if not os.path.exists(full_path):
        return web.json_response({"error": "image not found"}, status=404)

    return web.json_response(persist_image_state(relative_path, updates))


async def api_import_files(request: web.Request) -> web.Response:
    reader = await request.multipart()
    parts = []
    while True:
        part = await reader.next()
        if part is None:
            break
        if getattr(part, "filename", None):
            parts.append(part)

    result = None
    for item in import_files_from_parts(parts):
        if item[0] == "write":
            _, part, target_path = item
            with open(target_path, "wb") as file:
                while True:
                    chunk = await part.read_chunk()
                    if not chunk:
                        break
                    file.write(chunk)
        else:
            _, result = item

    return web.json_response(result or {"ok": True, "imported_images": [], "imported_libraries": [], "skipped": []})


async def api_delete_images(request: web.Request) -> web.Response:
    body = await request.json()
    relative_paths = body.get("relative_paths", [])
    if not isinstance(relative_paths, list) or not relative_paths:
        return web.json_response({"error": "relative_paths required"}, status=400)
    return web.json_response(delete_images(relative_paths))


async def api_batch_update_images(request: web.Request) -> web.Response:
    body = await request.json()
    relative_paths = body.get("relative_paths", [])
    updates = body.get("updates", {})
    if not isinstance(relative_paths, list) or not relative_paths or not isinstance(updates, dict):
        return web.json_response({"error": "relative_paths and updates required"}, status=400)
    return web.json_response(batch_update_images(relative_paths, updates))


async def api_move_images(request: web.Request) -> web.Response:
    body = await request.json()
    relative_paths = body.get("relative_paths", [])
    target_subfolder = str(body.get("target_subfolder", "")).strip()
    if not isinstance(relative_paths, list) or not relative_paths:
        return web.json_response({"error": "relative_paths required"}, status=400)

    try:
        return web.json_response(move_images(relative_paths, target_subfolder))
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)


async def api_rename_image(request: web.Request) -> web.Response:
    body = await request.json()
    relative_path = str(body.get("relative_path", "")).strip()
    new_filename = str(body.get("new_filename", "")).strip()
    if not relative_path or not new_filename:
        return web.json_response({"error": "relative_path and new_filename required"}, status=400)

    try:
        return web.json_response(rename_image(relative_path, new_filename))
    except FileNotFoundError:
        return web.json_response({"error": "image not found"}, status=404)
    except FileExistsError:
        return web.json_response({"error": "target filename already exists"}, status=409)
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)


async def api_batch_rename_images(request: web.Request) -> web.Response:
    body = await request.json()
    relative_paths = body.get("relative_paths", [])
    template = str(body.get("template", "")).strip()
    start_number = int(body.get("start_number", 1))
    padding = int(body.get("padding", 2))
    current_page = int(body.get("current_page", 1))

    if not isinstance(relative_paths, list) or not relative_paths or not template:
        return web.json_response({"error": "relative_paths and template required"}, status=400)

    try:
        return web.json_response(
            batch_rename_images(
                relative_paths=relative_paths,
                template=template,
                start_number=start_number,
                padding=padding,
                current_page=current_page,
            )
        )
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)
    except FileExistsError as error:
        return web.json_response({"error": str(error)}, status=409)
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)


async def api_list_libraries(_request: web.Request) -> web.Response:
    return web.json_response({"libraries": list_libraries()})


async def api_get_library(request: web.Request) -> web.Response:
    name = request.query.get("name", "")
    if not name:
        return web.json_response({"error": "name required"}, status=400)
    library = get_library(name)
    return web.json_response({"name": name, "data": library})


async def api_get_library_entries(request: web.Request) -> web.Response:
    name = request.query.get("name", "")
    if not name:
        return web.json_response({"error": "name required"}, status=400)

    search = request.query.get("search", "")
    page = max(1, int(request.query.get("page", "1")))
    limit = max(1, int(request.query.get("limit", "120")))
    return web.json_response(get_library_entries_page(name, search=search, page=page, limit=limit))


async def api_get_library_raw(request: web.Request) -> web.Response:
    name = request.query.get("name", "")
    if not name:
        return web.json_response({"error": "name required"}, status=400)

    try:
        return web.json_response({"name": name, "text": get_library_raw_text(name)})
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)


async def api_search_library_artists(request: web.Request) -> web.Response:
    name = request.query.get("name", "")
    if not name:
        return web.json_response({"error": "name required"}, status=400)

    query = request.query.get("query", "")
    filter_mode = request.query.get("filter_mode", "none")
    post_threshold = int(request.query.get("post_threshold", "0"))
    limit = max(1, int(request.query.get("limit", "12")))
    return web.json_response(
        search_library_artists(
            name=name,
            query=query,
            filter_mode=filter_mode,
            post_threshold=post_threshold,
            limit=limit,
        )
    )


async def api_generate_artist_string(request: web.Request) -> web.Response:
    body = await request.json()
    name = str(body.get("name", "")).strip()
    if not name:
        return web.json_response({"error": "name required"}, status=400)

    try:
        return web.json_response(
            generate_artist_string(
                name=name,
                query=str(body.get("query", "")),
                count=int(body.get("count", 3)),
                mode=str(body.get("mode", "standard")),
                preselected_names=body.get("preselected_names", []),
                filter_mode=str(body.get("filter_mode", "none")),
                post_threshold=int(body.get("post_threshold", 0)),
                creative_bracket_style=str(body.get("creative_bracket_style", "paren")),
                creative_nest_levels=int(body.get("creative_nest_levels", 0)),
                standard_weight_min=float(body.get("standard_weight_min", 0.5)),
                standard_weight_max=float(body.get("standard_weight_max", 1.5)),
                nai_weight_min=float(body.get("nai_weight_min", 0.5)),
                nai_weight_max=float(body.get("nai_weight_max", 1.5)),
                enable_custom_format=bool(body.get("enable_custom_format", False)),
                custom_format_string=str(body.get("custom_format_string", "{name}")),
            )
        )
    except (ValueError, TypeError) as error:
        return web.json_response({"error": str(error)}, status=400)


async def api_save_library(request: web.Request) -> web.Response:
    body = await request.json()
    name = body.get("name", "")
    data = body.get("data")
    if not name or data is None:
        return web.json_response({"error": "name and data required"}, status=400)
    try:
        filename = save_library(name, data)
    except LibraryValidationError as error:
        return web.json_response(
            {"error": "validation failed", "validation_errors": error.issues},
            status=400,
        )
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)
    return web.json_response({"ok": True, "name": filename, "count": len(data)})


async def api_import_library(request: web.Request) -> web.Response:
    reader = await request.multipart()
    uploaded_name = ""
    uploaded_bytes = b""
    mode = "create"
    target_name = ""
    new_name = ""

    while True:
        part = await reader.next()
        if part is None:
            break

        if getattr(part, "filename", None):
            uploaded_name = str(part.filename)
            uploaded_bytes = await part.read()
            continue

        field_value = (await part.text()).strip()
        if part.name == "mode":
            mode = field_value or "create"
        elif part.name == "target_name":
            target_name = field_value
        elif part.name == "new_name":
            new_name = field_value

    if not uploaded_name or not uploaded_bytes:
        return web.json_response({"error": "library file required"}, status=400)

    try:
        result = import_library_data(
            source_filename=uploaded_name,
            raw_payload=uploaded_bytes,
            mode=mode,
            target_name=target_name,
            new_name=new_name,
        )
    except LibraryValidationError as error:
        return web.json_response(
            {"error": "validation failed", "validation_errors": error.issues},
            status=400,
        )
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)

    return web.json_response(result)


async def api_upsert_library_entry(request: web.Request) -> web.Response:
    body = await request.json()
    name = str(body.get("name", "")).strip()
    entry = body.get("entry")
    if not name or not isinstance(entry, dict):
        return web.json_response({"error": "name and entry required"}, status=400)

    try:
        if "index" in body and body.get("index") is not None:
            result = update_library_entry(name, int(body.get("index")), entry)
        else:
            result = create_library_entry(name, entry)
    except LibraryValidationError as error:
        return web.json_response(
            {"error": "validation failed", "validation_errors": error.issues},
            status=400,
        )
    except (ValueError, IndexError) as error:
        return web.json_response({"error": str(error)}, status=400)

    return web.json_response(result)


async def api_delete_library_entry(request: web.Request) -> web.Response:
    body = await request.json()
    name = str(body.get("name", "")).strip()
    index = body.get("index")
    if not name or index is None:
        return web.json_response({"error": "name and index required"}, status=400)

    try:
        result = delete_library_entry(name, int(index))
    except (ValueError, IndexError) as error:
        return web.json_response({"error": str(error)}, status=400)

    return web.json_response(result)


async def api_create_folder(request: web.Request) -> web.Response:
    body = await request.json()
    path = str(body.get("path", "")).strip()
    try:
        return web.json_response(create_folder(path))
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)


async def api_delete_folder(request: web.Request) -> web.Response:
    body = await request.json()
    path = str(body.get("path", "")).strip()
    try:
        return web.json_response(delete_folder(path))
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)


async def api_merge_folder(request: web.Request) -> web.Response:
    body = await request.json()
    source_path = str(body.get("source_path", "")).strip()
    target_path = str(body.get("target_path", "")).strip()
    try:
        return web.json_response(merge_folder(source_path, target_path))
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)


async def api_delete_library(request: web.Request) -> web.Response:
    name = request.query.get("name", "")
    if not name:
        return web.json_response({"error": "name required"}, status=400)
    delete_library(name)
    return web.json_response({"ok": True})


def register_routes(app):
    _safe_add_route(app.router, "get", "/universal_gallery/api/context", api_gallery_context)
    _safe_add_route(app.router, "get", "/universal_gallery/api/images", api_list_images)
    _safe_add_route(app.router, "get", "/universal_gallery/api/metadata", api_image_metadata)
    _safe_add_route(app.router, "get", "/universal_gallery/api/thumb", api_thumbnail)
    _safe_add_route(app.router, "get", "/universal_gallery/api/trash", api_list_trash)
    _safe_add_route(app.router, "get", "/universal_gallery/api/trash/file", api_trash_file)
    _safe_add_route(app.router, "post", "/universal_gallery/api/image-state", api_update_image_state)
    _safe_add_route(app.router, "post", "/universal_gallery/api/trash/restore", api_restore_trash_item)
    _safe_add_route(app.router, "post", "/universal_gallery/api/trash/purge", api_purge_trash_item)
    _safe_add_route(app.router, "post", "/universal_gallery/api/import", api_import_files)
    _safe_add_route(app.router, "post", "/universal_gallery/api/images/delete", api_delete_images)
    _safe_add_route(app.router, "post", "/universal_gallery/api/images/batch-update", api_batch_update_images)
    _safe_add_route(app.router, "post", "/universal_gallery/api/images/move", api_move_images)
    _safe_add_route(app.router, "post", "/universal_gallery/api/images/rename", api_rename_image)
    _safe_add_route(app.router, "post", "/universal_gallery/api/images/batch-rename", api_batch_rename_images)
    _safe_add_route(app.router, "get", "/universal_gallery/api/libraries", api_list_libraries)
    _safe_add_route(app.router, "get", "/universal_gallery/api/library", api_get_library)
    _safe_add_route(app.router, "get", "/universal_gallery/api/library/entries", api_get_library_entries)
    _safe_add_route(app.router, "get", "/universal_gallery/api/library/raw", api_get_library_raw)
    _safe_add_route(app.router, "get", "/universal_gallery/api/library/artists", api_search_library_artists)
    _safe_add_route(app.router, "post", "/universal_gallery/api/library/generate-artists", api_generate_artist_string)
    _safe_add_route(app.router, "post", "/universal_gallery/api/library", api_save_library)
    _safe_add_route(app.router, "post", "/universal_gallery/api/library/import", api_import_library)
    _safe_add_route(app.router, "post", "/universal_gallery/api/library/entry", api_upsert_library_entry)
    _safe_add_route(app.router, "delete", "/universal_gallery/api/library/entry", api_delete_library_entry)
    _safe_add_route(app.router, "delete", "/universal_gallery/api/library", api_delete_library)
    _safe_add_route(app.router, "post", "/universal_gallery/api/folders/create", api_create_folder)
    _safe_add_route(app.router, "post", "/universal_gallery/api/folders/delete", api_delete_folder)
    _safe_add_route(app.router, "post", "/universal_gallery/api/folders/merge", api_merge_folder)

    if os.path.exists(GALLERY_UI_DIR):
        _safe_add_route(app.router, "get", "/gallery", redirect_gallery_root)
        _safe_add_route(app.router, "get", "/gallery/", serve_gallery_index)
        _safe_add_static(app.router, "/gallery", GALLERY_UI_DIR)
        print("[Universal Extractor] Gallery UI -> /gallery")
    else:
        print(f"[Universal Extractor] Warning: {GALLERY_UI_DIR} not found. Run 'npm run build' in gallery_ui/")
