# 1.6.0 基础架构、接入与恢复手册

本版保持图片管理功能和旧 API，新增持久资源身份与本机任务调度。视频、音频、图像向量搜索、提示词版本库和外部项目管理尚未交付。

## 数据与安装

- `gallery_state.json` 仍是收藏、笔记、分类及图版的唯一权威来源，未迁入 SQLite。
- `catalog.sqlite3` 是新增的权威目录，保存 `assets`、`jobs`、`catalog_meta`、`catalog_migrations`。**不能删除重建**。正在运行时可能有 `-wal` / `-shm` 文件。
- `gallery_index.sqlite3` 仍为派生索引，schema 9 增加缓存的资源 ID、内容版本、指纹所属版本和 `gallery_folders` 目录快照；可从来源和权威数据重建。上下文请求不再遍历目录，旧版升级可先读现有图片，再异步补齐空目录快照。
- 原图仍留在注册图源内；默认 input 只读，外部来源权限规则不变。`UNIVERSAL_EXTRACTOR_DATA_DIR` 继续可选，不自动搬迁旧数据。
- 升级前停止 ComfyUI，备份整个 data 和实际来源；完整替换前端 dist，重启 ComfyUI 并刷新图库及已有 ComfyUI 页面。不要将新旧两份插件同时放进 custom_nodes。
- 无新增模型、GPU、数据库服务或运行时 Python 依赖。普通用户无需 Node.js。

首次登记从已有索引分批建立 ID，不重新哈希全部原图；能 stat 的文件记录纳秒时间。插件内改名、移动、入垃圾箱和恢复保留 ID；复制/导入独立登记。导入不会占用已有缺失资源的位置。原地内容修改递增内容版本并清除旧的分析结果。外部移动按旧位置缺失、新位置新增处理，不通过路径后缀或相同哈希自动继承笔记。首次升级中从未登记的历史 Pin 路径仍保留带备份的保守修复。来源根目录更改形成新的命名空间。

目录库无法打开时不自动重建。已有图片索引允许继续浏览；`context` 返回 `catalog_error` / `read_only`，图库显示原因，修改与任务接口返回 503。保留目录库、WAL 和操作日志，在停止服务后检查备份与恢复证据。

## 模块与执行边界

`service.py` 保留兼容导出。`sources.py`、`indexing.py`、`file_ops.py`、`libraries.py`、`media_service.py` 通过显式 `ServiceEnvironment` 获取宿主依赖，不反向导入 facade。现有绑定适配器保留旧测试/调用方的 monkeypatch 兼容，不代表新增领域代码可以自行读取 ComfyUI 全局。

`GalleryRuntime` 管理目录库、WAL 锚点、执行器与调度器，在 aiohttp cleanup 生命周期等待工作完成并关闭。测试夹具使用独立临时目录并等待清理，避免后台线程在下一测试的路径上运行。

| 通道 | 线程 / 边界 |
| --- | --- |
| HTTP 普通查询 | 2 线程，32 个运行及等待请求 |
| 文件及用户状态修改 | 1 线程，16 个请求；沿用文件/状态锁 |
| 目录扫描 | 1 线程 |
| 指纹、颜色和尺寸分析 | 共享 2 线程 |
| 缩略图预热及按需生成 | 2 路生成限制，宿主拥有预热线程 |
| 上传 | 最多 2 个会话，2 路磁盘工作 |
| 持久任务待执行队列 | 最多 256 条，同类同版本活动任务合并 |

HTTP 热列表通过只读连接查询已提交快照，复用当前请求的来源快照，不做 schema 迁移、扫描、解码或 JSON→索引同步。旧 Python facade 的直接调用仍保留同步维护语义，不能把它当作只读连接使用。手动强制刷新等待同一个后台扫描任务；同源保护仍覆盖所有 API。

普通读取的已校验图源配置快照最多保留一秒，配置文件修改或默认根目录变化会立即失效；修改和扫描仍重新校验。路径已在图源入口规范化，计算来源签名不重复访问文件系统。

计算在写事务外进行，结果短事务提交；指纹和衍生尺寸/颜色写入前重新核对文件和资源版本。扫描提交核对来源修改代数，过期结果重新扫描。扫描遇到读取失败时保守保留对应来源的已有记录。freshness 仍按当前范围检查，保留关闭开关，没有引入目录监听器。

`MediaProcessor` 固定 `probe`、`extract_metadata`、`build_preview`、`build_fingerprints` 四类能力，本版仅注册 `ImageProcessor`。元数据、预览和指纹仍受原有 Pillow 解码限制保护。多媒体格式不要仅添加到扩展名常量而绕过处理器。

## API 接入

所有接口仍位于 `/universal_gallery/api/`。旧图片列表、变体成员与新建图片垃圾箱记录增加 `asset_id`；索引记录增加 `content_revision` / `media_type: "image"`。旧路径、分页及操作字段继续支持，旧垃圾箱记录可以没有 ID，恢复时登记。

### 创建任务

```http
POST /universal_gallery/api/jobs
Content-Type: application/json

{"kind":"refresh_index","payload":{"subfolder":"default_output::","force":true}}
```

返回 202 和 `{"job": {...}}`。另一种公开类型为 `fingerprint_assets`，payload 支持 `relative_paths`（最多 2000）、`subfolder`、`limit`（1–2000）及已有搜索/分类/图版/日期/Pin/色系条件。默认指纹处理批次仍为 360；变体候选上限仍为 2000，不应将它称为全库以图搜图。

不接受任意任务类型、私有参数、命令或未注册路径。公开参数采用后端 snake_case。`colors`、`dimensions` 仅由内部调度。旧 force_refresh、指纹预热及变体接口仍等待任务结果并返回兼容结构。

### 查询与取消

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/jobs?page=1&limit=50` | 分页返回 jobs、total、page、limit；limit 1–120 |
| GET | `/jobs?active=true` | 仅返回活动任务 |
| GET | `/jobs/{id}` | 返回单个 job |
| POST | `/jobs/{id}/cancel` | 请求在安全检查点取消分析 |

任务含 `id`、`kind`、`state`、`completed`、`total`、`error`、`attempts`、创建/更新时间及 payload。状态为 queued、running、cancelling、succeeded、failed、cancelled。进度是处理数量，不是预计剩余时间。

任务 payload 中的 `_processor_version` 由服务器记录；下划线开头的字段属于内部快照，调用方不得提交。损坏/超限图片继续可浏览，内部尺寸和颜色任务在 `result.failed` 与 `result.diagnostics` 中保留最多 50 条样本诊断，不将解码失败伪装为黑色图片。

400 表示不合法参数，403 表示跨源，404 表示任务不存在，503 表示服务只读或队列拥塞。网络响应丢失不等于任务已取消。可重试 I/O 错误最多重试两次，间隔 2 秒、10 秒；权限和输入错误不自动重试。服务重启后重新排队可重复的未完成任务，不自动执行文件事务日志。

前端通过现有右下角状态中心展示公开任务；页面可见并存在活动任务时合并轮询，完成后停止。失败可重试，换页/隐藏/卸载会取消 GET，不会终止已开始的文件提交。旧服务器缺少任务接口时，图库继续工作。

## 文件操作与上传恢复

文件移动日志在 `operation_journal/`，包含 JSON 快照及 `catalog_before` / `catalog_after`。回滚失败时保留证据并阻止后续文件操作。移至系统回收站不可可靠自动撤销：若文件已移走但后续目录/垃圾箱状态提交失败，保留 purge 恢复记录，不假报成功。这是补偿协议，不是跨文件系统 ACID。

上传日志在 `upload_journal/`。文件先放入目标卷的 `.ue-uploads/{session-id}/*.part`，不参与图库列表；全部接收完成后重新校验权限并独占发布。当前发布依赖目标卷支持同卷硬链接；不支持时明确失败并回滚，不采用可能覆盖文件的重命名回退。会话只清理有所有权证据的文件；用户文件被外部替换或证据不完整时保留日志，要求人工检查。

启动时先恢复日志记录的上传会话并使派生快照失效，再恢复持久任务；不按年龄清扫目录。目录库损坏时停止自动上传恢复。上传与文件移动的专用暂存目录不参与图片、目录或 freshness 扫描。

恢复步骤：

1. 停止 ComfyUI，备份 data 与涉及的来源目录，包含暂存文件。
2. 运行只读检查：`python scripts/inspect_recovery.py /你的/data`。
3. 对照文件位置、JSON 快照和目录库身份，确认哪些提交已完成。purge 还需检查系统回收站。
4. 有可信一致备份时整体恢复；需要保留后续编辑时逐项核对，不能直接用旧 JSON 覆盖新数据。
5. 确认没有未解决事务后才重新启动。不要把日志当脚本执行或直接删除告警。

回滚代码时，保持当前兼容 JSON 和原文件，保留目录库以便再次升级；不要删除目录库“重置”。完整替换旧版 dist 并刷新页面。

## 验证与明确限制

完整验证：`powershell -ExecutionPolicy Bypass -File scripts/verify.ps1`。机器没有 D 盘 ComfyUI Python 时脚本回退到 PATH 中的 Python。

性能复现：

```powershell
python scripts/benchmark_gallery.py --output artifacts/foundation-after.json --compare artifacts/foundation-baseline.json
```

基准使用隔离图片和合成索引，5 次预热、30 次采样。新版本热查询使用 HTTP 同样的只读/来源快照上下文；不是完整 HTTP 或浏览器端耗时。对照基线来自改造前的固定提交，同样不含请求排队。冷启动样本包含首次目录库登记成本，不宣称首次升级更快。真实图库、NAS、长时间运行、实际 ComfyUI/GPU 推理仍需独立实机验证。

浏览器验证使用 `scripts/preview.py` 创建的临时数据，不执行真实推理。LoRA 真实上游兼容测试固定版本，脚本对 Windows CRLF 做换行规范化，执行的仍为上游原始 setter/callback 代码。项目入口、语义搜索和视频音频将在后续独立版本交付。

本次环境、完整检查和性能数据见 [1.6.0 验证记录](VALIDATION-1.6.0.md)。历史 1.3.x 升级/验收文档和 1.2.10 维护记录保留为版本档案，不作为当前部署指南。
