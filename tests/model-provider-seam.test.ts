import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_AGENT_TOOLS,
  OpenAICompatibleModelProvider,
  resolveModelConfig,
} from '../src/runtime/model-provider.js';
import { AppServer } from '../src/runtime/app-server.js';
import { RuntimeEngine } from '../src/runtime/engine.js';
import type { Plan } from '../src/runtime/protocol.js';

describe('Model Provider Seam', () => {
  it('resolves default configuration and environment variables', () => {
    const config = resolveModelConfig({
      apiKey: 'test-key',
      baseURL: 'https://api.deepseek.com/v1/',
    });
    expect(config.provider).toBe('openai-compatible');
    expect(config.baseURL).toBe('https://api.deepseek.com/v1');
    expect(config.modelName).toBe('deepseek-chat');
    expect(config.apiKey).toBe('test-key');
  });

  it('fails fast when API key is missing for OpenAI-compatible provider', async () => {
    const provider = new OpenAICompatibleModelProvider(
      { provider: 'openai-compatible', apiKey: '' },
      (prefix) => `${prefix}-1`,
    );

    await expect(
      provider.proposePlan({
        turnId: 'turn-1',
        userInput: '整理周报',
      }),
    ).rejects.toThrow(/requires an API key/i);
  });

  it('builds valid chat completions request and parses json response into Plan', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      const responsePayload = {
        id: 'chatcmpl-123',
        choices: [
          {
            message: {
              content: JSON.stringify({
                steps: [
                  {
                    title: '读取会议纪要和销售数据',
                    toolName: 'workspace.read_file',
                    risk: 'read',
                    requiresApproval: false,
                  },
                  {
                    title: '在产物目录下生成综合周报 Word 文档',
                    toolName: 'workspace.write_report',
                    risk: 'write',
                    requiresApproval: true,
                  },
                ],
              }),
            },
          },
        ],
      };
      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const provider = new OpenAICompatibleModelProvider(
      {
        provider: 'openai-compatible',
        apiKey: 'sk-test-secret',
        baseURL: 'https://api.deepseek.com/v1',
        modelName: 'deepseek-chat',
      },
      (prefix) => `${prefix}-100`,
      mockFetch as unknown as typeof fetch,
    );

    const plan = await provider.proposePlan({
      turnId: 'turn-1',
      userInput: '把会议纪要整理成周报',
      workspaceFiles: ['meeting-notes.md', 'sales.csv'],
      tools: DEFAULT_AGENT_TOOLS,
    });

    expect(capturedUrl).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(capturedInit?.method).toBe('POST');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test-secret');

    const body = JSON.parse(String(capturedInit?.body));
    expect(body.model).toBe('deepseek-chat');
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('HostAgent');
    expect(body.messages[0].content).toContain('workspace.write_report');
    expect(body.messages[0].content).toContain('meeting-notes.md');
    expect(body.messages[1].content).toContain('把会议纪要整理成周报');

    expect(plan.turnId).toBe('turn-1');
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]?.toolName).toBe('workspace.read_file');
    expect(plan.steps[0]?.risk).toBe('read');
    expect(plan.steps[0]?.requiresApproval).toBe(false);

    expect(plan.steps[1]?.toolName).toBe('workspace.write_report');
    expect(plan.steps[1]?.risk).toBe('write');
    expect(plan.steps[1]?.requiresApproval).toBe(true);
  });

  it('tolerates and extracts JSON from markdown code fences', async () => {
    const mockFetch = vi.fn(async () => {
      const markdownJson = `\`\`\`json
{
  "steps": [
    {
      "title": "从 Markdown 代码块提取计划",
      "toolName": "workspace.write_report",
      "risk": "write",
      "requiresApproval": true
    }
  ]
}
\`\`\``;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: markdownJson } }],
        }),
        { status: 200 },
      );
    });

    const provider = new OpenAICompatibleModelProvider(
      { apiKey: 'sk-test' },
      (prefix) => `${prefix}-2`,
      mockFetch as unknown as typeof fetch,
    );

    const plan = await provider.proposePlan({
      turnId: 'turn-fence',
      userInput: '测试代码块容错',
    });

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.title).toBe('从 Markdown 代码块提取计划');
  });

  it('throws helpful error on HTTP failure status from provider', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response('Invalid API Key provided', {
        status: 401,
        statusText: 'Unauthorized',
      });
    });

    const provider = new OpenAICompatibleModelProvider(
      { apiKey: 'sk-invalid' },
      (prefix) => `${prefix}-3`,
      mockFetch as unknown as typeof fetch,
    );

    await expect(
      provider.proposePlan({
        turnId: 'turn-err',
        userInput: '测试鉴权错误',
      }),
    ).rejects.toThrow(/401.*Unauthorized.*Invalid API Key/);
  });

  it('integrates seamlessly with RuntimeEngine and AppServer via startTurnAsync', async () => {
    const mockPlan: Plan = {
      id: 'plan-custom-1',
      turnId: 'turn-1',
      status: 'proposed',
      steps: [
        {
          id: 'step-1',
          title: '动态由 ModelProvider 生成的第一步',
          toolName: 'workspace.read_file',
          risk: 'read',
          requiresApproval: false,
        },
      ],
    };

    const customProvider = {
      proposePlan: vi.fn(async () => mockPlan),
    };

    const server = new AppServer({ modelProvider: customProvider });
    const thread = server.createThread({ workspaceId: 'ws-test' });

    const turn = await server.startTurnAsync!({
      threadId: thread.id,
      input: '请读取文件并展示',
    });

    expect(customProvider.proposePlan).toHaveBeenCalledTimes(1);
    expect(turn.status).toBe('awaiting_approval');

    const events = server.listEvents(thread.id);
    const planEvent = events.find((e) => e.type === 'plan.proposed');
    expect(planEvent?.payload).toMatchObject({
      id: 'plan-custom-1',
    });

    const approvalEvent = events.find((e) => e.type === 'approval.requested');
    expect(approvalEvent?.payload).toMatchObject({
      planId: 'plan-custom-1',
      status: 'pending',
    });
  });
});
