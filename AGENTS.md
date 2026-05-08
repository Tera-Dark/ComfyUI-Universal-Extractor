# Agent Handoff Notes

This repository is a ComfyUI custom node plus a React/Vite gallery frontend.

## Project Map

- `py/` contains the ComfyUI node registration and Gallery backend.
- `py/gallery/` contains the aiohttp API routes, gallery service, state store, metadata parsing, thumbnailing, indexing, trash, folder, and source management logic.
- `gallery_ui/src/` contains the React frontend.
- `gallery_ui/dist/` is committed and served by ComfyUI at `/gallery/`.
- `web/comfyui/top_menu_extension.js` adds the ComfyUI top-menu entry and workflow handoff bridge.
- `data/` stores runtime gallery state, source configuration, SQLite index, thumbnail cache, trash, and prompt JSON libraries.
- `docs/architecture.md` documents the Gallery API, SQLite index tables, freshness flow, incremental sync, and state/color-index contracts.

## Build And Verification

Use these from the repository root unless noted:

```powershell
cd gallery_ui
cmd /c node_modules\.bin\tsc.cmd -b
cmd /c node_modules\.bin\vite.cmd build
cd ..
D:\comfyui\ComfyUI-aki-v1.5\ComfyUI-aki-v1.5\python\python.exe -m pytest
D:\comfyui\ComfyUI-aki-v1.5\ComfyUI-aki-v1.5\python\python.exe -m compileall py\gallery
```

The machine used for this project may not have `python` or `py` on `PATH`; prefer the bundled ComfyUI Python path above when available.

Prefer `powershell -ExecutionPolicy Bypass -File scripts\verify.ps1` for full local verification; it runs Python tests, compileall, frontend typecheck, lint, tests, build, and dist compatibility sync. After `vite build`, ComfyUI or a browser may still request older hashed assets. Preserve compatibility by copying the latest generated CSS content to all tracked `gallery_ui/dist/assets/index-*.css` files and the latest generated JS content to all tracked `index-*.js` files before committing release-ready dist changes. The current build script performs this sync automatically through `gallery_ui/scripts/sync-dist-compat.mjs`.

## Frontend Behavior To Preserve

- Gallery uses a three-column shell: left resource navigation, center content, right Inspector on desktop.
- Trash does not use the right Inspector; it keeps its own bulk toolbar.
- Trash grid mode uses a responsive masonry-style layout and must keep long item names and original paths clipped inside each card.
- Sidebar quick entries are source scopes, not cosmetic shortcuts: `default_output::` shows only output images/folders, and `default_input::` shows only input images/folders.
- The folder panel is scoped to the active source. Do not reintroduce an extra nested "input gallery" node inside the output directory tree.
- Folder ordering is pinned folders first, then modified time descending by default; name sorting is the alternate mode. Persisted legacy output pins such as `foo/bar` should still match canonical refs like `default_output::foo/bar`.
- Default selection mode is off. Single click opens image detail unless the user enables default selection mode in Settings.
- Selection mode supports click-select, left-button box select, Shift range select, right-click menus, and bulk actions.
- The filter popover is compact: fixed header, scrollable body, fixed footer, current-filter chips, compact sorting controls, compact color palette, date range, and Pin state.
- Color filtering is backed by the backend index. A color family must meet the 25% threshold to match.
- Live gallery refresh is a two-step flow: `galleryApi.getImageFreshness` checks the current view first, then `listImages(..., forceRefresh=true)` refreshes only when the fingerprint changes. Page 1 newest view may auto-replace; other views should show the pending-refresh control.
- Opening a workflow in ComfyUI should first try the existing ComfyUI page through `BroadcastChannel`, `postMessage`, and `localStorage` before opening a new page.
- Right-click and detail actions include copying the positive prompt and viewing Metadata.

## Backend Index Notes

- `gallery_index.sqlite3` uses `PRAGMA user_version` and derived tables including `gallery_images`, `gallery_index_meta`, `gallery_images_fts`, and `gallery_image_color_family`.
- `list_images_page()` should query SQLite directly and avoid loading every image into Python.
- `get_gallery_context()` should use SQLite aggregates for source counts, Pin count, subfolders, `subfolder_details`, and move targets; do not reintroduce full image-index reads for context.
- `force_refresh=true` should prefer incremental index sync when the source signature is current, with full rebuild only as cold-start or repair fallback.
- Folder API inputs may be source refs (`source_id::relative/path`). Keep write operations scoped to writable sources, and keep the default input source read-only unless the source config explicitly changes.

## Safety Notes

- Gallery file APIs must stay scoped to registered gallery sources and supported image extensions.
- Source configuration must validate paths, writable status, and import targets.
- Write operations and source settings need same-origin protection.
- Import APIs should keep file size, total request size, and file count limits.
