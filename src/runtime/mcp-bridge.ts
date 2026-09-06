import type { AgentToolDefinition, ToolParameterSchema } from './model-provider.js';
import type {
  McpServerConfig,
  McpServerState,
  McpToolInfo,
} from './mcp-types.js';
import { loadMcpConfig } from './mcp-config.js';
import { McpProcessSupervisor } from './mcp-process-supervisor.js';

export interface McpToolSchema {
  readonly type: 'object';
  readonly properties?: Record<string, unknown> | undefined;
  readonly required?: readonly string[] | undefined;
}

function formatToolParameters(
  schema?: McpToolSchema | Record<string, unknown> | undefined,
): ToolParameterSchema | undefined {
  if (!schema) return undefined;
  const raw = schema as Record<string, unknown>;
  const props =
    raw.properties && typeof raw.properties === 'object'
      ? (raw.properties as Record<string, unknown>)
      : undefined;
  const req = Array.isArray(raw.required)
    ? (raw.required as string[])
    : undefined;
  const desc =
    typeof raw.description === 'string'
      ? raw.description
      : undefined;

  return {
    type: typeof raw.type === 'string' ? raw.type : 'object',
    ...(desc !== undefined ? { description: desc } : {}),
    ...(props !== undefined ? { properties: props } : {}),
    ...(req !== undefined ? { required: req } : {}),
  };
}

export interface McpTool {
  readonly name: string;
  readonly description?: string | undefined;
  readonly inputSchema?: McpToolSchema | undefined;
  readonly risk?: 'read' | 'write' | 'external' | undefined;
  readonly requiresApproval?: boolean | undefined;
  readonly execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export class McpBridge {
  private readonly inMemoryTools = new Map<string, McpTool>();
  private readonly servers = new Map<string, McpProcessSupervisor>();
  private defaultWorkspacePath?: string | undefined;

  public constructor(options?: { readonly defaultWorkspacePath?: string | undefined }) {
    this.defaultWorkspacePath = options?.defaultWorkspacePath;
  }

  public setDefaultWorkspacePath(workspacePath: string | undefined): void {
    this.defaultWorkspacePath = workspacePath;
  }

  // --- In-memory mock tools support (backward compatibility & testing) ---

  public registerTool(tool: McpTool): void {
    this.inMemoryTools.set(tool.name, tool);
  }

  public unregisterTool(name: string): boolean {
    return this.inMemoryTools.delete(name);
  }

  public listTools(): readonly McpTool[] {
    return Array.from(this.inMemoryTools.values());
  }

  public getTool(name: string): McpTool | undefined {
    return this.inMemoryTools.get(name);
  }

  // --- External MCP Servers Management ---

  public addServer(
    id: string,
    config: McpServerConfig,
    workspacePath?: string | undefined,
  ): McpProcessSupervisor {
    const existing = this.servers.get(id);
    if (existing) {
      existing.disconnect().catch(() => {});
    }
    const supervisor = new McpProcessSupervisor(
      id,
      config,
      workspacePath ?? this.defaultWorkspacePath,
    );
    this.servers.set(id, supervisor);
    return supervisor;
  }

  public async removeServer(id: string): Promise<boolean> {
    const server = this.servers.get(id);
    if (!server) {
      return false;
    }
    await server.disconnect();
    return this.servers.delete(id);
  }

  public getServer(id: string): McpProcessSupervisor | undefined {
    return this.servers.get(id);
  }

  public listServers(): readonly McpServerState[] {
    return Array.from(this.servers.values()).map((s) => s.getState());
  }

  public async loadFromConfig(options?: {
    readonly workspacePath?: string | undefined;
    readonly globalConfigPath?: string | undefined;
  }): Promise<void> {
    const ws = options?.workspacePath ?? this.defaultWorkspacePath;
    const configs = loadMcpConfig({
      ...(ws !== undefined ? { workspacePath: ws } : {}),
      ...(options?.globalConfigPath !== undefined ? { globalConfigPath: options.globalConfigPath } : {}),
    });

    for (const [id, cfg] of Object.entries(configs)) {
      if (!this.servers.has(id)) {
        this.addServer(id, cfg, ws);
      }
    }
  }

  public async connectAll(timeoutMs = 10000): Promise<void> {
    const promises = Array.from(this.servers.values()).map(async (supervisor) => {
      if (!supervisor.config.disabled) {
        try {
          await supervisor.connect(timeoutMs);
        } catch (err) {
          console.warn(`[McpBridge] Failed to connect MCP server ${supervisor.id}:`, err);
        }
      }
    });
    await Promise.all(promises);
  }

  // --- Tool Export for Agent Engine ---

  public toAgentTools(): readonly AgentToolDefinition[] {
    const tools: AgentToolDefinition[] = [];

    // 1. In-memory tools
    for (const tool of this.inMemoryTools.values()) {
      const params = formatToolParameters(tool.inputSchema);
      tools.push({
        name: `mcp.${tool.name}`,
        description: tool.description ?? `MCP 工具: ${tool.name}`,
        risk: tool.risk ?? 'read',
        requiresApproval: tool.requiresApproval ?? false,
        ...(params !== undefined ? { parameters: params } : {}),
      });
    }

    // 2. Tools from connected external MCP servers
    for (const server of this.servers.values()) {
      for (const tool of server.getTools()) {
        const params = formatToolParameters(tool.inputSchema);
        tools.push({
          name: tool.fullName,
          description: tool.description
            ? `[MCP:${server.id}] ${tool.description}`
            : `[MCP:${server.id}] ${tool.name}`,
          risk: tool.risk,
          requiresApproval: tool.requiresApproval,
          ...(params !== undefined ? { parameters: params } : {}),
        });
      }
    }

    return tools;
  }

  // --- Dispatch & Execution ---

  public async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const rawName = name.startsWith('mcp.') ? name.slice(4) : name;

    // 1. Check in-memory tools
    const inMemoryTool = this.inMemoryTools.get(rawName);
    if (inMemoryTool) {
      const result = await inMemoryTool.execute(args);
      if (typeof result === 'string') {
        return result;
      }
      return JSON.stringify(result, null, 2);
    }

    // 2. Check external servers (pattern: <serverId>.<toolName>)
    const dotIndex = rawName.indexOf('.');
    if (dotIndex > 0) {
      const serverId = rawName.slice(0, dotIndex);
      const toolName = rawName.slice(dotIndex + 1);
      const server = this.servers.get(serverId);
      if (server) {
        return await server.callTool(toolName, args);
      }
    }

    throw new Error(`MCP tool not found: ${name}`);
  }

  public async dispose(): Promise<void> {
    const disconnections = Array.from(this.servers.values()).map((s) => s.disconnect());
    await Promise.all(disconnections);
    this.servers.clear();
    this.inMemoryTools.clear();
  }
}
