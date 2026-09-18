# 1.3.0-rc.1 · 极简工作台与可靠性改造

这是基于上游 `87960b0` / 1.2.10 的**本地候选版本**，未向原 GitHub 仓库推送，也不是上游官方发布。

## 安装前先保护数据

1. 停止 ComfyUI。
2. 备份旧插件的整个 `data/`，以及实际 output/input 和自定义图源目录。`data/trash/` 也属于用户数据，不要遗漏。
3. 将旧插件目录移到 `custom_nodes` 以外的备份位置。不要让新旧两个插件目录同时被 ComfyUI 加载。
4. 将交付 ZIP 中的 `ComfyUI-Universal-Extractor/` 放入 `ComfyUI/custom_nodes/`。
5. **把旧版 `data/` 的全部内容复制回新版 `data/`，用户原文件优先。** 不要让压缩包中的示例 artists.json 覆盖你自己维护的同名词库。
6. 使用运行 ComfyUI 的同一个 Python 安装 `requirements.txt`。本版增加 `Send2Trash>=1.8.3,<2`。
7. 启动 ComfyUI，浏览器强制刷新 `/gallery/` 和 ComfyUI 页面。前端已构建，普通用户不需要 Node.js。

Windows Portable 示例（在便携版根目录执行，目录名按实际调整）：

```powershell
.\python_embeded\python.exe -m pip install -r .\ComfyUI\custom_nodes\ComfyUI-Universal-Extractor\requirements.txt
```

已有 Git 工作副本且有自行修改时，不要直接覆盖。先备份并查看源代码补丁；补丁不含 dist，应用后需要 `npm ci && npm run build`。

## 界面变化

目标是借鉴 ChatGPT 的中性色、低噪声层级和渐进式操作，不复制聊天界面或 OpenAI 品牌。

- 左侧目录：浅灰背景、去卡片套卡片、统一灰色选中状态。
- 顶部工作区切换：下拉选择图库、词库、画师工作台、设置。
- 主区：清晰的目录标题、计数和圆角搜索框；图片是视觉主体。
- 高频操作保留：搜索、筛选、网格/列表、列数、选择模式。
- 双栏整理、变体分组、图版操作和导入目标移入“更多操作”。
- 目录列表/树形切换和展开操作移到目录操作菜单，释放搜索框空间。
- 菜单可用键盘打开、Esc 关闭，执行后回到触发按钮；支持外部点击关闭。
- 移动端侧栏增加可见关闭按钮；收起的侧栏不可被键盘误聚焦。
- 尊重系统减少动画设置。暂不新增深色主题，避免引入另一套未验证的色彩状态。

## 正确性与安全性

### 抽取节点

保留 `UniversalJsonSegmentRandomizer` 类型标识、输出类型和原 widget 顺序，旧工作流不需要重新连线。

- `polling` 通过 `IS_CHANGED` 明确要求重新执行，解决固定输入下缓存可能阻止推进的问题。
- 其他模式将词库内容 SHA-256 纳入失效检测。修改词库内容后不会继续命中旧结果。
- `unique_only` 先按原顺序对词条值去重，不再只保证列表位置唯一。
- 轮询状态使用锁并限制为 2,048 个键；超过限制会淘汰最早未使用的键。进程重启、键淘汰后仍从 seed 起点重新开始，不承诺跨重启持久轮询。
- 节点词库路径使用 realpath，拒绝通过符号链接逃逸 data 目录。

### 可选：保存真实展开提示词

新增 `Universal Prompt Snapshot`，用法：

```text
随机抽取/字符串组合 → Universal Prompt Snapshot → CLIPTextEncode → 采样器
```

正面选 `positive`，负面选 `negative`。它原样返回输入字符串，并在执行时将真实文字写入 `EXTRA_PNGINFO.universal_prompt_snapshots`，不重新执行或猜测上游随机逻辑。

- 该节点每次执行刷新快照，但上游仍可使用缓存。
- 需要正常保存 PNG 元数据的输出节点；禁用元数据或第三方节点丢弃 EXTRA_PNGINFO 时无法保存。
- 图库能按 Snapshot 节点 ID 读取 CLIPTextEncode 的快照输入。
- 这是提示词证据，不是模型、LoRA 文件、软件版本和所有采样参数的完整归档。也不会自动修改已有工作流。
- 多采样器/复杂 conditioning 仍可能无法确定当前图片对应的分支；本版明确提示不完整，不选择任意一个分支冒充准确结果。

### 图库文件操作

图片移动、单张/批量重命名、图片批量进入垃圾箱、目录重命名/合并、图片/目录恢复接入日志或事务辅助路径：

1. 预检查；
2. 写入操作日志和状态快照；
3. 暂存原文件，支持交换文件名；
4. 移动到目的位置并提交状态；
5. 遇到普通异常尽力回滚；回滚失败保留日志并阻止后续日志化操作。

增加的防护：

- 恢复时不会覆盖新生成的同名文件，而是报冲突。
- 恢复到原图源，不把 input/custom 的图片恢复到 output。
- 合并目录不能指向自身的子目录，不遍历符号链接；清理只删除空目录，不用 rmtree 删除突然出现的新文件。
- 跨卷文件移动采用独占创建并清理未完成拷贝；目录整体跨卷原子移动不支持，会报错而不是静默复制/删除整棵树。可用逐图片移动处理这类情况。
- 系统回收站改用 Send2Trash。失败时仍保留插件垃圾箱记录。
- UI 改为“移至系统回收站”，不再误称“彻底删除”。不提供静默永久删除回退。

**边界：** 多文件、文件系统、JSON 和 SQLite 之间不是真正的数据库 ACID 事务；突然断电、文件系统损坏、外部程序同时修改文件时不能保证自动恢复。操作日志用于保留证据，不会自动重放任意路径。词库编辑/导入不在这套图片事务的完整保证范围内。

### 遇到操作日志告警

停止 ComfyUI，备份文件和 data，然后运行只读检查：

```bash
python scripts/inspect_recovery.py /你的插件/data
```

查看 `operation_journal/*.json` 的 source、staging、target、phase 和 state_before。确认每份文件的实际位置后再进行人工恢复。不要盲目删除 `.ue-move-*` 文件或 pending 日志；不要把不可信日志当脚本执行。

## 性能与资源边界

- API 内的同步 service 调用转移到专用串行 worker，避免直接阻塞 ComfyUI HTTP 事件循环。
- 最多 16 个排队/执行中的 service 工作；拥塞时返回 503 和 Retry-After，不无限积压。
- HTTP 客户端离开不取消已经提交的文件写操作；槽位在真实工作完成后才释放。
- 这不是完整后台作业系统：没有新增跨请求的进度/取消 API，耗时操作仍需等待结果；CPU 密集工作仍在同一 Python 进程，需要后续大图库性能测试。
- 相似图候选改为分段 Hamming 索引，保留精确半径校验。退化哈希下最坏复杂度仍可能是平方级，2,000 张扫描上限仍保留。
- 不完整/空提示词不进入“同 Prompt”分组；指纹版本升级自动使旧派生指纹失效。
- API 返回扫描数量/上限；UI 明确说明扫描范围和“规则评分不是概率”。
- 前端预加载队列最多 80 项、并发 4，卡住的请求 15 秒后释放工作槽位；已有加载 URL 集合仍限制 2,500 项。

## 数据路径与部署

默认仍使用插件 `data/`，避免静默迁移。可选：

```text
UNIVERSAL_EXTRACTOR_DATA_DIR=/长期保存的/UniversalExtractorData
```

启用前停止 ComfyUI，复制整个原 data 到新路径，并在启动环境设置变量。索引、垃圾箱、状态和词库都随该目录走。新目录为空时不会自动复制旧词库。

同源检查不是身份认证。不要将带文件读写权限的 ComfyUI 直接暴露到公网；使用可信反向代理认证/网络访问控制。多 ComfyUI 进程同时写一个 data 目录不受支持。

## 构建与验证

```bash
python -m pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -q
python -m compileall -q py
cd gallery_ui
npm ci
npm run typecheck
npm run lint
npm run test:run
npm run audit:security
npm run build
npm run audit:dist
cd ..
python scripts/check_release.py
```

本版构建会清理旧 dist，并用 Vite manifest 检查所有新资源存在，不再覆盖旧哈希名称。升级后旧标签页需要刷新。

安全审计网络不可用现在算“未通过验证”，不再静默成功。锁文件已更新修复本次审计发现的 Vitest/mocker 和 js-yaml 问题。

CI 新增 Linux/macOS + Python 3.10/3.13 矩阵；现有 Windows + Python 3.11 完整校验保留。**新增 CI 配置不代表这些平台已在本次环境实际执行通过。**

## 本次仍需真实环境验收

- 真实 ComfyUI 固定 seed 连续排队、polling、缓存和 Snapshot PNG 保存。
- 你的自定义输出节点、LoRA Manager 版本、多浏览器工作流回传。
- Windows/macOS 的系统回收站、网络盘、不同磁盘权限。
- 万张以上图库的冷索引、扫描延迟、内存/CPU 占用与同时出图。
- 非正常退出时的人工恢复演练。

这个 RC 不建议直接替换唯一的生产图库。先用备份/小图源试用，再迁移日常数据。
