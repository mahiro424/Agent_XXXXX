import type { ReasoningEffort } from './protocol.js';
import type { FilePermissionMode } from '../ui/demo-home.js';
import type { McpServerConfig } from './mcp-types.js';

export type ServiceProviderType = 'deepseek' | 'openai' | 'ollama' | 'custom';

export interface ModelServiceConfig {
  readonly id: string;
  readonly name: string;
  readonly providerType: ServiceProviderType;
  readonly apiKey: string;
  readonly baseURL: string;
  readonly modelName: string;
  readonly reasoningEffort?: ReasoningEffort | undefined;
  readonly isDefault?: boolean | undefined;
  readonly lastTestedAt?: string | undefined;
  readonly lastTestStatus?: 'success' | 'error' | 'testing' | undefined;
  readonly lastTestLatencyMs?: number | undefined;
  readonly lastTestError?: string | undefined;
}

export interface AgentSettings {
  readonly activeServiceId: string;
  readonly services: readonly ModelServiceConfig[];
  readonly permissionPolicy: FilePermissionMode;
  readonly enablePowershellExecution: boolean;
  readonly maxHistoryRounds: number;
  readonly language: string;
  readonly mcpServers?: Record<string, McpServerConfig> | undefined;
}

export interface ConnectionTestResult {
  readonly success: boolean;
  readonly latencyMs: number;
  readonly status?: number | undefined;
  readonly error?: string | undefined;
}

export interface ProviderModelPreset {
  readonly id: string;
  readonly name: string;
  readonly category: 'official' | 'thirdparty' | 'local';
  readonly providerType: ServiceProviderType;
  readonly defaultBaseURL: string;
  readonly defaultModel: string;
  readonly models: readonly string[];
  readonly defaultReasoning: ReasoningEffort;
  readonly description?: string | undefined;
}

export const RECOMMENDED_PROVIDER_PRESETS: readonly ProviderModelPreset[] = [
  // 1. 官方直连
  {
    id: 'deepseek',
    name: 'DeepSeek (官方)',
    category: 'official',
    providerType: 'deepseek',
    defaultBaseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-pro',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    defaultReasoning: 'high',
    description: '深度求索官方开放平台端点',
  },
  {
    id: 'openai',
    name: 'OpenAI (官方)',
    category: 'official',
    providerType: 'openai',
    defaultBaseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4',
    models: ['gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-6-astra'],
    defaultReasoning: 'medium',
    description: 'OpenAI 官方 API 端点',
  },
  {
    id: 'anthropic',
    name: 'Anthropic (官方)',
    category: 'official',
    providerType: 'custom',
    defaultBaseURL: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-6',
    models: ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5', 'claude-sonnet-5'],
    defaultReasoning: 'high',
    description: 'Anthropic Claude 官方端点',
  },
  // 2. 第三方兼容 / 聚合代理入口 (P0 要求)
  {
    id: 'custom-relay',
    name: '通用第三方 API (OneAPI/NewAPI/中转代理)',
    category: 'thirdparty',
    providerType: 'openai',
    defaultBaseURL: 'https://api.your-relay.com/v1',
    defaultModel: 'deepseek-v4-pro',
    models: ['deepseek-v4-pro', 'gpt-5.4', 'claude-sonnet-4-6', 'qwen-plus'],
    defaultReasoning: 'medium',
    description: '标准 OpenAI 兼容代理，适用于各类聚合分发平台、自建中转网关或商业镜像',
  },
  {
    id: 'siliconflow',
    name: '硅基流动 (SiliconFlow)',
    category: 'thirdparty',
    providerType: 'openai',
    defaultBaseURL: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    models: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-Coder-32B-Instruct'],
    defaultReasoning: 'high',
    description: '国内高并发推理加速云平台',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (海外聚合网关)',
    category: 'thirdparty',
    providerType: 'openai',
    defaultBaseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-r1',
    models: ['deepseek/deepseek-r1', 'anthropic/claude-sonnet-4-6', 'openai/gpt-5.4'],
    defaultReasoning: 'high',
    description: '全球统一的大模型路由接入平台',
  },
  {
    id: 'moonshot',
    name: '月之暗面 (Kimi)',
    category: 'thirdparty',
    providerType: 'openai',
    defaultBaseURL: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-latest',
    models: ['kimi-latest', 'moonshot-v1-128k'],
    defaultReasoning: 'medium',
    description: '月之暗面 Kimi 大模型开放平台',
  },
  {
    id: 'dashscope',
    name: '阿里百炼 (DashScope)',
    category: 'thirdparty',
    providerType: 'openai',
    defaultBaseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
    defaultReasoning: 'medium',
    description: '阿里云通义千问兼容模式接口',
  },
  // 3. 本地模型
  {
    id: 'ollama',
    name: 'Ollama (本地离线)',
    category: 'local',
    providerType: 'ollama',
    defaultBaseURL: 'http://localhost:11434/v1',
    defaultModel: 'qwen3-coder-30b-a3b-instruct',
    models: ['qwen3-coder-30b-a3b-instruct', 'qwen2.5-coder:latest', 'deepseek-v4-flash', 'gpt-oss-120b'],
    defaultReasoning: 'off',
    description: '本地独立运行的开箱即用模型服务',
  },
];

export const PRESET_SERVICES: readonly ModelServiceConfig[] = [
  {
    id: 'deepseek-official',
    name: 'DeepSeek V4 Pro (推荐)',
    providerType: 'deepseek',
    apiKey: '',
    baseURL: 'https://api.deepseek.com',
    modelName: 'deepseek-v4-pro',
    reasoningEffort: 'high',
    isDefault: true,
  },
  {
    id: 'openai-compatible',
    name: 'OpenAI GPT-5.4 (通用网关)',
    providerType: 'openai',
    apiKey: '',
    baseURL: 'https://api.openai.com/v1',
    modelName: 'gpt-5.4',
    reasoningEffort: 'medium',
  },
  {
    id: 'anthropic-claude',
    name: 'Anthropic Claude Sonnet 4.6',
    providerType: 'custom',
    apiKey: '',
    baseURL: 'https://api.anthropic.com/v1',
    modelName: 'claude-sonnet-4-6',
    reasoningEffort: 'high',
  },
  {
    id: 'ollama-local',
    name: 'Ollama 本地服务 (Qwen3 Coder)',
    providerType: 'ollama',
    apiKey: 'ollama',
    baseURL: 'http://localhost:11434/v1',
    modelName: 'qwen3-coder-30b-a3b-instruct',
    reasoningEffort: 'off',
  },
];

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  activeServiceId: 'deepseek-official',
  services: PRESET_SERVICES,
  permissionPolicy: 'auto',
  enablePowershellExecution: true,
  maxHistoryRounds: 20,
  language: 'zh-CN',
};
