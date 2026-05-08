# Universal Gallery Architecture

This document summarizes the runtime architecture that matters for future backend and frontend work.

## Request Flow

- ComfyUI serves the committed frontend bundle from `gallery_ui/dist/` at `/gallery/`.
- Gallery API routes live under `/universal_gallery/api/` in `py/gallery/routes.py`.
- Most gallery behavior is implemented in `py/gallery/service.py`; persisted image state and boards live in `py/gallery/state_store.py`.
- File APIs must stay scoped to registered gallery sources and supported image extensions.

## Gallery Index Data Model

Runtime gallery data is stored under `data/`. User state remains JSON-backed, while image listing uses SQLite:

- `gallery_state.json`: editable image state, categories, pins, notes, and boards.
- `gallery_sources.json`: configured gallery sources.
- `gallery_index.sqlite3`: derived image index.
- `thumb_cache/`: generated thumbnails.
- `trash/`: plugin-managed trash storage.

`gallery_index.sqlite3` uses `PRAGMA user_version` for internal schema migration. The important tables are:

- `gallery_images`: primary image index keyed by `relative_path`; stores source, folder, file size, created/modified timestamps, baked state fields, and color profile fields.
- `gallery_index_meta`: source signature, built timestamp, color index version, state digest, auxiliary-table version, and FTS availability.
- `gallery_images_fts`: FTS5 search table for filename/path/title/category/notes text. If FTS5 is unavailable, search falls back to the existing LIKE expression.
- `gallery_image_color_family`: normalized color-family rows used by color filtering, while legacy color fields remain in `gallery_images` for response compatibility.

The index has composite indexes for common list views: source plus folder plus creation time, pinned plus creation time, category plus creation time, color family plus creation time, filename, and size.

## Loading And Sync Strategy

Normal image listing uses `list_images_page()`, which queries SQLite directly with pagination. It does not need to load the whole image index into Python.

Automatic gallery sync is a two-step flow:

1. The frontend calls `/universal_gallery/api/images/freshness` for the current folder/source view while the page is visible.
2. If the fingerprint changed, the frontend calls `/api/images?force_refresh=true`; the backend performs incremental index sync when the existing DB signature is current.

Incremental sync scans only the affected scope, upserts new or modified files, deletes missing files, and queues only changed paths for color backfill. Full rebuild remains the cold-start and repair fallback.

`get_gallery_context()` avoids full image reads. It derives source counts, pinned count, subfolders, and move targets from SQLite aggregates plus lightweight directory discovery. `list_boards()` uses the small editable state set and DB existence checks rather than scanning every indexed image.

`GalleryContext.subfolders` keeps the legacy string list for API compatibility. `GalleryContext.subfolder_details` adds source id, relative path, and directory modified time for frontend source-scoped folder trees and default modified-time sorting.

## State And Color Indexing

Editable image state remains persisted in `gallery_state.json`. The SQLite index caches those fields for fast list queries, but `_sync_image_state_to_index_db()` first compares `gallery_state_mtime` and `gallery_state_digest`; unchanged state skips DB writes.

Color indexing is intentionally asynchronous:

- Base file rows are available before pixel analysis completes.
- Current page paths are prioritized for color backfill.
- Failed or unreadable images are marked with a fallback color profile so the background worker does not loop forever.
- `/universal_gallery/api/color-index/status` reports backfill progress.

## Frontend Contract

The public response shapes for `ImageListResponse` and `GalleryContext` are preserved. Frontend code should keep using `galleryApi.listImages`, `galleryApi.getContext`, and `galleryApi.getImageFreshness` rather than reaching into backend implementation details.

When the gallery is on page 1 sorted by newest first, live sync may replace the list automatically. In other views, the frontend shows a pending-refresh pill so browsing position is not interrupted.

Sidebar source shortcuts use folder refs as scopes. `default_output::` means the output source root, `default_input::` means the input source root, and `source_id::relative/path` targets a folder inside a registered source. The empty string is only a compatibility fallback and should not be used as the normal output shortcut.

The folder panel should render only the active source tree. Pinned folders sort first, then folders sort by modified time descending unless the user switches to name sorting. Legacy pinned output paths without the `default_output::` prefix should still be treated as aliases for their canonical source refs.

Trash grid mode is presentation-only and remains backed by `/api/trash`. It uses a responsive masonry-style card layout, keeps restore/purge actions local to the trash page, and clips long names and original paths inside the card bounds.
