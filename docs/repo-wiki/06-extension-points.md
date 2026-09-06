# 06 系统扩展点机制

开发人员可以通过以下标准方式扩展 Agent_XXXXX 的能力：

---

## 1. 添加原生工具 (Native Tool)

只需在 `src/runtime/tools/` 下实现 `UniversalToolHandler` 接口，并在 `src/runtime/tools/index.ts` 的 `createDefaultToolRegistry` 中注册即可：

```typescript
export class MyCustomTool implements UniversalToolHandler {
  public readonly name = 'my_namespace.my_tool';
  public readonly description = '我的自定义工具能力说明';
  public readonly risk = 'write';
  public readonly requiresApproval = true;

  public canHandle(toolName: string): boolean {
    return toolName === this.name;
  }

  public async execute(toolName: string, args: Record<string, unknown>, context: ToolContext): Promise<string> {
    // 业务逻辑实现，可通过 context.sandbox 安全操作工作区文件
    return '执行结果';
  }
}
```

---

## 2. 接入外部 MCP 服务

在设置面板中添加 MCP 服务器配置，指定 `command` 与 `args`（如 `npx -y @modelcontextprotocol/server-everything`），系统会自动建立 Stdio 管道并热注册工具。
