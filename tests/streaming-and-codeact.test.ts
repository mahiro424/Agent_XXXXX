import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeEngine } from '../src/runtime/engine.js';
import { DesktopSession } from '../src/desktop/session.js';
import {
  DEFAULT_AGENT_TOOLS,
} from '../src/runtime/model-provider.js';
import type {
  ChatMessage,
  Plan,
} from '../src/runtime/protocol.js';
import type {
  ModelChatInput,
  ModelChatOutput,
  ModelProvider,
} from '../src/runtime/model-provider.js';
import { renderDemoHome } from '../src/ui/render.js';
import { DemoHomeController } from '../src/ui/demo-home.js';
import { DefaultApprovalPolicy } from '../src/runtime/approval-policy.js';

describe('Streaming Thought Disclosure & CodeAct Sandbox Subsystem', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agent-stream-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  });

  describe('1. CodeAct 脚本沙箱工具规范与安全隔离 (workspace.execute_script)', () => {
    it('在 DEFAULT_AGENT_TOOLS 中具备严格的 JSON Schema 与高危权限标记', () => {
      const scriptTool = DEFAULT_AGENT_TOOLS.find((t) => t.name === 'workspace.execute_script');
      expect(scriptTool).toBeDefined();
      expect(scriptTool?.risk).toBe('external');
      expect(scriptTool?.requiresApproval).toBe(true);
      expect(scriptTool?.parameters?.properties?.language).toBeDefined();
      expect(scriptTool?.parameters?.properties?.script).toBeDefined();
      expect(scriptTool?.parameters?.required).toContain('language');
      expect(scriptTool?.parameters?.required).toContain('script');
    });

    it('能够在受控沙箱中执行 Node.js 脚本并准确捕获标准输出', async () => {
      const engine = new RuntimeEngine({});
      engine.setApprovalPolicy(new DefaultApprovalPolicy({ tier: 'full-access' }));
      engine.setEnablePowershellExecution(true);
      const thread = engine.createThread({ workspaceId: 'ws-test', workspaceRoot: testDir });

      const nodeScript = `
        const data = [100, 250, 350];
        const sum = data.reduce((a, b) => a + b, 0);
        console.log("ACCURATE_SUM:" + sum);
      `;

      const result = await engine.executeToolCall(thread, {
        id: 'call-script-1',
        name: 'workspace.execute_script',
        arguments: {
          language: 'node',
          script: nodeScript,
        },
      });

      expect(result).toContain('ACCURATE_SUM:700');
      expect(result).toContain('退出码 0');
    });

    it('能够在受控沙箱中执行 PowerShell 脚本并处理数据', async () => {
      const engine = new RuntimeEngine({});
      engine.setApprovalPolicy(new DefaultApprovalPolicy({ tier: 'full-access' }));
      engine.setEnablePowershellExecution(true);
      const thread = engine.createThread({ workspaceId: 'ws-test', workspaceRoot: testDir });

      const psScript = `
        $val = 42 * 2
        Write-Output "CALC_RESULT:$val"
      `;

      const result = await engine.executeToolCall(thread, {
        id: 'call-script-ps',
        name: 'workspace.execute_script',
        arguments: {
          language: 'powershell',
          script: psScript,
        },
      });

      expect(result).toContain('CALC_RESULT:84');
      expect(result).toContain('PowerShell 脚本执行结果');
    });

    it('在 ask-approval 安全门禁模式下拦截脚本执行并返回明确审批提示', async () => {
      const engine = new RuntimeEngine({});
      const policy = new DefaultApprovalPolicy({ tier: 'ask-approval' });
      engine.setApprovalPolicy(policy);
      engine.setEnablePowershellExecution(true);
      const thread = engine.createThread({ workspaceId: 'ws-test', workspaceRoot: testDir });

      const result = await engine.executeToolCall(thread, {
        id: 'call-script-intercept',
        name: 'workspace.execute_script',
        arguments: {
          language: 'node',
          script: 'console.log("should be blocked");',
        },
      });

      expect(result).toContain('[安全审批拦截]');
      expect(result).toContain('需要人工审批确认');
    });

    it('当系统设置禁用外部脚本执行时拒绝运行', async () => {
      const engine = new RuntimeEngine({});
      engine.setEnablePowershellExecution(false);
      const thread = engine.createThread({ workspaceId: 'ws-test', workspaceRoot: testDir });

      const result = await engine.executeToolCall(thread, {
        id: 'call-script-disabled',
        name: 'workspace.execute_script',
        arguments: {
          language: 'node',
          script: 'console.log("hello");',
        },
      });

      expect(result).toContain('错误：当前系统设置已禁用外部脚本/命令执行');
    });
  });

  describe('2. 全链路执行事件与流式思维链透出 (Streaming & Event Lifecycle)', () => {
    it('在 ReAct 工具调用循环中准确派发 tool.started 与 tool.completed 事件', async () => {
      const eventsCaptured: string[] = [];
      const engine = new RuntimeEngine({});
      engine.subscribeEvents((event) => {
        eventsCaptured.push(event.type);
      });

      const thread = engine.createThread({ workspaceId: 'ws-test', workspaceRoot: testDir });
      // Create a dummy CSV so office.process_excel succeeds
      writeFileSync(join(testDir, 'sales.csv'), 'owner,amount\nMaya,120\nLeo,80\n', 'utf-8');

      await engine.sendMessage(thread.id, '请帮我汇总 sales.csv 并生成 Excel 表格');

      expect(eventsCaptured).toContain('intent.classified');
      expect(eventsCaptured).toContain('tool.started');
      expect(eventsCaptured).toContain('tool.completed');
    });

    it('当模型产生流式分块时通过 onChunk 驱动 message.updated 事件更新', async () => {
      const updatedMessages: ChatMessage[] = [];

      class MockStreamingProvider implements ModelProvider {
        proposePlan(): Plan {
          return { id: 'p1', turnId: 't1', steps: [], status: 'proposed' };
        }
        async chatCompletion(input: ModelChatInput): Promise<ModelChatOutput> {
          if (input.onChunk) {
            input.onChunk({ deltaReasoning: '正在推理第一步...' });
            input.onChunk({ deltaReasoning: '第二步思考完成。' });
            input.onChunk({ deltaContent: '任务已' });
            input.onChunk({ deltaContent: '执行完毕。' });
          }
          return {
            reasoningContent: '正在推理第一步...第二步思考完成。',
            content: '任务已执行完毕。',
          };
        }
      }

      const engine = new RuntimeEngine({
        modelProvider: new MockStreamingProvider(),
      });

      engine.subscribeEvents((event) => {
        if (event.type === 'message.updated') {
          updatedMessages.push(event.payload as ChatMessage);
        }
      });

      const thread = engine.createThread({ workspaceId: 'ws-test', workspaceRoot: testDir });
      const finalMsg = await engine.sendMessage(thread.id, '你好，请帮我分析');

      expect(finalMsg.content).toBe('任务已执行完毕。');
      expect(finalMsg.reasoningContent).toContain('第二步思考完成');
      expect(updatedMessages.length).toBeGreaterThanOrEqual(1);
      const lastUpdate = updatedMessages[updatedMessages.length - 1];
      expect(lastUpdate?.content).toContain('任务已执行完毕');
    });
  });

  describe('3. 会话控制器与界面渲染动效感知 (DesktopSession & UI Rendering)', () => {
    it('DesktopSession 在 sendMessage 执行期间透出 isGenerating 与细粒度 executionState', async () => {
      const session = new DesktopSession({
        configPath: join(testDir, 'agent-settings.json'),
      });
      session.selectWorkspace(testDir);

      const snapshotsObserved: { isGenerating?: boolean | undefined; status?: string | undefined }[] = [];
      session.subscribe((snap) => {
        snapshotsObserved.push({
          isGenerating: snap.isGenerating,
          status: snap.executionState?.status,
        });
      });

      await session.sendMessage('你好！');

      // Should have entered generating state and returned to idle
      expect(snapshotsObserved.some((s) => s.isGenerating === true)).toBe(true);
      const finalSnap = session.snapshot();
      expect(finalSnap.isGenerating).toBe(false);
      expect(finalSnap.executionState?.status).toBe('idle');
    });

    it('renderDemoHome 在执行期渲染 .chat-live-activity 动态指示器', () => {
      const homeController = new DemoHomeController({
        server: {} as any,
      });

      const htmlActive = renderDemoHome(homeController.view(), {
        messages: [{ id: 'm1', threadId: 't1', role: 'user', content: '测试', createdAt: '' }],
        isGenerating: true,
        executionState: {
          status: 'tool_executing',
          currentTool: 'workspace.execute_script',
          detail: '正在执行本地脚本计算...',
        },
      });

      expect(htmlActive).toContain('chat-live-activity');
      expect(htmlActive).toContain('data-execution-status="tool_executing"');
      expect(htmlActive).toContain('正在执行本地脚本计算...');
      expect(htmlActive).toContain('live-activity-spinner');
    });
  });

  describe('4. 主动自愈与容错重试闭环 (Adaptive Self-Correction & Error Recovery)', () => {
    it('当工具初次调用失败（如文件未找到）时，模型接收到错误反馈并主动纠偏重试成功', async () => {
      writeFileSync(join(testDir, 'actual_sales.csv'), 'owner,amount\nAlice,300\n', 'utf-8');

      let attempt = 0;
      class SelfHealingModelProvider implements ModelProvider {
        proposePlan(): Plan {
          return { id: 'p-self', turnId: 't-self', steps: [], status: 'proposed' };
        }
        async chatCompletion(input: ModelChatInput): Promise<ModelChatOutput> {
          attempt++;
          const lastMsg = input.messages[input.messages.length - 1];

          // Turn 1: model mistakenly guesses 'wrong_sales.csv'
          if (attempt === 1) {
            return {
              reasoningContent: '尝试读取销售文件 wrong_sales.csv',
              content: '正在读取 wrong_sales.csv...',
              toolCalls: [
                {
                  id: 'tc-err-1',
                  name: 'workspace.read_file',
                  arguments: { path: 'wrong_sales.csv' },
                },
              ],
            };
          }

          // Turn 2: model sees error "文件未找到: wrong_sales.csv。当前工作区文件列表: actual_sales.csv"
          // and self-corrects to 'actual_sales.csv'
          if (lastMsg?.role === 'tool' && lastMsg.content.includes('文件未找到')) {
            return {
              reasoningContent: '发现文件不存在，根据工作区反馈自愈调整路径为 actual_sales.csv',
              content: '检测到文件路径不匹配，正在自动重新读取 actual_sales.csv...',
              toolCalls: [
                {
                  id: 'tc-heal-2',
                  name: 'workspace.read_file',
                  arguments: { path: 'actual_sales.csv' },
                },
              ],
            };
          }

          // Turn 3: tool succeeded, summarize
          return {
            content: `自愈执行成功！已根据正确文件内容完成分析：${lastMsg?.content}`,
          };
        }
      }

      const engine = new RuntimeEngine({
        modelProvider: new SelfHealingModelProvider(),
      });

      const thread = engine.createThread({ workspaceId: 'ws-test', workspaceRoot: testDir });
      const finalMsg = await engine.sendMessage(thread.id, '请帮我分析销售数据');

      expect(attempt).toBe(3);
      expect(finalMsg.content).toContain('自愈执行成功');
      expect(finalMsg.content).toContain('Alice,300');

      const messages = engine.listMessages(thread.id);
      // Tool messages should contain both the first error and the second success
      const toolMessages = messages.filter((m) => m.role === 'tool');
      expect(toolMessages.length).toBe(2);
      expect(toolMessages[0]?.content).toContain('文件未找到: wrong_sales.csv');
      expect(toolMessages[1]?.content).toContain('Alice,300');
    });
  });
});
