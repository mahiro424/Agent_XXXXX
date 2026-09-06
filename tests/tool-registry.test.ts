import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ToolRegistry,
  createDefaultToolRegistry,
  createSanitizedProcessEnv,
  ReadFileToolHandler,
  WriteFileToolHandler,
  EditFileToolHandler,
  ListDirToolHandler,
  WriteArtifactToolHandler,
  ProcessExcelToolHandler,
  GenerateWordReportToolHandler,
  RunCommandToolHandler,
  ExecuteScriptToolHandler,
  McpToolAdapter,
} from '../src/runtime/tools/index.js';
import type { ToolContext } from '../src/runtime/tools/index.js';
import { LocalWorkspaceSandbox } from '../src/runtime/sandbox.js';
import { DefaultApprovalPolicy } from '../src/runtime/approval-policy.js';
import { ProductionOfficeEngine } from '../src/runtime/office-engine.js';
import { LocalDocumentEngine } from '../src/runtime/document-engine.js';
import { SafeProcessRunner } from '../src/runtime/process-runner.js';
import { McpBridge } from '../src/runtime/mcp-bridge.js';
import { RuntimeEngine } from '../src/runtime/engine.js';
import { DesktopSession } from '../src/desktop/session.js';
import type { Thread } from '../src/runtime/protocol.js';

describe('ToolRegistry 与命令模式插件架构 (Tool Architecture)', () => {
  function createTestContext(rootDir: string, tier: 'full-access' | 'auto' | 'ask-approval' = 'full-access') {
    const thread: Thread = {
      id: 'thread-test-1',
      workspaceId: 'ws-1',
      workspaceRoot: rootDir,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const policy = new DefaultApprovalPolicy({ tier });
    const sandbox = new LocalWorkspaceSandbox({
      rootDir,
      policy,
      now: () => new Date().toISOString(),
      idFactory: (p) => `${p}-1`,
    });
    const officeEngine = new ProductionOfficeEngine();
    const documentEngine = new LocalDocumentEngine();
    const processRunner = new SafeProcessRunner();
    const mcpBridge = new McpBridge();
    const verifiedArtifacts: string[] = [];

    const context: ToolContext = {
      thread,
      sandbox,
      approvalPolicy: policy,
      officeEngine,
      documentEngine,
      processRunner,
      mcpBridge,
      enablePowershellExecution: true,
      verifyArtifact: (_threadId, name) => {
        verifiedArtifacts.push(name);
      },
      now: () => new Date().toISOString(),
    };

    return { context, sandbox, policy, verifiedArtifacts };
  }

  it('createDefaultToolRegistry 能够预装载全部系统标准工具并枚举规范定义', () => {
    const registry = createDefaultToolRegistry();

    expect(registry.has('workspace.read_file')).toBe(true);
    expect(registry.has('workspace.write_file')).toBe(true);
    expect(registry.has('workspace.edit_file')).toBe(true);
    expect(registry.has('workspace.list_dir')).toBe(true);
    expect(registry.has('workspace.write_artifact')).toBe(true);
    expect(registry.has('office.process_excel')).toBe(true);
    expect(registry.has('office.generate_word_report')).toBe(true);
    expect(registry.has('workspace.run_command')).toBe(true);
    expect(registry.has('workspace.execute_script')).toBe(true);
    expect(registry.has('mcp.test-server.calc')).toBe(true); // 通配符 mcp.*

    const defs = registry.getDefinitions();
    expect(defs.length).toBeGreaterThanOrEqual(9);
    const names = defs.map((d) => d.name);
    expect(names).toContain('workspace.read_file');
    expect(names).toContain('office.process_excel');
    expect(names).toContain('workspace.execute_script');
  });

  it('对未知工具名称执行时返回清晰的错误提示，不抛出未经处理的异常', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agent-tool-reg-'));
    try {
      const { context } = createTestContext(tempDir);
      const registry = new ToolRegistry();
      const result = await registry.execute('unknown.tool_xyz', {}, context);
      expect(result).toContain('未知工具: "unknown.tool_xyz"');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('文件系统工具集 (workspace-file-tools) 能够独立执行读写与编辑', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agent-tool-fs-'));
    try {
      const { context, sandbox } = createTestContext(tempDir, 'full-access');
      const registry = createDefaultToolRegistry();

      // 1. 写入文件
      const writeRes = await registry.execute(
        'workspace.write_file',
        { path: 'test.txt', content: 'Hello World\nLine 2' },
        context,
      );
      expect(writeRes).toContain('成功写入工作区文件: test.txt');
      expect(sandbox.hasFile('test.txt')).toBe(true);

      // 2. 读取文件
      const readRes = await registry.execute('workspace.read_file', { path: 'test.txt' }, context);
      expect(readRes).toContain('Hello World');

      // 3. 局部精准替换
      const editRes = await registry.execute(
        'workspace.edit_file',
        { path: 'test.txt', targetContent: 'Hello World', replacementContent: 'Hello Antigravity' },
        context,
      );
      expect(editRes).toContain('成功对工作区文件 test.txt 完成局部精准 Search & Replace 编辑');
      expect(sandbox.readFile('test.txt')).toContain('Hello Antigravity');

      // 4. 列出目录
      const listRes = await registry.execute('workspace.list_dir', {}, context);
      expect(listRes).toContain('test.txt');

      // 5. 产物写入
      const artifactRes = await registry.execute(
        'workspace.write_artifact',
        { name: 'out.json', content: '{"ok":true}' },
        context,
      );
      expect(artifactRes).toContain('成功在工作区生成文件: out.json');
      expect(sandbox.hasFile('artifacts/out.json') || existsSync(join(sandbox.artifactsDir, 'out.json'))).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('环境变量脱敏函数 createSanitizedProcessEnv 能够彻底过滤宿主凭据', () => {
    // 注入临时敏感环境变量模拟
    const origAgent = process.env['AGENT_API_KEY'];
    const origOpenAI = process.env['OPENAI_API_KEY'];
    process.env['AGENT_API_KEY'] = 'secret-key-123';
    process.env['OPENAI_API_KEY'] = 'sk-secret-456';

    const env = createSanitizedProcessEnv();
    expect(env['AGENT_API_KEY']).toBe('');
    expect(env['OPENAI_API_KEY']).toBe('');
    expect(env['ANTHROPIC_API_KEY']).toBe('');

    // 基础系统路径保留
    const hasPath = env['PATH'] !== undefined || env['Path'] !== undefined;
    expect(hasPath).toBe(true);

    if (origAgent !== undefined) process.env['AGENT_API_KEY'] = origAgent; else delete process.env['AGENT_API_KEY'];
    if (origOpenAI !== undefined) process.env['OPENAI_API_KEY'] = origOpenAI; else delete process.env['OPENAI_API_KEY'];
  });

  it('Office 工具集能够独立生成 Excel 工作簿并触发证据链校验', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agent-tool-office-'));
    try {
      const { context, sandbox, verifiedArtifacts } = createTestContext(tempDir, 'full-access');
      const registry = createDefaultToolRegistry();

      sandbox.writeWorkspaceFile('data.csv', 'name,score\nAlice,95\nBob,88');

      const excelRes = await registry.execute(
        'office.process_excel',
        {
          source: 'data.csv',
          target: 'scores.xlsx',
          title: '考试成绩单',
        },
        context,
      );

      expect(excelRes).toContain('成功生成带动态公式的高保真 Excel 工作簿：scores.xlsx');
      expect(existsSync(join(sandbox.artifactsDir, 'scores.xlsx'))).toBe(true);
      expect(verifiedArtifacts).toContain('scores.xlsx');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('执行内核双轨统一：sendMessage 自动沉淀不可变 Turn，并在 DesktopSession 快照中无缝透传', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agent-turn-unify-'));
    try {
      const engine = new RuntimeEngine();
      const thread = engine.createThread({ workspaceId: 'ws-unify', workspaceRoot: tempDir });

      // 1. 发送对话消息
      await engine.sendMessage(thread.id, '你好，我是测试用户');

      // 2. 验证引擎中已自动创建并完成 Turn
      const events = engine.listEvents(thread.id);
      const turnStarted = events.find((e) => e.type === 'turn.started');
      const turnCompleted = events.find((e) => e.type === 'turn.status_changed');

      expect(turnStarted).toBeDefined();
      expect(turnCompleted).toBeDefined();
      expect((turnStarted?.payload as any).input).toBe('你好，我是测试用户');
      expect((turnCompleted?.payload as any).status).toBe('completed');

      // 3. 验证 DesktopSession 在多轮交互中能自动同步当前 turn
      const session = new DesktopSession({
        permissionMode: 'full-access',
        liveModelAvailable: false,
      });
      await session.selectWorkspace(tempDir);

      const snapshot = await session.sendMessage('请帮我确认工作区状态');
      expect(snapshot.turn).toBeDefined();
      expect(snapshot.turn?.input).toBe('请帮我确认工作区状态');
      expect(snapshot.turn?.status).toBe('completed');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
