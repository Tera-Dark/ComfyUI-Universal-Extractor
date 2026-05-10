# Universal Gallery Frontend

## Maintenance notes

- `npm run audit:dist` reports tracked `dist/assets/index-*.js` and `index-*.css` counts, sizes, and latest entrypoint assets.
- The repository-level `scripts\verify.ps1` runs frontend build, dist audit, and release metadata checks after Python verification.
- `WorkspaceSidebar` keeps folder source scoping and sorting helpers in `src/components/shared/folderTree.ts`.
- `GalleryWorkspace` keeps image prefetch state and card image loading in `src/components/gallery/galleryImagePrefetch.ts` and `GalleryCardImage.tsx`.
- Floating menu placement, dismiss behavior, and editable-target shortcut guards are centralized in `src/utils/interaction.ts`.

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

图库主页面采用稳定主内容区 + 覆盖式 Inspector 模型：

- 左侧资源栏：图源、输出/输入图库范围、当前 source 目录、图版、分类等导航。
- 中间内容区：图库浏览、筛选、排序、分页、网格/列表。
- 右侧 Inspector：当普通图库页选中图片时出现，桌面端以固定覆盖层显示，不改变中间图库滚动容器宽度；移动端以抽屉显示。

左侧资源栏采用固定快捷入口 + 单一滚动区模型：输出图库、输入图库和垃圾箱固定在顶部。输出图库/输入图库是实际 source 范围切换，目录区只显示当前 source 下的目录，不再把输入目录嵌套显示在输出树里。当前目录支持搜索、树形/列表切换、置顶、默认按修改时间排序、名称排序备选和更多操作菜单，避免多个嵌套滚动条抢占鼠标滚轮。

垃圾箱页不复用右侧 Inspector，继续使用自己的批量操作栏，避免恢复/彻底删除逻辑和普通图片详情混在一起。垃圾箱网格视图使用自适应瀑布流排版，图片按内容高度自然排列，文件名和原始路径必须限制在卡片内部。

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

图库自动同步使用轻量 freshness 检查，而不是定时强制刷新完整列表：

- `useGalleryData` 在 Gallery tab 可见、页面未隐藏、且自动同步开关开启时轮询 `galleryApi.getImageFreshness`。
- freshness 未变化时不调用 `listImages(..., forceRefresh=true)`，避免触发后端索引同步。
- 当前处于第 1 页且按 `created_at desc` 排序时，新图会自动替换列表并预热缩略图。
- 其他页码或排序状态只显示“有新图”提示，用户点击后再调用 `refresh()`，避免打断浏览位置。

## UI 交互约定

- 单击图片默认打开大图详情页；如果用户在设置中开启“默认进入选择模式”，则单击进入选取模式。
- 双击图片或点击“查看详情”也会打开大图详情页。
- 左键拖拽支持类似文件管理器的框选。
- Shift 支持连续选择。
- 右键菜单支持单图和多选批量操作。
- 单图右键菜单和详情入口支持复制图片、复制文件名、复制路径、复制正面提示词、查看 Metadata、打开原图等高频操作。
- 双栏模式使用文件管理器式交互：单击选择，Ctrl/Meta 追加选择，Shift 连选，双击打开详情；拖动已选图片到另一栏会批量移动，外部文件拖入仍只走导入。双栏卡片应与普通图库卡片保持一致的 hover、选中、图片缩放、文本裁剪和真实分辨率展示体验。
- 双栏模式的右键菜单复用项目内上下文菜单样式，支持打开详情/原图/工作流、查看 Metadata、复制图片/文件名/路径/正向提示词、选择/取消、移动到另一栏、Pin/取消 Pin、加入图版和删除。
- 双栏模式快捷键：Ctrl/Meta+A 全选当前栏，Escape 关闭菜单或清空选择，Delete 删除所选，Enter 打开聚焦图片详情，Ctrl/Meta+M 移动到另一栏，Ctrl/Meta+R 刷新左右栏，Tab 切换左右栏焦点；输入框和目录搜索框聚焦时不触发这些快捷键。
- 网格/列表切换要覆盖图库、垃圾箱和词库子项目；垃圾箱网格模式保持瀑布流自适应，不使用固定拉伸列。
- 小型子页面和弹窗使用统一的标题、说明、输入区、操作区排版。
- “在 ComfyUI 中打开工作流”优先通过 `BroadcastChannel`、`postMessage` 和 `localStorage` 把工作流发送到已打开的 ComfyUI 页面；只有没有可复用窗口时才打开新的 ComfyUI 页面，避免已有工作流触发浏览器离开确认。

## 设置偏好

设置页包含浏览器本地保存的界面与交互偏好：

- 默认进入选择模式：默认关闭，关闭时单击图片打开详情。
- 发送工作流前确认：关闭后直接发送到已打开的 ComfyUI 页面。
- 启动时收起侧边栏：适合小屏或专注浏览。
- 预加载附近图片：可在大图库中提升翻页和滚动体验，也可关闭以减少后台读取。
- 目录默认树形视图：关闭后输出目录默认使用平铺列表。

## 构建与缓存

执行 `npm run build` 后，Vite 会生成新的 hash 资源文件。ComfyUI 或浏览器可能仍请求旧 hash 文件；如果用户环境出现旧资源 404，需要把当前构建产物同步复制到旧 hash 文件名，保持兼容。

`npm run build` 会在 Vite 构建后运行 `scripts/sync-dist-compat.mjs`，自动把当前 JS/CSS 内容同步到已跟踪的旧 hash 兼容文件名。CI 只验证构建可以通过，不会自动提交 `dist/`。发布前仍需显式提交 `dist/index.html` 和相关 `dist/assets/index-*.js`、`dist/assets/index-*.css` 产物。

已知构建入口：

- `dist/index.html`
- `dist/assets/index-*.js`
- `dist/assets/index-*.css`

## 后端协作

图库数据来自 `/universal_gallery/api/`：

- `/api/images`：分页图片列表，支持搜索、分类、日期、Pin、色系筛选和排序。
- `/api/images/freshness`：轻量检查当前视图图片文件是否变化，用于自动同步。
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
