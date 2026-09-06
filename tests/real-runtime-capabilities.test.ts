import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AttachmentReader } from '../src/runtime/attachment-reader.js';
import { ContextCompactor } from '../src/runtime/context-compactor.js';
import { SafeProcessRunner } from '../src/runtime/process-runner.js';
import { LocalWorkspaceSandbox } from '../src/runtime/sandbox.js';
import { DefaultApprovalPolicy } from '../src/runtime/approval-policy.js';
import { RuntimeEngine } from '../src/runtime/engine.js';
import { AppServer } from '../src/runtime/app-server.js';
import { DesktopSession } from '../src/desktop/session.js';
import type { AttachmentItem, ChatMessage } from '../src/runtime/protocol.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createTempWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-runtime-real-'));
  roots.push(root);
  return root;
}

describe('Real Agent Runtime Functional Capabilities', () => {
  describe('AttachmentReader (真实物理文件内容提取)', () => {
    it('reads real text content from local file and formats structured prompt', () => {
      const root = createTempWorkspace();
      const filePath = join(root, 'notes.md');
      writeFileSync(filePath, '# 项目需求\n1. 实现真实运行时\n2. 拒绝仅有 UI 空架子\n', 'utf8');

      const reader = new AttachmentReader();
      const item: AttachmentItem = {
        id: 'att-1',
        name: 'notes.md',
        path: filePath,
        size: 80,
        type: 'text/markdown',
      };

      const extracted = reader.extract(item);
      expect(extracted.name).toBe('notes.md');
      expect(extracted.textContent).toContain('实现真实运行时');
      expect(extracted.textContent).toContain('拒绝仅有 UI 空架子');
      expect(extracted.isTruncated).toBe(false);

      const prompt = reader.formatPrompt([extracted]);
      expect(prompt).toContain('<attachments>');
      expect(prompt).toContain('<attachment name="notes.md" type="text/markdown" size="');
      expect(prompt).toContain('实现真实运行时');
      expect(prompt).toContain('</attachments>');
    });

    it('truncates oversized text files while preserving head and tail', () => {
      const root = createTempWorkspace();
      const filePath = join(root, 'large.log');
      const largeContent = 'HEAD_LINE\n' + 'x'.repeat(5000) + '\nTAIL_LINE';
      writeFileSync(filePath, largeContent, 'utf8');

      const reader = new AttachmentReader({ maxCharsPerFile: 1000 });
      const extracted = reader.extract({
        id: 'att-large',
        name: 'large.log',
        path: filePath,
        size: largeContent.length,
        type: 'text/plain',
      });

      expect(extracted.isTruncated).toBe(true);
      expect(extracted.textContent).toContain('HEAD_LINE');
      expect(extracted.textContent).toContain('TAIL_LINE');
      expect(extracted.textContent).toContain('已自动折叠截断中间');
    });
  });

  describe('ContextCompactor (真实上下文压缩与 Checkpoint 归档)', () => {
    it('folds historical messages into a structured Checkpoint and prunes tool results', () => {
      const compactor = new ContextCompactor({ preserveRecentCount: 2 });
      const messages: ChatMessage[] = [
        {
          id: 'm1',
          threadId: 't1',
          role: 'user',
          content: '请帮我整理销售数据',
          createdAt: '2026-09-05T00:00:00.000Z',
        },
        {
          id: 'm2',
          threadId: 't1',
          role: 'tool',
          name: 'workspace.read_file',
          content: 'sales.csv 包含以下数据：\n' + 'Maya,120\nLeo,80\n'.repeat(50),
          createdAt: '2026-09-05T00:01:00.000Z',
        },
        {
          id: 'm3',
          threadId: 't1',
          role: 'assistant',
          content: '已成功生成 sales-summary.xlsx 汇总文件。',
          createdAt: '2026-09-05T00:02:00.000Z',
        },
        {
          id: 'm4',
          threadId: 't1',
          role: 'user',
          content: '现在帮我写一份周报',
          createdAt: '2026-09-05T00:03:00.000Z',
        },
        {
          id: 'm5',
          threadId: 't1',
          role: 'assistant',
          content: '好的，正在准备生成周报。',
          createdAt: '2026-09-05T00:04:00.000Z',
        },
      ];

      const result = compactor.compact(messages, 't1', (p) => `${p}-1`, () => '2026-09-05T00:05:00.000Z');
      expect(result.compacted).toBe(true);
      expect(result.previousCount).toBe(5);
      // Checkpoint + recent 2 = 3 messages
      expect(result.newCount).toBe(3);
      expect(result.messages[0]?.content).toContain('[系统上下文整理与记忆压缩]');
      expect(result.messages[0]?.content).toContain('请帮我整理销售数据');
      expect(result.messages[0]?.content).toContain('sales-summary.xlsx');
      expect(result.freedTokensEstimate).toBeGreaterThan(0);
    });

    it('estimates token usage accurately with context window metrics', () => {
      const compactor = new ContextCompactor();
      const messages: ChatMessage[] = [
        { id: '1', threadId: 't', role: 'user', content: '测试 Token 统计内容', createdAt: '' },
      ];
      const snapshot = compactor.estimateTokens(messages, true);
      expect(snapshot.contextWindow).toBe(128000);
      expect(snapshot.usedTokens).toBeGreaterThan(0);
      expect(snapshot.messagesCount).toBe(1);
    });
  });

  describe('SafeProcessRunner (本地安全命令执行)', () => {
    it('executes safe PowerShell commands and returns output', async () => {
      const root = createTempWorkspace();
      const runner = new SafeProcessRunner({ defaultTimeoutMs: 5000 });

      const result = await runner.run({
        command: 'Write-Output "AgentRuntimeActive"',
        cwd: root,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('AgentRuntimeActive');
      expect(result.timedOut).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('LocalWorkspaceSandbox File Writing & Diff Editing', () => {
    it('writes arbitrary workspace file and edits via search & replace diff', () => {
      const root = createTempWorkspace();
      const sandbox = new LocalWorkspaceSandbox({
        rootDir: root,
        policy: new DefaultApprovalPolicy({ tier: 'full-access' }),
      });

      // 1. Write file
      const writeRes = sandbox.writeWorkspaceFile('config/app.json', '{\n  "port": 3000,\n  "env": "dev"\n}\n');
      expect(writeRes.bytes).toBeGreaterThan(0);
      expect(readFileSync(join(root, 'config/app.json'), 'utf8')).toContain('"port": 3000');

      // 2. Edit file via partial Search & Replace
      const editRes = sandbox.editWorkspaceFile('config/app.json', '"env": "dev"', '"env": "production"');
      expect(editRes.replacements).toBe(1);
      expect(readFileSync(join(root, 'config/app.json'), 'utf8')).toContain('"env": "production"');

      // 3. List directory
      const dirEntries = sandbox.listDirectory('config');
      expect(dirEntries.some((e) => e.name === 'app.json')).toBe(true);
    });

    it('denies path traversal attempts outside workspace root', () => {
      const root = createTempWorkspace();
      const sandbox = new LocalWorkspaceSandbox({ rootDir: root });

      expect(() => {
        sandbox.writeWorkspaceFile('../forbidden.txt', 'evil');
      }).toThrow(/path_outside_workspace/);
    });
  });

  describe('RuntimeEngine Universal Tools & 5-Tier Approval Interception', () => {
    it('executes workspace.write_file and workspace.edit_file in full-access tier', async () => {
      const root = createTempWorkspace();
      const policy = new DefaultApprovalPolicy({ tier: 'full-access' });
      const engine = new RuntimeEngine({ approvalPolicy: policy });

      const thread = engine.createThread({ workspaceId: 'ws-1', workspaceRoot: root });

      // Write file
      const writeOutput = await engine.executeToolCall(thread, {
        id: 'tc-1',
        name: 'workspace.write_file',
        arguments: { path: 'greeting.txt', content: 'Hello World!' },
      });
      expect(writeOutput).toContain('成功写入工作区文件: greeting.txt');
      expect(readFileSync(join(root, 'greeting.txt'), 'utf8')).toBe('Hello World!');

      // Edit file
      const editOutput = await engine.executeToolCall(thread, {
        id: 'tc-2',
        name: 'workspace.edit_file',
        arguments: { path: 'greeting.txt', search: 'Hello', replace: 'Hi' },
      });
      expect(editOutput).toContain('成功对工作区文件 greeting.txt 完成局部精准 Search & Replace 编辑');
      expect(readFileSync(join(root, 'greeting.txt'), 'utf8')).toBe('Hi World!');

      // List dir
      const listOutput = await engine.executeToolCall(thread, {
        id: 'tc-3',
        name: 'workspace.list_dir',
        arguments: {},
      });
      expect(listOutput).toContain('greeting.txt');

      // Run command
      const runOutput = await engine.executeToolCall(thread, {
        id: 'tc-4',
        name: 'workspace.run_command',
        arguments: { command: 'Write-Output "VerifiedRun"' },
      });
      expect(runOutput).toContain('VerifiedRun');
    });

    it('intercepts write and command execution in ask-approval tier', async () => {
      const root = createTempWorkspace();
      const policy = new DefaultApprovalPolicy({ tier: 'ask-approval' });
      const engine = new RuntimeEngine({ approvalPolicy: policy });

      const thread = engine.createThread({ workspaceId: 'ws-1', workspaceRoot: root });

      // Write should be intercepted
      const writeOutput = await engine.executeToolCall(thread, {
        id: 'tc-1',
        name: 'workspace.write_file',
        arguments: { path: 'secret.txt', content: 'data' },
      });
      expect(writeOutput).toContain('[安全审批拦截]');
      expect(writeOutput).toContain('需要人工审批确认');

      // Run command should be intercepted
      const runOutput = await engine.executeToolCall(thread, {
        id: 'tc-2',
        name: 'workspace.run_command',
        arguments: { command: 'Get-Process' },
      });
      expect(runOutput).toContain('[安全审批拦截]');
      expect(runOutput).toContain('需要人工审批确认');
    });
  });

  describe('DesktopSession Integration (真实附件提取与真实压缩)', () => {
    it('injects real attachment content when user sends a message', async () => {
      const root = createTempWorkspace();
      const filePath = join(root, 'source.ts');
      writeFileSync(filePath, 'export const value = 42;\n', 'utf8');

      const server = new AppServer();
      const session = new DesktopSession({ server });
      session.selectWorkspace(root);

      session.addAttachment({
        id: 'a1',
        name: 'source.ts',
        path: filePath,
        size: 25,
        type: 'text/typescript',
      });

      await session.sendMessage('请分析此源码');

      const messages = session.snapshot().messages ?? [];
      const userMsg = messages.find((m) => m.role === 'user');
      expect(userMsg).toBeDefined();
      expect(userMsg?.content).toContain('<attachment name="source.ts"');
      expect(userMsg?.content).toContain('export const value = 42;');
    });

    it('physically reduces token usage and messages when calling compactContext', async () => {
      const root = createTempWorkspace();
      const server = new AppServer();
      const session = new DesktopSession({ server });
      session.selectWorkspace(root);

      // Create a conversation with multiple turns
      await session.sendMessage('任务 1：请记录下要点 A');
      await session.sendMessage('任务 2：请记录下要点 B');
      await session.sendMessage('任务 3：请记录下要点 C');

      const countBefore = (session.snapshot().messages ?? []).length;
      expect(countBefore).toBeGreaterThanOrEqual(6);

      // Trigger real compaction
      await session.compactContext();

      const countAfter = (session.snapshot().messages ?? []).length;
      expect(countAfter).toBeLessThan(countBefore);

      const messagesAfter = session.snapshot().messages ?? [];
      expect(messagesAfter[0]?.content).toContain('[系统上下文整理与记忆压缩]');
    });
  });
});
