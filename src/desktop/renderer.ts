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
let sidebarCollapsed = false;

function toggleSidebar(): void {
  sidebarCollapsed = !sidebarCollapsed;
  const shell = document.querySelector<HTMLElement>('.desktop-shell');
  if (shell) {
    shell.classList.toggle('sidebar-collapsed', sidebarCollapsed);
  }
}

function render(next: DesktopSnapshot): void {
  snapshot = next;
  const routeContent = renderDemoHome(next.home, {
    thread: next.thread,
    turn: next.turn,
    plan: next.plan,
    approval: next.approval,
    messages: next.messages,
    skills: next.skills,
    activeSkillId: next.activeSkillId,
    permissionMode: next.permissionMode,
  });
  root.innerHTML = `<div class="desktop-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}">
  ${renderAppShell(next.shell, {
    ...(next.workspaceFiles ? { workspaceFiles: next.workspaceFiles } : {}),
    ...(next.artifactFiles ? { artifactFiles: next.artifactFiles } : {}),
  })}
  <section data-desktop-content>${routeContent}</section>
  <p id="desktop-feedback" role="status" aria-live="polite"></p>
</div>`;

  const stream = document.querySelector<HTMLElement>('#chat-stream');
  if (stream) {
    stream.scrollTop = stream.scrollHeight;
  }
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
  if (!(target instanceof Element)) {
    return;
  }
  const button = target.closest<HTMLButtonElement>('button');
  if (button) {
    if (button.dataset.action === 'toggle-sidebar') {
      toggleSidebar();
      return;
    }
  }
  if (button && snapshot !== undefined) {
    if (button.classList.contains('badge-remove-btn')) {
      const badge = button.closest('.prompt-active-badge');
      if (badge) {
        (badge as HTMLElement).style.display = 'none';
      }
      return;
    }
    const category = button.dataset.category;
    if (category !== undefined) {
      const categoryPrompts: Record<string, string> = {
        excel: '读取工作区 sales.csv，使用 ExcelJS 生成包含跨表求和公式的销售报表 sales-summary.xlsx',
        word: '读取工作区 meeting-notes.md，使用 docx 生成格式规范的大纲周报 weekly-meeting-report.docx',
        clean: '清洗多源办公数据并剔除异常值，生成规整的待分析表格',
        verify: '核验 artifacts 产物物理完整性与安全哈希（解构 ZIP/OpenXML 校验核心部件非空）',
        custom: '编排自定义办公自动化复合任务并在双重沙箱中安全执行',
      };
      const prompt = categoryPrompts[category];
      if (prompt) {
        void apply(
          () => window.agentDesktop.setTaskInput(prompt),
          `已切换至【${button.textContent?.trim() ?? category}】场景`,
        );
      }
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
      case 'new-chat':
        void apply(() => window.agentDesktop.selectWorkspace(), '已开启新对话');
        return;
      case 'send-message':
      case 'submit-plan': {
        const input = snapshot?.home.taskInput?.trim();
        if (input) {
          void apply(
            () => window.agentDesktop.sendMessage(input),
            '智能体正在思考并执行任务…',
          );
        } else {
          void apply(() => window.agentDesktop.submitPlan(), '方案已生成，请审核后决定是否执行');
        }
        return;
      }
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
  }

  const treeFile = target.closest<HTMLElement>('.tree-file');
  if (treeFile && snapshot !== undefined) {
    const rawText = treeFile.textContent?.trim() ?? '';
    const match = rawText.match(/[📄📊]\s*([^\s(]+)/);
    const fileName = match ? match[1] : undefined;
    if (fileName) {
      const current = snapshot.home.taskInput ?? '';
      const updated = current ? `${current} ${fileName}` : `处理工作区文件 ${fileName} `;
      void apply(() => window.agentDesktop.setTaskInput(updated), `已将 ${fileName} 加入任务输入`);
    }
  }
});

root.addEventListener('keydown', (event) => {
  if (
    event.target instanceof HTMLTextAreaElement &&
    event.target.id === 'task-input'
  ) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const input = event.target.value.trim();
      if (input) {
        void apply(
          () => window.agentDesktop.sendMessage(input),
          '智能体正在思考并执行任务…',
        );
      }
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (snapshot?.home.canSubmit) {
        void apply(() => window.agentDesktop.submitPlan(), '方案已生成，请审核后决定是否执行');
      }
    }
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
  if (target instanceof HTMLSelectElement) {
    if (target.dataset.action === 'set-model-mode') {
      void apply(() => window.agentDesktop.setModelMode(target.value as 'fake' | 'live'));
    } else if (target.dataset.action === 'set-permission-mode') {
      void apply(
        () => window.agentDesktop.setPermissionMode(target.value as any),
        `文件权限已切换为【${target.selectedOptions[0]?.text?.trim() ?? target.value}】`,
      );
    }
  }
});

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
    event.preventDefault();
    toggleSidebar();
  }
});

if (typeof window.agentDesktop === 'undefined') {
  const errMsg = '初始化错误：未检测到桌面桥接层 (window.agentDesktop)';
  console.error(errMsg);
  root.innerHTML = `<div style="padding:20px;color:#dc2626;font-weight:bold;">${errMsg}</div>`;
} else {
  void window.agentDesktop.getSnapshot().then((initial) => {
    console.log('[RENDERER] Initial snapshot received:', initial.route);
    render(initial);
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[RENDERER] Failed to get initial snapshot:', message);
    feedback(message);
  });
  window.agentDesktop.subscribe(render);
}
