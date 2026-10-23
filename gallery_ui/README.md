# Universal Gallery Frontend

## Maintenance notes

- `useGalleryData` composes scoped queries (`useGalleryQueries`), batch outcomes (`useGalleryBatchOperations`), and refresh completion (`useGalleryRefresh`). `useGalleryJobs` and refresh waiters share `galleryJobMonitor`, using visible-only change-driven waits with a two-second legacy fallback. `useGallerySelection` owns click/range/keyboard anchors while box geometry stays with the measured layout; `useVariantRequests` aborts replaced analysis requests. Optional asset IDs preserve compatibility with old servers.
- Task protocol and recovery: [foundation guide](../docs/foundation-1.6.0.zh-CN.md).
- Reverse image search is a lazy `ImageSearchModal` beside the text search. Gallery-level paste opens it outside editable fields/modal dialogs. Uploads are references only; preserve cancellation, persistent index progress, full-path copy, filter-clearing folder navigation and resize behavior. See [search contracts and limits](../docs/image-search.zh-CN.md).

- `npm run audit:dist` validates the Vite manifest, imported chunks and index asset references without rewriting hashed files.
- `npm run audit:security` runs `npm audit --audit-level=moderate` so frontend dependency vulnerabilities stay visible.
- The repository-level `scripts\verify.ps1` runs frontend security audit, build, dist audit, and release metadata checks after Python verification.
- `WorkspaceSidebar` keeps folder source scoping and sorting helpers in `src/components/shared/folderTree.ts`; generated date-named folders sort by embedded valid dates before directory mtime in the default modified-order mode.
- `GalleryWorkspace` keeps image prefetch state and card image loading in `src/components/gallery/galleryImagePrefetch.ts` and `GalleryCardImage.tsx`.
- `GalleryWorkspace` keeps box-selection math in `src/components/gallery/gallerySelectionModel.ts`; virtual masonry selection should continue using drag-start rect snapshots, estimated offscreen rects, and scroll-delta compensation.
- `DualFolderWorkspace` keeps pane selection, validated internal drag MIME parsing, and shortcut action mapping in `src/components/gallery/dualFolderModel.ts`.
- Variant organization is toggled from `GalleryToolbar` and rendered by `src/components/gallery/VariantGroupsView.tsx`; selected variant groups should reuse normal `GalleryMainContent` cards, selection, context menus, board, move, trash, metadata, and workflow actions.
- Global pending/success/error feedback is centralized in `src/components/shared/OperationStatusCenter.tsx`; `src/components/shared/ToastViewport.tsx` is a compatibility wrapper around the same right-bottom status center, not a separate toast surface.
- Floating menu placement, dismiss behavior, and editable-target shortcut guards are centralized in `src/utils/interaction.ts`.
- `TopNavigation` owns the update bell. It calls `galleryApi.getUpdateStatus()`, uses `src/utils/interaction.ts` for the popover, and should show the red dot only when the backend returns `update_available`.
- First-run onboarding lives in `src/components/shared/OnboardingTour.tsx`; its completion flag is localStorage-only, while the Settings restart button reopens it without adding another `UiPreferences` field.
- The gallery first screen should not fetch `/api/libraries` or use initial `forceRefresh=true`; library data is enabled only for `library` and `workbench` tabs.
- `LibraryWorkspace`, `WorkbenchWorkspace`, `SettingsWorkspace`, and `ImageDetailModal` are lazy-loaded from `src/App.tsx`; keep `GalleryWorkspace` statically imported for the first screen.
- `WorkbenchWorkspace` uses a creative-tool console layout: top status strip, left tool rail, staged generator panel, and queue/source panels. Keep future tools inside the rail/stage pattern and preserve the 1320px breakpoint that lets the generator stay wide before support panels stack below it.
- Normal gallery masonry measurement is owned by `GalleryWorkspace` and `useVirtualMasonry`. Dual-folder mode unmounts the normal grid, so leaving dual-folder mode must reset stale `gridWidth` and reattach `ResizeObserver` to the newly mounted `.ue-gallery-grid--virtual`.
- Normal gallery list view is a compact card-grid list: desktop widths at 1240px and above show two cards per row, list thumbnails stay larger for readability, metadata uses second-level timestamps, and real-resolution chips render when `width`/`height` are available.

这是 ComfyUI Universal Extractor 的图库前端，使用 React、TypeScript 和 Vite 构建。构建产物位于 `gallery_ui/dist/`，由后端以 `/gallery/` 路径挂载到 ComfyUI。

## 开发命令

```bash
npm install
npm run dev
npm run typecheck
npm run test
npm run build
npm run preview
npm run lint
```

常规验证顺序：

```bash
npm run typecheck
npm run lint
npm run test:run
npm run audit:security
npm run build
```

项目根目录还需要配合 Python 后端校验：

```bash
python -m pytest
python -m compileall py\gallery
```

Windows 本地也可以在仓库根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify.ps1
```

## 目录职责

- `src/App.tsx`：应用入口，管理顶部导航、全局状态和图库工作台布局。
- `src/components/gallery/GalleryWorkspace.tsx`：图库主体浏览区，包含筛选、排序、网格/列表、垃圾箱瀑布流、拖选、右键菜单和选择态。
- `src/components/gallery/DualFolderWorkspace.tsx`：双栏目录整理模式，负责左右目录选择、多选状态、批量拖拽移动、右键菜单和双栏快捷键。
- `src/components/gallery/GalleryInspectorPanel.tsx`：图库右侧 Inspector，处理单图详情、多选批量操作、色板展示和移动端抽屉。
- `src/components/library/`：词库页面，支持网格/列表、搜索、分页和跳页。
- `src/components/shared/`：通用弹窗、侧边栏、上下文菜单等共享组件。
- `src/hooks/`：页面数据和交互状态 Hook，例如 `useGalleryData`。
- `src/services/`：后端 API 封装，例如 `galleryApi.listImages`。
- `src/types/`：前后端共享数据结构定义。
- `src/i18n/`：中文和英文文案。
- `src/styles/`：全局布局、图库、词库、弹窗等样式。

## 布局约定

图库主页面采用独立滚动主内容区 + 预留空间的 Inspector 模型：

- 左侧资源栏：图源、输出/输入图库范围、当前 source 目录、图版、分类等导航。
- 中间内容区：图库浏览、筛选、排序、分页、网格/列表。
- 右侧 Inspector：普通图库选择时显示，桌面预留右侧 320px，960px 及以下预留下方空间；可用宽度变化后重测虚拟布局，不遮挡卡片或分页。

左侧资源栏采用固定快捷入口 + 单一滚动区模型：输出图库、输入图库和垃圾箱固定在顶部。输出图库/输入图库是实际 source 范围切换，目录区只显示当前 source 下的目录，不再把输入目录嵌套显示在输出树里。当前目录支持搜索、树形/列表切换、置顶、默认按修改时间排序、名称排序备选和更多操作菜单；有效日期命名目录会先按名称中的日期稳定排序，再回退到目录修改时间，避免自动生成的日期目录被后续写入打乱。布局避免多个嵌套滚动条抢占鼠标滚轮。

垃圾箱页不复用右侧 Inspector，使用独立批量工具栏。网格保持瀑布流，预览保留 1/1.36 固定框，图片解码不改变列平衡；文件名和原始路径限制在卡片内部。

## 筛选约定

图库顶部只保留高频入口，筛选面板统一承载：

- 分类筛选
- 排序字段和升降序
- 日期范围
- Pin 状态
- 色系筛选

筛选面板采用固定头部、可滚动内容区和固定底部。顶部显示结果数量和实时应用状态，内容区包含当前条件摘要、分类、排序、紧凑色系调色板、日期与 Pin 状态；小屏下以底部抽屉展示，避免底部操作被系统任务栏或窗口边缘挡住。

色系筛选由后端图片索引提供，`galleryApi.listImages` 会传递 `color_family` 参数。支持基础色系和虚拟分组：暖色、冷色、低饱和；单个色系占比达到 25% 才会命中筛选。色系索引不阻塞普通列表加载，当前页优先补全，全库后台补齐；前端通过 `galleryApi.getColorIndexStatus` 轮询 `/api/color-index/status` 并在筛选面板展示进度。

## 即时同步

图库自动同步通过完成通知和 freshness 兜底协调：

- `useGalleryAutoSync` 在图库可见且启用自动同步时读取轻量完成通知，结合版本化广播合并一秒内事件；API 客户端的完成记录由后端发现。
- 每 15 秒 freshness 兜底，有变化才扫描；首次索引直读后异步校准。成功后才确认指纹，陈旧扫描不能吞掉新事件。
- 仅最新排序第一页、接近顶部且没有选择、拖动或详情编辑时自动插入；其他位置更新目录统计并显示待刷新入口，保持卡片和选择。
- 关闭同步或后台标签页暂停自动检查；非图库页面不请求图片分页。详见[同步接口与性能](../docs/synchronization-performance.zh-CN.md)。

## UI 交互约定

- 单击图片默认打开大图详情页；如果用户在设置中开启“默认进入选择模式”，则单击进入选取模式。
- 双击图片或点击“查看详情”也会打开大图详情页。
- 左键拖拽支持类似文件管理器的框选；网格模式使用虚拟瀑布流时，框选需要基于拖拽开始时的布局快照和离屏卡片估算坐标，拖到滚动容器边缘应自动滚动并继续命中后续项目。
- Shift 支持连续选择。
- 右键菜单支持单图和多选批量操作。
- 单图右键菜单和详情入口支持复制图片、复制文件名、复制路径、复制正面提示词、查看 Metadata、打开原图等高频操作。
- 双栏模式使用文件管理器式交互：单击选择，Ctrl/Meta 追加选择，Shift 连选，双击打开详情；拖动已选图片到另一栏会批量移动，外部文件拖入仍只走导入。双栏卡片应与普通图库卡片保持一致的 hover、选中、图片缩放、文本裁剪和真实分辨率展示体验。
- 双栏模式的右键菜单复用项目内上下文菜单样式，支持打开详情/原图/工作流、查看 Metadata、复制图片/文件名/路径/正向提示词、选择/取消、移动到另一栏、Pin/取消 Pin、加入图版和删除。
- 双栏模式快捷键：Ctrl/Meta+A 全选当前栏，Escape 关闭菜单或清空选择，Delete 删除所选，Enter 打开聚焦图片详情，Ctrl/Meta+M 移动到另一栏，Ctrl/Meta+R 刷新左右栏，Tab 切换左右栏焦点；输入框和目录搜索框聚焦时不触发这些快捷键。
- 网格/列表切换要覆盖图库、垃圾箱和词库子项目；普通图库列表视图在宽屏下使用两列紧凑卡片，显示秒级时间和真实分辨率；垃圾箱网格模式保持瀑布流自适应，不使用固定拉伸列。
- 小型子页面和弹窗使用统一的标题、说明、输入区、操作区排版。
- “在 ComfyUI 中打开工作流”会先弹出安全确认，再通过 `BroadcastChannel` 探测已打开的 ComfyUI 页面，并只向一个回传 `instanceId` 的接收页发送工作流；不会自动创建新的 ComfyUI 窗口。没有可接收页面时，会保留 pending payload，并通过右下角状态中心提示刷新现有 ComfyUI 页面后重试；发送成功或失败也必须走同一个状态中心。
- 文件移动、删除、重命名、清空/彻底删除、批量分类、批量图版、导入、图源保存等敏感操作应通过确认弹窗拦截，长耗时或易失败操作应使用 `useOperationStatus().runOperation(...)` 显示 pending/success/error。

## 设置偏好

设置页包含浏览器本地保存的界面与交互偏好：

- 默认进入选择模式：默认关闭，关闭时单击图片打开详情。
- 标准/紧凑密度：只调整间距，独立于网格列数；安全存储不可用时不抛错。
- 启动时收起侧边栏：适合小屏或专注浏览。
- 预加载附近图片：可在大图库中提升翻页和滚动体验，也可关闭以减少后台读取。
- 图库自动同步：控制完成事件和可见页面的兜底检查。
- 目录默认树形视图：关闭后输出目录默认使用平铺列表。

## 构建与缓存

`npm run build` 清理 dist 后生成新的内容哈希资源和 Vite manifest，再审计全部引用。不得把新内容覆盖到旧 hash 文件名；旧页出现资源 404 时完整更新 dist 并刷新浏览器/ComfyUI。

`npm run sync-dist` 只是非写入的资源审计兼容入口。CI 不自动提交 dist；发布前显式提交完整干净构建产物。共享颜色、控件在 `base.css`，跨工作区样式在 `workspace-system.css`，Metadata 两个入口分别导入 `metadata.css`；访问顺序不能改变布局。

已知构建入口：

- `dist/index.html`
- `dist/assets/index-*.js`
- `dist/assets/index-*.css`

## 后端协作

图库数据来自 `/universal_gallery/api/`：

- `/api/images`：分页图片列表，支持搜索、分类、日期、Pin、色系筛选和排序。
- `/api/images/freshness`：轻量检查当前视图图片文件是否变化，用于自动同步。
- `/api/update-status`：远端更新状态，区分核验、缓存和失败；手动重查才传 `force=true`。
- `/api/release-notes`：离线读取当前安装版本和历史本地说明。
- `/api/sync-status`、`/api/sync-notifications`：有界完成通知，不能提交任意路径或文件操作命令。
- `/api/jobs`：持久任务状态和变化通知，不占普通查询通道。
- `/api/context`：图源、图版、分类等上下文。
- `/api/color-index/status`：色系索引补全进度，用于筛选面板状态提示。
- `/api/image-state`：图片状态更新。
- `/api/images/batch-update`、`/api/images/batch-rename`：批量操作。
- `/api/trash`、`/api/trash/restore`、`/api/trash/purge`：垃圾箱操作。

修改筛选、排序、图片字段时，需要同时更新：

- `src/types/universal-gallery.ts`
- `src/services/galleryApi.ts`
- `src/hooks/useGalleryData.ts`
- 相关组件和 i18n 文案
