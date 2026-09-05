import type {
  DesktopApprovalView,
  DesktopEventDto,
  DesktopPlanView,
} from '../desktop/session.js';
import type { AppShellView } from './app-shell.js';
import type { DemoHomeView } from './demo-home.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export interface AppShellRenderContext {
  readonly workspaceFiles?: readonly string[];
  readonly artifactFiles?: readonly string[];
}

export function renderAppShell(
  view: AppShellView,
  context?: AppShellRenderContext,
): string {
  // Only render active, functional navigation buttons
  const functionalNav = [
    { id: 'demo-home', label: '新建会话' },
    ...(view.threadId || view.route === 'task-plan'
      ? [{ id: 'task-plan', label: '任务方案与审批' }]
      : []),
  ];
  const nav = functionalNav
    .map(
      (item) =>
        `<button type="button" class="nav-btn" data-route="${item.id}" aria-current="${
          view.route === item.id ? 'page' : 'false'
        }"><span class="nav-icon">${item.id === 'demo-home' ? '💬' : '📋'}</span><span>${escapeHtml(item.label)}</span></button>`,
    )
    .join('');
  const workspace = view.workspaceRoot
    ? `<span data-status="workspace" title="${escapeHtml(view.workspaceRoot)}">📁 ${escapeHtml(view.workspaceRoot)}</span>`
    : '<span data-status="workspace">尚未选择工作区</span>';
  const disabled = view.disabledReason
    ? `<p role="status" data-status="disabled-reason">${escapeHtml(view.disabledReason)}</p>`
    : '';
  const stop = view.canStopTask
    ? '<button type="button" data-action="stop-task">停止任务</button>'
    : '';

  const workspaceName = view.workspaceRoot
    ? view.workspaceRoot.split(/[\\/]/).pop() ?? 'workspace'
    : 'demo-workspace';

  const defaultWorkspaceFiles = [
    'sales.csv',
    'meeting-notes.md',
    'decisions.txt',
  ];
  const workspaceFilesList = (context?.workspaceFiles && context.workspaceFiles.length > 0
    ? context.workspaceFiles
    : defaultWorkspaceFiles)
    .map((file) => `<div class="tree-file" data-filename="${escapeHtml(file)}" title="点击插入提示词"><span>📄 ${escapeHtml(file)}</span></div>`)
    .join('');

  const defaultArtifactFiles = [
    'sales-summary.xlsx',
    'weekly-meeting-report.docx',
  ];
  const artifactFilesList = (context?.artifactFiles && context.artifactFiles.length > 0
    ? context.artifactFiles
    : defaultArtifactFiles)
    .map(
      (file) =>
        `<div class="tree-file verified" data-filename="${escapeHtml(file)}" title="点击插入提示词"><span>📊 ${escapeHtml(file)}</span><span class="badge-tag">已验</span></div>`,
    )
    .join('');

  return `<main data-page="app-shell" data-state="${view.readiness}" class="surface-base">
  <nav aria-label="主导航" class="surface-card">
    <div class="sidebar-header">
      <div class="sidebar-brand">
        <span class="brand-avatar">A</span>
        <span class="brand-name">Agent_XXXXX</span>
        <span class="brand-version">v1.0</span>
      </div>
    </div>
    <div class="nav-links">${nav}</div>
    <div class="workspace-tree-section">
      <div class="tree-section-header">
        <span>本地工作空间 (Local Workspace)</span>
      </div>
      <div class="workspace-group">
        <div class="folder-title">📁 ${escapeHtml(workspaceName)} (输入源)</div>
        <div class="folder-children">${workspaceFilesList}</div>
      </div>
      <div class="workspace-group artifacts-group">
        <div class="folder-title artifacts-title">📁 artifacts (任务产物目录)</div>
        <div class="folder-children">${artifactFilesList}</div>
      </div>
    </div>
  </nav>
  <header aria-label="全局状态">
    <div class="header-left">
      <button type="button" class="sidebar-toggle-btn" data-action="toggle-sidebar" title="收起/展开侧边栏 (Ctrl+B)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="9" y1="3" x2="9" y2="21"></line>
        </svg>
      </button>
      <span class="header-center-title">Agent_XXXXX</span>
    </div>
    <div class="header-right">
      ${workspace}
      <span data-status="sandbox" class="status-pill green">● ${
        view.sandboxReady ? '沙箱就绪' : '沙箱保护中'
      }</span>
      <span data-status="model" class="status-pill">${escapeHtml(view.modelMode)} ${
        view.modelConnected ? '已连接' : '未连接'
      }</span>
      <span data-status="network" class="status-pill">网络${
        view.network === 'disabled' ? '关闭' : '已开启'
      }</span>
      ${stop}
    </div>
  </header>
  <section data-route-content aria-live="polite">${escapeHtml(view.route)}</section>
  ${disabled}
</main>`;
}

export function renderDemoHome(view: DemoHomeView): string {
  const quickTasks = view.quickTasks
    .map(
      (task) =>
        `<button type="button" class="quick-task-btn" data-quick-task="${escapeHtml(task)}">${escapeHtml(task)} ↘</button>`,
    )
    .join('');
  const disabled = view.disabledReason
    ? `<p role="status" data-status="disabled-reason">${escapeHtml(view.disabledReason)}</p>`
    : '';
  const workspace = view.workspaceRoot
    ? `<span data-status="workspace">${escapeHtml(view.workspaceRoot)}</span>`
    : '<span data-status="workspace">尚未选择工作区</span>';

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

    <div class="main-prompt-card">
      <div class="prompt-active-badge">
        <span class="skill-badge-pill">
          <span>🔗 Office-自动合并多表与公式汇总</span>
          <button type="button" class="badge-remove-btn" title="清除标签">×</button>
        </span>
      </div>

      <label for="task-input" class="sr-only">任务</label>
      <textarea id="task-input" name="task" aria-label="任务输入" placeholder="输入任务需求，例如：读取工作区 sales.csv 与 meeting-notes.md，生成销售报表并汇总合计...">${escapeHtml(view.taskInput)}</textarea>

      <div class="prompt-card-bottom">
        <div class="controls-left">
          <div class="workspace-status">
            ${workspace}
            <button type="button" data-action="select-workspace" class="select-workspace-btn">选择工作区</button>
          </div>
          <span class="sandbox-shield-tag">🔒 沙箱写保护: 仅限 artifacts/ 目录</span>
        </div>

        <div class="controls-right">
          <label for="model-mode" class="sr-only">模型模式</label>
          <select id="model-mode" data-action="set-model-mode" aria-label="模型模式" class="model-select">
            <option value="fake" ${view.modelMode === 'fake' ? 'selected' : ''}>Fake Model Demo</option>
            <option value="live" ${view.modelMode === 'live' ? 'selected' : ''}>Live Model Demo</option>
          </select>
          <div class="model-status" data-status="model" style="display:none">模型：${escapeHtml(view.modelMode)}</div>
          <button type="button" class="submit-circle-btn" data-action="submit-plan" ${view.canSubmit ? '' : 'disabled'} title="${escapeHtml(view.submitLabel)}">
            ↑
          </button>
        </div>
      </div>
    </div>

    ${disabled}

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
