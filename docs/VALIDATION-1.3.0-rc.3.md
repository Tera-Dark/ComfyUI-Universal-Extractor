# RC3 验证记录

2026-09-18。修改基线 `77fcb7a`（RC2），上游基线 `87960b0`。本地候选版本，未推送上游。

## 本轮结果

| 检查 | 结果 |
|---|---|
| Python / Linux / Python 3.13 | **103 passed** |
| Vitest | **141 passed / 29 files** |
| TypeScript | 通过 |
| ESLint | 0 errors / 0 warnings |
| 中英文字典与占位符 / 静态调用审计 | **855 keys**，通过 |
| npm 安全审计 | 查询成功，**0 vulnerabilities** |
| 生产构建、入口与 manifest | 通过，**16 项资源引用** |
| 版本 / CHANGELOG 一致性 | 1.3.0-rc.3 通过 |
| Python 编译、git diff --check | 通过 |
| 新 QoL 浏览器脚本 | 4 组中英文/视口组合通过，0 pageerror |
| RC2 首次引导回归 | 8 组 / 88 步通过，0 pageerror |
| 原图库冒烟回归 | 桌面/手机通过，0 pageerror |

## 新增回归重点

- 新资源编辑不会跳回已有资源；编辑后取消切换保留草稿。
- 双栏下一页追加而非替换；旧目录请求迟到时被忽略。
- 移动处理期间的重复快捷键不发出第二次请求；部分失败的被阻止项仍选中；结果显示实际数量。
- 已加载变体组搜索、排序与输入数组不可变性。
- 清除筛选保留排序，单独重置排序，Esc 关闭筛选面板。
- 确认框初始焦点位于安全操作，Esc 取消并回焦。

## 真浏览器检查

`browser_qol.py` 使用 Chromium，分别运行 1440×960、390×844，中文/英文各一次。检查：

1. 词库、工作台、设置能切换且无页面横向溢出。
2. 工作台横向工具导航、默认折叠格式工具、灵感页切换。
3. 在结果区输入草稿，切换到其他工作区再回来，草稿仍在。
4. 添加新资源并输入，尝试离开设置，取消确认后输入保持，再明确丢弃后离开。
5. 筛选面板横向位于视口内，Esc 关闭与回焦。
6. 双栏卡片与控件可见；从双栏切换变体；分组搜索无结果状态。
7. 按上述状态保存截图，收集页面异常。

浏览器检查实际发现并修复了“隐藏双栏无效筛选控件后，更多菜单贴到侧栏下面”的定位问题。所有截图在有限动画结束后采集。

另重新执行 RC2 的四种视口（1440、768、390、320 像素宽）中英文 11 步引导，以及原图库搜索、视图、菜单、图片详情、手机侧栏测试。

**环境说明：**预览使用生产前端和真实 Gallery 路由，模拟 `folder_paths`，图片为程序绘制的临时示例。浏览器 QoL 脚本不执行文件移动；移动锁与部分失败属于组件测试，文件操作回滚/冲突等属于既有 Python 测试。不能把它们描述为真实 ComfyUI 端到端移动验证。

## 复现

```bash
python -m pytest -q
npm ci --prefix gallery_ui
npm run verify --prefix gallery_ui
python scripts/check_release.py

python -m pip install playwright
python -m playwright install --with-deps chromium
python scripts/preview.py --port 8189
# 另一终端，仅针对隔离预览
python scripts/browser_qol.py http://127.0.0.1:8189 ./artifacts/qol-evidence
python scripts/browser_rc2.py http://127.0.0.1:8189 ./artifacts/onboarding-evidence
python scripts/browser_smoke.py --url http://127.0.0.1:8189
```

## 未验证

真实 ComfyUI/GPU，Windows/macOS，Safari/Firefox，真实手机触控，大图库/NAS、长时间并发与硬件帧率未验证。没有执行远程 CI。当前截图检查覆盖代表性页面状态，不等于每个弹窗、工具配置和错误分支都经过视觉验收。

工作台状态仅在当前页面会话保留；变体搜索仅作用于当前加载分组；双栏全选仅作用于已加载图片；未实现完整撤销栈或逐文件冲突预演。升级前仍须备份。
