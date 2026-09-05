# Codex 式本地工作区 Agent Runtime

V1 采用 Codex 式的本地工作区模式：桌面客户端通过 App Server 协议连接独立 Agent Runtime，Runtime 只在用户明确选择的工作区内运行，沙箱边界负责限制可触达资源，动作策略负责决定何时需要用户批准，网络默认关闭。Local Workspace 是 V1 默认模式；Task Workspace/Worktree 用于后续隔离任务；Cloud、Computer Use、PiP 和默认接管主桌面不属于 V1 主路径。这样可以先验证“会话 → 计划 → 审批 → 工具执行 → 产物验证”的客户端闭环，再逐步增加 Windows Bridge 和桌面应用控制能力。

## 考虑过的方案

- **前台 GUI 接管**：可展示桌面自动化效果，但输入抢占、坐标误操作和结果不确定性高，不适合作为 V1 默认模式。
- **本地工作区 Agent**：边界清晰、易于审批和验证，适合先完成 Demo，并与未来 Worktree/Cloud 模式兼容。
- **纯云端 Agent**：隔离性较好，但无法直接访问用户本地文件和 Windows 应用，后置。
