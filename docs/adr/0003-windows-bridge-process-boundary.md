# Windows Bridge 进程边界

桌面观察（窗口、截图、UIA）与桌面动作（输入、应用启动）必须由独立 C#/.NET sidecar 提供，并通过受限 JSON-RPC/Named Pipes 暴露给 Agent Runtime；Renderer 不得直接访问系统能力。这样既可以稳定使用 Windows UIA/Win32/Office COM，又能为未来的 PiP/RDP 独立会话保留隔离边界。
