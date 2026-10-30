# Gemini × DeepSeek Flash Bridge (v0.3.2)

<p align="center">
  <img src="assets/icon.svg" width="128" height="128" alt="Gemini × DeepSeek Flash Bridge Icon" />
</p>

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/tests-18%20passing-brightgreen.svg" alt="Tests" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://www.npmjs.com/package/dsh-plugin-gemini-bridge"><img src="https://img.shields.io/npm/v/dsh-plugin-gemini-bridge.svg?color=cb3837" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/Antigravity-2.26+-orange.svg" alt="Antigravity" />
  <img src="https://img.shields.io/badge/DSH-Desktop%200.2+-purple.svg" alt="DeepSeek Harness" />
</p>

A seamless bridge connecting **Google Antigravity (Gemini)** and **DeepSeek Harness (DeepSeek Flash)**. Gemini 4 acts as the Architect / Tech Lead (deep reasoning, top-level system design, core academic/creative writing), while orchestrating DeepSeek Flash for heavy-lifting implementation and compilation — with **every turn rendered live in the DSH desktop window** for transparent human oversight.

[中文文档 (README.md)](README.md) | [English Documentation (README_EN.md)](README_EN.md)

---

## 🌟 Key Innovations in v0.3.1

### 1. Full Compatibility with DSH v0.2.1-rc.5 Reasoning Clean-up
- **Automatic Signature Stripping**: Aligned with the official `reasoning-text` engine via `cleanReasoningAndSignatures`, stripping `<signature>...</signature>` metadata blocks cleanly.
- **Streaming Leak Protection**: Intercepts unclosed signature fragments during in-flight stream generation, preventing raw payload noise from leaking to Gemini.
- **Zero-Artifact Pure Content Delivery**: Guarantees clean reasoning and code responses in `lastText`.

### 2. Work Division Matrix (Tech Lead vs Senior Engineer)
- **Gemini 4 (Architect / Tech Lead)**: Drives architectural framing, theoretical deductions, academic content drafting, and specifies clear research paths (concrete file targets & verification hypotheses).
- **DeepSeek Flash / DSH (Execution Engine)**: Excels at heavy-lifting code refactoring, complex LaTeX typography (fixing Overfull hboxes, aligning BibTeX, tuning floating figures), and deep local repository search.

### 2. Overlap Execution: "Do Work While Waiting"
Eliminating the anti-pattern of blocking wait loops:
- Inspired by **Antigravity's Subagent/Task architecture** and **DSH's Teamwork concurrency philosophy**: DSH runs as an independent background session on the local host.
- **Pipelined Concurrency**: Once Gemini dispatches a heavy task via `dsh_start`, it **does not freeze or poll in tight loops**. Gemini immediately leverages its own reasoning to draft subsequent chapters, plan verification cases, or design prompt trees in parallel, only checking back with non-blocking `dsh_status` when ready.

### 3. Balanced Teamwork Orchestration
- **Single-Session Mode**: Default for targeted tasks (typesetting, bug fixing, precise file searches), minimizing token consumption and nesting latency.
- **Teamwork Mode**: Enabled on-demand for large-scale cross-system engineering migrations and multi-module architectures.

---

## 🏛️ Architecture

```
Antigravity (Gemini 4 / 3.8 Flash)              DeepSeek Harness (DeepSeek Flash)
  ├─ Rules: rules/AGENTS.md                        ├─ Cordis Plugin: dsh-plugin-gemini-bridge
  ├─ Skill: skills/dsh-delegate                    │    ctx.workspaceRegistry.create → Isolated Workspace
  ├─ Agent: agents/dsh-worker                      │    ctx.sessionController.create → Native Visible Session
  └─ MCP Tools: dsh_*                              │    ctx.sessionController.prompt → Dispatch Prompt
        │                                          │    ctx.sessionQuery → Extract Touched Files & Tokens
        │                                          │    sessions.json → Persistent Cold-Reboot Storage
        └──────────── MCP stdio (bin/shim.cjs) ────┘
                        HTTP 127.0.0.1:<port> (Token Protected)
```

---

## 🛠️ Installation

### Prerequisites
- **DeepSeek Harness (DSH)** Desktop (>= 0.2.0-rc.2).
- **Google Antigravity (AGY)** (>= 2.26.0).
- Local Node.js runtime (>= 18.0.0).

### Method 1: Local Setup Script (Recommended)
Open PowerShell at the repo root and run:
```powershell
pwsh -File scripts\install.ps1
```

### Method 2: NPM Package for DSH
```bash
npm install -g dsh-plugin-gemini-bridge
```

---

## 📖 MCP Tool Specifications

| Tool | Parameters | Description |
|---|---|---|
| `dsh_start` | `cwd` (absolute), `prompt`, `title?` | Launches a background DSH session. Returns `sessionId` immediately. Gemini is encouraged to proceed with parallel work. |
| `dsh_status` | `sessionId` | **Non-blocking** query of session state and latest tail text. Ideal for checking status between parallel tasks. |
| `dsh_wait` | `sessionId`, `timeoutSeconds?` (default 30) | Optional synchronous wait. Use only when strictly dependent on the output with no parallel tasks available. |
| `dsh_result` | `sessionId` | Retrieves final text, `filesChanged`, and `tokenUsage`. |
| `dsh_send` | `sessionId`, `message` | Sends follow-up message to the existing session context. |
| `dsh_cancel` | `sessionId` | Cancels current execution turn safely without destroying history. |
| `dsh_list` | None | Lists all bridge sessions. |

---

## 🧪 Testing

```powershell
npm test
```
All 17 integration and unit tests pass cleanly.

---

## 📄 License

Distributed under the [MIT License](LICENSE).
