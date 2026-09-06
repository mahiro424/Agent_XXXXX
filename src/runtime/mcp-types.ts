export interface McpServerConfig {
  readonly command: string;
  readonly args?: readonly string[] | undefined;
  readonly env?: Record<string, string> | undefined;
  readonly cwd?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly autoApprove?: readonly string[] | undefined;
}

export interface McpServersConfigFile {
  readonly mcpServers?: Record<string, McpServerConfig> | undefined;
}

export type McpServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface McpToolInfo {
  readonly name: string;
  readonly fullName: string; // e.g. "mcp.sqlite.query" or "mcp.calc"
  readonly description?: string | undefined;
  readonly inputSchema?: Record<string, unknown> | undefined;
  readonly serverId: string;
  readonly risk: 'read' | 'write' | 'external';
  readonly requiresApproval: boolean;
}

export interface McpServerState {
  readonly id: string;
  readonly config: McpServerConfig;
  readonly status: McpServerStatus;
  readonly error?: string | undefined;
  readonly tools: readonly McpToolInfo[];
}
