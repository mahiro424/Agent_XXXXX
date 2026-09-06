import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  parseMcpConfigFile,
  validateMcpServerConfig,
  loadMcpConfig,
} from '../src/runtime/mcp-config.js';
import {
  McpProcessSupervisor,
  inferToolRisk,
} from '../src/runtime/mcp-process-supervisor.js';
import { McpBridge } from '../src/runtime/mcp-bridge.js';

describe('MCP Subsystem: Config, Risk Inference and Process Supervisor', () => {
  const tempDirs: string[] = [];

  function createTempDir(prefix: string): string {
    const base = join(process.cwd(), '.test-tmp');
    const dir = join(base, `agent-test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const d of tempDirs) {
      try {
        if (existsSync(d)) {
          rmSync(d, { recursive: true, force: true });
        }
      } catch {
        // ignore cleanup error
      }
    }
  });

  it('infers tool risk and approval requirement based on name and description', () => {
    const r1 = inferToolRisk('read_file', 'Read file contents from disk');
    expect(r1.risk).toBe('read');
    expect(r1.requiresApproval).toBe(false);

    const r2 = inferToolRisk('delete_record', 'Delete a record from database');
    expect(r2.risk).toBe('write');
    expect(r2.requiresApproval).toBe(true);

    const r3 = inferToolRisk('run_command', 'Execute a shell script');
    expect(r3.risk).toBe('external');
    expect(r3.requiresApproval).toBe(true);

    const r4 = inferToolRisk('query_data', 'Execute a SELECT statement');
    expect(r4.risk).toBe('external'); // 'execute' in description triggers external
    expect(r4.requiresApproval).toBe(true);
  });

  it('parses, validates and merges MCP configurations', () => {
    const rawJson = JSON.stringify({
      mcpServers: {
        calc: {
          command: 'node',
          args: ['calc.js'],
          env: { FOO: 'bar' },
          autoApprove: ['add'],
        },
        invalidServer: {
          command: '',
        },
      },
    });

    const parsed = parseMcpConfigFile(rawJson);
    expect(parsed.calc).toBeDefined();
    expect(parsed.calc?.command).toBe('node');
    expect(parsed.calc?.args).toEqual(['calc.js']);
    expect(parsed.calc?.env).toEqual({ FOO: 'bar' });
    expect(parsed.calc?.autoApprove).toEqual(['add']);
    // Invalid server was skipped
    expect(parsed.invalidServer).toBeUndefined();
  });

  it('loads workspace mcp.json and overrides global servers', () => {
    const wsDir = createTempDir('ws');
    const globalDir = createTempDir('global');

    const globalConfigPath = join(globalDir, 'mcp_servers.json');
    writeFileSync(
      globalConfigPath,
      JSON.stringify({
        mcpServers: {
          globalOnly: { command: 'node', args: ['g.js'] },
          overrideMe: { command: 'node', args: ['v1.js'] },
        },
      }),
      'utf8'
    );

    const agentDir = join(wsDir, '.agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          overrideMe: { command: 'node', args: ['v2.js'] },
          wsOnly: { command: 'node', args: ['ws.js'] },
        },
      }),
      'utf8'
    );

    const merged = loadMcpConfig({
      workspacePath: wsDir,
      globalConfigPath,
    });

    expect(merged.globalOnly).toBeDefined();
    expect(merged.overrideMe?.args).toEqual(['v2.js']);
    expect(merged.wsOnly).toBeDefined();
  });

  it('spawns a real stdio MCP server process, discovers tools, and executes tool calls', async () => {
    const serverDir = createTempDir('mcp-srv');
    const serverScriptPath = join(serverDir, 'server.mjs');

    // Create a mini MCP Server script using @modelcontextprotocol/sdk
    const serverScript = `
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'test-mcp-server',
  version: '1.0.0',
});

server.tool(
  'add_numbers',
  { a: z.number(), b: z.number() },
  async ({ a, b }) => {
    return {
      content: [
        { type: 'text', text: String(a + b) }
      ]
    };
  }
);

server.tool(
  'list_items',
  {},
  async () => {
    return {
      content: [
        { type: 'text', text: 'item1, item2, item3' }
      ]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
`;
    writeFileSync(serverScriptPath, serverScript, 'utf8');

    const bridge = new McpBridge();
    const supervisor = bridge.addServer('math', {
      command: 'node',
      args: [serverScriptPath],
      autoApprove: ['add_numbers'],
    });

    try {
      const tools = await supervisor.connect(15000);
      expect(tools.length).toBe(2);
      expect(tools.map((t) => t.name)).toContain('add_numbers');
      expect(tools.map((t) => t.name)).toContain('list_items');

      // Check autoApprove overrides approval requirement
      const addTool = tools.find((t) => t.name === 'add_numbers');
      expect(addTool?.fullName).toBe('mcp.math.add_numbers');
      expect(addTool?.requiresApproval).toBe(false);

      // Verify bridge tool export
      const agentTools = bridge.toAgentTools();
      expect(agentTools.some((t) => t.name === 'mcp.math.add_numbers')).toBe(true);

      // Execute tool call via bridge
      const result = await bridge.execute('mcp.math.add_numbers', { a: 15, b: 27 });
      expect(result.trim()).toBe('42');

      const itemsResult = await bridge.execute('mcp.math.list_items', {});
      expect(itemsResult).toContain('item1, item2, item3');
    } finally {
      await bridge.dispose();
    }
  });
});
