# Agent Handoff Notes

This repository is a ComfyUI custom node plus a React/Vite gallery frontend.

## Project Map

- `py/` contains the ComfyUI node registration and Gallery backend.
- `py/gallery/` contains the aiohttp API routes, gallery service, state store, metadata/recipe extraction, update checking, thumbnailing, indexing, trash, folder, and source management logic.
- `py/gallery/service.py` is the compatibility facade for routes and tests; `py/gallery/refs.py`, `py/gallery/source_security.py`, `py/gallery/image_safety.py`, `py/gallery/recipe.py`, `py/gallery/update_checker.py`, and `py/gallery/variant_fingerprints.py` hold source refs, path/decode safety, image recipes, release update status, and variant fingerprints.
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
- Normal gallery list view is a compact card-grid list: desktop widths at 1240px and above show two list cards per row, list thumbnails are larger than before, list metadata uses second-level timestamps, and real-resolution chips appear when `width`/`height` are available. Mobile falls back to one column without horizontal overflow.
- Trash does not use the right Inspector; it keeps its own bulk toolbar.
- Trash grid mode uses a responsive masonry-style layout and must keep long item names and original paths clipped inside each card.
- Sidebar quick entries are source scopes, not cosmetic shortcuts: `default_output::` shows only output images/folders, and `default_input::` shows only input images/folders.
- The folder panel is scoped to the active source. Do not reintroduce an extra nested "input gallery" node inside the output directory tree.
- Folder ordering is pinned folders first, then modified time descending by default; when sibling folder names contain valid `YYYY-MM-DD`/`YYYY.MM.DD`/`YYYY_MM_DD` dates, that embedded date wins over directory mtime to keep generated date folders stable. Name sorting is the alternate mode. Persisted legacy output pins such as `foo/bar` should still match canonical refs like `default_output::foo/bar`.
- Default selection mode is off. Single click opens image detail unless the user enables default selection mode in Settings.
- Selection mode supports click-select, left-button box select, scroll-assisted box select, Shift range select, right-click menus, and bulk actions. In virtual grid mode, box selection must use drag-start layout snapshots plus estimated offscreen card rects so it can continue selecting beyond currently mounted cards.
- Dual-folder mode is a file-manager style organizer. It supports per-pane selection, Ctrl/Meta multi-select, Shift range-select, double-click detail, batch internal drag move, right-click actions, pane-level select/invert/clear/refresh/move controls, and shortcuts: Ctrl/Meta+A, Escape, Delete, Enter, Ctrl/Meta+M, Ctrl/Meta+R, and Tab.
- In dual-folder mode, internal image drags use `application/x-universal-gallery-image` and move through `galleryApi.moveImages`; external `Files` drops remain imports and must keep the original browser `File` objects unchanged.
- Dual-folder cards should stay visually aligned with normal gallery cards: clipped filenames, real-resolution chips when `width`/`height` are present, hover lift/image scale, and stable selected/focused/drop states.
- Entering dual-folder mode unmounts the normal virtual gallery grid. When leaving dual-folder mode, `GalleryWorkspace` must clear stale `gridWidth` and reattach `ResizeObserver` measurement to the newly mounted `.ue-gallery-grid--virtual`; otherwise normal gallery columns can reuse the old layout and overflow.
- The filter popover is compact: fixed header, scrollable body, fixed footer, current-filter chips, compact sorting controls, compact color palette, date range, and Pin state.
- Color filtering is backed by the backend index. A color family must meet the 25% threshold to match.
- Gallery first load should read the existing SQLite index without `force_refresh=true`; manual refresh and freshness-detected changes are the paths that request `forceRefresh=true`.
- Library data should stay gated to `library` and `workbench` views. Do not make the gallery first screen fetch `/universal_gallery/api/libraries`.
- Non-gallery surfaces (`LibraryWorkspace`, `WorkbenchWorkspace`, `SettingsWorkspace`, and `ImageDetailModal`) are lazy-loaded from `App.tsx`; keep the main gallery statically loaded so the first screen avoids an extra waterfall.
- `WorkbenchWorkspace` is the extensible creative-tool console. Keep its quiet light workbench style: top status strip, left tool rail, staged generator flow, right/below queue panels, and the 1320px breakpoint that lets the generator stay wide before side panels stack below it. New workbench tools should plug into the rail/stage pattern rather than adding another top-level tab or unrelated visual system.
- First-run onboarding is controlled by `OnboardingTour` plus `onboardingTourModel`. It uses real `data-tour-id` anchors, may ask `App.tsx` to switch tabs, stores completion only in localStorage key `universal-extractor:onboarding-tour-v1-completed`, and exposes restart from Settings without adding a `UiPreferences` field.
- Live gallery refresh is a two-step flow: `galleryApi.getImageFreshness` checks the current view first, then `listImages(..., forceRefresh=true)` refreshes only when the fingerprint changes. Page 1 newest view may auto-replace; other views should show the pending-refresh control.
- The top-right update bell calls `galleryApi.getUpdateStatus()`; keep first load cached, show a red dot only for `update_available`, and reserve `force=true` for user-triggered rechecks.
- Variant organization is a Gallery-internal workspace toggled from `GalleryToolbar`. It groups exact duplicates, near duplicates, same prompt, same workflow, and filename series using local derived fingerprints, then reuses normal gallery selection, context menu, board, move, trash, metadata, and workflow-send behavior for group contents.
- Opening a workflow in ComfyUI must ask for confirmation, report pending/success/error through `OperationStatusCenter`, and must not auto-create new ComfyUI windows. The gallery probes existing ComfyUI pages over `BroadcastChannel`, targets one acknowledged `instanceId`, and only stores a pending payload plus shows a refresh/retry message when no refreshed receiver is available.
- Applying a detected ComfyUI-Lora-Manager LoRA stack from an image must also ask for confirmation, use the same single-target `BroadcastChannel` probe path, and mutate only an existing LoRA Manager-compatible node in the current ComfyUI graph. The bridge should prefer selected nodes, then the first matching graph node, and report success/error back through `OperationStatusCenter`.
- Right-click and detail actions include copying the positive prompt and viewing Metadata.
- `/api/metadata` returns a derived `recipe` object from `py/gallery/recipe.py` with prompt, checkpoint, LoRA, size, sampler, and `lora_manager` fields. Future one-click recipe integrations should consume that contract instead of scraping raw metadata or adding graph heuristics to `metadata.py`.
- Shared interaction helpers live in `gallery_ui/src/utils/interaction.ts`. Use them for floating menu placement, dismiss-on-Escape/click/scroll behavior, and editable-target keyboard guards instead of adding component-local variants.
- Global operation feedback lives in `gallery_ui/src/components/shared/OperationStatusCenter.tsx`. Keep `useToast().pushToast(...)` as the compatibility API for lightweight messages, but do not reintroduce a separate top-right toast viewport; long or failure-prone async actions should use `useOperationStatus().runOperation(...)` so pending, success, and error states appear in the right-bottom status center.
- Sensitive gallery mutations should require an explicit confirmation before starting, including destructive file operations, folder/source changes, import or move actions, trash restore/purge, batch metadata/category/board changes, and workflow sends.
- ComfyUI node registration lives in root `__init__.py` and loads node classes through `py/plugin.py`. The registered prompt-generation node is `UniversalJsonSegmentRandomizer` / `Universal Artist/Tag Randomizer`, a field-path based node for sampling specific JSON segments from `data/*.json` with random, polling, and sequential modes plus Anima, artist, weighted, NAI, tag, and custom output formats. Polling offsets are process-local and keyed by node id, selected library, fields, filters, pool content, and seed; ComfyUI restarts reset polling.

## Backend Index Notes

- `gallery_index.sqlite3` uses `PRAGMA user_version`, a `gallery_schema_migrations` audit table, WAL with a busy timeout, and derived tables including `gallery_images`, `gallery_index_meta`, `gallery_images_fts`, `gallery_image_color_family`, and `gallery_image_fingerprints`. The index is rebuildable; if the SQLite file looks corrupt, move it aside as `.corrupt-*` and rebuild instead of touching `gallery_state.json`.
- `gallery_images` includes cached real image dimensions (`image_width`, `image_height`) exposed as optional frontend `width`/`height`. Missing dimensions are filled gradually and must not block listing.
- `gallery_state.json` writes are locked and atomic. Index refresh/build runs conservative pin-state recovery after current `gallery_images` rows exist: a missing stateful path migrates only when exactly one indexed path ends with the full old path, target metadata wins on merge, and a `gallery_state.json.bak-*` backup is created before migration.
- Pillow decode work for metadata, dimensions, thumbnails, and color analysis goes through `py/gallery/image_safety.py`. `UNIVERSAL_EXTRACTOR_MAX_IMAGE_PIXELS` defaults to `160000000`; `0` or empty leaves Pillow's default untouched. Oversized images should stay listable while derived metadata fails softly with diagnostics.
- Variant fingerprints are rebuildable derived cache only: SHA-256 file hashes back exact duplicate groups, Pillow dHash backs near-duplicate groups, metadata hashes back same prompt/workflow groups, and filename sequence keys back series groups. They must not replace `gallery_state.json` user state.
- `list_images_page()` should query SQLite directly and avoid loading every image into Python.
- `get_gallery_context()` should use SQLite aggregates for source counts, Pin count, subfolders, `subfolder_details`, and move targets; do not reintroduce full image-index reads for context.
- `force_refresh=true` should prefer incremental index sync when the source signature is current, with full rebuild only as cold-start or repair fallback.
- `list_libraries()` should use the `library_summary_cache.json` count cache keyed by filename, file size, and `mtime_ns`; keep that runtime file ignored and included in `RUNTIME_STATE_FILENAMES` so it is not shown as a user library.
- Library entry/search endpoints should keep bounded response limits (`UNIVERSAL_EXTRACTOR_MAX_LIBRARY_ENTRY_LIMIT`, `UNIVERSAL_EXTRACTOR_MAX_LIBRARY_SEARCH_LIMIT`) and artist generation should not request an unbounded candidate pool.
- `/gallery/` serves `index.html` with `no-store`; hashed `/gallery/assets/*` files should keep long-lived immutable cache headers.
- `/gallery/` and `/gallery/assets/*` should keep the security headers defined in `py/gallery/routes.py`; do not add inline scripts without revisiting the CSP.
- `/universal_gallery/api/update-status` checks GitHub releases, caches successful responses in process for 30 minutes, and fails softly with an `error` field. Backend route changes require restarting ComfyUI.
- Folder API inputs may be source refs (`source_id::relative/path`). Keep write operations scoped to writable sources, and keep the default input source read-only unless the source config explicitly changes.

## Safety Notes

- Gallery file APIs must stay scoped to registered gallery sources and supported image extensions.
- Source configuration must validate paths, writable status, and import targets.
- Write operations and source settings need same-origin protection.
- Import APIs should keep file size, total request size, and file count limits.
- Import APIs should clean up files written earlier in the same multipart request if a later file fails a count or size limit.
- Trash preview, restore, and purge must resolve stored files through `resolve_trash_storage_path()` before touching the filesystem.
- Keep route-level security tests in `tests/test_gallery_routes.py` updated when API routes, import limits, same-origin guards, or `/gallery/assets/*` serving change.
