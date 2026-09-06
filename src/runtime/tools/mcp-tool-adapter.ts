import type { IToolHandler, ToolContext } from './tool-interface.js';

/**
 * 远程 MCP 工具动态桥接适配器
 * 支持所有以 'mcp.' 开头的工具调用并动态委托给 McpBridge
 */
export class McpToolAdapter implements IToolHandler {
  public readonly name = 'mcp.*';

  public canHandle(toolName: string): boolean {
    return toolName.startsWith('mcp.');
  }

  public async execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    return await context.mcpBridge.execute(toolName, args);
  }
}
