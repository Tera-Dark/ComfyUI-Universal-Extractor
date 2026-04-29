from __future__ import annotations

import asyncio
import os
from pathlib import Path

from aiohttp import web

from ..constants import GALLERY_INDEX_FILE, GALLERY_UI_DIR, IMPORT_IMAGE_SUBFOLDER, TRASH_DIR
from .service import (
    LibraryValidationError,
    batch_update_images,
    batch_rename_images,
    create_gallery_board,
    build_import_result,
    create_folder,
    delete_gallery_board,
    delete_gallery_source,
    delete_images,
    delete_folder,
    delete_library,
    diagnose_gallery_sources,
    enqueue_thumbnail_prewarm,
    get_import_target_for_filename,
    get_gallery_context,
    get_image_metadata,
    get_thumbnail_prewarm_status,
    image_ref_for_full_path,
    get_library,
    get_library_entries_page,
    get_library_raw_text,
    get_thumbnail_path,
    get_trash_item,
    import_library_data,
    list_images,
    list_images_page,
    list_boards,
    list_gallery_sources,
    list_libraries,
    list_trash_items,
    merge_folder,
    move_images,
    persist_image_state,
    purge_trash_item,
    restore_trash_item,
    save_gallery_source,
    update_board_images,
    update_gallery_board,
    search_library_artists,
    test_gallery_source_path,
    generate_artist_string,
    rename_image,
    resolve_image_path,
    save_library,
    create_library_entry,
    update_library_entry,
    delete_library_entry,
)


def _bad_request(message: str) -> web.Response:
    return web.json_response({"error": message}, status=400)


def _parse_int(value, field: str, default: int, min_value: int | None = None, max_value: int | None = None) -> int:
    if value in (None, ""):
        parsed = default
    else:
        try:
            parsed = int(value)
        except (TypeError, ValueError) as error:
            raise ValueError(f"{field} must be an integer") from error

    if min_value is not None:
        parsed = max(min_value, parsed)
    if max_value is not None:
        parsed = min(max_value, parsed)
    return parsed


def _parse_float(value, field: str, default: float) -> float:
    if value in (None, ""):
        return default
    try:
        return float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{field} must be a number") from error


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
    board_id = request.query.get("board_id", "")
    date_from = request.query.get("date_from", "")
    date_to = request.query.get("date_to", "")
    favorites_only = (
        request.query.get("favorites", "").lower() in {"1", "true", "yes"}
        or request.query.get("pinned", "").lower() in {"1", "true", "yes"}
    )
    force_refresh = request.query.get("force_refresh", "").lower() in {"1", "true", "yes"}
    sort_by = request.query.get("sort_by", "created_at")
    sort_order = request.query.get("sort_order", "desc")
    try:
        page = _parse_int(request.query.get("page"), "page", 1, min_value=1)
        limit = _parse_int(request.query.get("limit"), "limit", 60, min_value=1, max_value=120)
        page_result = list_images_page(
            page=page,
            limit=limit,
            search=search,
            category=category,
            subfolder=subfolder,
            board_id=board_id,
            date_from=date_from,
            date_to=date_to,
            favorites_only=favorites_only,
            sort_by=sort_by,
            sort_order=sort_order,
            force_refresh=force_refresh,
        )
    except ValueError as error:
        return _bad_request(str(error))

    return web.json_response(page_result)


async def api_image_metadata(request: web.Request) -> web.Response:
    relative_path = request.query.get("relative_path", "")
    if not relative_path:
        return web.json_response({"error": "relative_path required"}, status=400)

    try:
        _, full_path = resolve_image_path(relative_path)
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)
    except ValueError as error:
        return _bad_request(str(error))

    if not os.path.exists(full_path):
        return web.json_response({"error": "not found"}, status=404)

    return web.json_response(get_image_metadata(relative_path))


async def api_thumbnail(request: web.Request) -> web.StreamResponse:
    relative_path = request.query.get("relative_path", "")
    try:
        size = _parse_int(request.query.get("size"), "size", 480, min_value=64, max_value=1024)
    except ValueError as error:
        return _bad_request(str(error))

    if not relative_path:
        return _bad_request("relative_path required")

    try:
        _, thumb_path = await asyncio.to_thread(get_thumbnail_path, relative_path, size)
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)
    except (RuntimeError, ValueError) as error:
        return web.json_response({"error": str(error)}, status=400)

    return web.FileResponse(
        Path(thumb_path),
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


async def api_prewarm_thumbnails(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return _bad_request("json body required")
    if not isinstance(body, dict):
        return _bad_request("json body must be an object")
    relative_paths = body.get("relative_paths", [])
    if not isinstance(relative_paths, list):
        return _bad_request("relative_paths must be a list")
    try:
        size = _parse_int(body.get("size"), "size", 480, min_value=64, max_value=1024)
        limit = _parse_int(body.get("limit"), "limit", 80, min_value=1, max_value=200)
        return web.json_response(enqueue_thumbnail_prewarm([str(path) for path in relative_paths], size=size, limit=limit))
    except ValueError as error:
        return _bad_request(str(error))


async def api_thumbnail_prewarm_status(_request: web.Request) -> web.Response:
    return web.json_response(get_thumbnail_prewarm_status())


async def api_image_file(request: web.Request) -> web.StreamResponse:
    relative_path = request.query.get("relative_path", "")
    if not relative_path:
        return _bad_request("relative_path required")

    try:
        _, full_path = resolve_image_path(relative_path)
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)
    except ValueError as error:
        return _bad_request(str(error))

    if not os.path.exists(full_path):
        return web.json_response({"error": "not found"}, status=404)

    return web.FileResponse(Path(full_path))


async def api_list_trash(_request: web.Request) -> web.Response:
    return web.json_response({"items": list_trash_items()})


async def api_trash_file(request: web.Request) -> web.StreamResponse:
    item_id = request.query.get("id", "")
    item = get_trash_item(item_id)
    if not item:
        return web.Response(status=404)

    trash_root = os.path.realpath(os.path.abspath(TRASH_DIR))
    storage_path = Path(os.path.realpath(os.path.abspath(os.path.join(TRASH_DIR, item.get("storage_path", "")))))
    try:
        if os.path.commonpath([trash_root, str(storage_path)]) != trash_root:
            return _bad_request("trash path must stay within trash directory")
    except ValueError:
        return _bad_request("invalid trash path")

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

    try:
        _, full_path = resolve_image_path(relative_path)
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)
    except ValueError as error:
        return _bad_request(str(error))

    if not os.path.exists(full_path):
        return web.json_response({"error": "image not found"}, status=404)

    return web.json_response(persist_image_state(relative_path, updates))


async def api_import_files(request: web.Request) -> web.Response:
    reader = await request.multipart()
    imported_images = []
    imported_libraries = []
    skipped = []
    target_source_id = ""
    target_subfolder = IMPORT_IMAGE_SUBFOLDER

    while True:
        part = await reader.next()
        if part is None:
            break
        if getattr(part, "filename", None):
            kind, target_path, skipped_item = get_import_target_for_filename(part.filename, target_source_id, target_subfolder)
            if skipped_item:
                skipped.append(skipped_item)
                continue

            with open(target_path, "wb") as file:
                while True:
                    chunk = await part.read_chunk()
                    if not chunk:
                        break
                    file.write(chunk)

            if kind == "image":
                imported_images.append(
                    {
                        "filename": os.path.basename(target_path),
                        "relative_path": image_ref_for_full_path(target_path),
                    }
                )
            else:
                imported_libraries.append({"filename": os.path.basename(target_path)})
            continue

        field_value = (await part.text()).strip()
        if part.name == "target_source_id":
            target_source_id = field_value
        elif part.name == "target_subfolder":
            target_subfolder = field_value or IMPORT_IMAGE_SUBFOLDER

    return web.json_response(build_import_result(imported_images, imported_libraries, skipped))


async def api_delete_images(request: web.Request) -> web.Response:
    body = await request.json()
    relative_paths = body.get("relative_paths", [])
    if not isinstance(relative_paths, list) or not relative_paths:
        return web.json_response({"error": "relative_paths required"}, status=400)
    try:
        return web.json_response(delete_images(relative_paths))
    except ValueError as error:
        return _bad_request(str(error))


async def api_batch_update_images(request: web.Request) -> web.Response:
    body = await request.json()
    relative_paths = body.get("relative_paths", [])
    updates = body.get("updates", {})
    if not isinstance(relative_paths, list) or not relative_paths or not isinstance(updates, dict):
        return web.json_response({"error": "relative_paths and updates required"}, status=400)
    try:
        return web.json_response(batch_update_images(relative_paths, updates))
    except ValueError as error:
        return _bad_request(str(error))


async def api_list_boards(request: web.Request) -> web.Response:
    force_refresh = request.query.get("force_refresh", "").lower() in {"1", "true", "yes"}
    try:
        return web.json_response({"boards": list_boards(force_refresh=force_refresh)})
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)


async def api_create_board(request: web.Request) -> web.Response:
    body = await request.json()
    name = str(body.get("name", "")).strip()
    description = str(body.get("description", "")).strip()
    try:
        return web.json_response(create_gallery_board(name, description))
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)


async def api_update_board(request: web.Request) -> web.Response:
    body = await request.json()
    board_id = str(body.get("id", "")).strip()
    updates = body.get("updates", {})
    if not board_id or not isinstance(updates, dict):
        return web.json_response({"error": "id and updates required"}, status=400)
    try:
        return web.json_response(update_gallery_board(board_id, updates))
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)


async def api_delete_board(request: web.Request) -> web.Response:
    body = await request.json()
    board_id = str(body.get("id", "")).strip()
    if not board_id:
        return web.json_response({"error": "id required"}, status=400)
    try:
        return web.json_response(delete_gallery_board(board_id))
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)


async def api_update_board_pins(request: web.Request) -> web.Response:
    body = await request.json()
    board_id = str(body.get("id", "")).strip()
    relative_paths = body.get("relative_paths", [])
    pinned = bool(body.get("pinned", True))
    if not board_id or not isinstance(relative_paths, list):
        return web.json_response({"error": "id and relative_paths required"}, status=400)
    try:
        return web.json_response(update_board_images(board_id, relative_paths, pinned=pinned))
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)


async def api_move_images(request: web.Request) -> web.Response:
    body = await request.json()
    relative_paths = body.get("relative_paths", [])
    target_subfolder = str(body.get("target_subfolder", "")).strip()
    target_source_id = str(body.get("target_source_id", "")).strip()
    if not isinstance(relative_paths, list) or not relative_paths:
        return web.json_response({"error": "relative_paths required"}, status=400)

    try:
        return web.json_response(move_images(relative_paths, target_subfolder, target_source_id))
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
    try:
        start_number = _parse_int(body.get("start_number"), "start_number", 1)
        padding = _parse_int(body.get("padding"), "padding", 2)
        current_page = _parse_int(body.get("current_page"), "current_page", 1)
    except ValueError as error:
        return _bad_request(str(error))

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
    try:
        page = _parse_int(request.query.get("page"), "page", 1, min_value=1)
        limit = _parse_int(request.query.get("limit"), "limit", 120, min_value=1)
    except ValueError as error:
        return _bad_request(str(error))
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
    try:
        post_threshold = _parse_int(request.query.get("post_threshold"), "post_threshold", 0)
        limit = _parse_int(request.query.get("limit"), "limit", 12, min_value=1)
    except ValueError as error:
        return _bad_request(str(error))
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
                count=_parse_int(body.get("count"), "count", 3),
                mode=str(body.get("mode", "standard")),
                preselected_names=body.get("preselected_names", []),
                filter_mode=str(body.get("filter_mode", "none")),
                post_threshold=_parse_int(body.get("post_threshold"), "post_threshold", 0),
                creative_bracket_style=str(body.get("creative_bracket_style", "paren")),
                creative_nest_levels=_parse_int(body.get("creative_nest_levels"), "creative_nest_levels", 0),
                standard_weight_min=_parse_float(body.get("standard_weight_min"), "standard_weight_min", 0.5),
                standard_weight_max=_parse_float(body.get("standard_weight_max"), "standard_weight_max", 1.5),
                nai_weight_min=_parse_float(body.get("nai_weight_min"), "nai_weight_min", 0.5),
                nai_weight_max=_parse_float(body.get("nai_weight_max"), "nai_weight_max", 1.5),
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


async def api_list_gallery_sources(request: web.Request) -> web.Response:
    force_refresh = request.query.get("force_refresh", "").lower() in {"1", "true", "yes"}
    context = get_gallery_context(force_refresh=force_refresh)
    return web.json_response({"sources": context.get("sources", []), "active_source_count": context.get("active_source_count", 0)})


async def api_save_gallery_source(request: web.Request) -> web.Response:
    body = await request.json()
    if not isinstance(body, dict):
        return _bad_request("source payload required")
    try:
        return web.json_response(save_gallery_source(body))
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)
    except ValueError as error:
        return _bad_request(str(error))


async def api_delete_gallery_source(request: web.Request) -> web.Response:
    body = await request.json()
    source_id = str(body.get("id", "")).strip()
    if not source_id:
        return _bad_request("id required")
    try:
        return web.json_response(delete_gallery_source(source_id))
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)
    except ValueError as error:
        return _bad_request(str(error))


async def api_test_gallery_source_path(request: web.Request) -> web.Response:
    body = await request.json()
    try:
        return web.json_response(test_gallery_source_path(str(body.get("path", ""))))
    except ValueError as error:
        return _bad_request(str(error))


async def api_diagnose_gallery_sources(_request: web.Request) -> web.Response:
    return web.json_response(diagnose_gallery_sources())


def register_routes(app):
    _safe_add_route(app.router, "get", "/universal_gallery/api/context", api_gallery_context)
    _safe_add_route(app.router, "get", "/universal_gallery/api/images", api_list_images)
    _safe_add_route(app.router, "get", "/universal_gallery/api/metadata", api_image_metadata)
    _safe_add_route(app.router, "get", "/universal_gallery/api/thumb", api_thumbnail)
    _safe_add_route(app.router, "post", "/universal_gallery/api/thumb/prewarm", api_prewarm_thumbnails)
    _safe_add_route(app.router, "get", "/universal_gallery/api/thumb/prewarm-status", api_thumbnail_prewarm_status)
    _safe_add_route(app.router, "get", "/universal_gallery/api/image-file", api_image_file)
    _safe_add_route(app.router, "get", "/universal_gallery/api/trash", api_list_trash)
    _safe_add_route(app.router, "get", "/universal_gallery/api/trash/file", api_trash_file)
    _safe_add_route(app.router, "post", "/universal_gallery/api/image-state", api_update_image_state)
    _safe_add_route(app.router, "post", "/universal_gallery/api/trash/restore", api_restore_trash_item)
    _safe_add_route(app.router, "post", "/universal_gallery/api/trash/purge", api_purge_trash_item)
    _safe_add_route(app.router, "post", "/universal_gallery/api/import", api_import_files)
    _safe_add_route(app.router, "post", "/universal_gallery/api/images/delete", api_delete_images)
    _safe_add_route(app.router, "post", "/universal_gallery/api/images/batch-update", api_batch_update_images)
    _safe_add_route(app.router, "get", "/universal_gallery/api/boards", api_list_boards)
    _safe_add_route(app.router, "post", "/universal_gallery/api/boards", api_create_board)
    _safe_add_route(app.router, "patch", "/universal_gallery/api/boards", api_update_board)
    _safe_add_route(app.router, "delete", "/universal_gallery/api/boards", api_delete_board)
    _safe_add_route(app.router, "post", "/universal_gallery/api/boards/pins", api_update_board_pins)
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
    _safe_add_route(app.router, "get", "/universal_gallery/api/settings/gallery-sources", api_list_gallery_sources)
    _safe_add_route(app.router, "post", "/universal_gallery/api/settings/gallery-sources", api_save_gallery_source)
    _safe_add_route(app.router, "patch", "/universal_gallery/api/settings/gallery-sources", api_save_gallery_source)
    _safe_add_route(app.router, "delete", "/universal_gallery/api/settings/gallery-sources", api_delete_gallery_source)
    _safe_add_route(app.router, "post", "/universal_gallery/api/settings/gallery-sources/test-path", api_test_gallery_source_path)
    _safe_add_route(app.router, "get", "/universal_gallery/api/settings/gallery-sources/diagnostics", api_diagnose_gallery_sources)

    if os.path.exists(GALLERY_UI_DIR):
        _safe_add_route(app.router, "get", "/gallery", redirect_gallery_root)
        _safe_add_route(app.router, "get", "/gallery/", serve_gallery_index)
        _safe_add_static(app.router, "/gallery", GALLERY_UI_DIR)
        print("[Universal Extractor] Gallery UI -> /gallery")
    else:
        print(f"[Universal Extractor] Warning: {GALLERY_UI_DIR} not found. Run 'npm run build' in gallery_ui/")
