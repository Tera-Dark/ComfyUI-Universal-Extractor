# Changelog

## 1.8.1 - 2026-10-24

### 图库同步与效率
- 合并此前本地 1.8.0 的性能改进：一次遍历收集图片和目录，仅登记变化的资源身份，按索引 rowid 局部更新全文检索。
- 后端发现 API 客户端的工作流完成记录，按输出范围合并同步；新完成事件不会被更早的扫描吞掉。
- 刷新等待和状态中心共用任务变化通知，减少重复轮询与多余提示；未变化的卡片、目录和移动目标保持引用。
- 修复新版 Pillow 颜色像素解析，合并后台分析排队，避免无用的尺寸任务。

### 统一工作区体验
- 以图库的浅色工具界面为基准统一字体、表面、控件和弹层；保留深色沉浸看图及语义状态色。
- 词库改为标题、搜索与操作、条目的内容优先布局；统计和教程按需展开，区分空词库与搜索无结果。
- 工作台恢复 1320px 下的宽生成区，高级配方折叠并显示生效摘要，画师池明确区分加入预选和已加入。
- 设置侧栏提供对应导航，不再将未请求的词库误显示为空。

### 弹窗与样式可靠性
- 通用按钮和设计变量不再依赖设置页加载；Metadata 可从右键菜单独立打开，无需先进入图片详情。
- 普通弹窗共用焦点、键盘和返回逻辑；确认框始终位于上层，词条草稿关闭前检查未保存修改。
- 保留图库布局、选择、文件事务、自动同步和 ComfyUI/LoRA Manager 集成。

### 升级说明
- 安装前停止 ComfyUI，备份 data 和未解决的操作日志，再完整替换代码与 dist，重启并刷新 ComfyUI 和图库。
- 保留用户 JSON、词库和目录库身份；派生索引升级到 schema 11。不要用包内默认数据覆盖用户 data，不要删除 catalog.sqlite3 或恢复证据。
- GitHub 发布与 Registry 审核状态分别核验；上传成功不代表 Manager 已可更新。

### 已知限制
- 加载图片时仍可能出现轻微视觉抖动，尚未彻底消除；本版不增加搜索模型或视频音频支持。

### Gallery synchronization and performance
- Includes the previously local 1.8.0 improvements: collect images and folders in one traversal, register only changed identities, and update full-text rows through indexed row IDs.
- Discover API workflow completions on the backend and coalesce output scopes; an older scan cannot acknowledge newer output.
- Share task-change notifications between refresh waiters and the status center, reducing duplicate polling/messages while preserving unchanged cards, folders and move targets.
- Fix modern Pillow color pixel extraction, coalesce background analysis and avoid unnecessary dimension jobs.

### Consistent workspaces
- Align light workspace surfaces, typography, controls and overlays with Gallery; retain dark image viewing and semantic status colors.
- Put library search, actions and entries first; keep overview/help optional and distinguish empty libraries from unmatched searches.
- Restore the wide generator below 1320px, disclose active advanced recipe options, and make artist selection actions explicit.
- Give Settings relevant sidebar navigation without presenting unfetched libraries as empty.

### Modal and style reliability
- Shared controls and design tokens no longer depend on Settings being loaded; standalone Metadata owns its required styles.
- Light dialogs share focus, keyboard and return behavior; nested confirmations stay above them and entry drafts require an explicit discard.
- Preserve gallery geometry, selections, file journals, auto-sync and ComfyUI/LoRA Manager behavior.

### Upgrade notes
- Stop ComfyUI, back up data and unresolved operation journals, replace the code and complete dist, restart, and refresh ComfyUI and Gallery.
- Preserve user JSON, libraries and catalog identities; the derived index upgrades to schema 11. Do not overwrite user data with bundled defaults or delete catalog.sqlite3/recovery evidence.
- GitHub releases and Registry review have independent status; a successful upload does not guarantee Manager availability.

### Known limitations
- Mild visual movement can still occur while images load; it is not fully resolved. No search model or video/audio support is added.

## 1.8.0 - 2026-10-23

### 同步与效率
- 单次遍历同时更新图片和目录，只登记变化的资源身份，缓存纳秒时间并加速全文索引的局部更新。
- 后端发现 API 客户端的工作流完成记录，不再依赖普通 ComfyUI 网页收到事件；明确输出目录时优先同步相关范围。
- 任务中心与刷新等待共用变化通知，避免重复轮询、重复提示和旧任务隐藏状态影响新任务。
- 复用未变化的卡片、目录与移动目标，复用自然排序器消除目录刷新热点；元数据回填保持布局，保护请求期间新建的选择。

### 可靠性修复
- 修复新版 Pillow 的颜色像素解析错误，合并后台分析排队，不再创建空尺寸分析任务。
- 新完成事件不会被更早的扫描吞掉；重复输出只保留必要的后续同步。
- 保留单图、批量文件事务、资源 ID、图源权限和 LoRA Manager 行为。

### 候选版与升级
- 此版本为本地验证候选，尚未自动推送 GitHub 或发布 Registry。
- 部署前停止 ComfyUI，备份用户数据和未解决日志，完整替换代码及 dist，重启并刷新页面。
- 目录库和用户 JSON 不迁移；派生索引升级到 schema 11，不要删除 catalog.sqlite3 或恢复日志。

### Synchronization and performance
- Collect image and folder snapshots in one traversal, register only changed identities, cache nanosecond mtimes, and update FTS rows through indexed row IDs.
- Discover API workflow completions on the backend without requiring an ordinary ComfyUI page to receive the event; reconcile known output scopes first.
- Share one change-driven task monitor between feedback and refresh waiters, avoiding duplicate polling, duplicate messages and stale hidden state.
- Reuse unchanged cards, folders and move targets plus one natural-sort collator, keep metadata backfill stable, and protect in-flight selections.

### Reliability fixes
- Fix modern Pillow RGBA pixel extraction, coalesce analysis backlogs, and avoid empty dimension jobs.
- Do not acknowledge new workflow output through an older scan; merge only the necessary follow-up reconciliation.
- Preserve file journals, resource IDs, registered-source permissions and LoRA Manager behavior.

### Candidate and upgrade notes
- This is a local validation candidate; no automatic GitHub push or Registry publication.
- Stop ComfyUI, back up user data and unresolved journals, replace code and the complete dist, restart, and refresh the pages.
- Catalog identities and user JSON remain unchanged. The derived index upgrades to schema 11; never delete catalog.sqlite3 or recovery evidence.

## 1.7.0 - 2026-10-16

### 主要变化
- 工作流完成后自动同步图库，低频检查兜底；整理图片时保留浏览位置。
- 右上角可离线查看版本说明，右下角任务中心统一进度、失败与最近记录。
- 增加标准与紧凑密度，改善卡片、空状态及工作区操作。
- 以图搜图保留搜索会话，支持返回结果和定位原图所在分页。

### 修复
- 修复首次 freshness 基线遗漏新图、滚动后目录统计不更新的问题。
- 修复示例更新日志为空、检查失败仍显示最新及任务提示重复的问题。
- 修复以图搜图关闭后再次点击无法打开，以及定位后重开时仍隐藏的问题。
- 批量清理垃圾箱只保留一条操作提示，整批结束后更新一次列表；失败保留未完成项。
- 合并相同范围刷新任务，扫描冲突有限重试；终止失败后暂停自动重试，避免刷新失败循环。
- 稳固瀑布流滚动坐标、固定卡片高度及浏览锚点，避免尺寸回填、缩略图加载和垃圾箱多列重排引起闪烁。

### 升级注意
- 停止 ComfyUI 后完整替换插件和 dist，重启并刷新 ComfyUI 页面以加载完成事件桥接。
- 用户 JSON、图源、资源身份和文件事务保持兼容；关闭自动同步的偏好继续生效。
- GitHub Release 与 Registry 审核独立；以 Registry 的实际版本状态确认是否可通过 Manager 更新。

### Changes
- Synchronize the gallery after workflow completion, with low-frequency fallback checks and stable browsing positions.
- Read installed release notes offline and track progress, failures and recent results in the task center.
- Choose standard or compact density with clearer cards, empty states and workspace actions.
- Keep image-search sessions when viewing details and locate originals on their folder page.

### Fixes
- Reconcile the first freshness baseline and update folder statistics while browsing older images.
- Fix missing preview notes, misleading offline update status and duplicate task messages.
- Fix reopening image search after closing it or locating a result.
- Use one operation record and one list reload for bulk trash cleanup, retaining unfinished items on failure.
- Coalesce refresh tasks and bound scan-conflict retries. Pause automatic retries after terminal failure.
- Stabilize masonry scroll coordinates, card geometry and browse anchors; avoid flashing during dimension backfill, thumbnail loading and trash column layout.

### Upgrade notes
- Stop ComfyUI, replace the complete plugin and dist, then restart and refresh ComfyUI to load the execution bridge.
- User JSON, sources, resource identity and file transactions remain compatible. Disabled auto-sync stays disabled.
- GitHub releases and Registry review are independent. Check the Registry version status for Manager update availability.

## Unreleased

- Stabilize the queue-capacity test on slow Windows CI disks by keeping its worker blocked until explicit cleanup. Runtime behavior and published 1.6.0 files are unchanged.

## 1.6.0 - 2026-10-15

### Find your original images

- Add local reverse image search: paste, drop or choose a reference to locate originals across enabled gallery sources. Match exact files and compressed/resized copies, show full paths, copy paths and jump to the containing folder. Build full-library visual fingerprints in persistent background tasks; keep reference uploads in memory. See [usage and limits](docs/image-search.zh-CN.md).

### Gallery foundation

- Add an authoritative asset catalog with persistent IDs and content revisions, separate from rebuildable image indexes and unchanged JSON annotations/boards. Journal identity changes with file moves, rename, trash and restoration; preserve unresolved recovery evidence.
- Split source, index, file, library and media domains behind compatible service exports. Add an image-provider contract for later media types; no video/audio or embedding models are enabled in this release.
- Separate bounded snapshot reads, serialized mutations, scans and analysis. Persist refresh/fingerprint/color/dimension jobs with progress, deduplication, cancellation, retries and restart recovery. Expose validated same-origin job endpoints and reuse the bottom-right status center.
- Stage uploads on the target volume, publish exclusively after reception, and clean only session-owned files on error/recovery. Batch annotations save once; return per-image states and retain failed selections.
- Serve committed directory snapshots and use stable pagination/covering indexes. Briefly cache validated read sources with immediate configuration invalidation, reuse a request-owned read-only SQLite handle, and close it after the worker finishes. Version fingerprints and previews against asset/content changes; reject stale analysis commits.
- Update vulnerable indirect frontend dependencies without forcing major upgrades and classify Tailwind build packages as development dependencies.

Upgrade and recovery: [foundation guide](docs/foundation-1.6.0.zh-CN.md). Existing source refs, JSON libraries, ComfyUI node widgets and LoRA bridge behavior remain compatible. Back up data and sources, restart ComfyUI and refresh both pages. GitHub Releases and Registry publishing are explicit release steps, separate from an ordinary source push.

## 1.5.0 - 2026-09-27

Performance and quality-of-life update. This release also incorporates the previously unpushed LoRA/mid-scroll fixes from the local post-1.4.0 commit.

### Performance and architecture

- Reconcile saved image state against indexed fields; update and rebuild FTS/color helper rows **only for changed images**, not every existing pin/board/note on a single edit. Batch image-path lookups within SQLite's portable parameter limit, including variant fingerprint lookups and prewarming; board counts query only actual board members. A forced Gallery context refresh no longer scans again inside board summaries.
- Stream live-freshness hashes in a deterministic directory traversal instead of collecting and sorting all image records in memory every polling interval; bound the per-scope freshness cache to the 32 most recently used scopes. Existing gallery views retain their changed-file detection.
- Lazy-load dual-folder organization, variant grouping, board sharing and metadata viewer; retain the ordinary gallery grid on the direct first-render path. Under the locked local build, entry JS fell from 430.72 to 396.41 kB (121.32 to 112.82 kB reported gzip); optional screens load their own chunks on demand.
- Extract safe browser preference storage and typed UI-preference handling from the main App; persist after React state updates rather than inside a state updater. No source, workflow or library data migration is performed.

### Quality of life and safety

- Abort obsolete read requests when switching gallery scope or leaving the gallery; defer the image list when starting in another workspace. Honor the existing image-prefetch preference for thumbnail prewarming as well as in-browser prefetch. Surface short plain-text backend errors even if the response is not JSON.
- Add an explicit desktop density reset to six images per row. Saved custom densities remain unchanged until the user chooses reset; narrower windows still clamp columns. Handle disabled browser localStorage gracefully for gallery, library, folder navigation and preferences.
- Block updated galleries from sending LoRA stacks to old ComfyUI tabs; verify append/replace and all preserved CLIP strengths against the upstream LoRA Manager callbacks. Fold every CLIP child row on the target without directly modifying other workflow nodes. Previously overwritten entries still require workflow history or backups.
- Keep middle-gallery bidirectional scrolling stable with non-translating cards and single-line measured metadata, while defaulting new desktop users to six columns where width permits.

### Verification

- Local verification: 108 Python and 204 frontend tests, 17 bridge/pinned-upstream LoRA tests, plus typecheck, lint, i18n, security, release-metadata and rebuilt-dist audits. Isolated Chromium checks passed for desktop/mobile browsing, lazy screens and workspace-scoped loading, blocked storage, middle/bottom/resize scrolling, and LoRA actions/channel compatibility. Fixtures and pinned upstream source are not an installed ComfyUI/LoRA Manager or a user-device acceptance test.

## 1.4.0 - 2026-09-27

Gallery workflow, safety and LoRA-stack usability update. This release includes the previously uncommitted P0/P1/P2 refinements and masonry-scroll fix since 1.3.0.

### Added

- Apply a detected ComfyUI-Lora-Manager stack from the gallery context menu or image detail with **Append / Replace / Cancel**. Append keeps other target-node entries and updates matching names; Replace removes only the target node's previous LoRAs. Incoming CLIP rows start collapsed even when weights differ; independent CLIP values (including zero) are retained. Confirmation warns that subsequent model-strength edits while collapsed will sync CLIP in upstream LoRA Manager.
- Display target-node and added/updated/removed counts; wait for the addressed ComfyUI instance's asynchronous receipt, verify widget/text synchronization, and reject incomplete writes with best-effort rollback. Duplicate deliveries share one result; the bridge does not directly rewrite other graph nodes. Native LoRA Manager callbacks can still synchronize connected trigger-word nodes.
- Provide persistent mobile single/double-column density presets, result-aware empty states, URL/history restoration for stable gallery/library scopes, and import destinations with a direct link to the returned folder.

### Changed

- Protect unsaved image edits (including filenames) across closing, paging, filmstrip and workspace switches. Separate stale metadata from touched fields; block save until metadata is ready. Modal focus stays inside the dialog and returns to its trigger.
- Keep image selection, Inspector and navigation scoped to the current source/page/variant/organizer pane. Invalidate stale image/library requests, debounce gallery and library search with IME support, and avoid stale thumbnails or headings while switching sources.
- Report the actual outcome of batch moves/deletes and single-image failures; preserve unresolved selections and keep error details until dismissed. Refresh operations wait for the real requests; navigation resets the gallery scroll, and live updates do not yank the viewport.
- Stabilize virtual masonry near the bottom: reserve fallback media aspect ratios before lazy image decode, use consistent height estimates, and invalidate measurements when widths change. Remove redundant offscreen content-visibility estimates that interfered with sizing.
- Remove the ineffective optional workflow-confirmation preference; sending a workflow still always asks for confirmation. Keep clean content-hashed builds and the manifest as the single asset source of truth.

### Verification

- 189 frontend tests, 104 Python tests, 10 ComfyUI-bridge tests, TypeScript/ESLint/i18n checks, zero-vulnerability dependency audit, clean dist build and asset audit; isolated Chromium scenarios cover P0/P1/P2, the masonry tail and LoRA handoff UI. No claim of real ComfyUI/LoRA-Manager, GPU, production gallery or cross-browser/device validation.

## 1.3.0 - 2026-09-18

Major visual, interaction, and stability update featuring minimal workspace architecture, precision selection, and backend safeguards.

- **Selection & Viewport Repair**: App bound to viewport with dedicated gallery scrolling; box-selection anchors to scrolling content; shrinking selection deselects excluded images; continuous smooth edge auto-scroll with speed limits; Escape/blur/lostpointer cancellation; deferred inspector opening prevents layout shifts during active dragging; true docked inspector avoids obscuring rightmost image column.
- **Visual Consistency & Neutral Styling**: Neutral typography, outlines, and controls across gallery, workbench, settings, library, and variant surfaces; single-layer neutral card borders and explicit text labels on batch actions.
- **Z-Index & Hierarchy**: Top navigation raised above desktop and mobile sidebars with confirmed point hit-testing.
- **Source Management & Dual-Folder**: Lock against dirty source overwrite; paged loading in dual-folder view; conflict-safe move execution with reporting.
- **Robust Backend Safeguards**: Bounded worker offloading; atomic journaled file operations with recovery inspection; cross-platform Send2Trash integration with collision-safe restore; Universal Prompt Snapshot node for metadata embedding.
- **Dependency & Cache Integrity**: Upgraded dependencies, strict manifest validation, content-hashed clean builds, and zero-vulnerability security audits.

## 1.3.0-rc.3 - 2026-09-18

Local QoL and visual-consistency candidate; not an upstream release.

- Unify workbench, settings, library, organizer and variant surfaces around the gallery's neutral typography, controls and spacing. Horizontal workbench tools and optional format conversion; row-based settings and section shortcuts.
- Preserve workbench draft/selection state while switching workspaces in the current page session; hidden effects are suspended with React Activity.
- Fix new-source selection reset; protect dirty source edits against source/tab changes, incoming refreshes and browser unload. Save validates non-empty name/path; source controls expose pressed state.
- Dual-pane request sequencing prevents stale directory responses; paged loading replaces the implicit 80-image ceiling. Explicit loaded-image selection scope, independent filter scope and return-to-gallery action.
- Lock repeated moves from confirmation through completion; confirm source/destination, preserve failures, report moved/missing/blocked counts and do not overwrite conflicts.
- Search/sort loaded variant groups and clarify that similarity is not permission to delete; guard stale variant requests.
- Separate filter reset from sort reset; keyboard Escape and focus return for the filter panel.
- Shared confirmation dialogs are portaled, modal, safe-action focused, keyboard contained, and cancellable with Escape; replaced requests resolve safely.
- See docs/UPGRADE-1.3.0-rc.3.zh-CN.md and docs/VALIDATION-1.3.0-rc.3.md for scope and limitations.

## 1.3.0-rc.2 - 2026-09-18

Local interaction refinement candidate; not an upstream release. Includes RC1 backend safeguards.

- Replace the centered tutorial with an 11-step target-aware spotlight tour, focus containment, missing-target fallback, and measured mobile positioning. Explicit dark-button/white-text contrast.
- Replace the numeric columns menu with three visual density presets and an accessible 3–8 range control.
- Add visible workspace descriptions at every screen size; prevent narrow-screen toolbar overlap.
- Normalize short opacity/color motion, remove full-overlay travel and blurred photo backdrops, decode before image handoff, cancel stale requests, preload neighbors, and honor reduced motion.
- Centralize dual-folder translations, localize errors/retry/tooltips/dates, set document language, and audit 833 keys and interpolation placeholders.
- Add regression coverage for geometry, density, decoder cancellation, error retry, unsaved-change guard, and first-run tours in both languages across four viewport sizes.
- See docs/UPGRADE-1.3.0-rc.2.zh-CN.md and docs/VALIDATION-1.3.0-rc.2.md for installation and actual validation limits.

## 1.3.0-rc.1 - 2026-09-18

Local candidate based on 87960b0; not an upstream release.

- Minimal neutral workspace UI; workspace dropdown; progressive toolbar/directory actions; keyboard dismiss and mobile sidebar close.
- Correct ComfyUI cache invalidation for polling and changed libraries; unique value sampling; bounded synchronized polling state.
- Optional Universal Prompt Snapshot pass-through node saves resolved text in PNG metadata.
- Portable Send2Trash with accurate UI language; collision-safe, source-aware restore.
- Journaled file/state operations with rollback, unresolved-journal guard and read-only recovery inspection.
- Bounded worker offload for service calls, exact Hamming candidate index, bounded prefetch queue.
- Conservative metadata parsing and incomplete-prompt exclusion from fingerprint grouping.
- Content-hashed clean builds with manifest validation; no rewriting historical hashed assets.
- Frontend lockfile security fixes; audit network failure no longer counts as success.
- Cross-platform CI configuration and additional fault-injection tests. See docs/UPGRADE-1.3.0-rc.1.zh-CN.md for limitations and installation.

## v1.2.10 - 2026-09-04

### 🖼️ 画廊浏览与排版升级 (Modern Visuals & Dynamic Masonry)
- **真·自适应动态瀑布流 (True Dynamic Masonry)**：彻底移除固定 3:4 比例的强制限制与黑边留白，根据图片真实分辨率动态绑定宽高比，全画幅完整呈现 16:9、1:1、9:16、横屏及超宽全景图片。
- **大图详情生图配方卡片化系统 (Recipe Card System)**：
  - 独立的正向/负向提示词卡片，支持微动效标识与一键快捷复制；
  - 结构化展示 Checkpoint 底模与 LoRA 列表（包含模型权重与 Clip 权重微标）；
  - 核心参数矩阵（Seed、Steps、CFG、Sampler、Scheduler、分辨率、Denoise）清晰排布，支持 Seed 一键复制；
  - 一键向已打开的 ComfyUI 发送工作流或应用 LoRA Manager 堆栈。
- **主工具栏与 Command 搜索一体化**：
  - 工具栏中央内嵌搜索栏，支持键盘快捷键 `/` 或 `Ctrl+K` / `Cmd+K` 快速聚焦；
  - 动态呈现当前生效条件的活动过滤胶囊（Active Filter Chips），支持单项移除与一键全部重置。
- **左侧边栏目录树层级引导线与规整重构**：
  - 引入现代树形虚线引导线与水平微导线，多级嵌套目录结构清晰明了；
  - 动态切换文件夹开闭图标，分组头部采用纯净单行标题与数量徽标，消除挤压换行；
  - 增加一键「全部展开」与「全部收起」快捷按钮。

### ↔️ 双目录整理模式功能强化 (Dual-Folder Organizer)
- **居中悬浮操作中柱 (Transfer Action Rail)**：左右分栏中央新增交互中柱，提供左右目录互换（`⇄`）、选定图片双向批量移动（`➡️` / `⬅️` 带数量徽标）及双栏一键同步刷新（`🔄`）。
- **响应式折叠适配**：宽屏自适应立式悬浮，窄屏平滑回退为紧凑水平按钮栏。

### 🛡️ 鲁棒性加固与故障自愈 (Robustness & Graceful Fallbacks)
- **大图详情底部胶片缩略图传送带 (Filmstrip Strip)**：详情弹窗底部新增横向平滑缩略图传送带，高亮当前浏览图片并支持水平预览与即时切换，支持一键随心展开/收起。
- **损坏/异常图片优雅容错降级 (Broken Image Fallback)**：
  - 网格卡片与详情弹窗全覆盖，遇到图片损坏、外部删除或 404 时优雅呈现暗色柔光容错卡片与文件名提示，彻底告别浏览器原生裂图小图标；
  - 详情页提供「重试加载图片」与「新标签页打开」双通道恢复机制。
- **Pillow 14 兼容与内存优化**：在 `image_safety.py` 中实现安全的像素提取接口，彻底消除 `Image.Image.getdata` 废弃警告（0 warnings），并通过 `try...finally` 显式关闭临时图像释放 C 扩展层内存。
- **前端预加载内存池治理**：将全局无限 Set 改造为容量受控的 `BoundedSet(capacity = 2500)`，并在预加载完成时彻底清空 Image 解码器引用，杜绝长时运行内存泄漏。
- **工作流定向通信闭环修复**：放宽 BroadcastChannel 探测与加载超时至 8 秒，在 ComfyUI 端增加窗口获得焦点（`focus`）与可见性变化（`visibilitychange`）时的自动兜底提取。
- **构建安全审计离线容错**：优化 `scripts/audit-security.mjs`，内置网络抖动智能重试与超时保护。

---

## v1.2.8 - 2026-07-02
- 增强图库目录过滤与分类检索性能。
- 优化变体指纹分析（Exact Duplicate、Near Duplicate、Prompt Hash）算法。
- 完善 ComfyUI-Lora-Manager 堆栈同步与工作流定向握手协议。

## v1.2.7 - 2026-07-01
- 增加双目录对比整理模式。
- 增强 SQLite 索引并发事务与损坏自愈机制。
- 优化长列表虚拟滚动卡片渲染。
