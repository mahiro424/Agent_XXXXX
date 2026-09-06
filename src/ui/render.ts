import type {
  DesktopApprovalView,
  DesktopEventDto,
  DesktopExecutionState,
  DesktopPlanView,
  DesktopProject,
  DesktopSessionMetadata,
  DesktopThreadView,
  DesktopTurnView,
} from '../desktop/session.js';
import type { AppShellView } from './app-shell.js';
import type { DemoHomeView, DemoModelMode, FilePermissionMode } from './demo-home.js';
import type {
  AttachmentItem,
  ChatMessage,
  ReasoningEffort,
  TokenUsageSnapshot,
} from '../runtime/protocol.js';
import type { AgentSkill } from '../runtime/skill.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export interface AppShellRenderContext {
  readonly workspaceFiles?: readonly string[] | undefined;
  readonly artifactFiles?: readonly string[] | undefined;
  readonly sessions?: readonly DesktopSessionMetadata[] | undefined;
  readonly projects?: readonly DesktopProject[] | undefined;
  readonly activeSessionId?: string | undefined;
}

function renderSessionItem(
  s: DesktopSessionMetadata,
  activeSessionId?: string,
): string {
  const isActive = s.id === activeSessionId;
  const pinIcon = s.isPinned ? '📍' : '📌';
  const pinTitle = s.isPinned ? '取消置顶' : '置顶';
  return `
    <div class="session-item ${isActive ? 'active' : ''}" data-action="switch-session" data-session-id="${escapeHtml(s.id)}" title="${escapeHtml(s.title)}">
      <span class="session-icon">💬</span>
      <span class="session-title">${escapeHtml(s.title)}</span>
      <div class="session-actions">
        <button type="button" class="btn-action-icon" data-action="toggle-pin-session" data-session-id="${escapeHtml(s.id)}" title="${pinTitle}">${pinIcon}</button>
        <button type="button" class="btn-action-icon" data-action="rename-session" data-session-id="${escapeHtml(s.id)}" title="重命名">✏️</button>
        <button type="button" class="btn-action-icon" data-action="delete-session" data-session-id="${escapeHtml(s.id)}" title="删除">🗑️</button>
      </div>
    </div>
  `;
}

function renderProjectCard(
  p: DesktopProject,
  sessions: readonly DesktopSessionMetadata[],
  activeSessionId?: string,
): string {
  const isExpanded = p.isExpanded !== false;
  const projectSessions = sessions.filter((s) => s.projectId === p.id);
  const caret = isExpanded ? '▾' : '▸';
  const sessionsHtml = projectSessions.length > 0
    ? projectSessions.map((s) => renderSessionItem(s, activeSessionId)).join('')
    : '<div class="empty-hint">该项目暂无会话</div>';

  return `
    <div class="project-card ${isExpanded ? 'expanded' : 'collapsed'}" data-project-id="${escapeHtml(p.id)}">
      <div class="project-header" data-action="toggle-project-expanded" data-project-id="${escapeHtml(p.id)}">
        <span class="project-caret">${caret}</span>
        <div class="project-header-info">
          <span class="project-name" title="${escapeHtml(p.folderPath)}">📁 ${escapeHtml(p.name)}</span>
          <span class="project-folder-badge" title="${escapeHtml(p.folderPath)}">${escapeHtml(p.folderPath)}</span>
        </div>
        <div class="project-actions">
          <button type="button" class="btn-action-icon" data-action="create-project-chat" data-project-id="${escapeHtml(p.id)}" title="在此项目创建新会话">＋</button>
          <button type="button" class="btn-action-icon" data-action="delete-project" data-project-id="${escapeHtml(p.id)}" title="移除项目 (不删除本地文件)">🗑️</button>
        </div>
      </div>
      ${isExpanded ? `
        <div class="project-body">
          <button type="button" class="btn-new-project-session" data-action="create-project-chat" data-project-id="${escapeHtml(p.id)}" title="创建属于该项目的新会话">
            <span class="btn-icon">＋</span> 在此项目创建新会话
          </button>
          <div class="project-sessions">
            ${sessionsHtml}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

export function renderAppShell(
  view: AppShellView,
  context?: AppShellRenderContext,
): string {
  const sessions = context?.sessions ?? [];
  const projects = context?.projects ?? [];
  const activeSessionId = context?.activeSessionId ?? view.threadId;

  const pinnedSessions = sessions.filter((s) => s.isPinned);
  const ephemeralSessions = sessions.filter((s) => !s.projectId && !s.isPinned);

  const pinnedGroup = pinnedSessions.length > 0
    ? `
      <div class="sidebar-section">
        <div class="section-title">📌 置顶会话</div>
        <div class="session-list">${pinnedSessions.map((s) => renderSessionItem(s, activeSessionId)).join('')}</div>
      </div>
    `
    : '';

  const ephemeralGroup = `
    <div class="sidebar-section">
      <div class="section-title">⚡ 临时会话</div>
      <div class="session-list">
        ${ephemeralSessions.length > 0
          ? ephemeralSessions.map((s) => renderSessionItem(s, activeSessionId)).join('')
          : '<div class="empty-hint">暂无临时会话，点击上方创建</div>'}
      </div>
    </div>
  `;

  const projectsGroup = `
    <div class="sidebar-section projects-section">
      <div class="section-header">
        <span class="section-title">📁 项目工程</span>
        <button type="button" class="btn-create-project" data-action="prompt-create-project" title="关联本地文件夹创建项目">＋ 关联文件夹</button>
      </div>
      <div class="project-list">
        ${projects.length > 0
          ? projects.map((p) => renderProjectCard(p, sessions, activeSessionId)).join('')
          : '<div class="empty-hint">暂无项目，点击“＋ 关联文件夹”绑定本地工程</div>'}
      </div>
    </div>
  `;

  const hasCustomFiles = Boolean(
    (context?.workspaceFiles && context.workspaceFiles.length > 0) ||
    (context?.artifactFiles && context.artifactFiles.length > 0),
  );

  let workspaceSummaryHtml = '';
  if (hasCustomFiles) {
    const workspaceFilesList = (context?.workspaceFiles ?? [])
      .map((file) => `<div class="tree-file" data-filename="${escapeHtml(file)}" title="点击插入提示词"><span>📄 ${escapeHtml(file)}</span></div>`)
      .join('');
    const artifactFilesList = (context?.artifactFiles ?? [])
      .map((file) => `<div class="tree-file verified" data-filename="${escapeHtml(file)}" title="点击插入提示词"><span>📊 ${escapeHtml(file)}</span><span class="badge-tag">已验</span></div>`)
      .join('');
    workspaceSummaryHtml = `
      <div class="workspace-tree-section">
        <div class="tree-section-header">
          <span>工作区文件概览 (Files)</span>
        </div>
        <div class="folder-children">${workspaceFilesList}${artifactFilesList}</div>
      </div>
    `;
  }

  return `<main data-page="app-shell" data-state="${view.readiness}" class="surface-base">
  <nav aria-label="主导航" class="surface-card codex-sidebar">
    <div class="sidebar-header">
      <div class="sidebar-brand">
        <span class="brand-avatar">A</span>
        <span class="brand-name">Agent_XXXXX</span>
        <span class="brand-version">v1.0</span>
      </div>
      <button type="button" class="btn-create-session" data-action="create-ephemeral-chat" title="开辟全新临时会话">
        <span class="btn-icon">＋</span>
        <span class="btn-text">创建新会话</span>
      </button>
    </div>
    <div class="sidebar-scrollable">
      ${pinnedGroup}
      ${ephemeralGroup}
      ${projectsGroup}
      ${workspaceSummaryHtml}
    </div>
    <div class="sidebar-footer">
      <button type="button" class="sidebar-settings-btn" data-action="open-settings" title="系统设置 (AI 服务与全局策略)">
        <span class="settings-btn-icon">⚙️</span>
        <span class="settings-btn-text">设置</span>
      </button>
    </div>
  </nav>
  <header aria-label="全局状态">
    <div class="header-left">
      <button type="button" class="sidebar-toggle-btn" data-action="toggle-sidebar" title="收起/展开侧边栏 (Ctrl+B)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="9" y1="3" x2="9" y2="21"></line>
        </svg>
      </button>
      <span class="header-center-title">Agent_XXXXX</span>
    </div>
    <div class="header-right"></div>
  </header>
  <section data-route-content aria-live="polite">${escapeHtml(view.route)}</section>
</main>`;
}

export interface DemoHomeRenderContext {
  readonly thread?: DesktopThreadView | undefined;
  readonly turn?: DesktopTurnView | undefined;
  readonly plan?: DesktopPlanView | undefined;
  readonly approval?: DesktopApprovalView | undefined;
  readonly messages?: readonly ChatMessage[] | undefined;
  readonly skills?: readonly AgentSkill[] | undefined;
  readonly activeSkillId?: string | undefined;
  readonly permissionMode?: FilePermissionMode | undefined;
  readonly activeServiceName?: string | undefined;
  readonly activeModelName?: string | undefined;
  readonly configuredServices?: readonly { readonly id: string; readonly name: string; readonly modelName: string }[] | undefined;
  readonly isGenerating?: boolean | undefined;
  readonly executionState?: DesktopExecutionState | undefined;
}

function formatMarkdown(text: string): string {
  if (!text) return '';
  const escaped = escapeHtml(text);
  return escaped
    .replace(/```([\w-]*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n- /g, '<br>• ')
    .replace(/\n(\d+)\. /g, '<br>$1. ')
    .replace(/\n/g, '<br>');
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function renderAttachmentsList(attachments: readonly AttachmentItem[]): string {
  if (!attachments || attachments.length === 0) return '';
  return `<div class="composer-attachment-chips" aria-label="已选附件">
    ${attachments
      .map(
        (att) => `
        <span class="attachment-chip" data-attachment-id="${escapeHtml(att.id)}">
          <span class="chip-file-icon">📎</span>
          <span class="chip-file-name" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</span>
          <button type="button" class="chip-remove-btn" data-action="remove-attachment" data-attachment-id="${escapeHtml(att.id)}" title="移除附件">×</button>
        </span>
      `,
      )
      .join('')}
  </div>`;
}

function renderApprovalTierSelector(permissionMode: FilePermissionMode): string {
  return `
    <div class="approval-tier-picker">
      <span class="tier-icon">🛡️</span>
      <select id="permission-mode" data-action="set-permission-mode" aria-label="权限模式" class="tier-select-chip" title="切换智能体运行权限策略">
        <option value="full-access" ${permissionMode === 'full-access' ? 'selected' : ''}>完全访问 (免审批)</option>
        <option value="auto" ${permissionMode === 'auto' ? 'selected' : ''}>全自动 (防破坏停下)</option>
        <option value="accept-edits" ${permissionMode === 'accept-edits' ? 'selected' : ''}>自动接受编辑 (仅工作区)</option>
        <option value="risk-gated" ${permissionMode === 'risk-gated' ? 'selected' : ''}>仅高危 (低危放行)</option>
        <option value="ask-approval" ${permissionMode === 'ask-approval' ? 'selected' : ''}>每步确认 (人工审核)</option>
        <option value="read-only" ${permissionMode === 'read-only' ? 'selected' : ''}>仅只读访问</option>
      </select>
    </div>
  `;
}

function renderModelAndEffortSelector(
  modelMode: DemoModelMode,
  effort: ReasoningEffort,
  activeServiceName?: string,
  activeModelName?: string,
  services?: readonly { readonly id: string; readonly name: string; readonly modelName: string }[],
): string {
  const displayName = activeServiceName
    ? `${activeServiceName}${activeModelName ? ` (${activeModelName})` : ''}`
    : 'DeepSeek V4 Pro';

  const serviceOptions =
    services && services.length > 0
      ? services
          .map(
            (s) =>
              `<option value="${s.id}" ${s.name === activeServiceName ? 'selected' : ''}>${escapeHtml(s.name)} (${escapeHtml(s.modelName)})</option>`,
          )
          .join('')
      : `<option value="live" selected>${escapeHtml(displayName)}</option>`;

  return `
    <div class="model-select-wrap">
      <span class="model-sparkle">✦</span>
      <select id="model-mode" data-action="set-model-mode" aria-label="模型选择" class="model-select-chip" title="当前已生效的 AI 模型服务">
        ${serviceOptions}
      </select>
      <select id="reasoning-effort" data-action="set-reasoning-effort" aria-label="推理强度" class="effort-select-chip" title="设置模型思考与推理强度">
        <option value="max" ${effort === 'max' ? 'selected' : ''}>极高</option>
        <option value="high" ${effort === 'high' ? 'selected' : ''}>高</option>
        <option value="medium" ${effort === 'medium' ? 'selected' : ''}>中</option>
        <option value="low" ${effort === 'low' ? 'selected' : ''}>低</option>
        <option value="off" ${effort === 'off' ? 'selected' : ''}>关闭</option>
      </select>
    </div>
  `;
}

function renderContextCompactionWidget(
  snapshot?: TokenUsageSnapshot,
  isCompacting = false,
): string {
  const used = snapshot?.usedTokens ?? 120;
  const maxTokens = snapshot?.contextWindow ?? 128000;
  const pct = Math.min(100, Math.round((used / maxTokens) * 100));
  const tone = pct > 80 ? 'imminent' : pct > 60 ? 'caution' : 'calm';

  return `
    <div class="context-widget-container">
      <button type="button" class="context-usage-widget ${tone}" data-action="toggle-context-panel" title="点击查看记忆余量与上下文压缩明细">
        <svg class="ring-svg" viewBox="0 0 36 36">
          <path class="ring-bg" stroke-dasharray="100, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
          <path class="ring-fill" stroke-dasharray="${pct}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
        </svg>
        <span class="ring-text">${isCompacting ? '整理中…' : `约${pct}% · ${formatTokens(used)}/${formatTokens(maxTokens)}`}</span>
      </button>

      <div class="context-popover-panel" id="context-popover" style="display: none;">
        <div class="popover-header">
          <strong>上下文与记忆余量</strong>
          <span class="popover-pct ${tone}">约 ${pct}%</span>
        </div>
        <div class="popover-sub">已用 ${formatTokens(used)} / 容量 ${formatTokens(maxTokens)} (共 ${snapshot?.messagesCount ?? 0} 条消息)</div>
        <div class="popover-grid">
          <div>输入: <span>${formatTokens(snapshot?.inputTokens ?? 0)}</span></div>
          <div>输出: <span>${formatTokens(snapshot?.outputTokens ?? 0)}</span></div>
          <div>缓存读取: <span>${formatTokens(snapshot?.cacheRead ?? 0)}</span></div>
          <div>缓存写入: <span>${formatTokens(snapshot?.cacheWrite ?? 0)}</span></div>
        </div>
        <button type="button" class="btn-compact-trigger" data-action="compact-context" ${isCompacting ? 'disabled' : ''}>
          ${isCompacting ? '正在整理上下文…' : '立即整理 (上下文压缩)'}
        </button>
      </div>
    </div>
  `;
}

function renderMessageList(messages: readonly ChatMessage[]): string {
  return messages
    .filter((m) => m.role !== 'system')
    .map((msg) => {
      const timeStr = msg.createdAt ? msg.createdAt.slice(11, 19) : '';
      if (msg.role === 'user') {
        let text = msg.content;
        let attachmentsHtml = '';
        const match = text.match(/<attachments>([\s\S]*?)<\/attachments>\n?/);
        if (match && match[1]) {
          try {
            const list = JSON.parse(match[1]);
            attachmentsHtml = `<div class="msg-attachments-box">${list.map((a: any) => `
              <span class="msg-attachment-pill">📎 ${escapeHtml(a.name)}</span>
            `).join('')}</div>`;
          } catch {
            // ignore
          }
          text = text.replace(/<attachments>[\s\S]*?<\/attachments>\n?/, '');
        }

        return `
          <div class="chat-message user" data-msg-id="${escapeHtml(msg.id)}">
            <div class="chat-bubble user-bubble">
              ${attachmentsHtml}
              <div class="chat-text">${escapeHtml(text)}</div>
              <div class="chat-timestamp">${escapeHtml(timeStr)}</div>
            </div>
            <div class="chat-avatar user-avatar">👤</div>
          </div>
        `;
      }

      if (msg.role === 'tool') {
        return `
          <div class="chat-message tool" data-msg-id="${escapeHtml(msg.id)}">
            <div class="chat-tool-result-box">
              <div class="tool-result-header">
                <span class="tool-result-icon">⚡</span>
                <span class="tool-result-title">工具执行回填：<code>${escapeHtml(msg.name ?? 'tool')}</code></span>
                <span class="tool-verified-tag">✓ 物理已核验</span>
              </div>
              <div class="tool-result-body">${escapeHtml(msg.content)}</div>
            </div>
          </div>
        `;
      }

      // Assistant message
      let toolCallsHtml = '';
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        toolCallsHtml = msg.toolCalls
          .map(
            (tc) => `
              <div class="chat-tool-call-box">
                <div class="tool-call-header">
                  <span class="tool-icon">🔧</span>
                  <span class="tool-name">Agent 调度工具：<code>${escapeHtml(tc.name)}</code></span>
                  <span class="tool-call-badge">ReAct Loop</span>
                </div>
                <div class="tool-args-preview">入参：<code>${escapeHtml(JSON.stringify(tc.arguments))}</code></div>
              </div>
            `,
          )
          .join('');
      }

      let reasoningHtml = '';
      if (msg.reasoningContent) {
        reasoningHtml = `
          <details class="chat-thinking-box" open>
            <summary class="thinking-summary">🧠 深度思考过程 (DeepSeek Reasoning)</summary>
            <div class="thinking-body">${formatMarkdown(msg.reasoningContent)}</div>
          </details>
        `;
      }

      const formatted = formatMarkdown(msg.content);

      return `
        <div class="chat-message assistant" data-msg-id="${escapeHtml(msg.id)}">
          <div class="chat-avatar assistant-avatar">🤖</div>
          <div class="chat-bubble assistant-bubble">
            ${reasoningHtml}
            ${toolCallsHtml}
            ${formatted ? `<div class="chat-text markdown-body">${formatted}</div>` : ''}
            <div class="chat-timestamp">${escapeHtml(timeStr)}</div>
          </div>
        </div>
      `;
    })
    .join('');
}

export function renderComposerCard(
  view: DemoHomeView,
  isDocked = false,
  skillBadgeLabel = '',
  workspacePill = '',
  context?: DemoHomeRenderContext,
): string {
  const attachmentsHtml = renderAttachmentsList(view.attachments);
  const placeholder = isDocked
    ? '继续输入指令，支持 /compact 整理上下文，或直接粘贴/拖入附件…'
    : '输入任务需求或指令，支持 /compact 整理上下文，或直接粘贴/拖入附件...';

  return `
    <div class="main-prompt-card ${isDocked ? 'docked' : ''}" id="composer-card">
      <div class="prompt-card-top-row">
        <div class="prompt-active-badge">
          <span class="skill-badge-pill">
            <span>${escapeHtml(skillBadgeLabel)}</span>
            <button type="button" class="badge-remove-btn" title="清除标签">×</button>
          </span>
        </div>
      </div>

      ${attachmentsHtml}

      <label for="task-input" class="sr-only">任务输入</label>
      <textarea id="task-input" name="task" aria-label="任务输入" placeholder="${placeholder}">${escapeHtml(view.taskInput)}</textarea>

      <div class="prompt-card-bottom">
        <div class="controls-left">
          <input type="file" id="composer-file-picker" style="display: none;" multiple />
          <button type="button" class="btn-card-plus" data-action="open-file-picker" title="添加文件或附件">+</button>
          ${renderApprovalTierSelector(view.permissionMode)}
          ${workspacePill}
        </div>

        <div class="controls-right">
          ${renderModelAndEffortSelector(
            view.modelMode,
            view.reasoningEffort,
            context?.activeServiceName,
            context?.activeModelName,
            context?.configuredServices,
          )}
          ${renderContextCompactionWidget(view.tokenSnapshot, view.isCompacting)}
          <button type="button" class="submit-circle-btn" data-action="submit-plan" ${view.canSubmit ? '' : 'disabled'} title="${escapeHtml(view.submitLabel)}">
            ↑
          </button>
        </div>
      </div>
    </div>
  `;
}

export function renderDemoHome(
  view: DemoHomeView,
  context?: DemoHomeRenderContext,
): string {
  const quickTasks = view.quickTasks
    .map(
      (task) =>
        `<button type="button" class="quick-task-btn" data-quick-task="${escapeHtml(task)}">${escapeHtml(task)} ↘</button>`,
    )
    .join('');

  const workspaceName = view.workspaceRoot
    ? view.workspaceRoot.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || view.workspaceRoot
    : '尚未选择工作区';
  const workspacePill = `<span class="workspace-pill" title="当前绑定工作区: ${escapeHtml(view.workspaceRoot ?? '尚未选择工作区')}">📁 ${escapeHtml(workspaceName)}</span>`;

  const activeSkill =
    context?.skills?.find((s) => s.id === context?.activeSkillId) ??
    context?.skills?.[0] ?? {
      id: 'data-analysis',
      name: 'Office-自动合并多表与公式汇总',
      icon: '🔗',
      description: '自动合并多表与公式汇总',
      systemPrompt: '',
      recommendedTools: [],
    };

  const skillBadgeLabel = `${activeSkill.icon} ${activeSkill.name}`;
  const hasMessages = Boolean(context?.messages && context.messages.length > 0);

  const activeBadgeText = context?.activeServiceName
    ? `⚡ ${context.activeServiceName}${context.activeModelName ? ` (${context.activeModelName})` : ''}`
    : '⚡ DeepSeek V4 Pro';

  let inlineExecutionSection = '';
  if (context?.approval && context.approval.status === 'pending') {
    const steps = (context.plan?.steps ?? []).map((step, idx) => `
      <div class="inline-step-item" data-plan-step="${escapeHtml(step.id)}">
        <span class="step-badge">${idx + 1}</span>
        <span class="step-title">${escapeHtml(step.title)}</span>
        <span class="step-tool"><code>${escapeHtml(step.toolName)}</code></span>
        <span class="step-risk ${escapeHtml(step.risk)}">风险：${escapeHtml(step.risk)}</span>
      </div>
    `).join('');
    inlineExecutionSection = `
      <div class="inline-card approval-card" data-approval-status="pending">
        <div class="inline-card-header">
          <span class="status-indicator yellow">●</span>
          <strong>任务执行方案待审批 (按需审批模式)</strong>
          <span class="approval-hint">${escapeHtml(context.approval.reason)}</span>
        </div>
        <div class="inline-steps-container">${steps}</div>
        <div class="inline-approval-actions">
          <button type="button" class="btn-approve" data-action="approve-plan">批准执行</button>
          <button type="button" class="btn-reject" data-action="reject-plan">拒绝执行</button>
        </div>
      </div>`;
  } else if (
    context?.turn &&
    (context.turn.status === 'completed' ||
      context.turn.status === 'executing' ||
      context.turn.status === 'verifying')
  ) {
    const steps = (context.plan?.steps ?? []).map((step) => `
      <div class="inline-step-item completed" data-plan-step="${escapeHtml(step.id)}">
        <span class="step-check">✓</span>
        <span class="step-title">${escapeHtml(step.title)}</span>
        <span class="step-tool"><code>${escapeHtml(step.toolName)}</code></span>
      </div>
    `).join('');
    inlineExecutionSection = `
      <div class="inline-card execution-card" data-execution-status="${escapeHtml(context.turn.status)}">
        <div class="inline-card-header">
          <span class="status-indicator green">●</span>
          <strong>任务规划已生成并执行中</strong>
        </div>
        <div class="inline-steps-container">${steps}</div>
       </div>`;
  }

  const showLiveActivity = Boolean(
    context?.isGenerating ||
    (context?.executionState && context.executionState.status !== 'idle'),
  );
  const activityStatus = context?.executionState?.status ?? 'thinking';
  const activityIcon =
    activityStatus === 'tool_executing'
      ? '⚡'
      : activityStatus === 'routing'
        ? '🎯'
        : '🧠';
  const activityDetail =
    context?.executionState?.detail ||
    (activityStatus === 'tool_executing'
      ? `正在执行工具: ${context?.executionState?.currentTool ?? ''}...`
      : 'Agent 正在深度思考与分析需求...');

  const liveActivityHtml = showLiveActivity
    ? `
      <div class="chat-live-activity" data-execution-status="${escapeHtml(activityStatus)}">
        <span class="live-activity-spinner"></span>
        <span class="live-activity-icon">${activityIcon}</span>
        <span class="live-activity-text">${escapeHtml(activityDetail)}</span>
      </div>
    `
    : '';

  // If conversation has messages, render chat stream view with bottom docked card
  if (hasMessages) {
    return `<main data-page="demo-home" data-state="${view.state}" class="surface-base conversation-page">
  <section class="conversation-view" aria-label="智能体会话交互">
    <div class="chat-header-bar">
      <div class="chat-header-left">
        <span class="chat-header-icon">${activeSkill.icon}</span>
        <span class="chat-header-title">${escapeHtml(activeSkill.name)}</span>
        <span class="chat-header-badge" title="当前已生效的 AI 模型服务">${escapeHtml(activeBadgeText)}</span>
      </div>
      <div class="chat-header-right"></div>
    </div>

    <div class="chat-messages-stream" id="chat-stream">
      ${renderMessageList(context?.messages ?? [])}
      ${liveActivityHtml}
    </div>

    <div class="docked-prompt-area">
      ${renderComposerCard(view, true, skillBadgeLabel, workspacePill, context)}
    </div>
  </section>
</main>`;
  }

  // Initial Landing State
  return `<main data-page="demo-home" data-state="${view.state}" class="surface-base">
  <section class="welcome" aria-labelledby="demo-home-title">
    <div class="hero-box">
      <h1 id="demo-home-title">Agent_XXXXX</h1>
      <h2 class="hero-subtitle">本地工作区智能办公工作台</h2>
    </div>

    <div class="capability-pills" role="tablist">
      <button type="button" class="cap-pill active" data-category="excel"><span>📊</span><span>Excel 智能汇总</span></button>
      <button type="button" class="cap-pill" data-category="word"><span>📝</span><span>Word 周报生成</span></button>
      <button type="button" class="cap-pill" data-category="clean"><span>📁</span><span>多源资料清洗</span></button>
      <button type="button" class="cap-pill" data-category="verify"><span>🛡️</span><span>产物物理核验</span></button>
      <button type="button" class="cap-pill" data-category="custom"><span>🪄</span><span>自定义 Skill</span></button>
    </div>

    <div class="quick-tasks" aria-label="快捷任务">${quickTasks}</div>

    ${renderComposerCard(view, false, skillBadgeLabel, workspacePill, context)}

    ${liveActivityHtml}
    ${inlineExecutionSection}

    <div class="features-summary-grid">
      <div class="summary-card">
        <span class="card-icon">📑</span>
        <div>
          <div class="card-heading">OpenXML 真文档引擎</div>
          <div class="card-desc">支持 docx 大纲分节与 exceljs 动态求和公式</div>
        </div>
      </div>
      <div class="summary-card">
        <span class="card-icon">🛡️</span>
        <div>
          <div class="card-heading">双重沙箱安全门禁</div>
          <div class="card-desc">默认网络断开，禁止越界写，产物需用户确认</div>
        </div>
      </div>
      <div class="summary-card">
        <span class="card-icon">🔍</span>
        <div>
          <div class="card-heading">物理证据链校验</div>
          <div class="card-desc">重开重读、SHA256、ZIP 结构非空验证</div>
        </div>
      </div>
    </div>
  </section>
</main>`;
}

export interface TaskPlanRenderInput {
  readonly threadStatus?: string;
  readonly turnStatus?: string;
  readonly plan?: DesktopPlanView;
  readonly approval?: DesktopApprovalView;
}

export function renderTaskPlan(view: TaskPlanRenderInput): string {
  const steps =
    view.plan?.steps
      .map(
        (step, index) =>
          `<li data-plan-step="${escapeHtml(step.id)}" class="plan-step-card">
            <div class="step-header">
              <strong>${index + 1}. ${escapeHtml(step.title)}</strong>
              <span class="risk-badge ${escapeHtml(step.risk)}" data-risk="${escapeHtml(step.risk)}">风险：${escapeHtml(step.risk)}</span>
            </div>
            <div class="step-tool" data-tool="${escapeHtml(step.toolName)}">工具：<code>${escapeHtml(step.toolName)}</code></div>
          </li>`,
      )
      .join('') ?? '<li data-status="empty-plan">暂无计划</li>';
  const approval = view.approval;
  const approvalMarkup =
    approval === undefined
      ? '<p data-status="approval" class="approval-info">暂无审批需求</p>'
      : `<section data-approval-status="${escapeHtml(approval.status)}" aria-labelledby="approval-title" class="approval-panel">
  <h3 id="approval-title">方案审批确认</h3>
  <p data-approval-reason class="approval-reason">${escapeHtml(approval.reason)}</p>
  ${
    approval.status === 'pending'
      ? `<div class="approval-actions">
           <button type="button" class="btn-approve" data-action="approve-plan">批准执行</button>
           <button type="button" class="btn-reject" data-action="reject-plan">拒绝执行</button>
         </div>`
      : `<p role="status" class="approval-resolved">审批状态：<strong>${escapeHtml(approval.status)}</strong></p>`
  }
</section>`;

  return `<section data-page="task-plan" aria-labelledby="task-plan-title" class="task-plan-container">
  <div class="plan-top-nav">
    <button type="button" class="btn-return-home" data-route="demo-home">← 返回新会话</button>
  </div>
  <div class="plan-header-box">
    <h2 id="task-plan-title">任务计划与审批</h2>
    <div class="status-tags">
      <span data-status="thread" class="thread-tag">Thread: ${escapeHtml(view.threadStatus ?? 'unknown')}</span>
      <span data-status="turn" class="turn-tag">Turn: ${escapeHtml(view.turnStatus ?? 'unknown')}</span>
    </div>
  </div>
  <ol data-plan-steps class="steps-list">${steps}</ol>
  ${approvalMarkup}
</section>`;
}

export function renderEventTimeline(events: readonly DesktopEventDto[]): string {
  const items = events
    .map((event) => {
      const payload = JSON.stringify(event.payload) ?? '';
      return `<li data-event-type="${escapeHtml(event.type)}" class="timeline-event-item">
        <div class="event-meta">
          <time datetime="${escapeHtml(event.occurredAt)}">#${event.sequence}</time>
          <strong>${escapeHtml(event.type)}</strong>
        </div>
        <span class="event-payload">${escapeHtml(payload)}</span>
      </li>`;
    })
    .join('');
  return `<section data-event-timeline aria-labelledby="event-timeline-title" class="timeline-container">
  <h2 id="event-timeline-title">运行日志与证据链</h2>
  <ol class="timeline-list">${items || '<li data-status="empty-events">暂无事件</li>'}</ol>
</section>`;
}
