# Historical maintenance notes (1.2.10)

These notes describe the upstream baseline, not the current RC build contract.

## Maintenance notes

- Full local verification is `powershell -ExecutionPolicy Bypass -File scripts\verify.ps1`; it now includes Python tests, compileall, frontend typecheck/lint/tests/security audit/build, dist asset audit, and release metadata checks.
- Release version metadata is kept in sync across `pyproject.toml`, `gallery_ui/package.json`, and `gallery_ui/package-lock.json`; each release should also add its user-visible notes to `CHANGELOG.md`.
- The Gallery backend keeps `py/gallery/service.py` as the route-facing facade, with source refs, source path hardening, metadata reading, and image recipe extraction split into `py/gallery/refs.py`, `py/gallery/source_security.py`, `py/gallery/metadata.py`, and `py/gallery/recipe.py`.
- The frontend sidebar folder logic lives in `gallery_ui/src/components/shared/folderTree.ts`; gallery image prefetch/card loading lives in `gallery_ui/src/components/gallery/galleryImagePrefetch.ts` and `GalleryCardImage.tsx`.
- Shared frontend menu placement, dismiss handling, and shortcut editable-target guards live in `gallery_ui/src/utils/interaction.ts`.
- The top-right update bell reads `/universal_gallery/api/update-status`, which checks GitHub Releases for `Tera-Dark/ComfyUI-Universal-Extractor`, falls back to the local `CHANGELOG.md` entry for the installed version, caches status for 30 minutes, and returns soft errors without blocking the Gallery.
- Gallery first-screen routes (`/api/context` and `/api/images`) return a diagnostic fallback with `index_error` instead of a bare 500 when source or SQLite index startup fails, so Settings remains reachable for troubleshooting.
- Default folder ordering is pinned folders first, then modified time descending; generated date-named folders with valid `YYYY-MM-DD`, `YYYY.MM.DD`, or `YYYY_MM_DD` names sort by the embedded date before directory mtime so later file writes do not scramble date sequences.
- Gallery first screen is optimized to avoid external font requests, `/api/libraries`, and initial `force_refresh=true`; non-gallery workspaces and image detail are lazy-loaded chunks.
- First-run onboarding is browser-local state in `gallery_ui/src/components/shared/OnboardingTour.tsx` and `onboardingTourModel.ts`; completing or skipping the tour writes `universal-extractor:onboarding-tour-v1-completed`, and Settings can restart the tour without changing `UiPreferences`.
- Dual-folder organizer toggling remounts the normal virtual masonry grid; `GalleryWorkspace` must reset stale grid measurements and reobserve the new `.ue-gallery-grid--virtual` when returning to normal gallery layout.
- Runtime prompt-library counts are cached in `data/library_summary_cache.json`, which is ignored and excluded from user-visible JSON libraries.
- Gallery image state in `data/gallery_state.json` is written atomically and guarded by a backend lock. During index refresh/build, missing pinned or board state can recover to a moved image only when one current indexed path uniquely ends with the old full path; recovery creates `gallery_state.json.bak-*` first.
- Pillow image decoding is guarded by `UNIVERSAL_EXTRACTOR_MAX_IMAGE_PIXELS` (default `160000000`). Empty or `0` keeps Pillow's default. Oversized images can still appear as gallery files, but dimensions, thumbnails, metadata, and color derivation fail softly with diagnostics.
- Variant organization uses local-only derived fingerprints in SQLite (`gallery_image_fingerprints`): SHA-256 file hashes for exact duplicates, Pillow dHash for near matches, metadata hashes for same prompt/workflow groups, and filename sequence keys. No image or prompt data is uploaded.
- Gallery API route tests cover same-origin rejection, import size/count limits, library import limits, and static asset path traversal. Keep new route changes covered at `tests/test_gallery_routes.py`.
- Trash restore, purge, and preview all resolve stored trash files through the same trash-root containment check, so a corrupted `trash_state.json` cannot point operations outside `data/trash/`.
- Image/library import requests clean up files written earlier in the same request if a later file exceeds count or size limits.
- Library entry and artist-search routes clamp requested limits (`UNIVERSAL_EXTRACTOR_MAX_LIBRARY_ENTRY_LIMIT`, default `500`; `UNIVERSAL_EXTRACTOR_MAX_LIBRARY_SEARCH_LIMIT`, default `200`) to avoid accidental giant responses. Artist-string generation samples from a bounded candidate pool.
- `/gallery/` and hashed `/gallery/assets/*` responses include basic browser hardening headers, including `X-Content-Type-Options: nosniff` and a same-origin CSP.
- The starter Vite/React assets under `gallery_ui/src/assets/` were removed because the production Gallery UI does not reference them.
- `npm outdated` was recorded during the 2026-05-22 hardening pass. Patch/minor updates exist for Tailwind/Vite/Vitest/React/lucide and related tooling, while ESLint 10 and Node types 25 are major-line updates; dependency upgrades were intentionally deferred to a separate focused pass.
