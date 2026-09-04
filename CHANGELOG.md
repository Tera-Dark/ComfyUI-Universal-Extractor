# Changelog

All notable changes to the ComfyUI Universal Extractor project will be documented in this file.

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
