# Gemini × DeepSeek Flash Bridge v0.3.2

Connect Google Antigravity (Gemini 4) and DeepSeek Harness (DSH) through a high-performance local bridge.

## 🌟 Highlights

- **Work Division Matrix**: Specialized collaboration between Gemini 4 (Architect / Tech Lead for top-level system design and core academic writing) and DeepSeek Flash in DSH (Senior Engineer for heavy implementation, compilation, and typography).
- **Pipelined Overlap Concurrency ("Do Work While Waiting")**: Fully decoupled background task execution inspired by Antigravity Subagents & DSH Teamwork. Gemini no longer freezes in wait loops; it proceeds with drafting next chapters and unit tests in parallel.
- **DeepSeek Harness v0.2.1-rc.5 Clean-up**: Integrated reasoning-text clean-up engine that automatically strips `<signature>` metadata blocks and prevents in-flight streaming leakage.
- **Native Desktop Visibility**: Tasks appear directly in the DSH desktop sidebar with real-time streaming, automatic titles, and native permission approval popups.
- **100% Test Coverage**: All 18 unit and integration tests passing.

## 📦 What's Included

- `dsh-plugin-gemini-bridge-0.3.2.tgz`: The Cordis plugin for DeepSeek Harness.
- Full MCP stdio bridge shim (`bin/shim.cjs`) with zero external runtime dependencies.
- Antigravity agent (`dsh-worker`), skill (`dsh-delegate`), and rules (`AGENTS.md`).

## 🚀 Quick Install

```powershell
git clone https://github.com/Qingzhu093/gemini-dsh-bridge.git
cd gemini-dsh-bridge
pwsh -File scripts\install.ps1
```
