# dsh-plugin-gemini-bridge (v0.3.0)

> DeepSeek Harness 官方插件：将 DSH 桌面会话暴露给 Google Antigravity (Gemini) 进行高效主管调度与执行协同。

![Gemini x DSH Bridge](icon.svg)

## 特性亮点
- **实时桌面可视**：由 Gemini 派发的任务直接作为原生 DSH 对话运行，在侧边栏实时可见，保留流式打印。
- **原生安全与权限**：不绕过 DSH 原生权限系统，敏感指令弹出桌面原生确认窗口，支持用户直接干预。
- **异步解耦并发**：任务派发后后台自主推进，Gemini 前台可并发开展思考、内容撰写与准备。
- **自动上下文追踪**：多轮会话持久化与状态机管理（支持冷恢复）。
- **执行数据回传**：自动提取修改文件列表（`filesChanged`）与 Token 消耗。

## 安装方式

### 方式一：DSH 插件市场 / NPM 安装
```bash
npm install -g dsh-plugin-gemini-bridge
```
或在 DeepSeek Harness 桌面端插件市场搜索 `gemini-dsh-bridge` 点击安装并重启。

### 方式二：本地一键安装
在主仓库根目录运行：
```powershell
pwsh -File scripts\install.ps1
```

## 许可
MIT License.
