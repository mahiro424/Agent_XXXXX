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
  readonly availableModels?: readonly string[] | undefined;
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

export interface ModelsFetchResult {
  readonly success: boolean;
  readonly models: readonly string[];
  readonly latencyMs?: number | undefined;
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
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultReasoning: 'high',
    description: '深度求索官方开放平台端点 (支持通过端点动态获取最新模型)',
  },
  {
    id: 'openai',
    name: 'OpenAI (官方)',
    category: 'official',
    providerType: 'openai',
    defaultBaseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini'],
    defaultReasoning: 'medium',
    description: 'OpenAI 官方 API 端点',
  },
  {
    id: 'anthropic',
    name: 'Anthropic (官方)',
    category: 'official',
    providerType: 'custom',
    defaultBaseURL: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-latest',
    models: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
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
    defaultModel: '',
    models: [],
    defaultReasoning: 'medium',
    description: '标准 OpenAI 兼容代理，支持点击【获取模型列表】动态拉取代理站开通的所有模型',
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
    models: ['deepseek/deepseek-r1', 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o'],
    defaultReasoning: 'high',
    description: '全球统一的大模型路由接入平台',
  },
  {
    id: 'moonshot',
    name: '月之暗面 (Kimi)',
    category: 'thirdparty',
    providerType: 'openai',
    defaultBaseURL: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-auto',
    models: ['moonshot-v1-auto', 'moonshot-v1-128k'],
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
    defaultModel: 'qwen2.5-coder:latest',
    models: ['qwen2.5-coder:latest', 'deepseek-r1:latest'],
    defaultReasoning: 'off',
    description: '本地独立运行的开箱即用模型服务，支持动态拉取本地已安装模型',
  },
];

export const PRESET_SERVICES: readonly ModelServiceConfig[] = [
  {
    id: 'deepseek-official',
    name: 'DeepSeek (官方)',
    providerType: 'deepseek',
    apiKey: '',
    baseURL: 'https://api.deepseek.com',
    modelName: 'deepseek-chat',
    availableModels: ['deepseek-chat', 'deepseek-reasoner'],
    reasoningEffort: 'high',
    isDefault: true,
  },
  {
    id: 'openai-compatible',
    name: 'OpenAI (官方 / 兼容网关)',
    providerType: 'openai',
    apiKey: '',
    baseURL: 'https://api.openai.com/v1',
    modelName: 'gpt-4o',
    availableModels: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini'],
    reasoningEffort: 'medium',
  },
  {
    id: 'anthropic-claude',
    name: 'Anthropic Claude',
    providerType: 'custom',
    apiKey: '',
    baseURL: 'https://api.anthropic.com/v1',
    modelName: 'claude-3-5-sonnet-latest',
    availableModels: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
    reasoningEffort: 'high',
  },
  {
    id: 'ollama-local',
    name: 'Ollama 本地服务',
    providerType: 'ollama',
    apiKey: 'ollama',
    baseURL: 'http://localhost:11434/v1',
    modelName: 'qwen2.5-coder:latest',
    availableModels: ['qwen2.5-coder:latest', 'deepseek-r1:latest'],
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
