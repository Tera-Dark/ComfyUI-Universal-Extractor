# 🌟 ComfyUI-Universal-Extractor

为 ComfyUI 打造的**万能文本抽取（抽签）**与**极美灵感图库管家**的综合增强插件。
它让您能够在 ComfyUI 中极为方便地管理与调用外部海量的文本资源库（例如画师名、风格、关键词串），并以现代化的高级用户界面浏览您的生成作品。

---

## ✨ 核心功能亮点

### 1. 🎲 Universal Extractor (万能抽取节点)
- **多词库无缝切换**：自动扫描并读取 `data/` 目录下的所有 JSON 文件，支持在节点界面下拉菜单中随时切换抽取词库。
- **自定义拼装**：您可以定义抽取条目数量、随机或顺序抽取模式、并且支持 `前缀/后缀/连接符` 动态拼接（例如设置前缀为 `(`，后缀为 `:1.2)` 即可为所有抽到的词自动增加权重包装）。
- **兼容性极强**：完美兼容 `artist-generator` 格式的高级 JSON 数据块，也能识别只包含单纯字符串数组的基础 `.json` 格式。

### 2. 🖼️ Output Gallery (极美本地图库管家)
- **顶级 UI 体验**：基于 React + Vite + Tailwind v4 打造的现代 Web 设计页面，毛玻璃卡片、微交互动画、瀑布流展示，丝滑流畅体验堪比商业级 Web App。
- **无感集成**：无需繁琐的配置，自动注入 ComfyUI。界面会在 ComfyUI 顶部菜单栏追加一个带特效的 **"✨ 紫色渐变按钮"**，点击即可（Shift+Click 可新窗口）开启沉浸图库。
- **元数据深层读取**：点击图库中任意图片，不仅可以看到该图片的体积、时间，更能**自动还原 ComfyUI 生成它时内嵌的工作流 JSON 数据**！

### 3. 🎨 画师库独立管理 (Artist Library CRUD)
- **内置数据编排**：图库侧边栏独立的 "Artist Library" 功能，允许您离开 IDE 直接在网页内增删改查您收集的那些 `.json` 词源库。
- **可复查源数据**：如果某张图像在生成时使用了我们的 Extractor 节点或包含 `by xxx` 等画师痕迹的编码节点，图库管家将**深度分析并明确提炼出**这张图具体借用了哪些『画师提示词串』。

---

## 🧩 节点说明

该插件目前提供了一枚核心节点（在 `Universal Tools` 类别下可以找到）：

### **🌟 Universal Extractor (万能抽签)**
**输入 (Inputs):**
- **`file_name`**: 选择要读取的数据源 JSON 文件（会自动匹配 `data/` 下的所有可用文件）。
- **`extract_count`**: 决定从指定库中抽出几条记录。
- **`mode`**: 抽取规则，`random`（随机盲盒）或 `sequential`（按顺序按页轮转）。
- **`prefix`**: 每一条被抽出来的文本前面加什么（如 `(artist:`）。
- **`suffix`**: 每一条被抽出来的文本后面加什么（如 `:1.5)`）。
- **`separator`**: 合并多条数据的连接符（通常保留默认的 `, ` 即可）。
- **`seed`**: 随机种子值，保证生成的稳定性。

**输出 (Outputs):**
- **`Prompt (STRING)`**: 一段拼接完毕、立刻可以直接传给 `CLIP Text Encode` 的字符串。

---

## ⚙️ 如何使用

### 一、图库与画师库访问
1. **顶栏一键直达**：在 ComfyUI 工作流上方，会悬浮一个带有 ✨ 图标的小按钮，点击它就能立刻打开图文世界！
2. **端口直达**：如果您在其他设备局域网访问，直接输入您的 ComfyUI 根地址再加上 `/gallery` 即可。比如：`http://127.0.0.1:8188/gallery`。

### 二、管理您的 JSON 抽签数据源
插件在 `data/` 文件夹下专门负责存放这些数据源。
您可以通过打开图库 -> 左侧切换至 **Artist Library** 来新建、修改这些 JSON 文件；这会实时影响 Extractor 节点下拉菜单里的内容。

数据格式极其自由。哪怕是最简结构：
```json
[
  "greg rutkowski", 
  "wlop", 
  "alphonse mucha"
]
```
或者类似 `artist-generator` 含有丰富元属性的格式（带 `title`, `prompt`），它都会聪明地进行兼容读取。

---

## 📥 安装步骤

方法一：通过 Git 克隆（最快最佳）
将终端路径进入您的 ComfyUI 插件目录 `ComfyUI/custom_nodes/` 下：
```bash
git clone https://github.com/您的用户名/ComfyUI-Universal-Extractor.git
```
重启 ComfyUI，即可使用！

方法二：通过 ComfyUI Manager (即将上线)
打开 Manager -> Install Custom Nodes，搜索：`Universal Extractor` 点击安装并重启。
