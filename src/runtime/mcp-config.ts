import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { McpServerConfig, McpServersConfigFile } from './mcp-types.js';

export function getDefaultGlobalMcpConfigPath(): string {
  const appData =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : join(homedir(), '.config'));
  return join(appData, 'Agent_XXXXX', 'mcp_servers.json');
}

export function getWorkspaceMcpConfigPath(workspacePath: string): string {
  return join(workspacePath, '.agent', 'mcp.json');
}

export function validateMcpServerConfig(id: string, raw: unknown): McpServerConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid MCP server configuration for "${id}": must be an object`);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.command !== 'string' || obj.command.trim().length === 0) {
    throw new Error(`Invalid MCP server configuration for "${id}": "command" must be a non-empty string`);
  }

  const command = obj.command.trim();
  const args = Array.isArray(obj.args)
    ? obj.args.filter((item): item is string => typeof item === 'string')
    : undefined;

  let env: Record<string, string> | undefined;
  if (obj.env && typeof obj.env === 'object' && !Array.isArray(obj.env)) {
    env = {};
    for (const [key, value] of Object.entries(obj.env as Record<string, unknown>)) {
      if (typeof value === 'string') {
        env[key] = value;
      }
    }
  }

  const cwd = typeof obj.cwd === 'string' ? obj.cwd : undefined;
  const disabled = typeof obj.disabled === 'boolean' ? obj.disabled : false;
  const autoApprove = Array.isArray(obj.autoApprove)
    ? obj.autoApprove.filter((item): item is string => typeof item === 'string')
    : undefined;

  return {
    command,
    ...(args && args.length > 0 ? { args } : {}),
    ...(env && Object.keys(env).length > 0 ? { env } : {}),
    ...(cwd ? { cwd } : {}),
    ...(disabled ? { disabled: true } : {}),
    ...(autoApprove && autoApprove.length > 0 ? { autoApprove } : {}),
  };
}

export function parseMcpConfigFile(content: string): Record<string, McpServerConfig> {
  try {
    const parsed = JSON.parse(content) as McpServersConfigFile;
    const servers: Record<string, McpServerConfig> = {};
    const rawServers = parsed.mcpServers ?? {};

    for (const [id, rawConfig] of Object.entries(rawServers)) {
      try {
        servers[id] = validateMcpServerConfig(id, rawConfig);
      } catch (err) {
        console.warn(`[McpConfig] Skipping invalid server "${id}":`, err);
      }
    }
    return servers;
  } catch (err) {
    console.warn('[McpConfig] Failed to parse JSON config:', err);
    return {};
  }
}

export function loadMcpConfig(options?: {
  readonly workspacePath?: string;
  readonly globalConfigPath?: string;
}): Record<string, McpServerConfig> {
  const merged: Record<string, McpServerConfig> = {};

  const globalPath = options?.globalConfigPath ?? getDefaultGlobalMcpConfigPath();
  if (existsSync(globalPath)) {
    try {
      const content = readFileSync(globalPath, 'utf8');
      const globalServers = parseMcpConfigFile(content);
      Object.assign(merged, globalServers);
    } catch (err) {
      console.warn(`[McpConfig] Error reading global config ${globalPath}:`, err);
    }
  }

  if (options?.workspacePath) {
    const wsPath1 = getWorkspaceMcpConfigPath(options.workspacePath);
    const wsPath2 = join(options.workspacePath, '.agent', 'mcp_servers.json');
    const targetWsPath = existsSync(wsPath1) ? wsPath1 : existsSync(wsPath2) ? wsPath2 : undefined;

    if (targetWsPath) {
      try {
        const content = readFileSync(targetWsPath, 'utf8');
        const wsServers = parseMcpConfigFile(content);
        // Workspace-level overrides global
        Object.assign(merged, wsServers);
      } catch (err) {
        console.warn(`[McpConfig] Error reading workspace config ${targetWsPath}:`, err);
      }
    }
  }

  return merged;
}

export function saveMcpConfigFile(filePath: string, servers: Record<string, McpServerConfig>): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const payload: McpServersConfigFile = {
    mcpServers: servers,
  };
  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}
