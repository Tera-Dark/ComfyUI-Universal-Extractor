# Agent Handoff Notes

This repository is a ComfyUI custom node plus a React/Vite gallery frontend.

## Project Map

- `py/` contains the ComfyUI node registration and Gallery backend.
- `py/gallery/` contains the aiohttp API routes, gallery service, state store, metadata parsing, thumbnailing, indexing, trash, folder, and source management logic.
- `py/gallery/service.py` is the compatibility facade for routes and tests; `py/gallery/refs.py` and `py/gallery/source_security.py` hold low-risk source ref and path-safety helpers split out of the former monolithic service.
- `gallery_ui/src/` contains the React frontend.
- `gallery_ui/dist/` is committed and served by ComfyUI at `/gallery/`.
- `web/comfyui/top_menu_extension.js` adds the ComfyUI top-menu entry and workflow handoff bridge.
- `data/` stores runtime gallery state, source configuration, SQLite index, thumbnail cache, trash, library summary cache, and prompt JSON libraries.
- `docs/architecture.md` documents the Gallery API, SQLite index tables, freshness flow, incremental sync, first-load/caching strategy, and state/color-index contracts.

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

Prefer `powershell -ExecutionPolicy Bypass -File scripts\verify.ps1` for full local verification; it runs Python tests, compileall, frontend typecheck, lint, tests, dependency security audit, build, dist asset audit, and release metadata checks. After `vite build`, ComfyUI or a browser may still request older hashed assets. Preserve compatibility by copying the latest generated CSS content to all tracked `gallery_ui/dist/assets/index-*.css` files and the latest generated JS content to all tracked `index-*.js` files before committing release-ready dist changes. The current build script performs this sync automatically through `gallery_ui/scripts/sync-dist-compat.mjs`, and `scripts\check-release.ps1` verifies the tracked compatibility files match.

Before manually publishing to the Comfy registry, make sure the version in `pyproject.toml`, `gallery_ui/package.json`, and `gallery_ui/package-lock.json` is the intended release version. The publish workflow checks the registry first and skips cleanly if the version already exists.

## Frontend Behavior To Preserve

- Gallery uses a left resource navigation plus stable center content shell; the right Inspector is a fixed overlay panel on desktop and must not resize or squeeze the main gallery scroll container.
- Trash does not use the right Inspector; it keeps its own bulk toolbar.
- Trash grid mode uses a responsive masonry-style layout and must keep long item names and original paths clipped inside each card.
- Sidebar quick entries are source scopes, not cosmetic shortcuts: `default_output::` shows only output images/folders, and `default_input::` shows only input images/folders.
- The folder panel is scoped to the active source. Do not reintroduce an extra nested "input gallery" node inside the output directory tree.
- Folder ordering is pinned folders first, then modified time descending by default; name sorting is the alternate mode. Persisted legacy output pins such as `foo/bar` should still match canonical refs like `default_output::foo/bar`.
- Default selection mode is off. Single click opens image detail unless the user enables default selection mode in Settings.
- Selection mode supports click-select, left-button box select, scroll-assisted box select, Shift range select, right-click menus, and bulk actions. In virtual grid mode, box selection must use drag-start layout snapshots plus estimated offscreen card rects so it can continue selecting beyond currently mounted cards.
- Dual-folder mode is a file-manager style organizer. It supports per-pane selection, Ctrl/Meta multi-select, Shift range-select, double-click detail, batch internal drag move, right-click actions, pane-level select/invert/clear/refresh/move controls, and shortcuts: Ctrl/Meta+A, Escape, Delete, Enter, Ctrl/Meta+M, Ctrl/Meta+R, and Tab.
- In dual-folder mode, internal image drags use `application/x-universal-gallery-image` and move through `galleryApi.moveImages`; external `Files` drops remain imports and must keep the original browser `File` objects unchanged.
- Dual-folder cards should stay visually aligned with normal gallery cards: clipped filenames, real-resolution chips when `width`/`height` are present, hover lift/image scale, and stable selected/focused/drop states.
- The filter popover is compact: fixed header, scrollable body, fixed footer, current-filter chips, compact sorting controls, compact color palette, date range, and Pin state.
- Color filtering is backed by the backend index. A color family must meet the 25% threshold to match.
- Gallery first load should read the existing SQLite index without `force_refresh=true`; manual refresh and freshness-detected changes are the paths that request `forceRefresh=true`.
- Library data should stay gated to `library` and `workbench` views. Do not make the gallery first screen fetch `/universal_gallery/api/libraries`.
- Non-gallery surfaces (`LibraryWorkspace`, `WorkbenchWorkspace`, `SettingsWorkspace`, and `ImageDetailModal`) are lazy-loaded from `App.tsx`; keep the main gallery statically loaded so the first screen avoids an extra waterfall.
- First-run onboarding is controlled by `OnboardingTour` plus `onboardingTourModel`. It uses real `data-tour-id` anchors, may ask `App.tsx` to switch tabs, stores completion only in localStorage key `universal-extractor:onboarding-tour-v1-completed`, and exposes restart from Settings without adding a `UiPreferences` field.
- Live gallery refresh is a two-step flow: `galleryApi.getImageFreshness` checks the current view first, then `listImages(..., forceRefresh=true)` refreshes only when the fingerprint changes. Page 1 newest view may auto-replace; other views should show the pending-refresh control.
- Opening a workflow in ComfyUI must ask for confirmation, report pending/success/error through `OperationStatusCenter`, and must not auto-create new ComfyUI windows. The gallery probes existing ComfyUI pages over `BroadcastChannel`, targets one acknowledged `instanceId`, and only stores a pending payload plus shows a refresh/retry message when no refreshed receiver is available.
- Right-click and detail actions include copying the positive prompt and viewing Metadata.
- Shared interaction helpers live in `gallery_ui/src/utils/interaction.ts`. Use them for floating menu placement, dismiss-on-Escape/click/scroll behavior, and editable-target keyboard guards instead of adding component-local variants.
- Global operation feedback lives in `gallery_ui/src/components/shared/OperationStatusCenter.tsx`. Keep `useToast().pushToast(...)` as the compatibility API for lightweight messages, but do not reintroduce a separate top-right toast viewport; long or failure-prone async actions should use `useOperationStatus().runOperation(...)` so pending, success, and error states appear in the right-bottom status center.
- Sensitive gallery mutations should require an explicit confirmation before starting, including destructive file operations, folder/source changes, import or move actions, trash restore/purge, batch metadata/category/board changes, and workflow sends.
- ComfyUI node registration lives in root `__init__.py` and loads node classes through `py/plugin.py`. The registered prompt-generation node is `UniversalJsonSegmentRandomizer` / `Universal Artist/Tag Randomizer`, a field-path based node for sampling specific JSON segments from `data/*.json` with random, polling, and sequential modes plus Anima, artist, weighted, NAI, tag, and custom output formats. Polling offsets are process-local and keyed by node id, selected library, fields, filters, pool content, and seed; ComfyUI restarts reset polling.

## Backend Index Notes

- `gallery_index.sqlite3` uses `PRAGMA user_version` and derived tables including `gallery_images`, `gallery_index_meta`, `gallery_images_fts`, and `gallery_image_color_family`.
- `gallery_images` includes cached real image dimensions (`image_width`, `image_height`) exposed as optional frontend `width`/`height`. Missing dimensions are filled gradually and must not block listing.
- `list_images_page()` should query SQLite directly and avoid loading every image into Python.
- `get_gallery_context()` should use SQLite aggregates for source counts, Pin count, subfolders, `subfolder_details`, and move targets; do not reintroduce full image-index reads for context.
- `force_refresh=true` should prefer incremental index sync when the source signature is current, with full rebuild only as cold-start or repair fallback.
- `list_libraries()` should use the `library_summary_cache.json` count cache keyed by filename, file size, and `mtime_ns`; keep that runtime file ignored and included in `RUNTIME_STATE_FILENAMES` so it is not shown as a user library.
- `/gallery/` serves `index.html` with `no-store`; hashed `/gallery/assets/*` files should keep long-lived immutable cache headers.
- Folder API inputs may be source refs (`source_id::relative/path`). Keep write operations scoped to writable sources, and keep the default input source read-only unless the source config explicitly changes.

## Safety Notes

- Gallery file APIs must stay scoped to registered gallery sources and supported image extensions.
- Source configuration must validate paths, writable status, and import targets.
- Write operations and source settings need same-origin protection.
- Import APIs should keep file size, total request size, and file count limits.
