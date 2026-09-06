# 核心模块：工具注册表与 MCP 体系

- **注册表核心**：[`src/runtime/tools/tool-registry.ts`](../../../src/runtime/tools/tool-registry.ts)
- **MCP 进程监督**：[`src/runtime/mcp-process-supervisor.ts`](../../../src/runtime/mcp-process-supervisor.ts)
- **办公工具集**：[`src/runtime/tools/office-tools.ts`](../../../src/runtime/tools/office-tools.ts)
- **脚本沙箱**：[`src/runtime/tools/script-tools.ts`](../../../src/runtime/tools/script-tools.ts)

---

## 1. Universal Tool 标准接口

所有内部工具均实现 `UniversalToolHandler` 契约：
```typescript
export interface UniversalToolHandler {
  readonly name: string;
  readonly description: string;
  readonly risk: 'read' | 'write' | 'external';
  readonly requiresApproval: boolean;
  canHandle(toolName: string): boolean;
  execute(toolName: string, args: Record<string, unknown>, context: ToolContext): Promise<string>;
}
```

## 2. MCP 客户端与外部生态

通过 `McpProcessSupervisor` 启动标准 stdio 形式的 MCP Server 子进程，自动通过 JSON-RPC 获取工具列表，并动态注入到 `ToolRegistry` 中供大模型统一调度。
