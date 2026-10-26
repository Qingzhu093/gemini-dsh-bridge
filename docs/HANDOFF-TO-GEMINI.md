# 交接文档：Gemini × DeepSeek Flash Bridge（交给 Antigravity 里的 Gemini 继续）

> 交接时间：2026-10-26 18:15 (+08:00)
> 交接人：DeepSeek Harness 会话（lead）
> 接手人：Antigravity 里的 Gemini（建议 3.8 Flash，省额度；复杂判断再升 4）
> 代码位置：`D:\Documents\deepseek harness\gemini-dsh-bridge`

---

## 1. 一句话目标

让 **Antigravity 的 Gemini（主管）** 把执行类工作派给 **DeepSeek Harness 里的 DeepSeek Flash**，并且用户能在 **DSH 窗口里像普通对话一样实时看到、随时干预**。

方向是单向的：**Gemini 派活 → DSH 执行 → 结果回传**。DSH 不需要主动调 Gemini。

---

## 2. 当前状态（已实测通过，可直接用）

| 能力 | 状态 |
|---|---|
| MCP 握手 / 工具注册 | ✅ 7 个工具（见 §5） |
| `dsh_start` 创建会话并派任务 | ✅ 返回 sessionId，状态 running |
| `dsh_wait` 等待完成 | ✅ 返回 idle + 最终文本 |
| `dsh_send` 唤醒续聊（同一会话） | ✅ ONE → 追问 → TWO |
| `dsh_cancel` 取消 | ✅ 回到 idle |
| `dsh_list` | ✅（仅本进程启动过的会话） |
| 会话出现在 DSH 侧边栏、实时渲染、自动标题 | ✅ 已截图验证 |
| Antigravity 插件已启用 | ✅ 用户截图确认插件卡片出现 |

**交接时健康检查**（刚跑过）：
```
GET http://127.0.0.1:60085/gemini-bridge/health
{"ok":true,"plugin":"gemini-dsh-bridge","pid":57264,"active":0,"maxConcurrent":3}
MCP: initialize ok → tools/list 7 → dsh_start ok → dsh_wait → "LIST-OK" → dsh_list 1
```

环境版本：Antigravity 2.26.0 · DSH 桌面 0.2.1-rc.3 · Node v24.20.0 · Windows PowerShell 5.1（重要，见 §9）。

---

## 3. 架构与数据流

```
Antigravity（Gemini）
  ├─ MCP 工具 dsh_*（stdio shim）
  │     C:\Users\wangy\.gemini\config\plugins\gemini-dsh-bridge\bin\shim.cjs
  ▼
DSH 进程内的插件（gemini-dsh-bridge）
  ├─ ctx.webServer 注册 /gemini-bridge/*（仅 127.0.0.1 + token）
  ├─ ctx.workspaceRegistry.create(cwd)      → 工作区（侧边栏分组）
  ├─ ctx.sessionController.create/prompt    → 普通会话 = 用户能看见的对话
  └─ ctx.sessionQuery / ctx.agents          → 状态与最后回答
  ▼
DSH UI：会话实时出现（和手打完全一样，权限弹窗也是原生的）
```

关键点：**任务不是子进程，而是 DSH 自己创建的普通会话**，所以 UI 实时、权限原生、可手动介入。

---

## 4. 文件地图

### 仓库（源码）
```
gemini-dsh-bridge/
├── dsh-plugin/src/index.js        # DSH 插件：HTTP 路由 + 会话生命周期
├── antigravity-plugin/
│   ├── plugin.json
│   ├── mcp_config.json            # 指向 node + shim.cjs，timeoutSeconds 600
│   ├── bin/shim.cjs               # MCP stdio ⇄ HTTP，零依赖
│   ├── skills/dsh-delegate/SKILL.md
│   ├── agents/dsh-worker.md       # 自定义子代理（frontmatter 里挂 mcpServers）
│   └── rules/AGENTS.md
├── scripts/install.ps1            # 幂等安装（UTF-8 安全，见 §9）
├── scripts/uninstall.ps1
├── spike/                          # 验证用脚本（test-shim.js 可复用）
├── docs/bridge-sessions.png        # DSH 侧边栏证据截图
├── README.md
└── LICENSE (MIT)
```

### 安装位置（运行时）
| 项 | 路径 |
|---|---|
| DSH 插件 | `C:\Users\wangy\.dsh\plugins\gemini-dsh-bridge\` |
| DSH profile 注入 | `C:\Users\wangy\.dsh\profiles\desktop\cordis.patch.yml`（`# >>> gemini-dsh-bridge >>>` … `# <<< gemini-dsh-bridge <<<` 之间） |
| 运行态端点+token | `C:\Users\wangy\.dsh\bridge\endpoint.json`（每次 DSH 启动重写） |
| Antigravity 插件 | `C:\Users\wangy\.gemini\config\plugins\gemini-dsh-bridge\` |
| Antigravity 启用 | `C:\Users\wangy\.gemini\config\config.json` → `plugins.gemini-dsh-bridge.enabled = true` |
| 备份 | `cordis.patch.yml.bak-gemini-bridge`（首次安装前的干净版） |

---

## 5. MCP 工具合同（Antigravity 侧可调用）

| 工具 | 入参 | 出参要点 |
|---|---|---|
| `dsh_start(cwd, prompt, title?)` | cwd **绝对路径**；prompt 自包含任务书 | `{sessionId, workspaceId, state:"running"}`，立即返回 |
| `dsh_status(sessionId)` | | `state/finished/live/agentStatus/lastText` |
| `dsh_wait(sessionId, timeoutSeconds≤120)` | 长轮询 | 就绪即返回（finished 或 waiting-approval） |
| `dsh_result(sessionId)` | | 最终 assistant 文本 + 状态 |
| `dsh_send(sessionId, message)` | 唤醒/追问，保留上下文 | `{accepted:true}` |
| `dsh_cancel(sessionId)` | | `{accepted:true}` |
| `dsh_list()` | | 本进程启动过的会话 |

状态取值：`running` / `waiting-approval`（工具需要 DSH UI 里批准）/ `idle`（本轮结束）/ `done` / `cold`（DSH 重启后）/ `cancelled`。

任务书模板（写在 prompt 里即可）：
```
【目标】完成什么、为什么
【范围】涉及文件/目录；明确不要碰的
【要求】约束、风格样板、接口
【完成标准】测试/命令/产物路径
```

---

## 6. 已验证 vs 未验证

**已验证**
- MCP 全链路、start/wait/send/cancel/list、DSH 侧实时可见、自动标题、token 统计、后台插件在桌面端加载。

**未验证（你接手后的主要工作）**
- `/teamwork-preview` 蜂群在 Lead 层派活；内建 worker 能否带外部 MCP（官方只认 tools 白名单，**大概率不行**）。
- 真实审批场景：把 DSH 权限预设改成 `ask`，跑一条要批准的命令，确认 `waiting-approval` 与 UI 弹窗。
- DSH 重启后旧 sessionId 的 `dsh_result`（应返回 cold/历史，不应崩）。
- Antigravity 180s 默认超时下，长任务用 `dsh_wait` 循环的真实体验。

---

## 7. 你（Gemini）接下来要做的任务（按优先级）

**P0 端到端复测（务必先做，产出截图/日志）**
1. 选 3.8 Flash，调 `dsh_start` 在 `D:\Documents\deepseek harness\gemini-dsh-bridge\spike\work` 建个文件；`dsh_wait` 拿结果。
2. 确认 DSH 侧边栏出现该会话（工作区 `Gemini Bridge` 或目标目录），标题自动生成。
3. 验收：会话可见 + 最终文本正确 + 无 180s 超时。

**P1 审批流**
1. 临时把 DSH 权限预设改为 `ask`（或让任务跑一条未授权的命令）。
2. `dsh_wait` 应返回 `waiting-approval`；在 DSH UI 批准后继续到 idle。
3. 验收：`waiting-approval` 能提前唤醒，不误判。

**P2 蜂群兼容**
1. 用 `/teamwork-preview` 起一个小项目，让 Lead 层（主会话 agent）调用 `dsh_start`。
2. 记录：worker 是否能看到工具；结论写进 README「限制」。
3. 验收：Lead 层能派活；worker 不能时给出明确说明，不报错。

**P3 健壮性**
1. 插件会话注册表持久化到 `~/.dsh/bridge/sessions.json`，DSH 重启后 `dsh_list` 仍能看到（标记 cold）。
2. `dsh_result` 补充 `filesChanged`（可从 diff/工具事件推断）与 token 用量。
3. `dsh_wait` 支持多个 sessionId 同时等。

**P4 打包开源**
1. `dsh-plugin` 整理成可发 npm 的包（`main`、`files`、`license`、README）。
2. Antigravity 插件补 marketplace 所需元数据（`plugin.json` 已含 name/displayName/version/description）。
3. README 补：安装/卸载/限制/排障（已有初稿，可扩英文）。

**P5 测试**
1. 给 `dsh-plugin/src/index.js` 加单测：鉴权、参数校验、状态推导、并发上限。
2. `spike/test-shim.js` 改造成 integration 脚本（可 CI）。

---

## 8. 改代码 → 生效的标准流程

1. 改**仓库**里的源码（不要直接改安装目录，会被覆盖）。
2. 跑 `pwsh -File "D:\Documents\deepseek harness\gemini-dsh-bridge\scripts\install.ps1"`
   （会把 DSH 插件复制到 `~/.dsh/plugins/`、更新 Antigravity 插件与 mcp_config）。
3. **重启 DeepSeek Harness**（DSH 插件只在启动时加载）。
4. **重启 Antigravity**（MCP 进程只在启动时拉起）。
5. 验证：`%USERPROFILE%\.dsh\bridge\endpoint.json` 存在，且
   `curl.exe -s http://127.0.0.1:<port>/gemini-bridge/health` 返回 `{"ok":true,...}`。

排障顺序：
- health 不通 → DSH 没启动 / 插件没加载（看 `%APPDATA%\@deepseek-ai\dsh-desktop\*.log`）。
- health 通但工具报错 → 看 shim 报的 `error.code`（`SESSION_NOT_FOUND` / `LIMIT_EXCEEDED` / `UNAUTHORIZED`）。

---

## 9. 铁律与已知坑（务必遵守）

1. **绝不要用 PowerShell 的 `Get-Content` / `Set-Content` 读写这些 UTF-8 文件。**
   这台机器是 Windows PowerShell 5.1，默认 ANSI，会把中文注释变成乱码并写坏
   `cordis.patch.yml`（今天已经踩过一次，导致 DSH 无法启动）。用编辑器/Node/read·write 工具，或
   `[System.IO.File]::ReadAllText($p, (New-Object System.Text.UTF8Encoding($false)))`。
   `install.ps1` 已改成 UTF-8 安全 + 写后 round-trip 断言。

2. **DSH 启动报错弹窗时，不要点“Disable third-party plugins, back up profile patch, and restart”。**
   它会重置 `profiles/desktop/package.json` 的 `dsh.profile.bundles`，用户的插件（agent-team / auto-review / dev-index / voice-input / pdf-mineru / latex-studio）会“消失”。
   正确做法：用 `.bak-gemini-bridge` 恢复 `cordis.patch.yml`，从 `package.json.bak-install-*` 恢复 bundles，再跑 `scripts/uninstall.ps1` 后重装。

3. **不要做 sidecar / 不要逆向 DSH 私有 API。** 现有方案已经是官方接口，够用。

4. **MCP 单次调用默认 180s**；本插件配了 `timeoutSeconds: 600`，但长任务仍应 `dsh_start` 后 `dsh_wait` 轮询，不要一次阻塞到底。

5. **并发上限 3**（`dsh-plugin` 配置 `maxConcurrent`）。超了返回 `LIMIT_EXCEEDED`，蜂群大规模派活时要排队。

6. **`dsh_list` 是内存态**：DSH 重启后历史会话不在列表里（会话本身还在，可在 UI 里翻到）。P3 会修。

7. **`waiting-approval` 是尽力推断**（基于 session 事件里 `approval/asked` vs `approval/decided`），需 P1 真实场景验证。

8. 桥只绑 `127.0.0.1` + `x-bridge-token`，**不要**改成对外监听。

9. 用户要求：**省 Gemini 额度**，默认用 3.8 Flash 做执行与测试；需要审美/架构判断时才升 4。

---

## 10. 快速命令

```powershell
# 健康检查
$ep = Get-Content "$env:USERPROFILE\.dsh\bridge\endpoint.json" -Raw | ConvertFrom-Json
curl.exe -s "$($ep.origin)/gemini-bridge/health"

# MCP 自测（会真的建一个会话，消耗 DeepSeek token，很便宜）
& "C:\Users\wangy\nodejs\node.exe" "D:\Documents\deepseek harness\gemini-dsh-bridge\spike\test-shim.js"

# 重装（改完仓库代码后）
& "D:\Documents\deepseek harness\gemini-dsh-bridge\scripts\install.ps1"

# 卸载（干净回退）
& "D:\Documents\deepseek harness\gemini-dsh-bridge\scripts\uninstall.ps1"
```

---

## 11. 一句话验收

> 让 DeepSeek Flash 在 DSH 里跑一个"读取某目录、改一处、跑测试、汇报"的任务；
> 用户在 DSH 窗口里全程看得见；Gemini 在 Antigravity 里拿到结构化结果并复述关键证据。
> 能做到，这条链路就闭环了。
