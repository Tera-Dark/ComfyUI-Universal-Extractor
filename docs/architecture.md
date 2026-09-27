# Gallery architecture and contracts

The baseline architecture below remains relevant, except for these release changes:

- `py/gallery/execution.py`: bounded serialized service worker; request cancellation does not abort writes.
- `py/gallery/file_transactions.py`: stage/transfer/state commit, durable recovery evidence, conservative rollback; not cross-filesystem ACID.
- `py/gallery/similarity.py`: exact-radius candidate generation using disjoint Hamming bands.
- `py/nodes/prompt_snapshot.py`: optional resolved-text PNG metadata pass-through.
- `gallery_ui/src/components/shared/DisclosureMenu.tsx`: accessible native disclosure for progressive actions.
- `gallery_ui/src/styles/minimal.css`: isolated visual tokens and workspace restyling.
- `UNIVERSAL_EXTRACTOR_DATA_DIR`: opt-in external data root, no automatic migration.
- Release builds now clean dist and validate Vite manifest; old hash names are never rewritten. `sync-dist` is a non-mutating compatibility alias for the audit.
- `scripts/check_release.py` is the portable metadata checker; PowerShell delegates to it.

See the RC upgrade guide for supported transactions, limitations, and platform validation status.

---

# Universal Gallery Architecture

This document summarizes the runtime architecture that matters for future backend and frontend work.

## Request Flow

- ComfyUI serves the committed frontend bundle from `gallery_ui/dist/` at `/gallery/`.
- `/gallery/` serves `index.html` with `Cache-Control: no-store`; hashed files under `/gallery/assets/*` are served with long-lived immutable cache headers so unchanged chunks can be reused by the browser.
- Gallery API routes live under `/universal_gallery/api/` in `py/gallery/routes.py`.
- Gallery behavior is exposed through the compatibility facade in `py/gallery/service.py`. Low-risk helper domains now live beside it: `refs.py` owns source/image/folder ref normalization, `source_security.py` owns source path hardening and scope checks, `metadata.py` owns Pillow metadata reads, `recipe.py` owns structured Comfy prompt recipe extraction, `update_checker.py` owns GitHub release update status, and `state_store.py` owns persisted image state and boards.
- File APIs must stay scoped to registered gallery sources and supported image extensions.
- Route-level safety is covered by `tests/test_gallery_routes.py`: API handlers must reject cross-origin `Origin`, `Referer`, or `Sec-Fetch-Site` requests, import endpoints must enforce configured size/count limits with 413 responses, and `/gallery/assets/*` must not serve files outside the committed dist assets directory.
- `/gallery/` and `/gallery/assets/*` responses carry browser hardening headers through `py/gallery/routes.py`, including `nosniff` and a same-origin CSP compatible with the React app's dynamic inline styles.

## Update Status Flow

`/universal_gallery/api/update-status` reports whether the installed plugin is behind the latest stable GitHub release for `Tera-Dark/ComfyUI-Universal-Extractor`. `py/gallery/update_checker.py` reads the local version from `pyproject.toml`, fetches up to five GitHub Releases, ignores drafts and prereleases, compares semantic version parts, and returns `current_version`, `latest_version`, `update_available`, release links, changelog bodies, `checked_at`, and a soft `error` string. If the installed version has a `CHANGELOG.md` section and GitHub has not published that release body yet, the checker uses the local section as the release note fallback; if the installed version is newer than GitHub's latest stable release, it is reported as the latest version rather than showing a false downgrade.

The checker keeps a process-local cache for 30 minutes. Normal topbar loads call the route without `force`; the update popover's manual recheck uses `force=true`. Network, GitHub, timeout, and malformed-response failures should not break the Gallery: the route returns the cached status with an `error` when possible, or a no-update fallback if no cache exists.

Because Gallery routes are registered during ComfyUI startup, adding or changing `/universal_gallery/api/update-status` requires a ComfyUI restart before the running server exposes the route. A frontend-only rebuild is not enough for backend route changes.

## Startup Diagnostics

`/universal_gallery/api/context` and `/universal_gallery/api/images` are first-screen routes and should fail soft for index/source startup problems. If source loading, SQLite initialization, or index refresh raises unexpectedly, `py/gallery/routes.py` logs the traceback server-side and returns a shape-compatible fallback payload with `index_error` and source `diagnostics` instead of a bare 500. The frontend surfaces `index_error` through the normal gallery inline error state while still allowing the user to open Settings and inspect source diagnostics.

## Gallery Index Data Model

Runtime gallery data is stored under `data/`. User state remains JSON-backed, while image listing uses SQLite:

- `gallery_state.json`: editable image state, categories, pins, notes, and boards.
- `gallery_state.json.bak-*`: timestamped backups created before automatic state recovery migrations.
- `gallery_sources.json`: configured gallery sources.
- `gallery_index.sqlite3`: derived image index.
- `library_summary_cache.json`: derived prompt-library counts keyed by filename, file size, and `mtime_ns`; it is runtime state, not a user library.
- `thumb_cache/`: generated thumbnails.
- `trash/`: plugin-managed trash storage.

`gallery_index.sqlite3` uses `PRAGMA user_version` for internal schema migration, opens in WAL mode with a configurable busy timeout, and keeps schema changes auditable through `gallery_schema_migrations`. The SQLite file is a rebuildable derived cache: if the main database header or initialization reports corruption, the index and any `-wal`/`-shm` side files are moved aside with `.corrupt-*` suffixes and rebuilt from registered sources plus `gallery_state.json`.

The important tables are:

- `gallery_images`: primary image index keyed by `relative_path`; stores source, folder, file size, real image width/height, created/modified timestamps, baked state fields, and color profile fields.
- `gallery_index_meta`: source signature, built timestamp, color index version, state digest, auxiliary-table version, and FTS availability.
- `gallery_schema_migrations`: append-only migration audit rows recording schema version bumps.
- `gallery_images_fts`: FTS5 search table for filename/path/title/category/notes text. If FTS5 is unavailable, search falls back to the existing LIKE expression.
- `gallery_image_color_family`: normalized color-family rows used by color filtering, while legacy color fields remain in `gallery_images` for response compatibility.
- `gallery_image_fingerprints`: local-only derived fingerprints used by variant organization. It stores file hashes, lightweight visual dHash values, prompt/workflow metadata hashes, filename sequence keys, and soft-failure diagnostics keyed by `relative_path`.

The index has composite indexes for common list views: source plus folder plus creation time, pinned plus creation time, category plus creation time, color family plus creation time, filename, and size.

## Loading And Sync Strategy

Normal image listing uses `list_images_page()`, which queries SQLite directly with pagination. It does not need to load the whole image index into Python.

The first gallery load should use the existing SQLite index without `force_refresh=true`. Forced image refresh is reserved for user-triggered refreshes and freshness-detected changes, where the backend can prefer incremental sync over a full rebuild.

Automatic gallery sync is a two-step flow:

1. The frontend calls `/universal_gallery/api/images/freshness` for the current folder/source view while the page is visible.
2. If the fingerprint changed, the frontend calls `/api/images?force_refresh=true`; the backend performs incremental index sync when the existing DB signature is current.

Incremental sync scans only the affected scope, upserts new or modified files, deletes missing files, and queues only changed paths for color backfill. Full rebuild remains the cold-start and repair fallback.

`get_gallery_context()` avoids full image reads. It derives source counts, pinned count, subfolders, and move targets from SQLite aggregates plus lightweight directory discovery. Its forced refresh runs the index sync once; board summaries reuse the resulting database. `list_boards()` selects only actual indexed board members, ordered by creation time for automatic covers, rather than building a potentially over-limit `IN` query for every pinned/note state path.

The freshness endpoint still stats in-scope image files (file-in-place edits must be detectable); it now hashes in deterministic directory order without retaining the entire image record list. The in-process cache retains the 32 most recently visited scopes. Disabling live gallery refresh from Settings is appropriate for exceptionally large or slow network-mounted sources.

`list_libraries()` does not parse every prompt-library JSON file on each request. It uses `library_summary_cache.json` for list counts when filename, file size, and `mtime_ns` match, then invalidates the affected summary when a library is imported, saved, deleted, or otherwise invalidated through the service facade.

Library page and artist-search routes clamp client-requested limits so large JSON libraries cannot produce unbounded responses. Import routes stream multipart files, enforce per-file, total-size, and count limits, and remove files written earlier in the same request if a later part fails a limit check.

`GalleryContext.subfolders` keeps the legacy string list for API compatibility. `GalleryContext.subfolder_details` adds source id, relative path, and directory modified time for frontend source-scoped folder trees and default modified-time sorting.

## State And Color Indexing

Editable image state remains persisted in `gallery_state.json`. The state store serializes load-modify-save operations through a module-level lock and writes JSON atomically by replacing a same-directory temporary file, so interrupted writes do not leave partial JSON. The SQLite index caches those fields for fast list queries, but `_sync_image_state_to_index_db()` first compares `gallery_state_mtime` and `gallery_state_digest`; unchanged state skips DB writes. When the state file does change, the service compares indexed fields for all affected paths in batches of at most 900 bind parameters, updates only differing rows and rebuilds FTS/color helpers only for those rows. Removed state paths clear prior indexed fields. `py/gallery/sqlite_batch.py` is shared with variant fingerprint queries and prewarming, so those queries remain portable to bundled SQLite builds with a 999-parameter limit.

Pin and board state is path-keyed, but refresh/build paths run a conservative recovery pass after current `gallery_images` rows exist. If a stateful path is no longer indexed and exactly one current image path ends with the full old path, the state is migrated and merged into the current path, with target metadata preserved and a `gallery_state.json.bak-*` backup created first. Basename-only or ambiguous matches are skipped.

Color indexing is intentionally asynchronous:

- Base file rows are available before pixel analysis completes.
- Current page paths are prioritized for color backfill.
- Failed or unreadable images are marked with a fallback color profile so the background worker does not loop forever.
- `/universal_gallery/api/color-index/status` reports backfill progress.

Image dimensions are indexed separately from thumbnails. New or changed files read their real Pillow dimensions during full or incremental index sync, and older rows with missing dimensions are filled by a low-priority background pass. List responses expose optional `width` and `height` values; missing dimensions must not block image listing or force the frontend to use thumbnail `naturalWidth`/`naturalHeight`.

Pillow decoding is centralized through `py/gallery/image_safety.py`. By default it sets `Image.MAX_IMAGE_PIXELS` from `UNIVERSAL_EXTRACTOR_MAX_IMAGE_PIXELS=160000000`; setting the variable to `0` or an empty value leaves Pillow's default untouched. `DecompressionBombWarning` is treated as an error for metadata, dimensions, color analysis, and thumbnail generation. Oversized files remain valid gallery entries, while derived data fails softly and records a diagnostic instead of crashing index or prewarm workers.

Variant organization is a derived cache over the same image index. `/api/images/variant-groups` applies the current Gallery view filters, computes missing fingerprints for a bounded batch, and groups images as exact duplicates, near duplicates, same prompt, same workflow, or filename series. `/api/images/variant-group` returns the images inside a selected group using the normal `ImageRecord` shape, while `/api/images/fingerprints/prewarm` and `/api/images/fingerprints/status` let the UI analyze more images and display progress. Fingerprints are rebuildable and must not become the source of truth for user state.

## Frontend Contract

The public response shapes for `ImageListResponse` and `GalleryContext` are preserved. Frontend code should keep using `galleryApi.listImages`, `galleryApi.getContext`, and `galleryApi.getImageFreshness` rather than reaching into backend implementation details.

Large frontend surfaces are split along stable helper boundaries. `WorkspaceSidebar` imports folder-scope and sorting helpers from `components/shared/folderTree.ts`, while `GalleryWorkspace` delegates image prefetch state and card image loading to `components/gallery/galleryImagePrefetch.ts` and `GalleryCardImage.tsx`, selection math to `components/gallery/gallerySelectionModel.ts`, and dual-folder selection/drag/shortcut rules to `components/gallery/dualFolderModel.ts`. These modules are implementation details; UI behavior and public API calls remain unchanged.

First-screen loading is intentionally gallery-first. `GalleryWorkspace` and its ordinary grid stay statically imported, while `LibraryWorkspace`, `WorkbenchWorkspace`, `SettingsWorkspace`, `ImageDetailModal`, and optional Gallery surfaces (dual-folder organizer, variant groups, board sharing, metadata viewer) use `React.lazy`/`Suspense` on demand. `useLibraryData` remains disabled until `library` or `workbench` is active; `useGalleryData` still fetches context for shared navigation but defers image-list requests on those tabs. Browse-scope changes abort obsolete read requests via `AbortSignal`, while backend file mutations remain shielded and must never be canceled halfway through. Disabling image prefetch in Settings also disables optional thumbnail prewarming, not just IntersectionObserver prefetch. Preference reads/writes use `utils/safeStorage.ts` so blocked browser storage does not crash navigation; `hooks/useUiPreferences.ts` owns the typed App preference snapshot and persists outside state updaters.

The update bell lives in `TopNavigation` beside the refresh action. It should remain a compact icon button with a red dot only when `UpdateStatus.update_available` is true. The popover uses the shared floating layer placement and dismiss helpers, displays current/latest versions plus release notes, and treats `UpdateStatus.error` as a non-blocking diagnostic rather than a full-screen failure.

`WorkbenchWorkspace` is a lazy-loaded creative-tool console rather than a Gallery-internal mode. Its frontend contract is visual and organizational: a status strip summarizes active tool/library/queue state, the left rail chooses tools, and the stage hosts the active tool with a staged generator flow plus queue/source panels. At medium desktop widths the generator must stay wide and supporting panels stack below it before the whole workspace collapses to a single column on mobile. Adding future workbench utilities should extend this rail/stage model without changing Gallery first-load data fetching.

Shared interaction primitives live in `gallery_ui/src/utils/interaction.ts`. Context menus in gallery, dual-folder, sidebar, and library surfaces should use the shared placement and dismiss helpers so menus stay near their trigger, flip inside the viewport, and close consistently on Escape, outside click, resize, or scroll. Keyboard shortcuts should use the shared editable-target guard so input fields and folder searches keep normal text-editing behavior.

First-run onboarding is owned by `gallery_ui/src/components/shared/OnboardingTour.tsx`. It is a frontend-only overlay that highlights real UI anchors through `data-tour-id`, may request tab changes through `App.tsx`, and stores completion in localStorage under `universal-extractor:onboarding-tour-v1-completed`. Skipping and finishing both mark the tour complete; the Settings restart button opens the tour for the current session without clearing or mixing that state into `UiPreferences`.

The main gallery grid is rendered through the `useVirtualMasonry` helper, backed by `@tanstack/react-virtual`. The right Inspector is a fixed overlay with **reserved viewport space**: desktop layouts add 320px of right margin to the main gallery scroll container, while layouts at or below 960px reserve 32dvh below it. Opening and closing it intentionally changes the available grid width (and may reflow the effective masonry column count), but must preserve page, selected paths and the user's browsing position; the newly sized virtual grid must be remeasured. It must not obscure cards or the bottom pagination. Box selection in the virtual grid must not depend only on mounted DOM cards: it should freeze the drag-start layout, use estimated rectangles for offscreen masonry items, compensate scroll delta while dragging, and auto-scroll near the main scroll container edges.

Normal gallery list view is also card-based rather than a plain table. At desktop widths of 1240px and above, it lays out two compact list cards per row; below that it returns to one column. Each list card keeps the same image actions and selection behavior as grid cards, uses a larger thumbnail, shows a local timestamp with seconds, and displays real image dimensions when the backend provides `width` and `height`.

Variant organization is a Gallery-internal workspace, not a top-level tab. `GalleryToolbar` toggles it from the action group, `VariantGroupsView` renders group cards and type filters, and selected groups reuse normal gallery cards, selection, context menus, board actions, move, delete-to-trash, metadata, and workflow-send behavior. The view may trigger fingerprint prewarm, but it must not change ordinary first-load behavior or fetch prompt libraries.

Dual-folder organization lives in `DualFolderWorkspace`. It is a frontend-only file-management surface over the existing image APIs: folder panes call `galleryApi.listImages`, internal drags use a private `application/x-universal-gallery-image` payload, moves use the existing `/api/images/move` wrapper, and delete/state/board actions reuse the same callbacks as normal gallery selection. It must keep external file drops separate from internal image drags so imports continue to receive the browser-provided `File` objects unchanged. Dual-folder cards should mirror normal-gallery interaction polish: clipped text, real-resolution chips when dimensions are available, hover lift, image scale, and stable selected/focused/drop states.

Switching into dual-folder mode unmounts the normal virtual masonry grid. Switching back must remeasure the newly mounted `.ue-gallery-grid--virtual` before normal gallery layout resumes: `GalleryWorkspace` clears stale `gridWidth` while dual-folder mode is active and reattaches `ResizeObserver` measurement when `dualFolderMode` or `galleryViewMode` changes. This prevents old grid widths from carrying over into the normal gallery and causing clipped or shifted columns.

When the gallery is on page 1 sorted by newest first, live sync may replace the list automatically. In other views, the frontend shows a pending-refresh pill so browsing position is not interrupted.

Sidebar source shortcuts use folder refs as scopes. `default_output::` means the output source root, `default_input::` means the input source root, and `source_id::relative/path` targets a folder inside a registered source. The empty string is only a compatibility fallback and should not be used as the normal output shortcut.

The folder panel should render only the active source tree. Pinned folders sort first, then folders sort by modified time descending unless the user switches to name sorting. For sibling folders with valid date-like names (`YYYY-MM-DD`, `YYYY.MM.DD`, or `YYYY_MM_DD`), the embedded date sorts ahead of raw directory mtime so generated date folders stay chronologically stable even after later file writes. Legacy pinned output paths without the `default_output::` prefix should still be treated as aliases for their canonical source refs.

Trash grid mode is presentation-only and remains backed by `/api/trash`. It uses a responsive masonry-style card layout, keeps restore/purge actions local to the trash page, and clips long names and original paths inside the card bounds.

Trash storage paths are resolved through `resolve_trash_storage_path()` in `py/gallery/service.py` before preview, restore, or purge. The helper keeps all operations inside `data/trash/`, even if runtime trash state is corrupted.

## Image Recipe Contract

`/universal_gallery/api/metadata` returns the embedded metadata and workflow as before, plus a derived `recipe` object from `py/gallery/recipe.py`. The recipe is intentionally local and best-effort: it reads Comfy prompt graphs when present and extracts positive/negative prompt text, checkpoint name, LoRA names and strengths, latent dimensions, seed, steps, CFG, sampler, scheduler, denoise, and whether a workflow payload exists. It also exposes `recipe.lora_manager` when ComfyUI-Lora-Manager nodes such as `Lora Loader (LoraManager)` or `Lora堆` are detected, including a normalized LoRA stack for one-click application. Missing or non-Comfy metadata should produce empty fields rather than errors.

Future integrations, including one-click recipe application through external LoRA tooling, should consume this structured `recipe` contract instead of scraping raw metadata or adding more graph heuristics to `metadata.py`. UI flows may still display the legacy `summary` field for compatibility; `recipe` is the cleaner handoff shape for automation.

## ComfyUI Workflow Handoff

The image detail action for opening a workflow in ComfyUI is a same-origin handoff, not a window-creation path. `gallery_ui/src/App.tsx` asks for confirmation, wraps the send in the global operation status center, then sends a `universal-extractor:workflow-probe` over the `universal-extractor-workflow` `BroadcastChannel`. `web/comfyui/top_menu_extension.js` responds with an `instanceId`, visibility state, and focus state. The gallery then sends one targeted `universal-extractor:workflow-message` to a single acknowledged ComfyUI instance and waits for `universal-extractor:workflow-delivered`.

LoRA Manager stack application uses the same probe/target channel but sends `universal-extractor:lora-stack-message` and awaits `universal-extractor:lora-stack-delivered` from the **selected** instance, including a target/count summary or an error. The shared right-click/detail confirmation reads the image recipe first and offers three choices: append, replace, or cancel. The ComfyUI bridge writes to **one** existing compatible node in the current graph, preferring a selected node, otherwise the first compatible graph node. Only active LoRAs from the image are sent. `mode: "append"` retains existing entries (including disabled/locked state and unrelated text), updates same-name LoRAs, and adds new names without duplicates; `mode: "replace"` removes only the target node's old LoRAs and preserves non-LoRA text; the bridge does not directly rewrite other graph nodes. Native LoRA Manager callbacks may still synchronize connected trigger-word nodes as part of its normal behavior. Incoming entries use explicit `expanded: false` so CLIP controls start collapsed even when CLIP and model weights differ; the independent value, including zero, is preserved. The confirmation warns that editing model strength while collapsed in upstream LoRA Manager subsequently synchronizes CLIP. Writes call the third-party widget callbacks, wait for their asynchronous list/text sync, verify the resulting list, and report failure instead of premature success; widget/property snapshots permit best-effort rollback on a callback error. The target node and canvas are marked dirty after a change.

The gallery must not call `window.open()` as a fallback for workflow handoff. If no refreshed ComfyUI page responds, the gallery stores the payload under `universal-extractor:pending-workflow` and shows a refresh/retry error so the user can refresh an existing ComfyUI tab. This avoids one click opening multiple ComfyUI tabs or broadcasting the same workflow into every open ComfyUI page.

## ComfyUI Nodes

Node registration starts in the repository root `__init__.py`, which loads classes from `py/nodes/extractor_node.py` through `py/plugin.py`. The only registered generation node is `UniversalJsonSegmentRandomizer`, displayed in ComfyUI as `Universal Artist/Tag Randomizer`.

`UniversalJsonSegmentRandomizer` reads the same `data/` libraries but resolves explicit field paths such as `name`, `other_names`, `meta.style`, or `tags.*`, flattens nested string/number values, optionally filters entries by another field path, and returns both the joined prompt string and a JSON string of selected segments. It supports `random`, `polling`, and `sequential` selection; duplicate policy control; and direct output formats for Anima artist strings, `artist:name`, weighted artist prompts, NAI-style weights, generic tag strings, and custom templates. Polling state is process-local and keyed by node id, library filename, field paths, filters, pool size/content hash, and seed, so separate nodes or changed libraries do not share offsets; restarting ComfyUI resets polling back to the seed-derived offset. Node file access is constrained to plain `.json` filenames in `data/` and excludes runtime state files listed in `RUNTIME_STATE_FILENAMES`.

## Release Guardrails

`scripts/verify.ps1` remains the preferred full local check. It runs Python tests, backend compileall, Node bridge tests, frontend typecheck/lint/i18n/tests/security audit/build, dist asset audit, and release metadata checks. `scripts/check-release.ps1` checks that `pyproject.toml`, `gallery_ui/package.json`, and `package-lock.json` versions agree and built assets referenced by `index.html` exist. Clean builds remove previous hashed files; do not rewrite old hashes with new content. Release versions should also add a matching `## x.y.z` section in `CHANGELOG.md` so the update popover can display local notes before or without a populated GitHub Release body.

The manual Comfy registry workflow reads the package version, checks the registry for an existing active version, and skips the publish action with a notice when the version is already present. Real publish failures should still fail the workflow.

The production frontend does not use the default Vite/React starter assets, so `gallery_ui/src/assets/hero.png`, `react.svg`, and `vite.svg` should stay absent unless a real UI surface references replacement assets.

Browse URLs encode the stable workspace tab and gallery source/board, search, filters, sort and page, plus the selected prompt library when that workspace is active. Meaningful scope changes push browser history; typing a query debounces the API request and replaces (rather than appends) its current history entry. `popstate` restores the encoded scope after running the same dirty-library, dirty-source-settings and image-detail leave guards as workspace navigation. A cancelled navigation restores the previous URL without discarding the draft. Detail image links, transient dual-pane folders and variant group analyses are intentionally **not** deep links: they require their own independently validated loading/permission semantics and are never reconstructed from untrusted query strings. Detail navigation and the batch Inspector use the visible page, variant group, or loaded dual-pane records, not the unrelated first gallery page.

Explicit gallery refresh waits for both context and image/trash requests to finish before marking its operation complete; a superseding view change reports an interrupted request. Live freshness replaces the newest first page only while the scroll viewport is near its top, otherwise it offers the existing pending-update pill. At mobile widths (up to 560px) grid density is an independent, persistent comfortable single-column or compact two-column choice, subject to the actual available width; the density popover shows the effective column count. The workflow-send confirmation is always required for safety; there is no `confirmWorkflowSend` UI preference.
