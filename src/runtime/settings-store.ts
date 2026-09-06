import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  AgentSettings,
  ConnectionTestResult,
  ModelsFetchResult,
  ModelServiceConfig,
  ProviderModelPreset,
  ServiceProviderType,
} from './settings-types.js';
import {
  DEFAULT_AGENT_SETTINGS,
  PRESET_SERVICES,
  RECOMMENDED_PROVIDER_PRESETS,
} from './settings-types.js';

export type {
  AgentSettings,
  ConnectionTestResult,
  ModelsFetchResult,
  ModelServiceConfig,
  ProviderModelPreset,
  ServiceProviderType,
};
export {
  DEFAULT_AGENT_SETTINGS,
  PRESET_SERVICES,
  RECOMMENDED_PROVIDER_PRESETS,
};

export class SettingsStore {
  private readonly configPath: string;
  private readonly fetchImpl: typeof fetch;
  private cachedSettings: AgentSettings | undefined;

  public constructor(configPath?: string, fetchImpl: typeof fetch = globalThis.fetch) {
    if (configPath) {
      this.configPath = configPath;
    } else {
      const appData = process.env.APPDATA || (process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support') : join(homedir(), '.config'));
      const dir = join(appData, 'Agent_XXXXX');
      this.configPath = join(dir, 'agent-settings.json');
    }
    this.fetchImpl = fetchImpl;
  }

  public getConfigFilePath(): string {
    return this.configPath;
  }

  public load(): AgentSettings {
    if (this.cachedSettings) {
      return this.cachedSettings;
    }

    if (!existsSync(this.configPath)) {
      const initial = this.bootstrapDefaultSettings();
      this.cachedSettings = initial;
      try {
        const dir = dirname(this.configPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(this.configPath, JSON.stringify(initial, null, 2), 'utf8');
      } catch {
        // ignore write error
      }
      return initial;
    }

    try {
      const raw = readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AgentSettings>;
      const merged: AgentSettings = {
        activeServiceId: parsed.activeServiceId ?? DEFAULT_AGENT_SETTINGS.activeServiceId,
        services: Array.isArray(parsed.services) && parsed.services.length > 0 ? parsed.services : DEFAULT_AGENT_SETTINGS.services,
        permissionPolicy: parsed.permissionPolicy ?? DEFAULT_AGENT_SETTINGS.permissionPolicy,
        enablePowershellExecution: parsed.enablePowershellExecution ?? DEFAULT_AGENT_SETTINGS.enablePowershellExecution,
        maxHistoryRounds: parsed.maxHistoryRounds ?? DEFAULT_AGENT_SETTINGS.maxHistoryRounds,
        language: parsed.language ?? DEFAULT_AGENT_SETTINGS.language,
      };
      this.cachedSettings = merged;
      return merged;
    } catch {
      const fallback = this.bootstrapDefaultSettings();
      this.cachedSettings = fallback;
      return fallback;
    }
  }

  public save(patch: Partial<AgentSettings>): AgentSettings {
    const current = this.cachedSettings ?? (existsSync(this.configPath) ? this.load() : this.bootstrapDefaultSettings());
    const updated: AgentSettings = {
      ...current,
      ...patch,
      services: patch.services ?? current.services,
    };

    try {
      const dir = dirname(this.configPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.configPath, JSON.stringify(updated, null, 2), 'utf8');
    } catch {
      // 容错处理
    }

    this.cachedSettings = updated;
    return updated;
  }

  public getActiveService(): ModelServiceConfig {
    const settings = this.load();
    const found = settings.services.find((s) => s.id === settings.activeServiceId);
    if (found) {
      return found;
    }
    return settings.services[0] ?? PRESET_SERVICES[0]!;
  }

  public setActiveService(serviceId: string): AgentSettings {
    return this.save({ activeServiceId: serviceId });
  }

  public addOrUpdateService(service: ModelServiceConfig): AgentSettings {
    const settings = this.load();
    const existingIndex = settings.services.findIndex((s) => s.id === service.id);
    let newServices: ModelServiceConfig[];
    if (existingIndex >= 0) {
      newServices = [...settings.services];
      newServices[existingIndex] = service;
    } else {
      newServices = [...settings.services, service];
    }
    return this.save({ services: newServices });
  }

  public deleteService(serviceId: string): AgentSettings {
    const settings = this.load();
    const filtered = settings.services.filter((s) => s.id !== serviceId);
    let nextActive = settings.activeServiceId;
    if (nextActive === serviceId) {
      nextActive = filtered[0]?.id ?? '';
    }
    return this.save({ services: filtered, activeServiceId: nextActive });
  }

  public updateServiceTestResult(
    serviceId: string,
    result: { status: 'success' | 'error'; latencyMs: number; error?: string },
  ): AgentSettings {
    const settings = this.load();
    const updatedServices = settings.services.map((s) => {
      if (s.id !== serviceId) return s;
      return {
        ...s,
        lastTestedAt: new Date().toISOString(),
        lastTestStatus: result.status,
        lastTestLatencyMs: result.latencyMs,
        ...(result.error ? { lastTestError: result.error } : { lastTestError: undefined }),
      };
    });
    return this.save({ services: updatedServices });
  }

  public updateServiceAvailableModels(
    serviceId: string,
    models: readonly string[],
  ): AgentSettings {
    const settings = this.load();
    const updatedServices = settings.services.map((s) => {
      if (s.id !== serviceId) return s;
      return {
        ...s,
        availableModels: models,
      };
    });
    return this.save({ services: updatedServices });
  }

  public async testConnection(
    service: { readonly baseURL: string; readonly apiKey?: string | undefined; readonly modelName?: string | undefined },
  ): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    const cleanBase = (service.baseURL || '').trim().replace(/\/+$/, '');
    if (!cleanBase) {
      return {
        success: false,
        latencyMs: 0,
        error: '未配置 Base URL 地址',
      };
    }

    const url = cleanBase.endsWith('/chat/completions')
      ? cleanBase
      : `${cleanBase}/chat/completions`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: service.apiKey ? `Bearer ${service.apiKey}` : '',
        },
        body: JSON.stringify({
          model: service.modelName || 'default',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startTime;
      if (response.ok) {
        return {
          success: true,
          latencyMs,
          status: response.status,
        };
      }

      // 如果返回 400（参数缺失）或 404，但连接通了，我们提取详细提示
      let errorMsg = `HTTP ${response.status} ${response.statusText}`;
      try {
        const errJson = (await response.json()) as { error?: { message?: string } | string };
        if (typeof errJson.error === 'string') {
          errorMsg = errJson.error;
        } else if (errJson.error?.message) {
          errorMsg = errJson.error.message;
        }
      } catch {
        // ignore parse error
      }

      return {
        success: false,
        latencyMs,
        status: response.status,
        error: errorMsg,
      };
    } catch (err: unknown) {
      const latencyMs = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        latencyMs,
        error: message.includes('abort') ? '请求超时 (12s)' : message,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 动态探测大模型服务商支持的真实可用模型列表
   */
  public async fetchModels(service: Partial<ModelServiceConfig>): Promise<ModelsFetchResult> {
    const startTime = Date.now();
    const cleanBase = (service.baseURL || '').trim().replace(/\/+$/, '');
    if (!cleanBase) {
      return {
        success: false,
        models: [],
        latencyMs: 0,
        error: '未配置 Base URL 地址',
      };
    }

    const candidateUrls: string[] = [];
    if (cleanBase.endsWith('/chat/completions')) {
      candidateUrls.push(cleanBase.replace(/\/chat\/completions$/, '/models'));
    } else if (cleanBase.endsWith('/v1')) {
      candidateUrls.push(`${cleanBase}/models`);
      candidateUrls.push(cleanBase.replace(/\/v1$/, '/models'));
    } else {
      candidateUrls.push(`${cleanBase}/models`);
      candidateUrls.push(`${cleanBase}/v1/models`);
    }

    let lastError = '无法获取模型列表';
    for (const url of candidateUrls) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (service.apiKey) {
          headers['Authorization'] = `Bearer ${service.apiKey}`;
        }
        const response = await this.fetchImpl(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const latencyMs = Date.now() - startTime;

        if (response.ok) {
          const data = (await response.json()) as { data?: Array<{ id?: string; name?: string }> };
          if (Array.isArray(data.data)) {
            const rawModels = data.data
              .map((item) =>
                item && typeof item.id === 'string'
                  ? item.id
                  : item && typeof item.name === 'string'
                    ? item.name
                    : '',
              )
              .filter((id) => id.length > 0);
            const models = Array.from(new Set(rawModels));
            if (models.length > 0) {
              return {
                success: true,
                models,
                latencyMs,
              };
            }
          }
        } else {
          let errorText = `HTTP ${response.status}`;
          try {
            const errJson = (await response.json()) as { error?: { message?: string } | string };
            if (typeof errJson.error === 'string') {
              errorText = errJson.error;
            } else if (errJson.error?.message) {
              errorText = errJson.error.message;
            }
          } catch {
            // ignore
          }
          lastError = errorText;
        }
      } catch (err: unknown) {
        clearTimeout(timeout);
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    return {
      success: false,
      models: [],
      latencyMs: Date.now() - startTime,
      error: lastError.includes('abort') ? '请求超时 (10s)' : lastError,
    };
  }

  private bootstrapDefaultSettings(): AgentSettings {
    const envApiKey = process.env.AGENT_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? '';
    const envBaseURL = process.env.AGENT_BASE_URL ?? 'https://api.deepseek.com';
    const envModelName = process.env.AGENT_MODEL_NAME ?? 'deepseek-chat';

    const services: ModelServiceConfig[] = PRESET_SERVICES.map((p) => {
      if (p.id === 'deepseek-official') {
        return {
          ...p,
          apiKey: envApiKey,
          baseURL: envBaseURL,
          modelName: envModelName,
        };
      }
      return p;
    });

    return {
      activeServiceId: 'deepseek-official',
      services,
      permissionPolicy: 'auto',
      enablePowershellExecution: true,
      maxHistoryRounds: 20,
      language: 'zh-CN',
    };
  }
}
