# 1.6.0 foundation candidate validation

Date: 2026-10-15. Branch: `codex/gallery-foundation`.

This is a locally installable candidate, not a published release. No real user image directory was modified by verification. Registered production source configuration was unavailable in this checkout; the user's growing SSD library has not been benchmarked or deployed here.

## Environment

- Windows 11 x64, build 26200; AMD Ryzen 9 7940HX, approximately 31 GiB usable RAM.
- Python 3.12.8, aiohttp 3.13.3, Pillow 12.1.1, SQLite 3.45.3.
- Node.js 24.15.0; installed Vite 8.1.0; Chromium 138 through Playwright.
- The documented D-drive ComfyUI Python installation is absent. Verification uses the installed PATH Python through the existing fallback.
- File tests and preview servers use temporary directories. SQL performance uses nominal 10,000/50,000 synthetic records plus 20 real, generated 64×48 PNG files; synthetic SQL results do not measure file traversal or full-resolution decoding.

## Verification commands

The final gate passed **144 Python tests, 209 frontend tests and 11 bridge tests**, plus compileall, TypeScript, lint, the 900-key i18n audit, npm audit (zero reported vulnerabilities), clean build, 23 dist asset references and consistent 1.6.0 metadata. The separate pinned-upstream suite passed **6/6** without skips. Python undefined-name inspection (`ruff --select F821`) also passed. A dedicated startup test verifies upload recovery completes before persisted jobs resume; recovered uploads invalidate derived snapshots. Reserved upload/move staging directories stay outside image/folder/freshness scans.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify.ps1
$env:LORA_MANAGER_SOURCE = (Resolve-Path artifacts/foundation-lora-manager).Path
node --test tests/comfy_lora_manager_upstream.test.mjs
python scripts/benchmark_gallery.py --output artifacts/foundation-after.json --compare artifacts/foundation-baseline.json
```

The full verification script runs Python tests, compileall, the 11 Node bridge tests, TypeScript, lint, i18n, frontend tests, npm security audit, clean production build, dist asset audit and release metadata checks. Baseline counts were 108 backend / 204 frontend / 11 bridge tests. No baseline test was removed or skipped. One external-move assertion was deliberately updated to the approved 1.6 policy: known asset state stays at the missing origin rather than following a suffix guess. Legacy paths never registered in the catalog still retain conservative backed-up recovery.

The fixed LoRA Manager source revision is `0a262cbe0c0a773c174e6b4570c44671d6e2b9a3`. All six integration cases execute the real upstream stacker/loader setter and debounce callbacks; independent CLIP=0, folding, append/replace and failure recovery remain covered by bridge checks. The test loader normalizes CRLF before extracting upstream functions on Windows. Upstream code is not vendored or modified.

New backend checks include exclusive staged publication, late-file/final-journal failures, cancellation/disconnect, startup upload recovery, one-save/no-op annotations, stable IDs and revisions, index rebuilds, file/JSON/catalog compensation, unresolved-log gates, source read failure, persistent bounded jobs, coalescing, cancellation, restart, retry classification, stale-result rejection, corrupt catalog degradation, missing authoritative tables, migration backups, shutdown ownership, immediate source-cache invalidation and traversal-free hot context. Frontend checks include resolving displayed jobs that leave the first job-list page.

## Reviewable delivery batches

The table identifies the main commits; subsequent corrective commits strengthen their final behavior. Verification references the final integrated code, not an invented test count for each historical commit.

| Batch | Main commit | Final behavior and validation | Boundary |
| --- | --- | --- | --- |
| 0 | `cfb341b` | Review and reproducible isolated baseline; original 108/204/11 test counts recorded | No real-library baseline available |
| 1 | `378e904` | Staged journaled uploads, one-save batch state, compatible dependency repairs; failure injection and security audit | No additional whole-file decode requirement |
| 2 | `60a249a` | Source/index/file/library/media domains behind the existing facade; legacy suite, compileall and name checks | Compatibility mapping remains for old integrations |
| 3 | `d7d0528` | Persistent UUIDs, revisions and image-provider contract; rebuild/copy/content-change tests | Images only; stat observation rather than startup hashing |
| 4 | `63edf42` | File/JSON/catalog compensation and trash identities; injected stage/publish/JSON/catalog faults | Recovery evidence, not cross-storage ACID |
| 5 | `a269f06` | Bounded lanes, durable jobs and validated API; blocked-analysis read, restart/cancel/retry/queue tests | Polling freshness remains; no directory watcher |
| 6 | `dbc5397`, `835c0f0` | Scoped queries, refresh, batch operations, selection commands, cancellable variants and persistent status | Existing masonry/organizer layout retained |
| 7 | Candidate metadata/docs/dist commit | Full verification, browser checks, benchmarks and complete rebuilt dist | No automatic push, deployment or publication |

`c6bb06f` adds committed folder snapshots and covering indexes; `4d33870` validates catalog integrity and bounds query snapshots; `b093985` resolves tracked jobs beyond the first status page. User JSON remains the sole annotation/board authority throughout.

## Browser regression

All browser checks use `scripts/preview.py`, committed production dist and disposable procedural images. They do not run ComfyUI inference.

| Script | Scope |
| --- | --- |
| `browser_smoke.py` | Desktop/mobile overflow, menus, search, view mode, workspace navigation, detail and sidebar |
| `browser_qol.py` | Four locale/viewport cases, unsaved source guard, workbench drafts, filters, organizer and variants |
| `browser_selection.py` | 1568/1100/390px pointer selection, scrolling, Inspector reservation and menu hit testing |
| `browser_optimization_smoke.py` | Lazy chunks, inactive gallery request gating, density preferences, disabled prefetch and blocked storage |
| `browser_p0.py` | Pending metadata/save drafts, navigation guards, failed deletes and partial move selection |
| `browser_p12.py` | Ten scenarios: source/search races, history guards, detail scopes, awaited refresh, live additions, density and temporary import |
| `browser_masonry.py` | 48 cards, varied heights, mobile/desktop lanes, bottom scrolling and resizing without card loss/overlap |
| `browser_rc2.py` | Eight bilingual first-run tours / 88 steps, focus, keyboard, mobile and reduced motion |
| `browser_lora_stack_channel.py` | Stale protocol rejected; compatible append/replace target one acknowledged receiver |

Browser checks reported no uncaught page errors on successful runs. The P0 harness now ignores only route callbacks left during page teardown; scenario assertions are unchanged. The live-refresh test explicitly requests three columns so its 18-image fixture actually overflows with today's six-column default. After the final hook extraction, P1/P2 and real-pointer selection were rerun against the rebuilt dist.

## Performance method and results

Baseline code: `cfb341b`, before the functional refactor. Each hot-query measurement warms five times and samples thirty times. New hot queries use the same query-only and source-snapshot context as HTTP read workers; these are service timings, excluding network, HTTP queue and browser rendering. Baseline uses the old service entry points without HTTP overhead. The same machine, fixture sizes and SQLite workload are used.

Raw reports are stored under [benchmarks](benchmarks/). The list/context P95 gate is at most 120% of the fixed baseline. Source-filtered page 10 / filename sorting and blocked-analysis samples are additional current-version checks. The artificial analysis barrier stays blocked until all query samples finish; a separate async test verifies the actual read executor completes before that barrier is released.

| Nominal records / query | Baseline P50 / P95 ms | Candidate P50 / P95 ms | P95 ratio | Gate |
| --- | --- | --- | --- | --- |
| 10000 / list | 22.48 / 29.43 | 12.77 / 20.74 | 0.705 | PASS |
| 10000 / context | 56.14 / 65.96 | 20.53 / 27.19 | 0.412 | PASS |
| 50000 / list | 38.56 / 46.32 | 34.09 / 48.11 | 1.039 | PASS |
| 50000 / context | 91.72 / 102.95 | 85.89 / 111.55 | 1.084 | PASS |

All four fixed hot-query gates passed. The largest candidate/baseline P95 ratio is 1.084, below 1.200.

| Additional check | Baseline P50 / P95 ms | Candidate P50 / P95 ms |
| --- | --- | --- |
| Freshness, 20 PNGs | 9.86 / 15.91 | 22.61 / 29.98 |
| Batch notes, 20 PNGs | 467.42 / 662.19 | 78.68 / 94.88 |
| Physical traversal/stat, 20 PNGs | Not recorded | 8.23 / 12.29 |
| 50000 list with analysis blocked | Not recorded | 39.32 / 48.77 |
| 10000 source-filtered page 10, filename sort | Not recorded | 20.10 / 24.41 |
| 50000 source-filtered page 10, filename sort | Not recorded | 72.77 / 86.95 |

Cold startup of the 20-PNG fixture was a **single sample**, 65.31 ms before and 334.27 ms after. It includes schema/catalog creation and first identity registration; no cold-start P95 is claimed. The candidate cold sample and freshness sample were slower, and are reported rather than hidden behind hot-query results.

The physical traversal sample was collected separately with the same isolated fixture/code/environment; this is explicit in the raw report. The repeatable benchmark command now records it directly. No synthetic-index result is presented as a real-library scan.

Raw reports: [baseline](benchmarks/foundation-1.6.0-baseline.json), [candidate](benchmarks/foundation-1.6.0-after.json).

## Deployment and remaining limits

- No automatic publication, Git push, Registry action or production deployment was performed.
- Real 10+ GB source scans, long-duration workloads, OS/filesystem combinations beyond this machine and a running ComfyUI/GPU session remain unmeasured. Browser protocol receivers are controlled same-origin fixtures; the pinned upstream integration is a separate real-code test.
- Cold startup includes first catalog registration and is slower than the old small-sample startup; hot-query improvement is not a claim that every upgrade operation is faster.
- Same-volume upload publication currently requires hard-link support. Unsupported target filesystems fail safely; they do not use an overwrite-prone rename fallback.
- External changes are detected by size and nanosecond mtime, without a full-library hash on startup. A modification deliberately preserving both size and mtime cannot be distinguished by this observation policy.
- JSON annotations/boards remain authoritative. The catalog is independently authoritative for identities/jobs; never delete it as an index repair. Preserve unresolved file/upload logs and consult the [recovery guide](foundation-1.6.0.zh-CN.md).
- Video/audio, semantic image search, whole-library reverse-image search, prompt versioning and external project entry management remain follow-up work.

Current README, frontend README, AGENTS and architecture contracts were reconciled with the code. The architecture review, 1.3.x RC upgrade/validation documents and 1.2.10 maintenance notes remain explicitly historical. No global agent memory or unrelated project files were changed.
