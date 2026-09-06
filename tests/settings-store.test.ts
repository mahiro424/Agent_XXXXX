import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_SETTINGS,
  PRESET_SERVICES,
  RECOMMENDED_PROVIDER_PRESETS,
  SettingsStore,
} from '../src/runtime/settings-store.js';
import type { ModelServiceConfig } from '../src/runtime/settings-store.js';
import { DesktopSession } from '../src/desktop/session.js';
import { renderSettingsModal } from '../src/ui/settings-modal.js';
import type { SettingsModalState } from '../src/ui/settings-modal.js';
import type { McpServerConfig, McpServerState } from '../src/runtime/mcp-types.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-settings-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('SettingsStore 数据模型与持久化测试', () => {
  it('初始化时能正确引导默认设置，并配置 2026 前沿模型架构', () => {
    const dir = createTempDir();
    const configPath = join(dir, 'settings.json');
    const store = new SettingsStore(configPath);

    const settings = store.load();
    expect(settings.activeServiceId).toBe('deepseek-official');
    expect(settings.permissionPolicy).toBe('auto');
    expect(settings.enablePowershellExecution).toBe(true);
    expect(settings.maxHistoryRounds).toBe(20);

    // 验证前沿模型预设：包含 deepseek-chat、gpt-4o、claude-3-5-sonnet-latest
    const deepseekService = settings.services.find((s) => s.id === 'deepseek-official');
    expect(deepseekService?.modelName).toBe('deepseek-chat');
    expect(deepseekService?.baseURL).toBe('https://api.deepseek.com');
    expect(deepseekService?.availableModels).toContain('deepseek-chat');

    const openaiService = settings.services.find((s) => s.id === 'openai-compatible');
    expect(openaiService?.modelName).toBe('gpt-4o');

    const claudeService = settings.services.find((s) => s.id === 'anthropic-claude');
    expect(claudeService?.modelName).toBe('claude-3-5-sonnet-latest');

    // 验证文件已被写入磁盘
    expect(existsSync(configPath)).toBe(true);
    const raw = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(raw.activeServiceId).toBe('deepseek-official');
  });

  it('能保存局部补丁并在磁盘上持久化', () => {
    const dir = createTempDir();
    const configPath = join(dir, 'settings.json');
    const store = new SettingsStore(configPath);

    store.save({
      permissionPolicy: 'risk-gated',
      maxHistoryRounds: 35,
      language: 'en-US',
    });

    // 重新实例化 store 从磁盘读取
    const store2 = new SettingsStore(configPath);
    const loaded = store2.load();
    expect(loaded.permissionPolicy).toBe('risk-gated');
    expect(loaded.maxHistoryRounds).toBe(35);
    expect(loaded.language).toBe('en-US');
  });

  it('支持增删改查 AI 服务并安全更新当前激活服务', () => {
    const dir = createTempDir();
    const configPath = join(dir, 'settings.json');
    const store = new SettingsStore(configPath);

    const customService: ModelServiceConfig = {
      id: 'my-custom-service',
      name: '公司自建网关',
      providerType: 'custom',
      baseURL: 'https://gateway.internal.corp/v1',
      modelName: 'gpt-5.4-pro',
      apiKey: 'sk-corp-secret-12345',
      reasoningEffort: 'high',
    };

    store.addOrUpdateService(customService);
    let settings = store.load();
    expect(settings.services.some((s) => s.id === 'my-custom-service')).toBe(true);

    store.setActiveService('my-custom-service');
    expect(store.getActiveService().id).toBe('my-custom-service');
    expect(store.getActiveService().apiKey).toBe('sk-corp-secret-12345');

    // 更新该服务
    const updatedService: ModelServiceConfig = {
      ...customService,
      modelName: 'gpt-5.4-mini',
    };
    store.addOrUpdateService(updatedService);
    expect(store.getActiveService().modelName).toBe('gpt-5.4-mini');

    // 删除服务：如果当前激活的被删除，应自动回退到第一个服务
    store.deleteService('my-custom-service');
    settings = store.load();
    expect(settings.services.some((s) => s.id === 'my-custom-service')).toBe(false);
    expect(settings.activeServiceId).not.toBe('my-custom-service');
  });

  it('testConnection 真实探活逻辑测试（成功、失败与错误响应处理）', async () => {
    const dir = createTempDir();
    const configPath = join(dir, 'settings.json');

    // 模拟成功探活的 fetch
    const mockSuccessFetch: typeof fetch = async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const storeSuccess = new SettingsStore(configPath, mockSuccessFetch);
    const resSuccess = await storeSuccess.testConnection({
      baseURL: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      modelName: 'deepseek-v4-pro',
    });
    expect(resSuccess.success).toBe(true);
    expect(resSuccess.status).toBe(200);
    expect(resSuccess.latencyMs).toBeGreaterThanOrEqual(0);

    // 模拟 401 失败响应
    const mock401Fetch: typeof fetch = async () => {
      return new Response(JSON.stringify({ error: { message: 'Invalid API Key provided' } }), {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const store401 = new SettingsStore(configPath, mock401Fetch);
    const res401 = await store401.testConnection({
      baseURL: 'https://api.deepseek.com',
      apiKey: 'sk-wrong',
      modelName: 'deepseek-v4-pro',
    });
    expect(res401.success).toBe(false);
    expect(res401.status).toBe(401);
    expect(res401.error).toContain('Invalid API Key');

    // 测试未提供 Base URL
    const resNoUrl = await store401.testConnection({
      baseURL: '',
      apiKey: 'sk-wrong',
    });
    expect(resNoUrl.success).toBe(false);
    expect(resNoUrl.error).toContain('未配置 Base URL');
  });

  it('记录测试探活延迟与时间戳', () => {
    const dir = createTempDir();
    const configPath = join(dir, 'settings.json');
    const store = new SettingsStore(configPath);

    store.updateServiceTestResult('deepseek-official', {
      status: 'success',
      latencyMs: 142,
    });

    const service = store.getActiveService();
    expect(service.lastTestStatus).toBe('success');
    expect(service.lastTestLatencyMs).toBe(142);
    expect(service.lastTestedAt).toBeDefined();
  });
});

describe('DesktopSession 设置热重载与集成测试', () => {
  it('DesktopSession 初始快照包含 settings 且与 SettingsStore 联动', async () => {
    const dir = createTempDir();
    const configPath = join(dir, 'settings.json');
    const session = new DesktopSession({ configPath });

    const snapshot = session.snapshot();
    expect(snapshot.settings).toBeDefined();
    expect(snapshot.settings?.activeServiceId).toBe('deepseek-official');
    expect(session.getSettings().permissionPolicy).toBe('auto');

    // 修改权限策略并热生效
    await session.saveSettings({ permissionPolicy: 'accept-edits' });
    expect(session.snapshot().permissionMode).toBe('accept-edits');
    expect(session.getSettings().permissionPolicy).toBe('accept-edits');
  });

  it('DesktopSession 动态更新 AI 服务配置并通知监听器', async () => {
    const dir = createTempDir();
    const configPath = join(dir, 'settings.json');
    const session = new DesktopSession({ configPath });

    let notifiedSnapshot: any = null;
    session.subscribe((snap) => {
      notifiedSnapshot = snap;
    });

    const newService: ModelServiceConfig = {
      id: 'openai-gpt54',
      name: 'OpenAI GPT-5.4 专线',
      providerType: 'openai',
      baseURL: 'https://api.openai.com/v1',
      modelName: 'gpt-5.4',
      apiKey: 'sk-gpt54-test',
      reasoningEffort: 'medium',
    };

    await session.saveSettings({
      services: [newService],
      activeServiceId: 'openai-gpt54',
    });

    expect(notifiedSnapshot).not.toBeNull();
    expect(notifiedSnapshot.settings.activeServiceId).toBe('openai-gpt54');
    expect(session.getSettings().activeServiceId).toBe('openai-gpt54');
  });
});

describe('SettingsModal UI 渲染测试', () => {
  it('正确渲染 EvoX 风格双栏结构与 AI 服务列表', () => {
    const settings = {
      ...DEFAULT_AGENT_SETTINGS,
      services: [
        {
          id: 's1',
          name: 'DeepSeek V4 Pro',
          providerType: 'deepseek' as const,
          baseURL: 'https://api.deepseek.com',
          modelName: 'deepseek-v4-pro',
          apiKey: 'sk-1234567890abcdef',
          reasoningEffort: 'high' as const,
        },
      ],
      activeServiceId: 's1',
    };

    const state: SettingsModalState = {
      isOpen: true,
      activeTab: 'services',
      isAddServiceOpen: false,
      editingServiceId: null,
      isTesting: false,
      testFeedback: null,
    };

    const html = renderSettingsModal(settings, state, 'C:\\config\\settings.json');
    expect(html).toContain('settings-backdrop');
    expect(html).toContain('settings-modal');
    expect(html).toContain('AI 服务');
    expect(html).toContain('DeepSeek V4 Pro');
    expect(html).toContain('当前使用中');
    expect(html).toContain('● 已就绪');
    expect(html).toContain('sk-••••cdef'); // 掩码保护
    expect(html).toContain('＋');
    expect(html).toContain('添加服务');
  });

  it('打开二级弹窗时渲染快捷预设胶囊与表单', () => {
    const state: SettingsModalState = {
      isOpen: true,
      activeTab: 'services',
      isAddServiceOpen: true,
      editingServiceId: null,
      isTesting: false,
      testFeedback: { success: true, latencyMs: 98 },
    };

    const html = renderSettingsModal(DEFAULT_AGENT_SETTINGS, state);
    expect(html).toContain('secondary-modal-backdrop');
    expect(html).toContain('添加 AI 服务');
    expect(html).toContain('DeepSeek');
    expect(html).toContain('OpenAI');
    expect(html).toContain('Ollama (本地)');
    expect(html).toContain('探活成功！真实延迟: 98ms');
  });

  it('能够渲染关于页面与配置持久化物理路径', () => {
    const state: SettingsModalState = {
      isOpen: true,
      activeTab: 'about',
      isAddServiceOpen: false,
      editingServiceId: null,
      isTesting: false,
      testFeedback: null,
    };

    const html = renderSettingsModal(DEFAULT_AGENT_SETTINGS, state, 'C:\\Users\\test\\agent-settings.json');
    expect(html).toContain('关于 Agent_XXXXX');
    expect(html).toContain('C:\\Users\\test\\agent-settings.json');
    expect(html).toContain('打开目录');
  });

  it('渲染第三方 API 专属入口按钮并正确打上第三方代理徽标与向导指引', () => {
    const customRelayService: ModelServiceConfig = {
      id: 'service-relay-oneapi',
      name: '自建 OneAPI 聚合中转',
      providerType: 'openai',
      baseURL: 'https://relay.example.com/v1',
      modelName: 'deepseek-v4-pro',
      apiKey: 'sk-relay-12345678',
    };
    const settings = {
      ...DEFAULT_AGENT_SETTINGS,
      services: [...DEFAULT_AGENT_SETTINGS.services, customRelayService],
    };
    const state: SettingsModalState = {
      isOpen: true,
      activeTab: 'services',
      isAddServiceOpen: false,
      editingServiceId: null,
      isTesting: false,
      testFeedback: null,
    };

    const html = renderSettingsModal(settings, state);
    expect(html).toContain('btn-relay-capsule');
    expect(html).toContain('接入第三方 API');
    expect(html).toContain('🔀 第三方代理');
    expect(html).toContain('🏛️ 官方直连');
    expect(html).toContain('自建 OneAPI 聚合中转');

    // 打开第三方专属向导模式
    const thirdPartyModalHtml = renderSettingsModal(settings, {
      ...state,
      isAddServiceOpen: true,
      isAddThirdParty: true,
    });
    expect(thirdPartyModalHtml).toContain('🔀 接入第三方 API / 兼容代理网关');
    expect(thirdPartyModalHtml).toContain('第三方 API 接入指南');
    expect(thirdPartyModalHtml).toContain('通用第三方 API (OneAPI/NewAPI/中转代理)');
  });

  it('支持弹窗内 Toast 浮动提示组件渲染', () => {
    const state: SettingsModalState = {
      isOpen: true,
      activeTab: 'services',
      isAddServiceOpen: false,
      editingServiceId: null,
      isTesting: false,
      testFeedback: null,
      toast: { message: '大模型连接已即时热重载！', type: 'success' },
    };

    const html = renderSettingsModal(DEFAULT_AGENT_SETTINGS, state);
    expect(html).toContain('settings-toast success');
    expect(html).toContain('大模型连接已即时热重载！');
    expect(html).toContain('✅');
  });

  it('DesktopSession.saveSettings 物理打通 ApprovalPolicy 与 enablePowershellExecution 并在快照中透传服务名', async () => {
    const dir = createTempDir();
    const configPath = join(dir, 'test-settings.json');
    const session = new DesktopSession({ configPath });

    const initial = session.snapshot();
    expect(initial.activeServiceName).toBe('DeepSeek (官方)');
    expect(initial.activeModelName).toBe('deepseek-chat');

    const updated = await session.saveSettings({
      permissionPolicy: 'risk-gated',
      enablePowershellExecution: false,
      maxHistoryRounds: 40,
      activeServiceId: 'openai-compatible',
    });

    expect(updated.permissionMode).toBe('risk-gated');
    expect(updated.activeServiceName).toBe('OpenAI (官方 / 兼容网关)');
    expect(updated.activeModelName).toBe('gpt-4o');

    const store = new SettingsStore(configPath);
    expect(store.load().permissionPolicy).toBe('risk-gated');
    expect(store.load().enablePowershellExecution).toBe(false);
    expect(store.load().maxHistoryRounds).toBe(40);
  });

  it('验证渲染端与设置类型模块纯净无 node 模块依赖，严格符合 CSP script-src self 规范', () => {
    const typesPath = join(process.cwd(), 'src/runtime/settings-types.ts');
    const typesContent = readFileSync(typesPath, 'utf8');
    expect(typesContent).not.toContain('node:fs');
    expect(typesContent).not.toContain('node:os');
    expect(typesContent).not.toContain('node:path');

    const mcpTypesPath = join(process.cwd(), 'src/runtime/mcp-types.ts');
    const mcpTypesContent = readFileSync(mcpTypesPath, 'utf8');
    expect(mcpTypesContent).not.toContain('node:');

    const modalPath = join(process.cwd(), 'src/ui/settings-modal.ts');
    const modalContent = readFileSync(modalPath, 'utf8');
    expect(modalContent).not.toContain('node:');
    expect(modalContent).not.toContain('settings-store.js');

    const rendererPath = join(process.cwd(), 'src/desktop/renderer.ts');
    const rendererContent = readFileSync(rendererPath, 'utf8');
    expect(rendererContent).not.toContain('settings-store.js');
    expect(rendererContent).not.toContain('node:');
  });

  it('DesktopSession 能够完整配置、保存、热重载与删除 MCP 服务器，并在快照中向前端透传服务状态', async () => {
    const dir = createTempDir();
    const configPath = join(dir, 'test-mcp-settings.json');
    const session = new DesktopSession({ configPath });

    // 1. 验证初始空 MCP 列表
    const initialSnapshot = session.snapshot();
    expect(initialSnapshot.mcpServers).toBeDefined();
    expect(initialSnapshot.mcpServers?.length).toBe(0);

    // 2. 保存新的 MCP 服务器配置
    const serverScript = `
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'calc-service', version: '1.0.0' });
server.tool('calc_sum', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
  content: [{ type: 'text', text: String(a + b) }]
}));
const transport = new StdioServerTransport();
await server.connect(transport);
`;
    const localDir = join(process.cwd(), '.test-tmp', `mcp-session-test-${Date.now()}`);
    mkdirSync(localDir, { recursive: true });
    tempDirs.push(localDir);
    const scriptPath = join(localDir, 'calc-server.mjs');
    writeFileSync(scriptPath, serverScript, 'utf8');

    const mcpConfig: McpServerConfig = {
      command: 'node',
      args: [scriptPath],
      autoApprove: ['calc_sum'],
    };

    // 探活测试
    const testResult = await session.testMcpConnection(mcpConfig, 'calc-service');
    expect(testResult.success).toBe(true);
    expect(testResult.toolCount).toBe(1);
    expect(testResult.tools).toContain('calc_sum');

    // 保存并热重载
    const savedSnapshot = await session.saveMcpServer('calc-service', mcpConfig);
    expect(savedSnapshot.settings?.mcpServers?.['calc-service']).toBeDefined();
    expect(savedSnapshot.mcpServers?.length).toBe(1);
    const liveServer = savedSnapshot.mcpServers?.find((s) => s.id === 'calc-service');
    expect(liveServer).toBeDefined();
    expect(liveServer?.status).toBe('connected');
    expect(liveServer?.tools.length).toBe(1);
    expect(liveServer?.tools[0]?.name).toBe('calc_sum');

    // 3. 验证删除 MCP 服务
    const deletedSnapshot = await session.deleteMcpServer('calc-service');
    expect(deletedSnapshot.settings?.mcpServers?.['calc-service']).toBeUndefined();
    expect(deletedSnapshot.mcpServers?.length).toBe(0);
  });

  it('renderSettingsModal 在 mcp 标签页下能正确渲染真实 MCP 服务卡片、工具徽章与添加表单', () => {
    const state: SettingsModalState = {
      isOpen: true,
      activeTab: 'mcp',
      isAddServiceOpen: false,
      isAddThirdParty: false,
      initialPresetId: 'deepseek',
      editingServiceId: null,
      isTesting: false,
      testFeedback: null,
      toast: null,
      isAddMcpOpen: true,
      editingMcpId: null,
      isTestingMcp: false,
      mcpTestFeedback: null,
    };

    const mockLiveServers: McpServerState[] = [
      {
        id: 'sqlite-service',
        config: { command: 'uvx', args: ['mcp-server-sqlite'], autoApprove: ['read_query'] },
        status: 'connected',
        tools: [
          {
            name: 'read_query',
            fullName: 'mcp.sqlite-service.read_query',
            serverId: 'sqlite-service',
            risk: 'read',
            requiresApproval: false,
          },
        ],
      },
    ];

    const settingsWithMcp = {
      ...DEFAULT_AGENT_SETTINGS,
      mcpServers: {
        'sqlite-service': { command: 'uvx', args: ['mcp-server-sqlite'], autoApprove: ['read_query'] },
      },
    };

    const html = renderSettingsModal(settingsWithMcp, state, undefined, mockLiveServers);
    expect(html).toContain('Model Context Protocol (MCP) 扩展生态');
    expect(html).toContain('sqlite-service');
    expect(html).toContain('🟢 已连接 (挂载 1 个工具)');
    expect(html).toContain('read_query');
    expect(html).toContain('data-action="test-mcp-server"');
    expect(html).toContain('data-action="edit-mcp-server"');
    expect(html).toContain('data-action="delete-mcp-server"');
    expect(html).toContain('➕ 添加 MCP 服务器');
    expect(html).toContain('mcp-server-form');
    expect(html).toContain('data-action="apply-mcp-preset"');
    expect(html).toContain('data-action="submit-mcp-form"');
  });

  it('能够通过标准 /models 端点动态拉取并解析可用模型列表', async () => {
    const dir = createTempDir();
    const configPath = join(dir, 'settings.json');

    const mockModelsFetch: typeof fetch = async (url) => {
      expect(String(url)).toContain('/models');
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'deepseek-chat', object: 'model', owned_by: 'deepseek' },
            { id: 'deepseek-reasoner', object: 'model', owned_by: 'deepseek' },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    };

    const store = new SettingsStore(configPath, mockModelsFetch);
    const result = await store.fetchModels({
      baseURL: 'https://api.deepseek.com',
      apiKey: 'sk-test-ds',
    });

    expect(result.success).toBe(true);
    expect(result.models).toEqual(['deepseek-chat', 'deepseek-reasoner']);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('拉取模型遇到鉴权失败或网络错误时返回友好提示', async () => {
    const dir = createTempDir();
    const configPath = join(dir, 'settings.json');

    const mockFailFetch: typeof fetch = async () => {
      return new Response(JSON.stringify({ error: { message: 'Authentication required' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const store = new SettingsStore(configPath, mockFailFetch);
    const result = await store.fetchModels({
      baseURL: 'https://api.deepseek.com',
      apiKey: 'invalid-key',
    });

    expect(result.success).toBe(false);
    expect(result.models).toEqual([]);
    expect(result.error).toContain('Authentication required');
  });
});
