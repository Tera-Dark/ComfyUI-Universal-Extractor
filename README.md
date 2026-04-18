# ComfyUI-Universal-Extractor

为 ComfyUI 打造的**万能文本抽取**与**极美本地图库管家**。

## 🌟 核心功能

1. **🎲 万能文本抽取节点 (Universal Extractor)**
   - 全面支持 `.json` 格式文本阵列读取与随机抽签，兼容 `artist-generator` 项目风格的数据。
   - 支持自定义抽取数量、前缀后缀包装（例：`(抽签数据:1.2)`）、多模式生成（纯随机或按顺序）。

2. **🖼️ 现代灵感图库管家 (Output Gallery)**
   - 即插即用的超美观前端画廊，无需额外配置，自动读取分析 ComfyUI 原生 `output` 文件夹的产出物。
   - 提供瀑布流显示、本地生成信息预览与参数一键抓回（UI布局致敬 Lora-Manager 的极品体验）。
   - 包含毛玻璃特效与微动画视觉，丝毫不输顶尖 WebApp。

## 📥 安装步骤

方法一：通过 Git 克隆（推荐）
进入您的 ComfyUI 插件目录 `ComfyUI/custom_nodes/` 下：
```bash
git clone https://github.com/您的用户名/ComfyUI-Universal-Extractor.git
```
重启 ComfyUI，大功告成！

方法二：通过 ComfyUI Manager 安装
等待并搜索：`Universal Extractor`，一键安装。

## ⚙️ 如何使用

### 图库管家
环境启动后，直接在浏览器中访问您的正常端口后缀添加 `/gallery`，例如默认的：
> [http://127.0.0.1:8188/gallery](http://127.0.0.1:8188/gallery)

### 抽取数据源提供
节点会自动读取该插件文件夹下面 `data/` 目录中存放的所有 `.json`。
格式支持类似 `artist-generator` 提供的属性，或者是纯粹的字符串数组。
只要数据合规，便可以在节点内无缝下拉挑选。
