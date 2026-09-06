import type {
  AgentSettings,
  ModelServiceConfig,
  ProviderModelPreset,
} from '../runtime/settings-types.js';
import {
  PRESET_SERVICES,
  RECOMMENDED_PROVIDER_PRESETS,
} from '../runtime/settings-types.js';
import type { McpServerState } from '../runtime/mcp-types.js';

export type SettingsTabId = 'services' | 'mcp' | 'general' | 'permissions' | 'about';

export interface SettingsModalState {
  readonly isOpen: boolean;
  readonly activeTab: SettingsTabId;
  readonly isAddServiceOpen: boolean;
  readonly isAddThirdParty?: boolean | undefined;
  readonly initialPresetId?: string | undefined;
  readonly editingServiceId: string | null;
  readonly isTesting: boolean;
  readonly testFeedback: {
    readonly serviceId?: string | undefined;
    readonly success?: boolean | undefined;
    readonly latencyMs?: number | undefined;
    readonly error?: string | undefined;
  } | null;
  readonly isFetchingModels?: boolean | undefined;
  readonly fetchedModels?: readonly string[] | undefined;
  readonly fetchModelsFeedback?: {
    readonly success?: boolean | undefined;
    readonly latencyMs?: number | undefined;
    readonly count?: number | undefined;
    readonly error?: string | undefined;
  } | null | undefined;
  readonly toast?: {
    readonly message: string;
    readonly type: 'success' | 'error';
  } | null | undefined;
  readonly isAddMcpOpen?: boolean | undefined;
  readonly editingMcpId?: string | null | undefined;
  readonly initialMcpPresetId?: string | undefined;
  readonly isTestingMcp?: boolean | undefined;
  readonly mcpTestFeedback?: {
    readonly serverId?: string | undefined;
    readonly success?: boolean | undefined;
    readonly latencyMs?: number | undefined;
    readonly toolCount?: number | undefined;
    readonly tools?: readonly string[] | undefined;
    readonly error?: string | undefined;
  } | null | undefined;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function maskApiKey(key?: string): string {
  if (!key || key.trim().length === 0) {
    return '未设置';
  }
  const trimmed = key.trim();
  if (trimmed.length <= 8) {
    return '••••••••';
  }
  return `${trimmed.slice(0, 3)}••••${trimmed.slice(-4)}`;
}

export function renderSettingsModal(
  settings: AgentSettings,
  state: SettingsModalState,
  configFilePath?: string,
  liveMcpServers?: readonly McpServerState[],
): string {
  if (!state.isOpen) {
    return '';
  }

  const navItems: Array<{ id: SettingsTabId; label: string; icon: string }> = [
    { id: 'services', label: 'AI 服务', icon: '🤖' },
    { id: 'mcp', label: 'MCP 插件', icon: '🔌' },
    { id: 'general', label: '日常', icon: '⚙️' },
    { id: 'permissions', label: '权限与安全', icon: '🛡️' },
    { id: 'about', label: '关于与存储', icon: 'ℹ️' },
  ];

  const navHtml = navItems
    .map(
      (item) => `
      <button type="button" class="settings-nav-item${state.activeTab === item.id ? ' active' : ''}" data-action="switch-settings-tab" data-tab="${item.id}">
        <span class="settings-nav-icon">${item.icon}</span>
        <span class="settings-nav-label">${escapeHtml(item.label)}</span>
      </button>
    `,
    )
    .join('');

  let contentHtml = '';
  switch (state.activeTab) {
    case 'services':
      contentHtml = renderServicesTab(settings, state);
      break;
    case 'mcp':
      contentHtml = renderMcpTab(settings, state, liveMcpServers);
      break;
    case 'general':
      contentHtml = renderGeneralTab(settings);
      break;
    case 'permissions':
      contentHtml = renderPermissionsTab(settings);
      break;
    case 'about':
      contentHtml = renderAboutTab(settings, configFilePath);
      break;
  }

  let secondaryModalHtml = '';
  if (state.isAddServiceOpen) {
    secondaryModalHtml = renderAddServiceModal(settings, state);
  } else if (state.isAddMcpOpen) {
    secondaryModalHtml = renderAddMcpModal(settings, state);
  }

  const toastHtml = state.toast
    ? `
    <div class="settings-toast ${state.toast.type}" role="status">
      <span>${state.toast.type === 'success' ? '✅' : '❌'}</span>
      <span>${escapeHtml(state.toast.message)}</span>
    </div>`
    : '';

  return `
  <div class="settings-backdrop" id="settings-backdrop">
    <div class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
      <!-- 左栏：分类导航 -->
      <aside class="settings-sidebar">
        <div class="settings-sidebar-header">
          <span class="settings-title-icon">⚙️</span>
          <h2 id="settings-dialog-title" class="settings-sidebar-title">设置</h2>
        </div>
        <nav class="settings-nav-list" aria-label="设置导航">
          ${navHtml}
        </nav>
      </aside>

      <!-- 右栏：主配置区 -->
      <section class="settings-content-area">
        ${toastHtml}
        ${contentHtml}
      </section>

      <!-- 关闭按钮 -->
      <button type="button" class="settings-close-btn" data-action="close-settings" title="关闭设置 (Esc)">✕</button>
    </div>
    ${secondaryModalHtml}
  </div>`;
}

function renderServicesTab(settings: AgentSettings, state: SettingsModalState): string {
  const serviceCardsHtml = settings.services
    .map((service) => {
      const isActive = service.id === settings.activeServiceId;
      const isConfigured = Boolean(service.apiKey && service.apiKey.trim().length > 0) || service.providerType === 'ollama';
      const isTestingThis = state.isTesting && state.testFeedback?.serviceId === service.id;

      let categoryBadge = '';
      if (service.providerType === 'ollama') {
        categoryBadge = '<span class="service-tag tag-local">💻 本地离线</span>';
      } else if (
        service.id.includes('relay') ||
        service.id.includes('siliconflow') ||
        service.id.includes('openrouter') ||
        service.id.includes('thirdparty') ||
        service.id.includes('kimi') ||
        service.id.includes('dashscope') ||
        service.name.includes('第三方') ||
        service.name.includes('中转') ||
        service.name.includes('代理') ||
        service.name.includes('硅基') ||
        service.name.includes('OpenRouter')
      ) {
        categoryBadge = '<span class="service-tag tag-thirdparty">🔀 第三方代理</span>';
      } else {
        categoryBadge = '<span class="service-tag tag-official">🏛️ 官方直连</span>';
      }

      let latencyBadge = '';
      if (service.lastTestStatus === 'success') {
        latencyBadge = `<span class="service-tag tag-success" title="上次测试时间: ${service.lastTestedAt ?? ''}">📶 延迟 ${service.lastTestLatencyMs ?? 0}ms</span>`;
      } else if (service.lastTestStatus === 'error') {
        latencyBadge = `<span class="service-tag tag-error" title="${escapeHtml(service.lastTestError ?? '连接失败')}">❌ 连接异常</span>`;
      }

      return `
      <div class="service-card${isActive ? ' is-active' : ''}" data-service-card-id="${service.id}">
        <div class="service-card-main">
          <div class="service-card-header">
            <div class="service-title-group">
              <span class="service-name">${escapeHtml(service.name)}</span>
              ${categoryBadge}
              ${isActive ? '<span class="service-tag tag-active">当前使用中</span>' : ''}
              ${
                isConfigured
                  ? '<span class="service-tag tag-ready">● 已就绪</span>'
                  : '<span class="service-tag tag-warning">○ 未配置密钥</span>'
              }
              ${latencyBadge}
            </div>
            <div class="service-actions-group">
              ${
                !isActive
                  ? `<button type="button" class="btn-subtle" data-action="set-active-service" data-service-id="${service.id}">设为当前</button>`
                  : ''
              }
              <button type="button" class="btn-subtle" data-action="test-service" data-service-id="${service.id}" ${state.isTesting ? 'disabled' : ''}>
                ${isTestingThis ? '测试中...' : '📶 测试'}
              </button>
              <button type="button" class="btn-subtle" data-action="edit-service" data-service-id="${service.id}">✏️ 编辑</button>
              <button type="button" class="btn-subtle btn-danger" data-action="delete-service" data-service-id="${service.id}" ${settings.services.length <= 1 ? 'disabled' : ''} title="删除该服务">🗑️</button>
            </div>
          </div>
          <div class="service-meta-grid">
            <div class="meta-item">
              <span class="meta-label">Base URL:</span>
              <span class="meta-value font-mono">${escapeHtml(service.baseURL)}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">默认模型:</span>
              <span class="meta-value font-mono">${escapeHtml(service.modelName)}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">API Key:</span>
              <span class="meta-value font-mono">${maskApiKey(service.apiKey)}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">思考强度:</span>
              <span class="meta-value font-mono">${service.reasoningEffort ?? 'off'}</span>
            </div>
          </div>
        </div>
      </div>`;
    })
    .join('');

  return `
  <div class="settings-tab-panel">
    <div class="panel-header">
      <div>
        <h3 class="panel-title">AI 服务管理</h3>
        <p class="panel-subtitle">配置大语言模型官方直连或第三方代理网关，支持一键实时探活与动态切换</p>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button type="button" class="btn-relay-capsule" data-action="open-add-thirdparty" title="一键接入 OneAPI / NewAPI / 硅基流动 / OpenRouter / 自建反代等第三方网关">
          <span class="capsule-icon">🔀</span>
          <span>接入第三方 API</span>
        </button>
        <button type="button" class="btn-primary-capsule" data-action="open-add-service" title="添加 DeepSeek / OpenAI 官方直连服务">
          <span class="capsule-icon">＋</span>
          <span>添加服务</span>
        </button>
      </div>
    </div>

    <div class="relay-tip-banner">
      <span>💡</span>
      <div>
        <strong>支持通用第三方 / 聚合中转网关接入</strong>：如 OneAPI、NewAPI、硅基流动 (SiliconFlow)、OpenRouter、自建代理等。兼容任何标准 OpenAI 格式接口。
      </div>
    </div>

    <div class="services-list-container">
      ${serviceCardsHtml}
    </div>
  </div>`;
}

export const RECOMMENDED_MCP_PRESETS = [
  {
    id: 'sqlite',
    name: 'SQLite 本地数据库',
    icon: '🗄️',
    description: '通过官方 SQLite MCP 访问工作区本地 .db 数据库文件',
    defaultCommand: 'uvx',
    defaultArgs: 'mcp-server-sqlite --db-path ./data.db',
    defaultAutoApprove: 'read_query, list_tables',
  },
  {
    id: 'memory',
    name: 'Memory 知识图谱',
    icon: '🧠',
    description: '基于 Anthropic 官方知识图谱构建长效上下文持久记忆',
    defaultCommand: 'npx',
    defaultArgs: '-y @modelcontextprotocol/server-memory',
    defaultAutoApprove: 'read_graph, search_nodes',
  },
  {
    id: 'fetch',
    name: 'Fetch 网页抓取',
    icon: '🌐',
    description: '通过标准 Fetch MCP 抓取网页并抽取清晰 Markdown 文本',
    defaultCommand: 'uvx',
    defaultArgs: 'mcp-server-fetch',
    defaultAutoApprove: '',
  },
  {
    id: 'custom',
    name: '自定义 stdio 服务',
    icon: '⚙️',
    description: '通过本地 node, python 或系统命令启动任意 MCP 服务',
    defaultCommand: 'node',
    defaultArgs: './server.mjs',
    defaultAutoApprove: '',
  },
] as const;

function renderMcpTab(
  settings: AgentSettings,
  state: SettingsModalState,
  liveServers?: readonly McpServerState[],
): string {
  const mcpServers = settings.mcpServers ?? {};
  const serverEntries = Object.entries(mcpServers);

  const serverCardsHtml =
    serverEntries.length > 0
      ? serverEntries
          .map(([id, cfg]) => {
            const live = liveServers?.find((s) => s.id === id);
            let statusBadge = '';
            if (cfg.disabled) {
              statusBadge = `<span class="service-tag tag-warning">🚫 已禁用</span>`;
            } else if (live) {
              if (live.status === 'connected') {
                statusBadge = `<span class="service-tag tag-ready">🟢 已连接 (挂载 ${live.tools.length} 个工具)</span>`;
              } else if (live.status === 'connecting') {
                statusBadge = `<span class="service-tag tag-warning">⏳ 正在连接...</span>`;
              } else if (live.status === 'error') {
                statusBadge = `<span class="service-tag tag-error" title="${escapeHtml(live.error ?? '启动失败')}">❌ 连接异常</span>`;
              } else {
                statusBadge = `<span class="service-tag">⚪ 就绪 (未连接)</span>`;
              }
            } else {
              statusBadge = `<span class="service-tag tag-ready">● 已配置</span>`;
            }

            const cmdStr = `${cfg.command} ${(cfg.args ?? []).join(' ')}`;
            const isTestingThis = Boolean(state.isTestingMcp && state.mcpTestFeedback?.serverId === id);

            let liveToolsHtml = '';
            if (live && live.tools.length > 0) {
              const pills = live.tools
                .map(
                  (t) =>
                    `<span class="service-tag tag-success font-mono" style="font-size: 11px; margin-right: 4px; margin-bottom: 4px;" title="${escapeHtml(t.description ?? t.fullName)}">${escapeHtml(t.name)}</span>`,
                )
                .join('');
              liveToolsHtml = `
              <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed #e2e8f0;">
                <div style="font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 6px;">已挂载可用工具 (${live.tools.length}):</div>
                <div style="display: flex; flex-wrap: wrap;">${pills}</div>
              </div>`;
            }

            return `
        <div class="service-card" data-mcp-card-id="${escapeHtml(id)}">
          <div class="service-card-main">
            <div class="service-card-header">
              <div class="service-title-group">
                <span class="service-name">${escapeHtml(id)}</span>
                <span class="service-tag" style="background:#f1f5f9; color:#475569;">stdio</span>
                ${statusBadge}
              </div>
              <div class="service-actions-group">
                <button type="button" class="btn-subtle" data-action="test-mcp-server" data-server-id="${escapeHtml(id)}" ${state.isTestingMcp ? 'disabled' : ''}>
                  ${isTestingThis ? '探活中...' : '📶 测试连接'}
                </button>
                <button type="button" class="btn-subtle" data-action="edit-mcp-server" data-server-id="${escapeHtml(id)}">✏️ 编辑</button>
                <button type="button" class="btn-subtle" data-action="toggle-mcp-server" data-server-id="${escapeHtml(id)}">
                  ${cfg.disabled ? '启用' : '禁用'}
                </button>
                <button type="button" class="btn-subtle btn-danger" data-action="delete-mcp-server" data-server-id="${escapeHtml(id)}" title="删除此服务">🗑️</button>
              </div>
            </div>
            <div class="service-meta-grid">
              <div class="meta-item">
                <span class="meta-label">命令:</span>
                <span class="meta-value font-mono">${escapeHtml(cfg.command)}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">参数:</span>
                <span class="meta-value font-mono">${escapeHtml((cfg.args ?? []).join(' ') || '无')}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">工作目录:</span>
                <span class="meta-value font-mono">${escapeHtml(cfg.cwd || '当前工作区')}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">免审批工具:</span>
                <span class="meta-value font-mono">${escapeHtml((cfg.autoApprove ?? []).join(', ') || '遵循默认策略')}</span>
              </div>
            </div>
            ${liveToolsHtml}
          </div>
        </div>`;
          })
          .join('')
      : `
      <div class="service-empty-state">
        <div class="empty-icon">🔌</div>
        <div class="empty-title">当前尚未配置任何 MCP 扩展服务器</div>
        <div class="empty-desc">
          点击右上角“添加 MCP 服务器”，可快速接入 SQLite 数据库、知识图谱、网页抓取等任意标准服务。<br />
          外部工具启动后将自动注册至智能体上下文，并受当前工作区五级安全策略保护。
        </div>
        <div style="margin-top: 14px;">
          <button type="button" class="btn-primary-capsule" data-action="open-add-mcp">
            <span class="capsule-icon">＋</span>
            <span>添加第一个 MCP 服务器</span>
          </button>
        </div>
      </div>
    `;

  return `
  <div class="settings-tab-panel">
    <div class="panel-header">
      <div>
        <h3 class="panel-title">Model Context Protocol (MCP) 扩展生态</h3>
        <p class="panel-subtitle">配置与管理外部 MCP 服务器，支持本地 stdio 进程通信与工具动态挂载</p>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button type="button" class="btn-subtle" data-action="reload-mcp-servers" title="重新从工作区与配置文件中重载并连接全部 MCP 服务">
          <span>🔄 重新载入全部</span>
        </button>
        <button type="button" class="btn-primary-capsule" data-action="open-add-mcp" title="添加新的 MCP stdio 服务">
          <span class="capsule-icon">＋</span>
          <span>添加 MCP 服务器</span>
        </button>
      </div>
    </div>

    <div class="services-list-container">
      ${serverCardsHtml}
    </div>
  </div>`;
}

function renderAddMcpModal(settings: AgentSettings, state: SettingsModalState): string {
  const isEditing = Boolean(state.editingMcpId);
  const editingConfig = state.editingMcpId ? settings.mcpServers?.[state.editingMcpId] : undefined;

  const idVal = state.editingMcpId ?? '';
  const commandVal = editingConfig?.command ?? 'uvx';
  const argsVal = (editingConfig?.args ?? ['mcp-server-sqlite', '--db-path', './data.db']).join(' ');
  const cwdVal = editingConfig?.cwd ?? '';
  const autoApproveVal = (editingConfig?.autoApprove ?? ['read_query', 'list_tables']).join(', ');
  const disabledVal = editingConfig?.disabled ?? false;

  const presetPillsHtml = RECOMMENDED_MCP_PRESETS.map((p) => {
    return `<button type="button" class="preset-pill-btn" data-action="apply-mcp-preset" data-preset-id="${p.id}">${p.icon} ${escapeHtml(p.name)}</button>`;
  }).join('');

  let testResultInline = '';
  if (state.isTestingMcp) {
    testResultInline = `<span class="test-inline-msg" style="color: #64748b;">⏳ 正在启动子进程握手并探活...</span>`;
  } else if (state.mcpTestFeedback) {
    if (state.mcpTestFeedback.success) {
      testResultInline = `<span class="test-inline-msg success">✅ 连接成功！发现 ${state.mcpTestFeedback.toolCount} 个工具, 耗时: ${state.mcpTestFeedback.latencyMs}ms</span>`;
    } else {
      testResultInline = `<span class="test-inline-msg error" title="${escapeHtml(state.mcpTestFeedback.error ?? '')}">❌ 连接失败: ${escapeHtml(state.mcpTestFeedback.error ?? '无法建立连接')}</span>`;
    }
  }

  const modalTitle = isEditing ? `编辑 MCP 服务器【${escapeHtml(idVal)}】` : '➕ 添加 MCP 服务器';

  return `
  <div class="secondary-modal-backdrop" id="add-mcp-backdrop">
    <div class="secondary-modal-card" role="dialog" aria-modal="true">
      <div class="secondary-modal-header">
        <h4 class="secondary-modal-title">${modalTitle}</h4>
        <button type="button" class="btn-close-icon" data-action="close-add-mcp" title="关闭">×</button>
      </div>

      <div class="secondary-modal-body">
        <div class="preset-recommendation-box" style="margin-bottom: 14px;">
          <span class="preset-box-title">推荐标准预设 (点击一键填入):</span>
          <div class="preset-pills-row">
            ${presetPillsHtml}
          </div>
        </div>

        <form class="settings-form" id="mcp-server-form">
          <div class="form-row">
            <div class="form-group flex-1">
              <label class="form-label" for="form-mcp-id">服务标识 ID (唯一英文名称)</label>
              <input type="text" class="form-input font-mono" id="form-mcp-id" value="${escapeHtml(idVal)}" placeholder="sqlite" ${isEditing ? 'disabled' : 'required'} />
            </div>
            <div class="form-group w-140">
              <label class="form-label" for="form-mcp-command">执行命令 (Command)</label>
              <input type="text" class="form-input font-mono" id="form-mcp-command" value="${escapeHtml(commandVal)}" placeholder="uvx / npx / node" required />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="form-mcp-args">启动参数 (Arguments, 空格分隔)</label>
            <input type="text" class="form-input font-mono" id="form-mcp-args" value="${escapeHtml(argsVal)}" placeholder="mcp-server-sqlite --db-path ./data.db" />
            <p class="form-help">例如: mcp-server-sqlite --db-path ./data.db 或 -y @modelcontextprotocol/server-memory</p>
          </div>

          <div class="form-row">
            <div class="form-group flex-1">
              <label class="form-label" for="form-mcp-cwd">执行工作目录 (留空则默认为当前打开的工作区)</label>
              <input type="text" class="form-input font-mono" id="form-mcp-cwd" value="${escapeHtml(cwdVal)}" placeholder="留空使用工作区根目录" />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="form-mcp-auto-approve">免审批工具白名单 (英文逗号分隔)</label>
            <input type="text" class="form-input font-mono" id="form-mcp-auto-approve" value="${escapeHtml(autoApproveVal)}" placeholder="read_query, list_tables" />
            <p class="form-help">在此列表中的工具调用时将自动放行，其余有修改风险的工具严格触发用户审批</p>
          </div>

          <div class="form-group">
            <label class="form-toggle-label">
              <input type="checkbox" id="form-mcp-disabled" ${disabledVal ? 'checked' : ''} />
              <span>暂时禁用此 MCP 服务 (禁用后不会在会话中启动子进程)</span>
            </label>
          </div>
        </form>
      </div>

      <div class="secondary-modal-footer">
        <div class="footer-left">
          <button type="button" class="btn-secondary" data-action="test-form-mcp" ${state.isTestingMcp ? 'disabled' : ''}>
            ${state.isTestingMcp ? '正在探活...' : '📶 测试连接'}
          </button>
          ${testResultInline}
        </div>
        <div class="footer-right">
          <button type="button" class="btn-secondary" data-action="close-add-mcp">取消</button>
          <button type="button" class="btn-primary" data-action="submit-mcp-form">保存并生效</button>
        </div>
      </div>
    </div>
  </div>`;
}

function renderGeneralTab(settings: AgentSettings): string {
  return `
  <div class="settings-tab-panel">
    <div class="panel-header">
      <div>
        <h3 class="panel-title">日常设置</h3>
        <p class="panel-subtitle">调整 Agent_XXXXX 本地运行时界面与历史上下文参数</p>
      </div>
    </div>

    <form class="settings-form" id="general-settings-form">
      <div class="form-group">
        <label class="form-label" for="setting-language">界面与系统语言</label>
        <select class="form-select" id="setting-language" name="language">
          <option value="zh-CN" ${settings.language === 'zh-CN' ? 'selected' : ''}>简体中文 (zh-CN)</option>
          <option value="en-US" ${settings.language === 'en-US' ? 'selected' : ''}>English (en-US)</option>
        </select>
        <p class="form-help">设置桌面主程序与生成任务材料的默认沟通语言</p>
      </div>

      <div class="form-group">
        <label class="form-label" for="setting-history-rounds">最大历史消息轮次 (Max History Rounds)</label>
        <input type="number" class="form-input" id="setting-history-rounds" name="maxHistoryRounds" value="${settings.maxHistoryRounds}" min="5" max="100" />
        <p class="form-help">超过此轮次时，上下文压缩引擎将对更早的历史执行结构化折叠以精简 Token</p>
      </div>

      <div class="form-footer">
        <button type="button" class="btn-primary-capsule" data-action="save-general-settings">保存日常设置</button>
      </div>
    </form>
  </div>`;
}

function renderPermissionsTab(settings: AgentSettings): string {
  const policies: Array<{ id: AgentSettings['permissionPolicy']; name: string; desc: string }> = [
    {
      id: 'auto',
      name: '自动裁决 (Auto - 推荐)',
      desc: '只读与无副作用命令自动放行；写文件与高风险外部系统命令自动生成审批卡片待您确认。',
    },
    {
      id: 'accept-edits',
      name: '自动接受编辑 (Accept Edits)',
      desc: '工作区代码与文档编辑自动采纳，仅重大命令或销毁性操作提示确认。',
    },
    {
      id: 'ask-approval',
      name: '严格逐项确认 (Ask Approval)',
      desc: '任何计划步骤与文件读写均需显式点击“批准”方可继续，最高安全性。',
    },
    {
      id: 'risk-gated',
      name: '风险门禁拦截 (Risk Gated)',
      desc: '自动拦截所有 external 与高危系统调用，工作区内读写经沙箱校验后执行。',
    },
    {
      id: 'full-access',
      name: '完全放行 (Full Access - 极客模式)',
      desc: '跳过所有人工确认卡片，全自动极速流转执行。（请确保工作区无敏感系统数据）',
    },
  ];

  const policyRadioHtml = policies
    .map(
      (p) => `
      <label class="policy-radio-card${settings.permissionPolicy === p.id ? ' selected' : ''}">
        <input type="radio" name="permissionPolicy" value="${p.id}" ${settings.permissionPolicy === p.id ? 'checked' : ''} />
        <div class="policy-card-body">
          <div class="policy-card-name">${escapeHtml(p.name)}</div>
          <div class="policy-card-desc">${escapeHtml(p.desc)}</div>
        </div>
      </label>
    `,
    )
    .join('');

  return `
  <div class="settings-tab-panel">
    <div class="panel-header">
      <div>
        <h3 class="panel-title">权限策略与执行安全</h3>
        <p class="panel-subtitle">配置 HostAgent 在执行本地文件修改与终端进程时的权限策略（五级分级安全体系）</p>
      </div>
    </div>

    <form class="settings-form" id="permission-settings-form">
      <div class="form-group">
        <label class="form-label">全局审批策略 (Approval Tier)</label>
        <div class="policy-radio-group">
          ${policyRadioHtml}
        </div>
      </div>

      <div class="form-group">
        <label class="form-toggle-label">
          <input type="checkbox" id="setting-powershell" name="enablePowershellExecution" ${settings.enablePowershellExecution ? 'checked' : ''} />
          <span>允许在工作区安全执行本地 PowerShell 终端命令</span>
        </label>
        <p class="form-help">开启后模型可使用 workspace.run_command 运行构建、测试或脚本工具，且受上述审批策略约束</p>
      </div>

      <div class="form-footer">
        <button type="button" class="btn-primary-capsule" data-action="save-permission-settings">保存权限策略</button>
      </div>
    </form>
  </div>`;
}

function renderAboutTab(settings: AgentSettings, configFilePath?: string): string {
  const pathDisplay = configFilePath || '默认 APPDATA/Agent_XXXXX/agent-settings.json';

  return `
  <div class="settings-tab-panel">
    <div class="panel-header">
      <div>
        <h3 class="panel-title">关于 Agent_XXXXX</h3>
        <p class="panel-subtitle">本地原生双重沙箱智能体运行时架构</p>
      </div>
    </div>

    <div class="about-card-container">
      <div class="about-hero">
        <div class="about-brand-logo">A</div>
        <div class="about-brand-info">
          <h4 class="about-name">Agent_XXXXX 桌面运行时</h4>
          <p class="about-version">版本: v1.0.0 (生产就绪 · 零 Mock 原生运行时)</p>
        </div>
      </div>

      <div class="about-section">
        <h5 class="about-section-title">本地持久化存储</h5>
        <div class="storage-path-box">
          <span class="storage-path-text font-mono">${escapeHtml(pathDisplay)}</span>
          <button type="button" class="btn-subtle" data-action="open-config-folder">打开目录</button>
        </div>
        <p class="about-section-desc">您的所有服务商密钥、模型配置与安全策略均仅加密存储在上述本地物理文件中，绝不上传至任何中心化第三方服务器。</p>
      </div>

      <div class="about-section">
        <h5 class="about-section-title">核心工程支柱</h5>
        <ul class="about-feature-list">
          <li><strong>双重沙箱安全保护</strong>：支持路径边界穿透拦截与高危破坏性指令物理防护</li>
          <li><strong>真实证据链质检</strong>：对生成的 Excel 与 Word 文件执行二进制解构与 OpenXML 规范校验</li>
          <li><strong>多模型前沿适配</strong>：原生支持 DeepSeek V4 系列、OpenAI GPT-5.4 / Codex 与 Ollama 本地开源大模型</li>
        </ul>
      </div>
    </div>
  </div>`;
}

function renderAddServiceModal(settings: AgentSettings, state: SettingsModalState): string {
  const isEditing = Boolean(state.editingServiceId);
  const isThirdParty = Boolean(state.isAddThirdParty || state.initialPresetId === 'custom-relay');
  const targetService = isEditing
    ? settings.services.find((s) => s.id === state.editingServiceId)
    : null;

  const thirdPartyPresets = RECOMMENDED_PROVIDER_PRESETS.filter((p) => p.category === 'thirdparty');
  const officialPresets = RECOMMENDED_PROVIDER_PRESETS.filter((p) => p.category === 'official');
  const localPresets = RECOMMENDED_PROVIDER_PRESETS.filter((p) => p.category === 'local');

  const thirdPartyPillsHtml = thirdPartyPresets
    .map(
      (preset) =>
        `<button type="button" class="preset-pill-btn" data-action="apply-provider-preset" data-preset-id="${preset.id}">${escapeHtml(preset.name)}</button>`,
    )
    .join('');

  const officialPillsHtml = [...officialPresets, ...localPresets]
    .map(
      (preset) =>
        `<button type="button" class="preset-pill-btn" data-action="apply-provider-preset" data-preset-id="${preset.id}">${escapeHtml(preset.name)}</button>`,
    )
    .join('');

  const nameVal = targetService?.name ?? (isThirdParty ? '第三方中转 (OneAPI/NewAPI)' : 'DeepSeek (官方)');
  const providerTypeVal = targetService?.providerType ?? (isThirdParty ? 'openai' : 'deepseek');
  const baseUrlVal = targetService?.baseURL ?? (isThirdParty ? 'https://api.your-relay.com/v1' : 'https://api.deepseek.com');
  const modelNameVal = targetService?.modelName ?? (isThirdParty ? '' : 'deepseek-chat');
  const apiKeyVal = targetService?.apiKey ?? '';
  const reasoningVal = targetService?.reasoningEffort ?? (isThirdParty ? 'medium' : 'high');

  const candidateModels: string[] = Array.from(
    new Set([
      ...(state.fetchedModels ?? []),
      ...(targetService?.availableModels ?? []),
    ]),
  );

  let fetchFeedbackInline = '';
  if (state.isFetchingModels) {
    fetchFeedbackInline = `<span class="test-inline-msg info">⏳ 正在从端点拉取模型列表...</span>`;
  } else if (state.fetchModelsFeedback) {
    if (state.fetchModelsFeedback.success) {
      fetchFeedbackInline = `<span class="test-inline-msg success">✅ 成功拉取到 ${state.fetchModelsFeedback.count ?? candidateModels.length} 个可用模型</span>`;
    } else {
      fetchFeedbackInline = `<span class="test-inline-msg error" title="${escapeHtml(state.fetchModelsFeedback.error ?? '')}">❌ 获取模型失败: ${escapeHtml(state.fetchModelsFeedback.error ?? '无法建立连接')}</span>`;
    }
  }

  let modelSelectorHtml = '';
  if (candidateModels.length > 0) {
    const isCustom = !candidateModels.includes(modelNameVal) && Boolean(modelNameVal);
    const optionsHtml = candidateModels
      .map(
        (m) => `<option value="${escapeHtml(m)}" ${m === modelNameVal ? 'selected' : ''}>${escapeHtml(m)}</option>`,
      )
      .join('');

    modelSelectorHtml = `
      <div class="model-select-group">
        <select class="form-select font-mono" id="form-service-model-select">
          ${optionsHtml}
          <option value="__custom__" ${isCustom ? 'selected' : ''}>✍️ 自定义输入其他模型...</option>
        </select>
        <input type="text" class="form-input font-mono" id="form-service-model" value="${escapeHtml(modelNameVal)}" placeholder="输入或选择模型标识符" style="${isCustom ? 'margin-top: 6px;' : 'display: none;'}" required />
      </div>
    `;
  } else {
    modelSelectorHtml = `
      <div class="model-select-group">
        <input type="text" class="form-input font-mono" id="form-service-model" value="${escapeHtml(modelNameVal)}" placeholder="点击右上角【🔄 获取可用模型】自动拉取或手动输入" required />
      </div>
    `;
  }

  let testResultInline = '';
  if (state.testFeedback) {
    if (state.testFeedback.success) {
      testResultInline = `<span class="test-inline-msg success">✅ 探活成功！真实延迟: ${state.testFeedback.latencyMs ?? 0}ms</span>`;
    } else {
      testResultInline = `<span class="test-inline-msg error" title="${escapeHtml(state.testFeedback.error ?? '')}">❌ 探活失败: ${escapeHtml(state.testFeedback.error ?? '无法建立连接')}</span>`;
    }
  }

  const modalTitle = isEditing
    ? '编辑 AI 服务'
    : isThirdParty
      ? '🔀 接入第三方 API / 兼容代理网关'
      : '添加 AI 服务';

  const thirdPartyGuideHtml = isThirdParty
    ? `
    <div class="relay-tip-banner">
      <span>ℹ️</span>
      <div>
        <strong>第三方 API 接入指南</strong>：支持 OneAPI、NewAPI、硅基流动 (SiliconFlow)、OpenRouter、自建反代等任何兼容 OpenAI 协议的代理。Base URL 通常以 <code>/v1</code> 结尾，服务商类型请保持 <code>OpenAI</code>。
      </div>
    </div>`
    : '';

  return `
  <div class="secondary-modal-backdrop">
    <div class="secondary-modal-card" role="dialog" aria-modal="true">
      <div class="secondary-modal-header">
        <h3 class="secondary-modal-title">${modalTitle}</h3>
        <button type="button" class="btn-icon-close" data-action="close-add-service">✕</button>
      </div>

      <div class="secondary-modal-body">
        ${thirdPartyGuideHtml}

        <div class="form-group">
          <label class="form-label">${isThirdParty ? '🌟 常用第三方代理 / 镜像聚合预设 (点击一键填入)' : '快速预设模板 (点击快速填入端点配置)'}</label>
          <div class="preset-pills-row">
            ${isThirdParty ? thirdPartyPillsHtml : `${officialPillsHtml}${thirdPartyPillsHtml}`}
          </div>
        </div>

        ${
          isThirdParty
            ? `
        <div class="form-group">
          <label class="form-label">官方直连模板</label>
          <div class="preset-pills-row">
            ${officialPillsHtml}
          </div>
        </div>`
            : ''
        }

        <form id="service-edit-form" class="service-form">
          <input type="hidden" id="form-service-id" value="${targetService?.id ?? `service-${Date.now()}`}" />

          <div class="form-row">
            <div class="form-group flex-1">
              <label class="form-label" for="form-service-name">服务名称</label>
              <input type="text" class="form-input" id="form-service-name" value="${escapeHtml(nameVal)}" placeholder="如：DeepSeek 生产网关" required />
            </div>
            <div class="form-group w-140">
              <label class="form-label" for="form-service-type">服务商类型</label>
              <select class="form-select" id="form-service-type">
                <option value="deepseek" ${providerTypeVal === 'deepseek' ? 'selected' : ''}>DeepSeek</option>
                <option value="openai" ${providerTypeVal === 'openai' ? 'selected' : ''}>OpenAI</option>
                <option value="ollama" ${providerTypeVal === 'ollama' ? 'selected' : ''}>Ollama (本地)</option>
                <option value="custom" ${providerTypeVal === 'custom' ? 'selected' : ''}>自定义</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="form-service-base-url">API 基础地址 (Base URL)</label>
            <input type="text" class="form-input font-mono" id="form-service-base-url" value="${escapeHtml(baseUrlVal)}" placeholder="https://api.deepseek.com" required />
          </div>

          <div class="form-row">
            <div class="form-group flex-1">
              <div class="form-label-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <label class="form-label" for="form-service-model" style="margin-bottom: 0;">生效模型 (Model Identifier)</label>
                <button type="button" class="btn-subtle" data-action="fetch-service-models" style="font-size: 11px; padding: 2px 8px; height: 24px;" ${state.isFetchingModels ? 'disabled' : ''}>
                  ${state.isFetchingModels ? '正在获取...' : '🔄 获取可用模型'}
                </button>
              </div>
              ${modelSelectorHtml}
              ${fetchFeedbackInline ? `<div style="margin-top: 4px;">${fetchFeedbackInline}</div>` : ''}
            </div>
            <div class="form-group w-140">
              <label class="form-label" for="form-service-reasoning">思考推理强度</label>
              <select class="form-select" id="form-service-reasoning">
                <option value="high" ${reasoningVal === 'high' ? 'selected' : ''}>High (深度思考)</option>
                <option value="medium" ${reasoningVal === 'medium' ? 'selected' : ''}>Medium (适中)</option>
                <option value="low" ${reasoningVal === 'low' ? 'selected' : ''}>Low (精简)</option>
                <option value="off" ${reasoningVal === 'off' ? 'selected' : ''}>Off (关闭)</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="form-service-api-key">API 密钥 (API Key)</label>
            <div class="password-input-wrap">
              <input type="password" class="form-input font-mono" id="form-service-api-key" value="${escapeHtml(apiKeyVal)}" placeholder="sk-..." />
              <button type="button" class="btn-toggle-eye" data-action="toggle-key-visibility" title="查看/隐藏明文">👁️</button>
            </div>
            <p class="form-help">密钥将仅保存在本地磁盘，通过安全加密管道与 LLM 提供商交互</p>
          </div>
        </form>
      </div>

      <div class="secondary-modal-footer">
        <div class="footer-left">
          <button type="button" class="btn-secondary" data-action="test-form-service" ${state.isTesting ? 'disabled' : ''}>
            ${state.isTesting ? '正在探活...' : '📶 测试连通性'}
          </button>
          ${testResultInline}
        </div>
        <div class="footer-right">
          <button type="button" class="btn-secondary" data-action="close-add-service">取消</button>
          <button type="button" class="btn-primary" data-action="submit-service-form">保存配置</button>
        </div>
      </div>
    </div>
  </div>`;
}
