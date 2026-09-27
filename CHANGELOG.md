# Changelog

All notable changes to the ComfyUI Universal Extractor project will be documented in this file.

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
