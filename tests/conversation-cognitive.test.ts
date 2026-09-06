import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IntentRouter } from '../src/runtime/conversation/intent-router.js';
import { ContextManager } from '../src/runtime/conversation/context-manager.js';
import { ElicitationEngine } from '../src/runtime/conversation/elicitation-engine.js';
import { RuntimeEngine } from '../src/runtime/engine.js';

describe('Conversation Cognitive Subsystem (IntentRouter, ContextManager, Elicitation)', () => {
  describe('IntentRouter (意图路由器)', () => {
    it('精准识别日常问候与系统说明为 chat_direct，无需复杂审批', () => {
      const r1 = IntentRouter.route('你好呀！');
      expect(r1.intent).toBe('chat_direct');
      expect(r1.suggestedMode).toBe('chat');

      const r2 = IntentRouter.route('介绍一下你自己');
      expect(r2.intent).toBe('chat_direct');
    });

    it('精准识别概念知识解答为 chat_direct', () => {
      const r = IntentRouter.route('解释一下什么是SOLID原则？');
      expect(r.intent).toBe('chat_direct');
    });

    it('识别信息熵过低的模糊指令为 clarification_needed', () => {
      const r = IntentRouter.route('改一下');
      expect(r.intent).toBe('clarification_needed');
    });

    it('识别查看文件/排查目录为 read_only_explore', () => {
      const r = IntentRouter.route('帮我看看当前有哪些文件');
      expect(r.intent).toBe('read_only_explore');
    });

    it('识别数据汇总/报表生成为 task_execution', () => {
      const r = IntentRouter.route('汇总 sales.csv 并生成 Excel 周报');
      expect(r.intent).toBe('task_execution');
      expect(r.suggestedMode).toBe('agent');
    });
  });

  describe('ContextManager (分层上下文管理)', () => {
    it('折叠过长的工具日志，避免上下文撑爆', () => {
      const cm = new ContextManager({ maxToolOutputChars: 100 });
      const hugeLog = 'A'.repeat(1000);
      const sanitized = cm.sanitizeToolOutput(hugeLog);
      expect(sanitized.length).toBeLessThan(500);
      expect(sanitized).toContain('中间省略');
    });

    it('组装分层上下文时，将首轮目标 (Pinned Goal) 稳固置顶', () => {
      const cm = new ContextManager({ maxActiveMessages: 2 });
      const messages = [
        { id: '1', threadId: 't1', role: 'user' as const, content: '核心任务：分析全年度财务报表', createdAt: '' },
        { id: '2', threadId: 't1', role: 'assistant' as const, content: '好的', createdAt: '' },
        { id: '3', threadId: 't1', role: 'user' as const, content: '第3步进展如何？', createdAt: '' },
        { id: '4', threadId: 't1', role: 'assistant' as const, content: '正在计算', createdAt: '' },
      ];
      const layered = cm.buildLayeredMessages({
        systemPrompt: '系统基础规范',
        messages,
        workspaceFiles: ['finance.xlsx'],
      });
      expect(layered[0]?.content).toBe('核心任务：分析全年度财务报表');
      expect(layered.some(m => m.content.includes('前序'))).toBe(true);
    });
  });

  describe('ElicitationEngine (主动需求澄清)', () => {
    it('能够注册和管理澄清选项卡片', () => {
      const ee = new ElicitationEngine();
      const req = ee.createRequest({
        id: 'req-1',
        question: '请选择报表统计维度：',
        options: [
          { id: 'opt-1', label: '按月统计', recommended: true },
          { id: 'opt-2', label: '按季度统计' },
        ],
      });
      expect(ee.getPendingRequest('req-1')?.options.length).toBe(2);
      const resolved = ee.resolveRequest('req-1');
      expect(resolved?.id).toBe('req-1');
      expect(ee.getPendingRequest('req-1')).toBeUndefined();
    });
  });

  describe('RuntimeEngine 意图分流集成实测', () => {
    it('发送纯问候时，直接生成友好回复，记录 intent.classified 事件，不挂载复杂工具', async () => {
      const engine = new RuntimeEngine();
      const thread = engine.createThread({ workspaceId: 'ws-1' });
      const reply = await engine.sendMessage(thread.id, '你好！');
      expect(reply.role).toBe('assistant');
      expect(reply.content).toContain('智能');

      const events = engine.listEvents(thread.id);
      const intentEvent = events.find(e => e.type === 'intent.classified');
      expect(intentEvent).toBeDefined();
      expect((intentEvent?.payload as any).intent).toBe('chat_direct');
    });

    it('发送模糊指令时，主动输出引导性反问建议', async () => {
      const engine = new RuntimeEngine();
      const thread = engine.createThread({ workspaceId: 'ws-1' });
      const reply = await engine.sendMessage(thread.id, '改一下');
      expect(reply.content).toContain('为了更精准地执行');
    });

    it('支持大模型动态传入自定义 sections 撰写 Word 文档与自定义 sheets 渲染 Excel 工作簿', async () => {
      const workspaceRoot = mkdtempSync(join(tmpdir(), 'agent-dynamic-'));
      const engine = new RuntimeEngine();
      try {
        const thread = engine.createThread({ workspaceId: 'ws-dynamic', workspaceRoot });

        // 测试动态 Word
        const wordRes = await engine.executeToolCall(thread, {
          id: 'tc-w1',
          name: 'office.generate_word_report',
          arguments: {
            target: 'dynamic-plan.docx',
            title: '2026年技术架构路线',
            subtitle: '系统架构演进纲要',
            sections: [
              {
                heading: '一、架构愿景',
                paragraphs: ['构建具备认知自愈能力的企业级 Agent 桌面运行时。'],
              },
            ],
          },
        });
        expect(wordRes).toContain('dynamic-plan.docx');

        // 测试动态 Excel
        const excelRes = await engine.executeToolCall(thread, {
          id: 'tc-e1',
          name: 'office.process_excel',
          arguments: {
            target: 'custom-metrics.xlsx',
            title: '服务吞吐明细',
            sheets: [
              {
                name: 'Q1性能',
                columns: [
                  { header: '服务名', key: 'service' },
                  { header: 'QPS', key: 'qps' },
                ],
                rows: [
                  { service: 'Gateway', qps: 5000 },
                  { service: 'Auth', qps: 2000 },
                ],
                includeTotalRow: true,
              },
            ],
          },
        });
        expect(excelRes).toContain('custom-metrics.xlsx');
      } finally {
        rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });
  });
});

