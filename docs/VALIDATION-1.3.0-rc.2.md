# RC2 验证记录

日期：2026-09-18。上游基线 `87960b0`；本轮修改基线 `4075389`（RC1）。本地分支 `improvement/minimal-workspace`，未推送上游。

## 实际执行

| 检查 | 本轮结果 |
|---|---|
| Python / Linux / Python 3.13 | **103 passed** |
| 前端 Vitest | **131 passed / 28 files** |
| TypeScript | 通过 |
| ESLint | 通过，0 errors / 0 warnings |
| i18n AST/字典审计 | **833 keys**；中英文键、占位符一致；静态 `t()` 无缺键；无硬编码中文 JSX |
| npm 安全审计 | 查询成功，**0 vulnerabilities** |
| Vite 生产构建 | 通过 |
| manifest / 入口资源审计 | **14 项资源引用通过** |
| 版本与 CHANGELOG 一致性 | 1.3.0-rc.2 通过 |
| Python 编译检查 | 通过 |
| git diff --check | 通过 |
| 原桌面 / 手机冒烟脚本 | 通过，0 pageerror |
| 新首次引导浏览器脚本 | **8 套完整引导 / 88 步**，0 pageerror |

这些结果是 RC2 重新执行所得，不是沿用 RC1 的通过数量。

## 浏览器覆盖

隔离预览后端 + 生产前端 + Chromium。每组均使用新浏览器上下文，不写入“跳过首次引导”标记。

| 视口 | 中文 | 英文 | 动态偏好 |
|---|---|---|---|
| 1440 × 960 | 完整 11 步 | 完整 11 步 | 常规 |
| 768 × 1024 | 完整 11 步 | 完整 11 步 | 常规 |
| 390 × 844 | 完整 11 步 | 完整 11 步 | 常规 |
| 320 × 568 | 完整 11 步 | 完整 11 步 | 减少动态效果 |

逐步检查：真实目标高亮可见、卡片在视口内且不覆盖高亮区域、主按钮白字与深色背景、焦点在浮窗中、底层应用 inert、结束后恢复交互。另检查所有视口下四个工作区描述可见、密度预设/滑块键盘调整/Esc 回焦。

图片详情：桌面与小屏 reduced-motion 下打开实际示例图片、等待解码、检查查看器无位移与稳定深色背景、双击缩放、键盘切换、关闭；截图在有限动画完成后采集。原冒烟脚本另测搜索、网格/列表、工作区切换和移动端侧栏。

**本轮浏览器检查中实际发现并修复：**
- 密度面板在布局引发的滚动事件后立即关闭；改为跟随锚点定位。
- 移动端侧栏过渡期间引导测量不稳定；引导期间侧栏直接就位。
- 320 × 568 英文卡片遮挡目标；按可用空间限制说明区高度。
- 窄屏工具栏互相遮挡；允许合理换行。

预览图片由 `scripts/preview.py` 程序绘制，非用户真实生成结果。预览为临时隔离目录，模拟 ComfyUI 的 `folder_paths` 和 `/view`；后者只允许访问示例图片根目录内的文件。它不是完整 ComfyUI 推理服务。

## 新增单元回归

- 卡片缺目标居中、实测高度、四类视口下不覆盖目标。
- 引导键盘焦点循环、Esc、inert 清理。
- 密度预设、3–8 边界、滑块、外部点击、滚动定位与回焦。
- 图片 decode 完成前不换图、过期请求取消、延迟 decode 不复活旧图、失败重试、超时。
- 图片详情组件的晚返回防错配、缓存破除重试、未保存修改的关闭确认。
- 文档语言、跨标签语言同步、localStorage 被拒时的降级。

## 复现命令

```bash
python -m pytest -q
npm ci --prefix gallery_ui
npm run verify --prefix gallery_ui
python scripts/check_release.py

# 可选浏览器验证，先安装 Playwright 与 Chromium
python -m pip install playwright
python -m playwright install chromium
python scripts/preview.py --port 8189
# 在另一个终端运行
python scripts/browser_smoke.py --url http://127.0.0.1:8189
python scripts/browser_rc2.py http://127.0.0.1:8189 ./artifacts/rc2-evidence
```

浏览器脚本输出截图和 `browser-rc2.json`；交付目录附有本次证据。生产使用不要暴露隔离预览服务到公网。

## 未验证与保留限制

未运行真实 ComfyUI/GPU 推理、Windows/macOS、Safari/Firefox、真实移动设备、超大图库/NAS/多进程竞争/长期压测，未执行远程 CI。响应式检查不是触屏手势或真实手机性能验证。没有基于实测硬件宣称帧率提升。

833-key 审计不是所有动态 UI 分支的穷尽验证；用户元数据及底层错误可能保留原语言。后端继续采用 RC1 的补偿日志与串行有界 worker，不能当作 ACID 数据库或完整后台任务系统。真实升级仍须先备份。
