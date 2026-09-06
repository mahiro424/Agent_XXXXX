import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type {
  McpServerConfig,
  McpServerState,
  McpServerStatus,
  McpToolInfo,
} from './mcp-types.js';

export function inferToolRisk(
  toolName: string,
  description?: string | undefined,
): {
  risk: 'read' | 'write' | 'external';
  requiresApproval: boolean;
} {
  const lower = `${toolName} ${description ?? ''}`.toLowerCase();
  const executeKeywords = ['exec', 'execute', 'run_command', 'run_script', 'bash', 'powershell', 'cmd', 'terminal'];
  const mutateKeywords = ['write', 'edit', 'delete', 'remove', 'modify', 'create', 'update', 'drop', 'insert', 'patch'];

  for (const kw of executeKeywords) {
    if (lower.includes(kw)) {
      return { risk: 'external', requiresApproval: true };
    }
  }

  for (const kw of mutateKeywords) {
    if (lower.includes(kw)) {
      return { risk: 'write', requiresApproval: true };
    }
  }

  return { risk: 'read', requiresApproval: false };
}

export class McpProcessSupervisor {
  public readonly id: string;
  public readonly config: McpServerConfig;
  private status: McpServerStatus = 'disconnected';
  private lastError: string | undefined;
  private client: Client | undefined;
  private transport: StdioClientTransport | undefined;
  private cachedTools: McpToolInfo[] = [];
  private readonly defaultWorkspacePath?: string | undefined;

  public constructor(id: string, config: McpServerConfig, defaultWorkspacePath?: string | undefined) {
    this.id = id;
    this.config = config;
    this.defaultWorkspacePath = defaultWorkspacePath;
  }

  public getStatus(): McpServerStatus {
    return this.status;
  }

  public getLastError(): string | undefined {
    return this.lastError;
  }

  public getState(): McpServerState {
    return {
      id: this.id,
      config: this.config,
      status: this.status,
      error: this.lastError,
      tools: this.cachedTools,
    };
  }

  public getTools(): readonly McpToolInfo[] {
    return this.cachedTools;
  }

  public async connect(timeoutMs = 10000): Promise<readonly McpToolInfo[]> {
    if (this.config.disabled) {
      this.status = 'disconnected';
      return [];
    }

    if (this.status === 'connected' && this.client) {
      return this.cachedTools;
    }

    this.status = 'connecting';
    this.lastError = undefined;

    let timer: NodeJS.Timeout | undefined;
    try {
      const client = new Client(
        { name: `agent-xxxxx-${this.id}`, version: '0.1.0' },
        { capabilities: { roots: { listChanged: true } } }
      );

      const targetCwd = this.config.cwd || this.defaultWorkspacePath || process.cwd();
      const transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args ? [...this.config.args] : [],
        env: {
          ...process.env,
          ...(this.config.env ?? {}),
        } as Record<string, string>,
        cwd: targetCwd,
        stderr: 'pipe',
      });

      let stderrLog = '';
      if (transport.stderr) {
        transport.stderr.on('data', (chunk: Buffer | string) => {
          stderrLog += chunk.toString();
          if (stderrLog.length > 2000) {
            stderrLog = stderrLog.slice(-2000);
          }
        });
      }

      transport.onerror = (err) => {
        console.warn(`[McpSupervisor:${this.id}] Transport error:`, err);
        this.status = 'error';
        this.lastError = `${err.message || String(err)}${stderrLog ? ` | stderr: ${stderrLog}` : ''}`;
      };

      transport.onclose = () => {
        if (this.status === 'connected') {
          console.warn(`[McpSupervisor:${this.id}] Connection closed unexpectedly`);
          this.status = 'disconnected';
        }
      };

      const connectPromise = client.connect(transport);
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`MCP server "${this.id}" connection timed out after ${timeoutMs}ms${stderrLog ? ` (stderr: ${stderrLog})` : ''}`));
        }, timeoutMs);
      });

      await Promise.race([connectPromise, timeoutPromise]);

      this.client = client;
      this.transport = transport;
      this.status = 'connected';

      // Refresh tools
      await this.refreshTools();
      return this.cachedTools;
    } catch (err) {
      this.status = 'error';
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      await this.disconnect();
      throw new Error(`Failed to start MCP server "${this.id}": ${msg}`);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  public async refreshTools(): Promise<readonly McpToolInfo[]> {
    if (!this.client || this.status !== 'connected') {
      return [];
    }
    try {
      const response = await this.client.listTools();
      const autoApproveSet = new Set(this.config.autoApprove ?? []);

      this.cachedTools = (response.tools ?? []).map((t) => {
        const fullName = `mcp.${this.id}.${t.name}`;
        const auto = autoApproveSet.has(t.name) || autoApproveSet.has(fullName);
        const { risk, requiresApproval } = inferToolRisk(t.name, t.description);

        return {
          name: t.name,
          fullName,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown> | undefined,
          serverId: this.id,
          risk,
          requiresApproval: auto ? false : requiresApproval,
        };
      });
      return this.cachedTools;
    } catch (err) {
      console.warn(`[McpSupervisor:${this.id}] Error fetching tools:`, err);
      return this.cachedTools;
    }
  }

  public async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    if (this.status !== 'connected' || !this.client) {
      await this.connect();
    }
    if (!this.client) {
      throw new Error(`MCP server "${this.id}" is not connected`);
    }

    const res = await this.client.callTool({
      name: toolName,
      arguments: args,
    });

    const isError = Boolean((res as { isError?: boolean }).isError);
    const content = (res as { content?: unknown[] }).content;

    if (isError) {
      const text = Array.isArray(content)
        ? content
            .map((c) =>
              typeof c === 'object' && c !== null && 'text' in c
                ? String((c as { text: unknown }).text)
                : JSON.stringify(c),
            )
            .join('\n')
        : 'Unknown tool failure';
      throw new Error(`MCP Tool Error [${toolName}]: ${text}`);
    }

    if (Array.isArray(content)) {
      const texts = content.map((c) => {
        if (typeof c === 'object' && c !== null && 'text' in c) {
          return String((c as { text: unknown }).text);
        }
        return JSON.stringify(c, null, 2);
      });
      return texts.join('\n');
    }

    return typeof res === 'string' ? res : JSON.stringify(res, null, 2);
  }

  public async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close();
      }
    } catch {
      // ignore
    }
    try {
      if (this.transport) {
        await this.transport.close();
      }
    } catch {
      // ignore
    }
    this.client = undefined;
    this.transport = undefined;
    if (this.status !== 'error') {
      this.status = 'disconnected';
    }
  }
}
