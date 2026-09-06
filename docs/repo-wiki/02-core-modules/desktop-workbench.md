# 核心模块：Desktop Workbench 桌面工作台

- **主进程**：[`src/desktop/main.ts`](../../../src/desktop/main.ts)
- **预加载桥接**：[`src/desktop/preload.cts`](../../../src/desktop/preload.cts)
- **渲染器控制器**：[`src/desktop/renderer.ts`](../../../src/desktop/renderer.ts)
- **样式表**：[`src/desktop/styles.css`](../../../src/desktop/styles.css)

---

## 1. 架构特性

- **ContextBridge 安全隔离**：`contextIsolation: true`，渲染进程绝不直接访问 Node.js 原生 API，所有操作通过 `window.agentDesktop` 严格白名单 IPC 交互；
- **自适应折叠布局**：支持左侧会话栏自适应伸缩（含 `Ctrl+B` 快捷键）、右侧审计上下文抽屉、中央沉浸式会话区；
- **动态模型配置与探测**：在设置弹窗中输入端点与密钥后，支持一键实时拉取 `/models` 并在下拉框中自适应选择。
