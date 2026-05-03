# ComfyUI Universal Extractor

ComfyUI Universal Extractor 是一个 ComfyUI 自定义节点和图库工作台插件，包含两块核心能力：

- **Universal Extractor 节点**：从 `data/` 里的 JSON 提示词库随机或顺序抽取文本，用于构建动态提示词工作流。
- **Universal Gallery 图库工作台**：在浏览器中管理 ComfyUI 图片输出、图版、分类、垃圾箱、词库和画师工作台。

前端支持中文和英文界面，图库页面使用轻量、偏工具型的三栏布局：左侧资源栏、中间浏览区、右侧 Inspector。

## 功能概览

### Extractor 节点

| 参数 | 说明 |
| --- | --- |
| `file_name` | 选择 `data/` 目录下的 JSON 提示词库文件 |
| `extract_count` | 抽取数量，范围 1 到 100 |
| `mode` | 抽取模式：`random` 随机，`sequential` 顺序 |
| `prefix` / `suffix` | 为每条抽取结果添加前缀或后缀 |
| `separator` | 多条结果之间的分隔符 |
| `seed` | 随机种子，保证可复现 |

节点会自动识别 JSON 数组中的字符串、`prompt`、`name`、`title` 等常见字段。

### Gallery 图库工作台

访问方式：

- ComfyUI 顶部菜单进入 Gallery。
- 直接访问 `http://<host>:<port>/gallery/`。

主要能力：

- **多图源管理**：默认挂载 ComfyUI `output/` 和 `input/`，自定义图源会经过路径、权限和导入目标校验。
- **图片索引**：SQLite 分页索引图片路径、大小、时间、状态、主色、色系占比和色板。
- **缩略图与预热**：使用 Pillow 生成 WebP 缩略图，并支持后台预热。
- **统一筛选面板**：分类、排序字段、升降序、日期范围、Pin 状态和色系筛选统一收纳在筛选入口中；面板采用固定头部、可滚动内容区和固定底部，色系筛选使用紧凑调色板布局。
- **色系筛选**：支持红、橙、黄、绿、青、蓝、紫、粉、棕、黑、白、灰，以及暖色、冷色、低饱和分组；单个色系占比达到 25% 才会命中筛选。
- **网格/列表模式**：图库、垃圾箱、词库子项目均支持两种常见排列方式。
- **资源栏导航**：快捷入口固定在侧边栏顶部，输出目录、图版和分类共用一个滚动区；输出目录支持搜索、树形/列表切换、置顶、排序和右键管理。
- **选择交互**：默认关闭选择模式，单击图片打开详情；开启选择模式后支持左键拖选、Shift 连选、右键菜单和悬浮操作。
- **右侧 Inspector**：普通图库页选中图片后，桌面端显示贴屏右侧详情栏并挤压中间内容；移动端以抽屉展示。
- **图片详情页**：支持左右翻页、键盘导航、缩放、双击背景退出、发送工作流到 ComfyUI；如果 ComfyUI 已打开，会通过消息通道加载到现有页面，避免触发离开页面确认。
- **Metadata 与提示词**：支持查看图片 Metadata，并可从右键菜单或详情入口一键复制正面提示词。
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
- 配置界面与交互偏好，包括默认选择模式、发送工作流前确认、启动时收起侧边栏、图片预加载和目录默认视图。

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
│       └── metadata.py
├── web/comfyui/
│   └── top_menu_extension.js
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
- `gallery_sources.json`：图库源配置。
- `gallery_index.sqlite3`：图片分页索引，包含色系和色板字段。
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
| `GET` | `/api/image-file` | 读取图片文件，仅允许受支持的图片扩展名 |
| `GET` | `/api/metadata` | 获取图片元数据和工作流信息 |
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

构建后如果 ComfyUI 或浏览器仍请求旧 hash 文件，可能出现静态资源 404。发布或本地验证时，需要把最新构建产物同步到旧 hash 兼容文件名，或清理浏览器和 ComfyUI 侧缓存。

## 验证

推荐在提交前执行：

```bash
cd gallery_ui
npm run build
cd ..
python -m compileall py\gallery
```

如果修改了 TypeScript 类型或组件，也建议执行：

```bash
cd gallery_ui
npm run lint
```

## 系统要求

- ComfyUI 0.3.0+
- Python 3.10+
- Pillow 10.0.0+
- 现代浏览器：Chrome、Edge、Firefox 或 Safari

## 特别鸣谢

- **韶韵**：感谢提供宝贵的资金支持与使用反馈。

## 许可证

[MIT License](LICENSE.txt) © 2026 Tera-Dark
