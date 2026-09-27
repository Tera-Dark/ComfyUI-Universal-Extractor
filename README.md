# ComfyUI Universal Extractor

## 1.4.0 · 图库体验与 LoRA 堆应用更新

在 1.3.0 的极简工作台基础上，改进了未保存草稿保护、批量操作结果反馈、图源与搜索切换、移动端密度、瀑布流尾部滚动，以及图片 LoRA 堆到现有 ComfyUI 工作流的定向应用。**仅提交源码和构建产物不会自动创建 GitHub Release 或发布 ComfyUI Registry 版本。**

**更新内容：** [CHANGELOG.md](CHANGELOG.md) · **架构和联动细节：** [docs/architecture.md](docs/architecture.md)。

开发验证：`powershell -ExecutionPolicy Bypass -File scripts\verify.ps1`（Windows），或依次运行 Python 测试、桥接测试与 `cd gallery_ui && npm run verify`。前端使用干净构建和 manifest 校验。

独立 UI 预览（无真实 ComfyUI/GPU）：`python scripts/preview.py`，访问 `http://127.0.0.1:8189/gallery/`。示例数据放在临时目录，不接触用户图源。

ComfyUI Universal Extractor 是一个 ComfyUI 自定义节点和图库工作台插件，包含两块核心能力：

- **Universal Artist/Tag Randomizer 节点**：按字段路径从 `data/` 词库条目中抽取特定词段，例如 `name`、`other_names`、`meta.tags`，并可直接输出 Anima、artist、NAI、加权画师串或通用 tag 串。
- **Universal Gallery 图库工作台**：在浏览器中管理 ComfyUI 图片输出、图版、分类、垃圾箱、词库和画师工作台。

前端支持中文和英文界面，图库页面使用轻量工作台布局：左侧资源栏、中间浏览区和右侧 Inspector。打开 Inspector 时桌面端会预留右侧空间、移动端预留下方空间，并重新测量瀑布流，避免遮挡卡片。

## 功能概览

### Artist/Tag Randomizer 节点

`Universal Artist/Tag Randomizer` 适合从词库条目里抽取指定字段片段，并直接整理成随机生成可用的画师串或 tag 串：

| 参数 | 说明 |
| --- | --- |
| `file_name` | 选择 `data/` 下的 JSON 词库文件；节点只读取普通 `.json` 词库，不读取运行时状态文件 |
| `field_paths` | 要抽取的字段路径，支持逗号或换行分隔，例如 `name`、`other_names`、`meta.style`、`tags.*` |
| `extract_count` | 抽取数量，范围 1 到 200 |
| `mode` | `random` 随机抽取，`polling` 每次生成轮询推进，`sequential` 按 `seed` 作为起点顺序抽取 |
| `duplicate_policy` | `auto` 在数量超过池大小时允许重复；`allow_duplicates` 始终可重复；`unique_only` 只返回不重复结果 |
| `output_format` | `anima` 输出 `@name` / `@name \(alias\)`，`artist` 输出 `artist:name`，`weighted_artist` 输出 `(name:1.0)`，`nai` 输出 NAI 权重段，`tags` 保留通用 tag，`custom` 使用模板 |
| `weight_min` / `weight_max` | 加权输出的权重范围；两者相同则固定权重 |
| `custom_template` | 自定义输出模板，支持 `{tag}`、`{clean}`、`{anima}`、`{index}` |
| `filter_path` / `filter_value` / `filter_mode` | 可选条目过滤，先按字段路径筛条目，再从命中的条目里抽取 |
| `prefix` / `suffix` / `separator` | 输出格式控制 |
| `seed` | 随机或顺序起点种子，保证可复现 |

节点输出两个字符串：`Prompt` 是拼接后的提示词，`Selected JSON` 是本次抽中的原始词段数组，方便调试工作流。常见画师词库可以用 `field_paths=name` 搭配 `output_format=anima` 或 `artist`；通用 tag 词库可以用 `field_paths=tags.*` 搭配 `output_format=tags` 或 `custom`。`polling` 轮询状态保存在当前 Python 进程内，并按节点 id、词库、字段、过滤条件、词池内容和 seed 隔离；重启 ComfyUI 后会从 seed 位置重新开始。

节点输入顺序需要兼容 ComfyUI 已保存工作流的 widget 位置：旧字段保持 `separator`、`seed`、`filter_path`、`filter_value`、`filter_mode` 的顺序，新加的 `weight_min`、`weight_max`、`custom_template` 放在末尾。升级后如果右侧错误面板出现 `Failed to convert an input value to a FLOAT/INT value`，并且内容类似 `weight_max ... ''`、`seed ... 'contains'` 或 `weight_min ... 'randomize'`，通常表示浏览器或 ComfyUI 仍加载了旧节点定义，先重启 ComfyUI 并刷新页面；如果错位状态已经被保存进工作流，重新放置一次 `Universal Artist/Tag Randomizer` 节点即可恢复干净参数。

### Gallery 图库工作台

访问方式：

- ComfyUI 顶部菜单进入 Gallery。
- 直接访问 `http://<host>:<port>/gallery/`。

主要能力：

- **多图源管理**：默认挂载 ComfyUI `output/` 和 `input/`，自定义图源会经过路径、权限和导入目标校验。
- **图片索引**：SQLite 分页索引图片路径、大小、时间、状态、主色、色系占比和色板；内部使用 schema 版本、组合索引、FTS 搜索表和色系关系表优化大图库加载。
- **轻量即时同步**：页面可见时先调用 freshness 指纹检查当前视图，只有检测到文件变化才触发增量索引和列表刷新，避免定时全量重扫。
- **缩略图与预热**：使用 Pillow 生成 WebP 缩略图，并支持后台预热。
- **变体整理 / 智能分组**：图库工具栏可进入变体整理视图，按重复图、近似图、同 Prompt、同 Workflow 和文件名序列聚合同一批 ComfyUI 输出；分组只提供建议整理和批量选择，删除/移动仍走安全确认。
- **统一筛选面板**：分类、排序字段、升降序、日期范围、Pin 状态和色系筛选统一收纳在筛选入口中；面板采用固定头部、可滚动内容区和固定底部，色系筛选使用紧凑调色板布局。
- **色系筛选**：支持红、橙、黄、绿、青、蓝、紫、粉、棕、黑、白、灰，以及暖色、冷色、低饱和分组；单个色系占比达到 25% 才会命中筛选。
- **网格/列表模式**：图库、垃圾箱、词库子项目均支持两种常见排列方式；普通图库列表视图在宽屏下使用两列紧凑卡片，显示秒级时间和真实分辨率；垃圾箱网格使用自适应瀑布流，长文件名和原始路径会限制在卡片内部。移动端可选择舒适单列或紧凑双列；缺失图片尺寸时先预留稳定媒体高度，减少滚到瀑布流底部时的跳动。
- **资源栏导航**：快捷入口固定在侧边栏顶部，输出图库和输入图库是独立 source 范围；目录区只显示当前入口对应的目录。目录支持搜索、树形/列表切换、置顶、默认按修改时间排序、名称排序备选和右键管理。
- **选择交互**：默认关闭选择模式，单击图片打开详情；开启选择模式后支持左键拖选、滚动框选、Shift 连选、右键菜单和悬浮操作。
- **双栏目录整理**：可在图库中开启左右双栏目录视图，两个目录独立搜索选择；支持单击选择、Ctrl/Meta 多选、Shift 连选、双击详情、批量拖拽移动、右键菜单、栏级全选/反选/清空/刷新/移动和键盘快捷键。双栏卡片会展示真实分辨率、文件大小和日期，并尽量保持与普通图库一致的 hover、选中和溢出控制体验。
- **右侧 Inspector**：普通图库页选中图片后，桌面端以贴屏覆盖层显示并为它预留宽度，瀑布流随可用空间重新排布；移动端以下方抽屉展示。
- **图片详情页与安全操作**：支持左右翻页、键盘导航、缩放与胶片条；标题、分类、备注、Pin、文件名的未保存草稿，在关闭、翻页或切换工作区前都会提示保存／放弃／取消。发送工作流前始终确认，进度和结果进入右下角状态中心；只向一个已刷新并可接收的现有 ComfyUI 页面发送，不会自动创建窗口。批量移动／删除按服务端实际结果反馈，失败时保留未完成的选择。
- **Metadata 与提示词**：支持查看图片 Metadata，并可从右键菜单或详情入口一键复制正面提示词；`/api/metadata` 同时返回结构化 `recipe` 字段，归纳 prompt、checkpoint、LoRA、尺寸和采样参数。
- **LoRA 堆应用**：图片包含 ComfyUI-Lora-Manager 配方时，右键菜单和详情页提供统一的 **追加到原堆／覆盖旧堆／取消**。只操作选中的一个兼容节点（没有选中时操作第一个）；追加保留已有条目并更新同名，覆盖只清除目标节点旧 LoRA。新发送条目的 CLIP 子行默认折叠，保留独立 CLIP 权重（包括 0）；若在折叠后手动改主权重，LoRA Manager 原生行为会同步覆盖 CLIP，请先展开再单独编辑。桥接不会主动改写其他节点，但原插件自身可能联动连接的触发词节点。
- **更新检查**：主页右上角铃铛会检查 GitHub Releases，有新版本时显示红点；弹窗中可查看当前/最新版本、更新日志，并手动重新检查。
- **文件管理**：移动、重命名、批量重命名、创建目录、删除到垃圾箱、恢复和彻底删除。
- **图版与分类**：支持 Pin 图、加入图版、分类管理和批量分类。

### Library 词库

- 管理 `data/` 下的 JSON 资源库。
- 支持搜索、分页、跳页、网格/列表视图。
- 支持新增、编辑、删除、导入、导出和复制原始 JSON 内容。

### Workbench 画师工作台

- 搜索画师资源库并按别名匹配。
- 按帖子数量筛选。
- 随机抽取画师提示词。
- 支持 standard、creative、nai 和自定义输出格式。
- 支持一键复制到剪贴板。

### Settings 设置

- 管理图库源。
- 测试路径有效性和图片数量。
- 配置导入目标。
- 查看图源健康状态和诊断信息。
- 配置界面与交互偏好，包括默认选择模式、启动时收起侧边栏、图片预加载和目录默认视图。

## 安装

### ComfyUI Manager

在 ComfyUI Manager 中搜索 `Universal Extractor` 并安装。

### 手动安装

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Tera-Dark/ComfyUI-Universal-Extractor.git
pip install -r ComfyUI-Universal-Extractor/requirements.txt
```

### ComfyUI Registry

```bash
comfy node registry-install tera-universal-extractor
```

前端构建产物 `gallery_ui/dist/` 随仓库发布，普通用户不需要额外执行 `npm run build`。

## 目录结构

```text
ComfyUI-Universal-Extractor/
├── __init__.py
├── pyproject.toml
├── requirements.txt
├── py/
│   ├── plugin.py
│   ├── constants.py
│   ├── paths.py
│   ├── nodes/
│   │   └── extractor_node.py
│   └── gallery/
│       ├── routes.py
│       ├── service.py
│       ├── state_store.py
│       ├── metadata.py
│       ├── update_checker.py
│       └── recipe.py
├── web/comfyui/
│   └── top_menu_extension.js
├── docs/
│   └── architecture.md
├── gallery_ui/
│   ├── src/
│   └── dist/
└── data/
    ├── *.json
    ├── gallery_state.json
    ├── gallery_sources.json
    ├── gallery_index.sqlite3
    ├── thumb_cache/
    └── trash/
```

运行时数据说明：

- `gallery_state.json`：图片状态、分类、图版等持久化数据。
- `gallery_state.json.bak-*`：图库状态自动恢复迁移前创建的时间戳备份文件。
- `gallery_sources.json`：图库源配置。
- `gallery_index.sqlite3`：图片分页索引，包含 `gallery_images` 主表、`gallery_index_meta` 元信息、`gallery_schema_migrations` 迁移记录、`gallery_images_fts` 搜索表、`gallery_image_color_family` 色系关系表和 `gallery_image_fingerprints` 变体指纹表。数据库使用 `PRAGMA user_version` 管理内部 schema 迁移，连接启用 WAL 和忙等待；索引是可重建派生数据，发现 SQLite 文件损坏时会隔离为 `.corrupt-*` 后重建，不会修改 `gallery_state.json` 用户状态。`gallery_images` 也缓存了图片真实宽高以便前端展示。
- `thumb_cache/`：缩略图缓存。
- `trash/`：插件内置垃圾箱。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| ComfyUI 节点 | Python 3.10+ |
| 后端 API | aiohttp / ComfyUI PromptServer |
| 图片处理 | Pillow，负责缩略图、元数据读取和色系索引 |
| 数据存储 | SQLite WAL + JSON 文件 |
| 前端 | React 19、TypeScript、Vite |
| UI | Tailwind CSS、Lucide React Icons |
| 国际化 | 自研 i18n，中文 / English |

## API 概览

所有 Gallery API 挂载在 `/universal_gallery/api/` 下。

| 方法 | 端点 | 说明 |
| --- | --- | --- |
| `GET` | `/api/context` | 获取图源、图版、分类等上下文 |
| `GET` | `/api/images` | 分页查询图片，支持搜索、分类、日期、Pin、色系筛选和排序；返回色系索引状态 |
| `GET` | `/api/images/freshness` | 轻量检查当前图库视图是否发生图片文件变化；用于前端自动同步，不重建完整索引 |
| `GET` | `/api/update-status` | 检查插件 GitHub Releases 更新状态，支持 `force=true` 手动重新检查 |
| `GET` | `/api/image-file` | 读取图片文件，仅允许受支持的图片扩展名 |
| `GET` | `/api/metadata` | 获取图片元数据、工作流信息和结构化 recipe |
| `GET` | `/api/thumb` | 获取缩略图 |
| `POST` | `/api/thumb/prewarm` | 批量预热缩略图 |
| `GET` | `/api/color-index/status` | 获取色系索引补全进度 |
| `POST` | `/api/image-state` | 更新图片状态 |
| `POST` | `/api/import` | 导入图片或资源库文件 |
| `POST` | `/api/images/delete` | 删除图片到垃圾箱 |
| `POST` | `/api/images/move` | 移动图片 |
| `POST` | `/api/images/rename` | 重命名图片 |
| `POST` | `/api/images/batch-update` | 批量更新图片状态 |
| `POST` | `/api/images/batch-rename` | 批量重命名图片 |
| `GET/POST` | `/api/boards` | 图版 CRUD |
| `GET/POST` | `/api/libraries` | 资源库列表和保存 |
| `GET` | `/api/library/entries` | 分页浏览资源库条目 |
| `POST` | `/api/library/import` | 导入资源库文件 |
| `POST` | `/api/library/generate-artists` | 生成画师提示词字符串 |
| `GET/POST` | `/api/settings/gallery-sources` | 图源管理 |
| `GET` | `/api/trash` | 垃圾箱列表 |
| `POST` | `/api/trash/restore` | 从垃圾箱恢复 |
| `POST` | `/api/trash/purge` | 彻底删除垃圾箱项目 |
| `POST` | `/api/folders/create` | 创建文件夹 |
| `POST` | `/api/folders/delete` | 删除文件夹 |
| `POST` | `/api/folders/merge` | 合并文件夹 |

## 安全与限制

- 图片路径解析会限制在已注册图源内，并强制校验支持的图片扩展名和普通文件类型。
- 自定义图库源不再直接信任请求体里的路径、可写状态和导入目标，会进行路径归一化、权限和允许目录校验。
- 写操作和图源配置接口带有同源/Origin 防护。
- 导入接口有单文件大小、总请求大小和文件数量限制，避免磁盘或内存 DoS。
- 插件面向本地或受信任 ComfyUI 环境；如果暴露到局域网或公网，应同时启用 ComfyUI 侧认证和反向代理访问控制。

## 色系索引

图片列表索引和色系索引是分层执行的：基础图片列表先写入 SQLite，保证图库首屏不被像素分析阻塞；当前页图片会优先进入色系补全队列，全库色系索引由后台单线程低优先级补齐。

图片索引支持增量同步：当 `/api/images/freshness` 或手动刷新发现文件变化时，后端优先只 upsert 新增/修改图片并删除已消失图片；只有冷启动、来源签名变化或数据库缺失时才回退全量重建。列表搜索优先使用 SQLite FTS5，色系筛选优先使用 `gallery_image_color_family` 关系表；旧字段继续保留以兼容已有响应格式。

色系分析会优先读取已有 WebP 缩略图；没有缩略图时才回退读取原图。Pillow 会生成：

- `dominant_color`：主色十六进制值。
- `color_family`：基础色系。
- `color_families_text`：达到筛选阈值的色系列表。
- `color_family_scores_json`：各色系在图片中的占比。
- `palette_json`：代表色板。
- `color_saturation`：平均饱和度。
- `color_luma`：平均亮度。

筛选阈值为 25%：单个基础色系在图片中占比达到 25% 才会命中；暖色和冷色按组内色系占比合计判断；低饱和按平均饱和度判断。已有数据库升级到新的 `color_index_version` 后不会阻塞普通图片列表，缺失的色系字段会在后台补全，可通过 `/universal_gallery/api/color-index/status` 查询进度。

## 前端开发

```bash
cd gallery_ui
npm install
npm run dev
npm run build
```

构建使用清理旧输出的内容哈希文件和 Vite manifest。部署时请**整体更新 `gallery_ui/dist/`** 并重启 ComfyUI、刷新浏览器；不要把新内容覆盖到旧 hash 文件名中，否则会破坏不可变资源的哈希语义。若旧页面仍请求已删除的文件，请刷新该页面以获取新的 `index.html` 和 manifest。LoRA 功能还需要同时更新 `web/comfyui/top_menu_extension.js`。

**LoRA 追加与旧标签页：**v1.3 的 ComfyUI 桥接脚本不识别“追加”模式，会把图库发来的堆按旧逻辑写入，导致原有条目消失。更新后须重启 ComfyUI，并对**主界面和图库两个页面**进行强制刷新（Ctrl+Shift+R）。新图库会在发送前校验主界面桥接协议，发现旧脚本会阻止发送并给出提示，而不是冒险覆盖。已经被旧脚本写掉的条目不能由新版本自动恢复，请从工作流历史或备份恢复。图库默认上限为每行 6 张，已保存的密度设置不被重置，窄屏仍自动减少列数。

## 验证

开发环境先安装测试依赖：

```bash
pip install -r requirements-dev.txt
```

Windows 本地推荐使用一键验证脚本；脚本会优先使用 ComfyUI Aki 自带 Python，找不到时回退到 `python`：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify.ps1
```

也可以分步执行：

```bash
D:\comfyui\ComfyUI-aki-v1.5\ComfyUI-aki-v1.5\python\python.exe -m pytest
D:\comfyui\ComfyUI-aki-v1.5\ComfyUI-aki-v1.5\python\python.exe -m compileall py\gallery
cd gallery_ui
npm run typecheck
npm run lint
npm run test:run
npm run audit:security
npm run build
```

从仓库根目录运行 `node --test tests/comfy_lora_stack_bridge.test.mjs` 检查桥接边界条件；真实上游行为另用 `LORA_MANAGER_SOURCE=/path/to/ComfyUI-Lora-Manager node --test tests/comfy_lora_manager_upstream.test.mjs` 测试（CI 自动拉取并固定上游提交 `0a262cbe`，不将其源码拷入本仓库）。可选浏览器回归只应针对 `scripts/preview.py` 建立的**隔离图库**运行，不要将模拟失败／移动／导入脚本指向真实 ComfyUI：例如 `python scripts/browser_lora_stack_channel.py http://127.0.0.1:8189`、`python scripts/browser_masonry_mid.py http://127.0.0.1:8189`、`python scripts/browser_masonry.py http://127.0.0.1:8189`。

CI 在 Windows 执行 Python、前端、i18n 和桥接测试，Linux/macOS 运行后端测试，另有 Linux 任务固定上游源码运行 LoRA Manager 回调集成测试；并用 `npm run audit:security` 阻止 moderate 及以上级别的前端依赖漏洞回归。`npm run build` 生成新的内容哈希资源与 manifest，**不会**改写旧哈希文件；CI 只验证构建，不会自动提交 `gallery_ui/dist/`。发布前需显式提交干净构建产物；真实 ComfyUI/LoRA Manager 和生产图库仍建议在工作流副本上实测。

## 系统要求

- ComfyUI 0.3.0+
- Python 3.10+
- Pillow 10.0.0+
- 现代浏览器：Chrome、Edge、Firefox 或 Safari

## 特别鸣谢

- **韶韵**：感谢提供宝贵的资金支持与使用反馈。

## 许可证

[MIT License](LICENSE.txt) © 2026 Tera-Dark
