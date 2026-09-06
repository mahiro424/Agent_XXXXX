# 05 配置系统与环境边界

- **配置文件**：`agent-settings.json`
- **管理模块**：[`src/runtime/settings-store.ts`](../../src/runtime/settings-store.ts)
- **类型定义**：[`src/runtime/settings-types.ts`](../../src/runtime/settings-types.ts)

---

## 核心配置结构

1. **服务提供商列表 (`services`)**：
   - `baseURL`、`apiKey`、`modelName`、`reasoningEffort`、`availableModels` (动态探测缓存)；
2. **MCP 服务器列表 (`mcpServers`)**：
   - `command`、`args`、`env`、`enabled`；
3. **日常偏好 (`general`)**：
   - `language`（默认 `zh-CN`）、`maxHistoryRounds`（上下文压缩阈值）；
4. **工作区权限模式**：
   - `strict-review`（默认每步高危操作弹窗审批）与 `full-access`（受控全自动执行）。
