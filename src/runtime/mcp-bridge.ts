import type { AgentToolDefinition } from './model-provider.js';

export interface McpToolSchema {
  readonly type: 'object';
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
}

export interface McpTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: McpToolSchema;
  readonly execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export class McpBridge {
  private readonly tools = new Map<string, McpTool>();

  public registerTool(tool: McpTool): void {
    this.tools.set(tool.name, tool);
  }

  public unregisterTool(name: string): boolean {
    return this.tools.delete(name);
  }

  public listTools(): readonly McpTool[] {
    return Array.from(this.tools.values());
  }

  public getTool(name: string): McpTool | undefined {
    return this.tools.get(name);
  }

  public toAgentTools(): readonly AgentToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: `mcp.${tool.name}`,
      description: tool.description ?? `MCP 工具: ${tool.name}`,
      risk: 'read' as const,
      requiresApproval: false,
      ...(tool.inputSchema ? { parameters: tool.inputSchema } : {}),
    }));
  }

  public async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const rawName = name.startsWith('mcp.') ? name.slice(4) : name;
    const tool = this.tools.get(rawName);
    if (!tool) {
      throw new Error(`MCP tool not found: ${name}`);
    }
    const result = await tool.execute(args);
    if (typeof result === 'string') {
      return result;
    }
    return JSON.stringify(result, null, 2);
  }
}
