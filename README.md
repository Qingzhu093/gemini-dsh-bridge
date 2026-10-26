# Gemini × DeepSeek Flash Bridge

<p align="center">
  <img src="assets/icon.svg" width="128" height="128" alt="Gemini × DeepSeek Flash Bridge Icon" />
</p>

<p align="center">
  <a href="#-中文使用说明"><img src="https://img.shields.io/badge/tests-17%20passing-brightgreen.svg" alt="Tests" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/Antigravity-2.26+-orange.svg" alt="Antigravity" />
  <img src="https://img.shields.io/badge/DSH-Desktop%200.2+-purple.svg" alt="DeepSeek Harness" />
</p>

Two lightweight plugins that allow **Gemini (Google Antigravity)** to orchestrate and delegate execution workloads to **DeepSeek Flash (running inside DeepSeek Harness)** — while allowing you to **watch every action live in the DSH desktop window**, just like normal human interaction.

[中文文档 (README.md)](#-中文使用说明) | [English Documentation (README_EN.md)](README_EN.md)

---

## 架构与核心原理 (Architecture)

```
Antigravity (Gemini 3.8 Flash / 4)            DeepSeek Harness (DeepSeek Flash)
  ├─ Skill: dsh-delegate                        ├─ Cordis Plugin: gemini-dsh-bridge
  ├─ Agent: dsh-worker                          │    ctx.workspaceRegistry.create → 独立工作区
  └─ MCP Tools: dsh_*                           │    ctx.sessionController.create → 原生可见会话
        │                                       │    ctx.sessionController.prompt → 派发任务
        │                                       │    ctx.sessionQuery → 提取变更文件与 Token
        │                                       │    sessions.json → 跨重启持久化存储
        └──────── MCP stdio (bin/shim.cjs) ─────┘
                    HTTP 127.0.0.1:<port> (Token Protected)
```

### 为什么采用 DSH 进程内插件？
Antigravity 只能获取其自身 MCP 客户端收到的文本结果。如果使用无头命令行子进程（headless process），该会话对桌面端用户是**完全不可见**的。
通过在 DSH 进程内部挂载桥接插件：
1. **桌面 UI 全程可见**：任务通过 DSH 原生的 `sessionController` 创建，会话直接出现在桌面侧边栏，生成标题并实时流式打印。
2. **原生权限与审批弹窗**：触发敏感指令或文件写操作时，使用 DSH 原生授权窗口，用户可随时在桌面窗口中一键批准或干预。
3. **断点恢复与会话复用**：支持 `dsh_send` 原生多轮续聊，支持重启后历史记录冷加载。

---

## 🛠️ 安装与快速上手 (Installation)

### 前置条件
- 已安装并可运行 **DeepSeek Harness (DSH)** 桌面端。
- 已安装 **Google Antigravity (AGY)**。
- 本地具备 Node.js (>= 18.0.0)。

### 一键安装脚本
在仓库根目录打开 PowerShell 执行：

```powershell
pwsh -File scripts\install.ps1
```

脚本将自动执行以下步骤：
1. 将 `dsh-plugin/` 安装至 `%USERPROFILE%\.dsh\plugins\gemini-dsh-bridge`；
2. 并在 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` 中安全注入插件声明（自动创建 `.bak-gemini-bridge` 备份）；
3. 将 `antigravity-plugin/` 安装至 `%USERPROFILE%\.gemini\config\plugins\gemini-dsh-bridge`；
4. 自动解析本机 Node.js 路径并写入 `mcp_config.json`，在 `%USERPROFILE%\.gemini\config\config.json` 中启用插件。

### 生效步骤
1. **重启 DeepSeek Harness**（DSH 启动时将自动在 `%USERPROFILE%\.dsh\bridge\endpoint.json` 生成监听端点与临时凭证）。
2. **重启 Antigravity**（自动拉起 MCP shim 并注册 `dsh_*` 工具）。
3. **验证健康状态**：
   ```powershell
   $ep = Get-Content "$env:USERPROFILE\.dsh\bridge\endpoint.json" -Raw | ConvertFrom-Json
   curl.exe -s "$($ep.origin)/gemini-bridge/health"
   ```
   返回 `{"ok":true,"plugin":"gemini-dsh-bridge",...}` 即表示全链路就绪。

### 卸载回退
```powershell
pwsh -File scripts\uninstall.ps1
```

---

## 📖 MCP 工具清单与接口合同 (Tool Specifications)

| 工具名称 | 核心参数 | 功能描述与出参要点 |
|---|---|---|
| `dsh_start` | `cwd` (绝对路径), `prompt` (任务书), `title?` | 创建新工作区和会话并下发任务，立即返回 `{sessionId, workspaceId, state:"running"}` |
| `dsh_status` | `sessionId` | 查看状态机状态 (`state`, `finished`, `live`)，返回最新 assistant 文本片段 |
| `dsh_wait` | `sessionId`, `timeoutSeconds?` (默认 60, 最长 120) | 长轮询等待完成；当遇到 `waiting-approval` 或任务完成时立即返回，避免忙轮询 |
| `dsh_result` | `sessionId` | 获取结构化执行结果：包含最终文本 `lastText`、修改的文件列表 `filesChanged` 及消耗的 `tokenUsage` |
| `dsh_send` | `sessionId`, `message` | 向同一会话追问或下发后续步骤，复用上下文并保留会话历史 |
| `dsh_cancel` | `sessionId` | 取消当前执行轮次，不破坏已有历史数据 |
| `dsh_list` | 无 | 获取所有桥接会话（包含持久化历史与冷恢复会话） |

### 会话生命周期状态 (`state`)
- `running`：DeepSeek Flash 正在执行任务。
- `waiting-approval`：正在等待用户在 DSH 桌面界面点击批准权限。
- `idle`：本轮任务顺利完成。
- `cold`：DSH 重启后从 `sessions.json` 恢复的历史会话（上下文已归档）。
- `cancelled`：被手动取消。

---

## 💡 使用范例 (How to Use in Antigravity)

在 Antigravity 中与 Gemini 对话时，Gemini 会自动加载 `dsh-delegate` 技能，通过清晰的规范把执行类工作下发给 DeepSeek Flash：

> **用户提问**：“帮我把 `D:\Projects\MyApp` 里面的所有 API 接口类型重构为 TypeScript 严格模式，并跑一下单元测试。”

**Gemini 的典型调度流程**：
1. **Gemini（主管）**：梳理改动目标与验收标准，生成自包含的任务书。
2. **调用 `dsh_start`**：下发至 DeepSeek Harness，工作区为目标工程绝对路径。
3. **桌面通知**：提示用户：“已为您在 DeepSeek Harness 创建任务会话 `Refactor API Types`，您可在 DSH 桌面窗口中实时查看进度。”
4. **调用 `dsh_wait`**：等待 DeepSeek Flash 执行完成。如遇权限申请，立即提示用户确认。
5. **调用 `dsh_result`**：提取修改的文件列表（`filesChanged`）与 Token 消耗，并做最终双重质检后向用户复述关键成果。

---

## 🧪 自动化测试 (Testing)

项目配备了纯原生、零外部依赖的自动化测试套件：

```bash
# 运行全部测试（包含 DSH 插件单元测试与 MCP Shim 测试）
npm test

# 单独运行 DSH 插件单元测试
npm run test:dsh

# 单独运行 Shim 协议测试
npm run test:shim

# 运行真实 DSH 端到端联调测试（需本地启动 DSH）
npm run test:integration
```

---

## 🔒 安全保障与设计约束 (Security & Constraints)

1. **仅监听本机环回口 (Loopback Only)**：所有 HTTP 交互严格绑定 `127.0.0.1`，拒绝任何局域网或公网访问。
2. **高强度随机会话令牌 (Token Guarded)**：每次 DSH 启动生成 256 位高熵令牌，仅通过本地 `0600` 权限的 `endpoint.json` 传递给同机 Antigravity 插件。
3. **原生权限模型不变**：桥接绝不绕过 DSH 的权限机制，敏感命令与文件修改依旧在 DSH 窗口弹出原生批准对话框。
4. **并发保护**：默认限制最大并发执行数为 3（`maxConcurrent: 3`），防止本地资源竞争与进程过载。
5. **跨重启持久化**：会话元数据自动持久化于 `%USERPROFILE%\.dsh\bridge\sessions.json`，支持防抖原子写入与冷启动回显。

---

## 📄 授权许可 (License)

本项目基于 [MIT 许可证](LICENSE) 开源。
