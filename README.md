<p align="center">
  <img src="https://raw.githubusercontent.com/Tera-Dark/ComfyUI-Universal-Extractor/master/gallery_ui/public/favicon.svg" width="96" height="96" alt="Universal Extractor Logo" />
</p>

<h1 align="center">ComfyUI Universal Extractor</h1>

<p align="center">
  <strong>一站式 ComfyUI 图库管理 & 提示词资源库工具</strong>
</p>

<p align="center">
  <a href="https://github.com/Tera-Dark/ComfyUI-Universal-Extractor"><img src="https://img.shields.io/badge/version-1.1.1-blue?style=flat-square" alt="version" /></a>
  <a href="https://github.com/Tera-Dark/ComfyUI-Universal-Extractor/blob/main/LICENSE.txt"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license" /></a>
  <img src="https://img.shields.io/badge/python-%3E%3D3.10-blue?style=flat-square" alt="python" />
  <img src="https://img.shields.io/badge/comfyui-%3E%3D0.3.0-orange?style=flat-square" alt="comfyui" />
</p>

---

## 📖 简介

**ComfyUI Universal Extractor** 是一个功能丰富的 ComfyUI 自定义节点插件，提供两大核心能力：

1. **Universal Extractor 节点** — 从 JSON 提示词库中随机/顺序抽取文本，快速构建动态提示词工作流
2. **Universal Gallery 图库工作台** — 一个独立的全功能 Web 图库管理界面，用于浏览、组织、标注你的 AI 生成图片，以及管理提示词资源库

支持多语言界面（中文 / English），提供深色主题、极简白色主题的专业 UI 体验。

---

## ✨ 功能特性

### 🎯 Extractor 节点

在 ComfyUI 工作流中直接使用的自定义节点，用于从 JSON 文件中抽取提示词文本。

| 参数                  | 说明                                  |
| ------------------- | ----------------------------------- |
| `file_name`         | 选择 `data/` 目录下的 JSON 提示词库文件         |
| `extract_count`     | 抽取数量（1 ~ 100）                       |
| `mode`              | 抽取模式：`random`（随机）或 `sequential`（顺序） |
| `prefix` / `suffix` | 为每条抽取结果添加前缀/后缀                      |
| `separator`         | 多条结果之间的分隔符                          |
| `seed`              | 随机种子，确保可复现性                         |

> 节点会自动识别 JSON 数组中的字符串、`{prompt: ...}`、`{name: ...}`、`{title: ...}` 等多种数据格式。

---

### 🖼️ Gallery 图库工作台

通过 ComfyUI 顶部菜单栏的按钮打开，或直接访问 `http://<host>:<port>/gallery/`。

#### 📂 多图源管理

- **默认图源** — 自动挂载 ComfyUI 的 `output/` 和 `input/` 目录
- **自定义图源** — 可添加任意本地文件夹作为图片来源
- **图源诊断** — 实时检测各图源的可用性、读写权限、磁盘空间、路径重叠等
- 支持递归扫描子目录，自动索引所有 `.png`、`.jpg`、`.jpeg`、`.webp` 格式图片

#### 🔍 图片浏览与检索

- **缩略图瀑布流** — 自动生成 WebP 缩略图，支持后台预热加速首屏加载
- **智能搜索** — 按文件名、标题、分类、笔记等字段全文检索
- **多维筛选** — 按子文件夹、分类、画板、日期范围、收藏状态组合筛选
- **排序** — 支持按创建时间、文件名、文件大小排序（升序/降序）
- **分页加载** — SQLite 索引驱动的高性能分页查询

#### 🏷️ 图片标注与组织

- **收藏 / 置顶** — 快速标记重要图片
- **分类标签** — 为图片添加自定义分类
- **标题 & 笔记** — 为每张图片添加标题和详细笔记
- **画板系统** — 创建主题画板，将图片归档到不同画板中
- **批量操作** — 支持批量修改分类、收藏状态、添加到画板

#### 📁 文件管理

- **重命名** — 单张或批量重命名图片（支持 `{n}`、`{name}`、`{page}` 模板变量）
- **移动** — 在不同图源和子文件夹之间移动图片
- **删除** — 安全删除至内置回收站，支持恢复或彻底删除
- **文件夹管理** — 创建、删除、合并文件夹
- **导入** — 通过拖拽或选择文件导入图片和资源库文件

#### 🔬 图片详情

- **元数据解析** — 自动读取 PNG 内嵌的 ComfyUI 工作流和提示词信息
- **Prompt 摘要** — 提取正向/负向提示词、采样器、步数、CFG、尺寸等关键参数
- **工作流还原** — 一键将图片的工作流加载回 ComfyUI 编辑器
- **图片导航** — 在筛选结果中使用键盘左右键快速切换图片

---

### 📚 Library 资源库

在 Gallery 工作台内切换到「Library」标签页即可使用。

- **资源库管理** — 管理 `data/` 目录下的所有 JSON 提示词库文件
- **条目浏览** — 分页浏览资源库内的条目，支持搜索过滤
- **条目编辑** — 新增、编辑、删除单条资源库条目
- **导入** — 上传 JSON 文件，支持新建、替换、合并三种导入模式
- **导出** — 查看和复制原始 JSON 内容
- **数据验证** — 导入和保存时自动校验数据格式

---

### 🎨 Workbench 画师工作台

在 Gallery 工作台内切换到「Workbench」标签页即可使用。专为画师提示词库设计的高级工具。

- **画师搜索** — 从画师资源库中搜索艺术家（支持别名匹配）
- **帖子数筛选** — 按帖子数量大于/小于阈值过滤画师
- **随机抽取** — 从匹配结果中随机选取指定数量的画师
- **多种格式输出**：
  - `standard` — 带权重的标准格式，如 `(artist:1.2)`
  - `creative` — 嵌套括号格式，如 `((artist))`
  - `nai` — NovelAI 权重格式，如 `1.2::artist ::`
- **权重范围** — 可自定义权重的最小值和最大值
- **自定义格式** — 支持 `{name}` 占位符的自定义格式模板
- **一键复制** — 生成后直接复制到剪贴板

---

### ⚙️ Settings 设置

- **图源配置** — 添加、编辑、启用/禁用图片来源
- **路径检测** — 测试路径有效性和图片数量
- **导入目标** — 指定图片导入的默认目标图源和子文件夹
- **诊断面板** — 查看所有图源的详细健康状态

---

## 🚀 安装

### 方式一：ComfyUI Manager（推荐）

在 ComfyUI Manager 中搜索 **"Universal Extractor"** 并安装。

### 方式二：手动安装

```bash
# 进入 ComfyUI 的自定义节点目录
cd ComfyUI/custom_nodes

# 克隆仓库
git clone https://github.com/Tera-Dark/ComfyUI-Universal-Extractor.git

# 安装 Python 依赖
pip install -r ComfyUI-Universal-Extractor/requirements.txt
```

### 方式三：通过 ComfyUI Registry

```bash
comfy node registry-install tera-universal-extractor
```

> **注意**：Gallery UI 的前端构建产物（`gallery_ui/dist/`）已包含在仓库中，无需额外执行 `npm run build`。

---

## 📁 目录结构

```
ComfyUI-Universal-Extractor/
├── __init__.py                  # ComfyUI 插件入口
├── pyproject.toml               # 项目元数据 & ComfyUI Registry 配置
├── requirements.txt             # Python 依赖（Pillow）
│
├── py/                          # Python 后端
│   ├── plugin.py                # 插件加载器
│   ├── constants.py             # 路径和全局常量
│   ├── paths.py                 # 路径解析与文件工具
│   ├── nodes/
│   │   └── extractor_node.py    # Extractor 节点实现
│   └── gallery/
│       ├── routes.py            # REST API 路由定义
│       ├── service.py           # 图库核心业务逻辑
│       ├── state_store.py       # 图片状态 & 画板持久化
│       └── metadata.py          # 图片元数据提取
│
├── web/comfyui/
│   └── top_menu_extension.js    # ComfyUI 顶部菜单栏按钮注入
│
├── gallery_ui/                  # React 前端（Vite + TypeScript + Tailwind）
│   ├── src/
│   │   ├── App.tsx              # 主应用组件
│   │   ├── components/
│   │   │   ├── gallery/         # 图库工作区组件
│   │   │   ├── library/         # 资源库工作区组件
│   │   │   ├── workbench/       # 画师工作台组件
│   │   │   ├── settings/        # 设置页面组件
│   │   │   └── shared/          # 通用组件（导航、侧边栏、对话框等）
│   │   ├── hooks/               # 自定义 React Hooks
│   │   ├── services/            # API 请求封装
│   │   ├── styles/              # CSS 样式文件
│   │   ├── types/               # TypeScript 类型定义
│   │   ├── i18n/                # 国际化（中文 / English）
│   │   └── utils/               # 工具函数
│   └── dist/                    # 前端构建产物（随仓库发布）
│
└── data/                        # 运行时数据目录
    ├── *.json                   # 提示词库文件
    ├── gallery_state.json       # 图片状态持久化
    ├── gallery_sources.json     # 图源配置
    ├── gallery_index.sqlite3    # 图片索引数据库
    ├── thumb_cache/             # 缩略图缓存
    └── trash/                   # 回收站
```

---

## 🛠️ 技术栈

| 层级             | 技术                                 |
| -------------- | ---------------------------------- |
| **ComfyUI 节点** | Python 3.10+, Pillow               |
| **后端 API**     | aiohttp (ComfyUI PromptServer)     |
| **数据存储**       | SQLite (WAL 模式), JSON 文件           |
| **前端框架**       | React 19, TypeScript 6, Vite 8     |
| **UI 样式**      | Tailwind CSS 4, Lucide React Icons |
| **缩略图**        | Pillow WebP 生成, 后台线程池预热            |
| **国际化**        | 自研 i18n（中文 / English）              |

---

## 🔌 API 端点概览

所有 API 挂载在 `/universal_gallery/api/` 路径下：

| 方法         | 端点                              | 说明                   |
| ---------- | ------------------------------- | -------------------- |
| `GET`      | `/api/context`                  | 获取图库上下文（图源、画板、分类等）   |
| `GET`      | `/api/images`                   | 分页查询图片列表（支持搜索/筛选/排序） |
| `GET`      | `/api/metadata`                 | 获取图片元数据与工作流信息        |
| `GET`      | `/api/thumb`                    | 获取图片缩略图              |
| `POST`     | `/api/thumb/prewarm`            | 批量预热缩略图              |
| `POST`     | `/api/image-state`              | 更新图片状态（收藏、分类、笔记等）    |
| `POST`     | `/api/import`                   | 导入图片或资源库文件           |
| `POST`     | `/api/images/delete`            | 删除图片（移入回收站）          |
| `POST`     | `/api/images/move`              | 移动图片到指定文件夹           |
| `POST`     | `/api/images/rename`            | 重命名图片                |
| `POST`     | `/api/images/batch-update`      | 批量更新图片状态             |
| `POST`     | `/api/images/batch-rename`      | 批量重命名图片              |
| `GET/POST` | `/api/boards`                   | 画板 CRUD 操作           |
| `GET/POST` | `/api/libraries`                | 资源库列表与保存             |
| `GET`      | `/api/library/entries`          | 分页浏览资源库条目            |
| `POST`     | `/api/library/import`           | 导入资源库文件              |
| `POST`     | `/api/library/generate-artists` | 生成画师提示词字符串           |
| `GET/POST` | `/api/settings/gallery-sources` | 图源管理                 |
| `GET`      | `/api/trash`                    | 回收站列表                |
| `POST`     | `/api/trash/restore`            | 从回收站恢复               |
| `POST`     | `/api/trash/purge`              | 彻底删除回收站项目            |
| `POST`     | `/api/folders/create`           | 创建文件夹                |
| `POST`     | `/api/folders/delete`           | 删除文件夹                |
| `POST`     | `/api/folders/merge`            | 合并文件夹                |

---

## 🌐 工作流集成

Gallery 支持将图片的工作流信息发送回 ComfyUI 编辑器：

- **BroadcastChannel** — 同源跨标签页实时通信
- **localStorage** — 跨窗口工作流传递
- **postMessage** — 父子窗口消息传递

在图片详情页面点击「加载工作流」按钮，即可将该图片的完整工作流或 API Prompt 一键还原到 ComfyUI 画布中。

---

## 📋 系统要求

- **ComfyUI** ≥ 0.3.0
- **Python** ≥ 3.10
- **Pillow** ≥ 10.0.0（用于缩略图生成和元数据读取）
- 现代浏览器（Chrome / Edge / Firefox / Safari）

---

## 🙏 特别鸣谢

- **韶韵** - 感谢提供宝贵的资金支持与使用反馈！

---

## 📄 许可证

[MIT License](LICENSE.txt) © 2026 Tera-Dark
