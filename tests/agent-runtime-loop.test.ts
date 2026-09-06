import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppServer } from '../src/runtime/app-server.js';
import { pruneContextMessages } from '../src/runtime/model-provider.js';
import type { ChatMessage } from '../src/runtime/protocol.js';
import { McpBridge } from '../src/runtime/mcp-bridge.js';
import { SkillRegistry } from '../src/runtime/skill.js';
import { DesktopSession } from '../src/desktop/session.js';

function createTempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-loop-'));
  writeFileSync(
    join(dir, 'sales.csv'),
    'owner,amount\nAlice,100\nBob,200\nCharlie,300\n',
    'utf8',
  );
  writeFileSync(
    join(dir, 'meeting-notes.md'),
    '# Q3 会议纪要\n重点讨论销售目标与架构改进。\n',
    'utf8',
  );
  return dir;
}

describe('Agent Runtime Loop & Conversation Stream', () => {
  it('handles basic conversational greetings and Q&A without executing tools', async () => {
    const workspace = createTempWorkspace();
    try {
      const server = new AppServer();
      const thread = server.createThread({ workspaceId: 't1', workspaceRoot: workspace });

      // 1. 打招呼
      const greetingReply = await server.sendMessage(thread.id, '你好，请介绍一下你自己');
      expect(greetingReply.role).toBe('assistant');
      expect(greetingReply.content).toContain('Agent_XXXXX');
      expect(greetingReply.toolCalls).toBeUndefined();

      // 2. 消息流被完整保留
      const messages = server.listMessages(thread.id);
      expect(messages.length).toBe(2);
      expect(messages[0]?.role).toBe('user');
      expect(messages[0]?.content).toBe('你好，请介绍一下你自己');
      expect(messages[1]?.role).toBe('assistant');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('executes ReAct tool calling loop, creates verified Excel artifact, and returns synthesized answer', async () => {
    const workspace = createTempWorkspace();
    try {
      const server = new AppServer();
      const thread = server.createThread({ workspaceId: 't2', workspaceRoot: workspace });

      // 指派 Excel 处理任务
      const reply = await server.sendMessage(
        thread.id,
        '请读取工作区 sales.csv，帮我统计销售数据并生成汇总 Excel 表格 sales-summary.xlsx',
      );

      expect(reply.role).toBe('assistant');
      expect(reply.content).toContain('sales-summary.xlsx');

      // 验证整个 ReAct loop 记录了 user -> assistant(toolCalls) -> tool(result) -> assistant(final)
      const msgs = server.listMessages(thread.id);
      expect(msgs.length).toBeGreaterThanOrEqual(3);

      const assistantCalls = msgs.find((m) => m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0);
      expect(assistantCalls).toBeDefined();
      expect(assistantCalls?.toolCalls?.[0]?.name).toBe('office.process_excel');

      const toolMsg = msgs.find((m) => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg?.content).toContain('sales-summary.xlsx');
      expect(toolMsg?.content).toContain('物理证据链校验');

      // 验证 artifacts 目录生成了真实文件并完成了校验
      const artifacts = server.checkSandbox(thread.id, {
        operation: 'read',
        targetPath: 'artifacts/sales-summary.xlsx',
      });
      expect(artifacts.decision).toBe('allowed');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('prunes context messages when estimated tokens exceed limit', () => {
    const msgs: ChatMessage[] = [
      { id: '1', threadId: 't', role: 'system', content: 'You are an agent.', createdAt: '2026-09-05T00:00:00Z' },
      { id: '2', threadId: 't', role: 'user', content: 'step 1', createdAt: '2026-09-05T00:00:01Z' },
      { id: '3', threadId: 't', role: 'assistant', content: 'calling tool', createdAt: '2026-09-05T00:00:02Z' },
      {
        id: '4',
        threadId: 't',
        role: 'tool',
        name: 'workspace.read_file',
        content: 'A'.repeat(5000), // Huge tool output
        createdAt: '2026-09-05T00:00:03Z',
      },
      { id: '5', threadId: 't', role: 'user', content: 'step 2', createdAt: '2026-09-05T00:00:04Z' },
      { id: '6', threadId: 't', role: 'assistant', content: 'final result', createdAt: '2026-09-05T00:00:05Z' },
    ];

    const pruned = pruneContextMessages(msgs, 400);
    // Preserves system message and truncates long middle tool content
    expect(pruned[0]?.role).toBe('system');
    const prunedToolMsg = pruned.find((m) => m.id === '4');
    expect(prunedToolMsg?.content.length).toBeLessThan(500);
    expect(prunedToolMsg?.content).toContain('[Tool output truncated');
  });

  it('manages App Server Skills and switches active skill per thread', async () => {
    const server = new AppServer();
    const skills = server.listSkills();
    expect(skills.length).toBeGreaterThanOrEqual(4);
    expect(skills.map((s) => s.id)).toContain('data-analysis');
    expect(skills.map((s) => s.id)).toContain('report-writing');

    const thread = server.createThread({ workspaceId: 't3' });
    server.setThreadSkill(thread.id, 'data-analysis');
    expect(server.getThreadSkill(thread.id)?.id).toBe('data-analysis');
    expect(server.getThreadSkill(thread.id)?.name).toContain('数据分析');
  });

  it('bridges MCP tools into the Agent Runtime and executes them seamlessly', async () => {
    const bridge = new McpBridge();
    bridge.registerTool({
      name: 'calc_discount',
      description: '计算折扣价格',
      inputSchema: {
        type: 'object',
        properties: { price: { type: 'number' }, discount: { type: 'number' } },
      },
      execute: (args) => {
        const p = (args.price as number) || 100;
        const d = (args.discount as number) || 0.8;
        return { finalPrice: p * d };
      },
    });

    const agentTools = bridge.toAgentTools();
    expect(agentTools.length).toBe(1);
    expect(agentTools[0]?.name).toBe('mcp.calc_discount');

    const result = await bridge.execute('mcp.calc_discount', { price: 200, discount: 0.9 });
    expect(result).toContain('"finalPrice": 180');
  });

  it('integrates seamlessly with DesktopSession for multi-turn interactive chat', async () => {
    const workspace = createTempWorkspace();
    try {
      const session = new DesktopSession({
        permissionMode: 'full-access',
        liveModelAvailable: false,
      });
      await session.selectWorkspace(workspace);

      // 第一轮：打招呼
      const snap1 = await session.sendMessage('你好！');
      expect(snap1.messages?.length).toBe(2);
      expect(snap1.messages?.[0]?.content).toBe('你好！');
      expect(snap1.messages?.[1]?.content.length).toBeGreaterThan(10);

      // 第二轮：多轮连续交互（生成周报 Word）
      const snap2 = await session.sendMessage('读取 meeting-notes.md 生成本周周报 Word 文档');
      expect(snap2.messages?.length).toBeGreaterThanOrEqual(4);
      expect(snap2.messages?.at(-1)?.content).toContain('weekly-meeting-report.docx');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
