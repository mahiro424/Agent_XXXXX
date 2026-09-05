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

export function renderAppShell(view: AppShellView): string {
  const nav = view.navItems
    .map(
      (item) =>
        `<button type="button" data-route="${item.id}" aria-current="${
          view.route === item.id ? 'page' : 'false'
        }">${escapeHtml(item.label)}</button>`,
    )
    .join('');
  const workspace = view.workspaceRoot
    ? `<span data-status="workspace">${escapeHtml(view.workspaceRoot)}</span>`
    : '<span data-status="workspace">尚未选择工作区</span>';
  const disabled = view.disabledReason
    ? `<p role="status" data-status="disabled-reason">${escapeHtml(view.disabledReason)}</p>`
    : '';
  const stop = view.canStopTask
    ? '<button type="button" data-action="stop-task">停止任务</button>'
    : '';

  return `<main data-page="app-shell" data-state="${view.readiness}" class="surface-base">
  <nav aria-label="主导航" class="surface-card">${nav}</nav>
  <header aria-label="全局状态">
    ${workspace}
    <span data-status="model">${escapeHtml(view.modelMode)} ${view.modelConnected ? '已连接' : '未连接'}</span>
    <span data-status="sandbox">${view.sandboxReady ? '沙箱就绪' : '沙箱未就绪'}</span>
    <span data-status="network">网络${view.network === 'disabled' ? '关闭' : '已开启'}</span>
    ${stop}
  </header>
  <section data-route-content aria-live="polite">${escapeHtml(view.route)}</section>
  ${disabled}
</main>`;
}

export function renderDemoHome(view: DemoHomeView): string {
  const quickTasks = view.quickTasks
    .map(
      (task) =>
        `<button type="button" data-quick-task="${escapeHtml(task)}">${escapeHtml(task)}</button>`,
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
    <h1 id="demo-home-title">告诉 Agent 你想完成什么</h1>
    <p>从本地工作区开始，先生成方案，再由你决定是否执行。</p>
    <div class="quick-tasks" aria-label="快捷任务">${quickTasks}</div>
    <label for="task-input">任务</label>
    <textarea id="task-input" name="task" aria-label="任务输入">${escapeHtml(view.taskInput)}</textarea>
    <div class="workspace-status">${workspace}</div>
    <div class="model-status" data-status="model">模型：${escapeHtml(view.modelMode)}</div>
    <button type="button" data-action="submit-plan" ${view.canSubmit ? '' : 'disabled'}>${escapeHtml(
      view.submitLabel,
    )}</button>
    ${disabled}
  </section>
</main>`;
}
