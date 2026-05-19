# Universal Gallery Architecture

This document summarizes the runtime architecture that matters for future backend and frontend work.

## Request Flow

- ComfyUI serves the committed frontend bundle from `gallery_ui/dist/` at `/gallery/`.
- `/gallery/` serves `index.html` with `Cache-Control: no-store`; hashed files under `/gallery/assets/*` are served with long-lived immutable cache headers so unchanged chunks can be reused by the browser.
- Gallery API routes live under `/universal_gallery/api/` in `py/gallery/routes.py`.
- Gallery behavior is exposed through the compatibility facade in `py/gallery/service.py`. Low-risk helper domains now live beside it: `refs.py` owns source/image/folder ref normalization, `source_security.py` owns source path hardening and scope checks, and `state_store.py` owns persisted image state and boards.
- File APIs must stay scoped to registered gallery sources and supported image extensions.

## Gallery Index Data Model

Runtime gallery data is stored under `data/`. User state remains JSON-backed, while image listing uses SQLite:

- `gallery_state.json`: editable image state, categories, pins, notes, and boards.
- `gallery_sources.json`: configured gallery sources.
- `gallery_index.sqlite3`: derived image index.
- `library_summary_cache.json`: derived prompt-library counts keyed by filename, file size, and `mtime_ns`; it is runtime state, not a user library.
- `thumb_cache/`: generated thumbnails.
- `trash/`: plugin-managed trash storage.

`gallery_index.sqlite3` uses `PRAGMA user_version` for internal schema migration. The important tables are:

- `gallery_images`: primary image index keyed by `relative_path`; stores source, folder, file size, real image width/height, created/modified timestamps, baked state fields, and color profile fields.
- `gallery_index_meta`: source signature, built timestamp, color index version, state digest, auxiliary-table version, and FTS availability.
- `gallery_images_fts`: FTS5 search table for filename/path/title/category/notes text. If FTS5 is unavailable, search falls back to the existing LIKE expression.
- `gallery_image_color_family`: normalized color-family rows used by color filtering, while legacy color fields remain in `gallery_images` for response compatibility.

The index has composite indexes for common list views: source plus folder plus creation time, pinned plus creation time, category plus creation time, color family plus creation time, filename, and size.

## Loading And Sync Strategy

Normal image listing uses `list_images_page()`, which queries SQLite directly with pagination. It does not need to load the whole image index into Python.

The first gallery load should use the existing SQLite index without `force_refresh=true`. Forced image refresh is reserved for user-triggered refreshes and freshness-detected changes, where the backend can prefer incremental sync over a full rebuild.

Automatic gallery sync is a two-step flow:

1. The frontend calls `/universal_gallery/api/images/freshness` for the current folder/source view while the page is visible.
2. If the fingerprint changed, the frontend calls `/api/images?force_refresh=true`; the backend performs incremental index sync when the existing DB signature is current.

Incremental sync scans only the affected scope, upserts new or modified files, deletes missing files, and queues only changed paths for color backfill. Full rebuild remains the cold-start and repair fallback.

`get_gallery_context()` avoids full image reads. It derives source counts, pinned count, subfolders, and move targets from SQLite aggregates plus lightweight directory discovery. `list_boards()` uses the small editable state set and DB existence checks rather than scanning every indexed image.

`list_libraries()` does not parse every prompt-library JSON file on each request. It uses `library_summary_cache.json` for list counts when filename, file size, and `mtime_ns` match, then invalidates the affected summary when a library is imported, saved, deleted, or otherwise invalidated through the service facade.

`GalleryContext.subfolders` keeps the legacy string list for API compatibility. `GalleryContext.subfolder_details` adds source id, relative path, and directory modified time for frontend source-scoped folder trees and default modified-time sorting.

## State And Color Indexing

Editable image state remains persisted in `gallery_state.json`. The SQLite index caches those fields for fast list queries, but `_sync_image_state_to_index_db()` first compares `gallery_state_mtime` and `gallery_state_digest`; unchanged state skips DB writes.

Color indexing is intentionally asynchronous:

- Base file rows are available before pixel analysis completes.
- Current page paths are prioritized for color backfill.
- Failed or unreadable images are marked with a fallback color profile so the background worker does not loop forever.
- `/universal_gallery/api/color-index/status` reports backfill progress.

Image dimensions are indexed separately from thumbnails. New or changed files read their real Pillow dimensions during full or incremental index sync, and older rows with missing dimensions are filled by a low-priority background pass. List responses expose optional `width` and `height` values; missing dimensions must not block image listing or force the frontend to use thumbnail `naturalWidth`/`naturalHeight`.

## Frontend Contract

The public response shapes for `ImageListResponse` and `GalleryContext` are preserved. Frontend code should keep using `galleryApi.listImages`, `galleryApi.getContext`, and `galleryApi.getImageFreshness` rather than reaching into backend implementation details.

Large frontend surfaces are split along stable helper boundaries. `WorkspaceSidebar` imports folder-scope and sorting helpers from `components/shared/folderTree.ts`, while `GalleryWorkspace` delegates image prefetch state and card image loading to `components/gallery/galleryImagePrefetch.ts` and `GalleryCardImage.tsx`. These modules are implementation details; UI behavior and public API calls remain unchanged.

First-screen loading is intentionally gallery-first. `GalleryWorkspace` stays statically imported, while `LibraryWorkspace`, `WorkbenchWorkspace`, `SettingsWorkspace`, and `ImageDetailModal` are declared with `React.lazy` and loaded on demand through `Suspense`. `useLibraryData` should remain disabled until the `library` or `workbench` tabs are active, so the gallery first screen does not request `/universal_gallery/api/libraries`.

Shared interaction primitives live in `gallery_ui/src/utils/interaction.ts`. Context menus in gallery, dual-folder, sidebar, and library surfaces should use the shared placement and dismiss helpers so menus stay near their trigger, flip inside the viewport, and close consistently on Escape, outside click, resize, or scroll. Keyboard shortcuts should use the shared editable-target guard so input fields and folder searches keep normal text-editing behavior.

The main gallery grid is rendered through the `useVirtualMasonry` helper, backed by `@tanstack/react-virtual`. The right Inspector is an overlay layer, not a layout column; opening or closing it should not change the main gallery scroll container width, column count, page, selection, or scroll position. Box selection in the virtual grid must not depend only on mounted DOM cards: it should freeze the drag-start layout, use estimated rectangles for offscreen masonry items, compensate scroll delta while dragging, and auto-scroll near the main scroll container edges.

Dual-folder organization lives in `DualFolderWorkspace`. It is a frontend-only file-management surface over the existing image APIs: folder panes call `galleryApi.listImages`, internal drags use a private `application/x-universal-gallery-image` payload, moves use the existing `/api/images/move` wrapper, and delete/state/board actions reuse the same callbacks as normal gallery selection. It must keep external file drops separate from internal image drags so imports continue to receive the browser-provided `File` objects unchanged. Dual-folder cards should mirror normal-gallery interaction polish: clipped text, real-resolution chips when dimensions are available, hover lift, image scale, and stable selected/focused/drop states.

When the gallery is on page 1 sorted by newest first, live sync may replace the list automatically. In other views, the frontend shows a pending-refresh pill so browsing position is not interrupted.

Sidebar source shortcuts use folder refs as scopes. `default_output::` means the output source root, `default_input::` means the input source root, and `source_id::relative/path` targets a folder inside a registered source. The empty string is only a compatibility fallback and should not be used as the normal output shortcut.

The folder panel should render only the active source tree. Pinned folders sort first, then folders sort by modified time descending unless the user switches to name sorting. Legacy pinned output paths without the `default_output::` prefix should still be treated as aliases for their canonical source refs.

Trash grid mode is presentation-only and remains backed by `/api/trash`. It uses a responsive masonry-style card layout, keeps restore/purge actions local to the trash page, and clips long names and original paths inside the card bounds.

## ComfyUI Workflow Handoff

The image detail action for opening a workflow in ComfyUI is a same-origin handoff, not a window-creation path. `gallery_ui/src/App.tsx` asks for confirmation, wraps the send in the global operation status center, then sends a `universal-extractor:workflow-probe` over the `universal-extractor-workflow` `BroadcastChannel`. `web/comfyui/top_menu_extension.js` responds with an `instanceId`, visibility state, and focus state. The gallery then sends one targeted `universal-extractor:workflow-message` to a single acknowledged ComfyUI instance and waits for `universal-extractor:workflow-delivered`.

The gallery must not call `window.open()` as a fallback for workflow handoff. If no refreshed ComfyUI page responds, the gallery stores the payload under `universal-extractor:pending-workflow` and shows a refresh/retry error so the user can refresh an existing ComfyUI tab. This avoids one click opening multiple ComfyUI tabs or broadcasting the same workflow into every open ComfyUI page.

## Release Guardrails

`scripts/verify.ps1` remains the preferred full local check. It runs Python tests, backend compileall, frontend typecheck/lint/tests/build, dist asset audit, and release metadata checks. `scripts/check-release.ps1` verifies `pyproject.toml`, `gallery_ui/package.json`, and `package-lock.json` versions match and that tracked dist compatibility assets share the latest CSS/JS content.

The manual Comfy registry workflow reads the package version, checks the registry for an existing active version, and skips the publish action with a notice when the version is already present. Real publish failures should still fail the workflow.
