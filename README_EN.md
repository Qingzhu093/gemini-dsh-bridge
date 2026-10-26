# Gemini × DeepSeek Flash Bridge

<p align="center">
  <img src="assets/icon.svg" width="128" height="128" alt="Gemini × DeepSeek Flash Bridge Icon" />
</p>

<p align="center">
  <a href="#testing"><img src="https://img.shields.io/badge/tests-17%20passing-brightgreen.svg" alt="Tests" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/Antigravity-2.26+-orange.svg" alt="Antigravity" />
  <img src="https://img.shields.io/badge/DSH-Desktop%200.2+-purple.svg" alt="DeepSeek Harness" />
</p>

Two lightweight plugins that allow **Gemini (Google Antigravity)** to orchestrate and delegate execution workloads to **DeepSeek Flash (running inside DeepSeek Harness)** — while allowing you to **watch every action live in the DSH desktop window**, just like normal human interaction.

[中文文档 (README.md)](README.md) | [English Documentation (README_EN.md)](#architecture)

---

## Architecture

```
Antigravity (Gemini 3.8 Flash / 4)            DeepSeek Harness (DeepSeek Flash)
  ├─ Skill: dsh-delegate                        ├─ Cordis Plugin: gemini-dsh-bridge
  ├─ Agent: dsh-worker                          │    ctx.workspaceRegistry.create → Workspace
  └─ MCP Tools: dsh_*                           │    ctx.sessionController.create → Visible Session
        │                                       │    ctx.sessionController.prompt → Dispatch Prompt
        │                                       │    ctx.sessionQuery → Files Changed & Token Usage
        │                                       │    sessions.json → Persistence Across Restarts
        └──────── MCP stdio (bin/shim.cjs) ─────┘
                    HTTP 127.0.0.1:<port> (Token Protected)
```

### Why an In-Process DSH Plugin?
Antigravity can only see what its own MCP tools return. A headless `dsh` child process is **invisible** in the desktop user interface.
By running the bridge **inside** the DSH process:
1. **Live Desktop Visibility**: Delegated tasks are created through DSH's native `sessionController`. Conversations appear directly in the sidebar, stream live responses, and automatically generate titles.
2. **Native Approvals**: When commands or file writes require permission, the native DSH approval dialog pops up, allowing human intervention at any time.
3. **Session Reusability**: Multi-turn follow-ups are supported via `dsh_send`, preserving context across turns.

---

## 🛠️ Installation & Setup

### Prerequisites
- DeepSeek Harness (DSH) desktop installed and running.
- Google Antigravity (AGY) installed.
- Node.js (>= 18.0.0) available locally.

### One-Click Installer
Run in PowerShell from the repository root:

```powershell
pwsh -File scripts\install.ps1
```

The script automatically:
1. Installs `dsh-plugin/` into `%USERPROFILE%\.dsh\plugins\gemini-dsh-bridge`;
2. Injects the plugin entry into `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` (creating a `.bak-gemini-bridge` backup);
3. Installs `antigravity-plugin/` into `%USERPROFILE%\.gemini\config\plugins\gemini-dsh-bridge`;
4. Configures `mcp_config.json` with the detected Node path and enables the plugin in `%USERPROFILE%\.gemini\config\config.json`.

### Activating
1. **Restart DeepSeek Harness** (writes `%USERPROFILE%\.dsh\bridge\endpoint.json` on boot).
2. **Restart Antigravity** (the `dsh_*` MCP tools will be active).
3. **Verify Health**:
   ```powershell
   $ep = Get-Content "$env:USERPROFILE\.dsh\bridge\endpoint.json" -Raw | ConvertFrom-Json
   curl.exe -s "$($ep.origin)/gemini-bridge/health"
   ```
   A return of `{"ok":true,"plugin":"gemini-dsh-bridge",...}` indicates the bridge is active.

### Uninstallation
```powershell
pwsh -File scripts\uninstall.ps1
```

---

## 📖 MCP Tool Specifications

| Tool | Core Arguments | Description & Return Highlights |
|---|---|---|
| `dsh_start` | `cwd` (absolute path), `prompt` (task brief), `title?` | Creates a new workspace/session and dispatches the task; returns `{sessionId, workspaceId, state:"running"}` |
| `dsh_status` | `sessionId` | Inspects state machine (`state`, `finished`, `live`) and returns latest text tail |
| `dsh_wait` | `sessionId`, `timeoutSeconds?` (default 60, max 120) | Waits until the session finishes or enters `waiting-approval`; avoids busy polling |
| `dsh_result` | `sessionId` | Reads final assistant text, list of `filesChanged`, and `tokenUsage` statistics |
| `dsh_send` | `sessionId`, `message` | Sends follow-up instructions to an existing session, maintaining context |
| `dsh_cancel` | `sessionId` | Cancels the current execution turn without destroying conversation history |
| `dsh_list` | None | Lists known bridge sessions (including cold-restored history) |

### Session Lifecycle States
- `running`: DeepSeek Flash is currently executing.
- `waiting-approval`: A tool call requires user confirmation in the DSH UI.
- `idle`: Execution completed.
- `cold`: Historical session restored from `sessions.json` after DSH reboot.
- `cancelled`: Manually stopped.

---

## 🧪 Testing

The repository includes a comprehensive, dependency-free test suite:

```bash
# Run all tests (plugin unit tests and shim protocol tests)
npm test

# Run DSH plugin unit tests only
npm run test:dsh

# Run MCP shim tests only
npm run test:shim

# Run live end-to-end integration test (requires running DSH)
npm run test:integration
```

---

## 🔒 Security & Guardrails

- **Loopback Only**: Bound strictly to `127.0.0.1`.
- **Token Protected**: Secured by a 256-bit entropy token rotated on DSH boot.
- **Native Permissions Intact**: Sensitive commands always trigger DSH desktop approval modals.
- **Concurrency Cap**: Maximum 3 concurrent running sessions by default (`maxConcurrent: 3`).
- **Atomic Persistence**: Session metadata is safely serialized with debounced atomic writes to `%USERPROFILE%\.dsh\bridge\sessions.json`.

---

## 📄 License

Distributed under the [MIT License](LICENSE).
