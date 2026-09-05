import {
  renderAppShell,
  renderDemoHome,
  renderEventTimeline,
  renderTaskPlan,
} from '../ui/render.js';
import type { DesktopSnapshot } from './session.js';
import type { AppRoute } from '../ui/app-shell.js';

const appRoot = document.querySelector<HTMLElement>('#app');
if (appRoot === null) {
  throw new Error('desktop renderer root is missing');
}
const root: HTMLElement = appRoot;

let snapshot: DesktopSnapshot | undefined;

function render(next: DesktopSnapshot): void {
  snapshot = next;
  const routeContent =
    next.route === 'demo-home'
      ? renderDemoHome(next.home)
      : renderTaskPlan({
          ...(next.thread === undefined ? {} : { threadStatus: next.thread.status }),
          ...(next.turn === undefined ? {} : { turnStatus: next.turn.status }),
          ...(next.plan === undefined ? {} : { plan: next.plan }),
          ...(next.approval === undefined ? {} : { approval: next.approval }),
        });
  root.innerHTML = `<div class="desktop-shell">
  ${renderAppShell(next.shell)}
  <section data-desktop-content>${routeContent}</section>
  ${renderEventTimeline(next.events)}
  <p id="desktop-feedback" role="status" aria-live="polite"></p>
</div>`;
}

function feedback(message: string): void {
  const element = document.querySelector<HTMLElement>('#desktop-feedback');
  if (element) {
    element.textContent = message;
  }
}

async function apply(action: () => Promise<DesktopSnapshot>, successMessage?: string): Promise<void> {
  try {
    render(await action());
    if (successMessage) {
      feedback(successMessage);
    }
  } catch (error) {
    feedback(error instanceof Error ? error.message : String(error));
  }
}

root.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const button = target.closest<HTMLButtonElement>('button');
  if (!button || snapshot === undefined) {
    return;
  }
  const quickTask = button.dataset.quickTask;
  if (quickTask !== undefined) {
    void apply(() => window.agentDesktop.chooseQuickTask(quickTask));
    return;
  }
  const route = button.dataset.route;
  if (route !== undefined) {
    void apply(() => window.agentDesktop.navigate(route as AppRoute));
    return;
  }
  switch (button.dataset.action) {
    case 'select-workspace':
      void apply(() => window.agentDesktop.selectWorkspace(), '工作区已选择');
      return;
    case 'submit-plan':
      void apply(() => window.agentDesktop.submitPlan(), '方案已生成，请审核后决定是否执行');
      return;
    case 'approve-plan':
      void apply(() => window.agentDesktop.respondApproval('approved'), '已批准执行');
      return;
    case 'reject-plan':
      void apply(() => window.agentDesktop.respondApproval('rejected'), '已拒绝执行');
      return;
    case 'stop-task':
      void apply(() => window.agentDesktop.stopTask(), '任务已停止');
      return;
    default:
      break;
  }
});

root.addEventListener('input', (event) => {
  const target = event.target;
  if (target instanceof HTMLTextAreaElement && target.id === 'task-input') {
    void apply(() => window.agentDesktop.setTaskInput(target.value));
  }
});

root.addEventListener('change', (event) => {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.dataset.action === 'set-model-mode') {
    void apply(() => window.agentDesktop.setModelMode(target.value as 'fake' | 'live'));
  }
});

void window.agentDesktop.getSnapshot().then(render).catch((error: unknown) => {
  feedback(error instanceof Error ? error.message : String(error));
});
window.agentDesktop.subscribe(render);
