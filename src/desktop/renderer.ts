import {
  renderAppShell,
  renderDemoHome,
  renderEventTimeline,
  renderTaskPlan,
} from '../ui/render.js';
import { renderSettingsModal, RECOMMENDED_MCP_PRESETS } from '../ui/settings-modal.js';
import type { SettingsModalState, SettingsTabId } from '../ui/settings-modal.js';
import { RECOMMENDED_PROVIDER_PRESETS } from '../runtime/settings-types.js';
import type { ModelServiceConfig } from '../runtime/settings-types.js';
import type { McpServerConfig } from '../runtime/mcp-types.js';
import type { DesktopSnapshot } from './session.js';
import type { AppRoute } from '../ui/app-shell.js';

const appRoot = document.querySelector<HTMLElement>('#app');
if (appRoot === null) {
  throw new Error('desktop renderer root is missing');
}
const root: HTMLElement = appRoot;

let snapshot: DesktopSnapshot | undefined;
let sidebarCollapsed = false;
let settingsWasOpen = false;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

let settingsState: SettingsModalState = {
  isOpen: false,
  activeTab: 'services',
  isAddServiceOpen: false,
  isAddThirdParty: false,
  initialPresetId: 'deepseek',
  editingServiceId: null,
  isTesting: false,
  testFeedback: null,
  toast: null,
  isAddMcpOpen: false,
  editingMcpId: null,
  isTestingMcp: false,
  mcpTestFeedback: null,
};

function ensureHosts(): { shellHost: HTMLElement; settingsPortal: HTMLElement } {
  let shellHost = root.querySelector<HTMLElement>('#desktop-shell-host');
  let settingsPortal = root.querySelector<HTMLElement>('#settings-portal');
  if (!shellHost || !settingsPortal) {
    root.innerHTML = `
      <div id="desktop-shell-host"></div>
      <div id="settings-portal"></div>
    `;
    shellHost = root.querySelector<HTMLElement>('#desktop-shell-host')!;
    settingsPortal = root.querySelector<HTMLElement>('#settings-portal')!;
  }
  return { shellHost, settingsPortal };
}

function toggleSidebar(): void {
  sidebarCollapsed = !sidebarCollapsed;
  const shell = document.querySelector<HTMLElement>('.desktop-shell');
  if (shell) {
    shell.classList.toggle('sidebar-collapsed', sidebarCollapsed);
  }
}

function setSettingsToast(message: string, type: 'success' | 'error' = 'success'): void {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  settingsState = { ...settingsState, toast: { message, type } };
  renderSettings();
  toastTimer = setTimeout(() => {
    settingsState = { ...settingsState, toast: null };
    renderSettings();
  }, 3500);
}

function renderShell(next: DesktopSnapshot): void {
  const { shellHost } = ensureHosts();

  const configuredServices = next.settings?.services.map((s) => ({
    id: s.id,
    name: s.name,
    modelName: s.modelName,
  }));

  const routeContent = renderDemoHome(next.home, {
    thread: next.thread,
    turn: next.turn,
    plan: next.plan,
    approval: next.approval,
    messages: next.messages,
    skills: next.skills,
    activeSkillId: next.activeSkillId,
    permissionMode: next.permissionMode,
    activeServiceName: next.activeServiceName,
    activeModelName: next.activeModelName,
    configuredServices,
  });

  shellHost.innerHTML = `<div class="desktop-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}">
  ${renderAppShell(next.shell, {
    ...(next.workspaceFiles ? { workspaceFiles: next.workspaceFiles } : {}),
    ...(next.artifactFiles ? { artifactFiles: next.artifactFiles } : {}),
    ...(next.sessions ? { sessions: next.sessions } : {}),
    ...(next.projects ? { projects: next.projects } : {}),
    ...(next.activeSessionId ? { activeSessionId: next.activeSessionId } : {}),
  })}
  <section data-desktop-content>${routeContent}</section>
  <p id="desktop-feedback" role="status" aria-live="polite"></p>
</div>`;

  const stream = document.querySelector<HTMLElement>('#chat-stream');
  if (stream) {
    stream.scrollTop = stream.scrollHeight;
  }
}

function renderSettings(next?: DesktopSnapshot): void {
  const currentSnapshot = next ?? snapshot;
  const { settingsPortal } = ensureHosts();

  if (!settingsState.isOpen || !currentSnapshot?.settings) {
    settingsPortal.innerHTML = '';
    settingsWasOpen = false;
    return;
  }

  const isFirstOpening = !settingsWasOpen;
  settingsWasOpen = true;

  const modalHtml = renderSettingsModal(
    currentSnapshot.settings,
    settingsState,
    undefined,
    currentSnapshot.mcpServers,
  );
  settingsPortal.innerHTML = modalHtml;

  const backdrop = settingsPortal.querySelector<HTMLElement>('#settings-backdrop');
  if (backdrop && isFirstOpening) {
    backdrop.classList.add('opening-animate');
    setTimeout(() => {
      backdrop.classList.remove('opening-animate');
    }, 250);
  }
}

function render(next: DesktopSnapshot): void {
  snapshot = next;
  renderShell(next);
  renderSettings(next);
}

function feedback(message: string): void {
  const element = document.querySelector<HTMLElement>('#desktop-feedback');
  if (element) {
    element.textContent = message;
  }
}

async function apply(action: () => Promise<DesktopSnapshot>, successMessage?: string): Promise<void> {
  try {
    const next = await action();
    render(next);
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
  if (target.id === 'settings-backdrop') {
    settingsState = {
      ...settingsState,
      isOpen: false,
      isAddServiceOpen: false,
      editingServiceId: null,
      testFeedback: null,
      isAddMcpOpen: false,
      editingMcpId: null,
      isTestingMcp: false,
      mcpTestFeedback: null,
      toast: null,
    };
    renderSettings();
    return;
  }
  if (target.classList.contains('secondary-modal-backdrop')) {
    settingsState = {
      ...settingsState,
      isAddServiceOpen: false,
      editingServiceId: null,
      testFeedback: null,
      isAddMcpOpen: false,
      editingMcpId: null,
      isTestingMcp: false,
      mcpTestFeedback: null,
    };
    renderSettings();
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
      case 'create-ephemeral-chat':
        void apply(() => window.agentDesktop.createSession(), '已开启新临时会话');
        return;
      case 'switch-session':
        if (button.dataset.sessionId) {
          void apply(() => window.agentDesktop.switchSession(button.dataset.sessionId!), '已切换会话');
        }
        return;
      case 'toggle-pin-session':
        if (button.dataset.sessionId) {
          void apply(() => window.agentDesktop.togglePinSession(button.dataset.sessionId!), '已更新置顶状态');
        }
        return;
      case 'rename-session': {
        const sessionId = button.dataset.sessionId;
        if (sessionId) {
          const sessionItem = button.closest<HTMLElement>('.session-item');
          const titleEl = sessionItem?.querySelector<HTMLElement>('.session-title');
          if (titleEl && !titleEl.querySelector('input')) {
            const currentTitle = titleEl.textContent?.trim() ?? '';
            titleEl.innerHTML = `<input type="text" class="session-rename-input" value="${currentTitle.replace(/"/g, '&quot;')}" />`;
            const inputEl = titleEl.querySelector<HTMLInputElement>('.session-rename-input');
            if (inputEl) {
              inputEl.focus();
              inputEl.select();
              let committed = false;
              const commit = () => {
                if (committed) return;
                committed = true;
                const newTitle = inputEl.value.trim();
                if (newTitle && newTitle !== currentTitle) {
                  void apply(() => window.agentDesktop.renameSession(sessionId, newTitle), '会话已重命名');
                } else {
                  titleEl.textContent = currentTitle;
                }
              };
              inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  committed = true;
                  titleEl.textContent = currentTitle;
                }
              });
              inputEl.addEventListener('blur', () => {
                commit();
              });
              inputEl.addEventListener('click', (e) => {
                e.stopPropagation();
              });
            }
          }
        }
        return;
      }
      case 'delete-session':
        if (button.dataset.sessionId) {
          void apply(() => window.agentDesktop.deleteSession(button.dataset.sessionId!), '会话已删除');
        }
        return;
      case 'prompt-create-project': {
        void (async () => {
          const folder = await window.agentDesktop.promptSelectFolder();
          if (folder) {
            const cleanPath = folder.replace(/[\\/]+$/, '');
            const folderName = cleanPath.split(/[\\/]/).pop() || '新项目';
            void apply(
              () => window.agentDesktop.createProject(folderName, folder),
              `已创建项目【${folderName}】并开启新会话`,
            );
          }
        })();
        return;
      }
      case 'create-project-chat':
        if (button.dataset.projectId) {
          void apply(() => window.agentDesktop.createSession({ projectId: button.dataset.projectId }), '已在项目中创建新会话');
        }
        return;
      case 'delete-project':
        if (button.dataset.projectId) {
          void apply(() => window.agentDesktop.deleteProject(button.dataset.projectId!), '项目已移除');
        }
        return;
      case 'toggle-project-expanded':
        if (button.dataset.projectId) {
          void apply(() => window.agentDesktop.toggleProjectExpanded(button.dataset.projectId!));
        }
        return;
      case 'open-file-picker': {
        const picker = document.querySelector<HTMLInputElement>('#composer-file-picker');
        picker?.click();
        return;
      }
      case 'remove-attachment': {
        const id = button.dataset.attachmentId;
        if (id) {
          void apply(() => window.agentDesktop.removeAttachment(id), '已移除附件');
        }
        return;
      }
      case 'toggle-context-panel': {
        const popover = document.querySelector<HTMLElement>('#context-popover');
        if (popover) {
          popover.style.display = popover.style.display === 'none' ? 'block' : 'none';
        }
        return;
      }
      case 'compact-context':
        void apply(() => window.agentDesktop.compactContext(), '已触发上下文压缩提炼');
        return;
      case 'send-message':
      case 'submit-plan': {
        const input = snapshot?.home.taskInput?.trim() ?? '';
        const attachments = snapshot?.home.attachments ?? [];
        if (input || attachments.length > 0) {
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
      case 'open-settings': {
        settingsState = { ...settingsState, isOpen: true, testFeedback: null, toast: null };
        renderSettings();
        return;
      }
      case 'close-settings': {
        settingsState = {
          ...settingsState,
          isOpen: false,
          isAddServiceOpen: false,
          editingServiceId: null,
          testFeedback: null,
          isAddMcpOpen: false,
          editingMcpId: null,
          isTestingMcp: false,
          mcpTestFeedback: null,
          toast: null,
        };
        renderSettings();
        return;
      }
      case 'switch-settings-tab': {
        const tab = button.dataset.tab as SettingsTabId;
        if (tab) {
          settingsState = { ...settingsState, activeTab: tab };
          renderSettings();
        }
        return;
      }
      case 'open-add-service': {
        settingsState = { ...settingsState, isAddServiceOpen: true, isAddThirdParty: false, initialPresetId: 'deepseek', editingServiceId: null, testFeedback: null };
        renderSettings();
        return;
      }
      case 'open-add-thirdparty': {
        settingsState = { ...settingsState, isAddServiceOpen: true, isAddThirdParty: true, initialPresetId: 'custom-relay', editingServiceId: null, testFeedback: null };
        renderSettings();
        return;
      }
      case 'close-add-service': {
        settingsState = { ...settingsState, isAddServiceOpen: false, isAddThirdParty: false, editingServiceId: null, testFeedback: null };
        renderSettings();
        return;
      }
      case 'edit-service': {
        const serviceId = button.dataset.serviceId;
        if (serviceId) {
          settingsState = { ...settingsState, isAddServiceOpen: true, isAddThirdParty: false, editingServiceId: serviceId, testFeedback: null };
          renderSettings();
        }
        return;
      }
      case 'set-active-service': {
        const serviceId = button.dataset.serviceId;
        if (serviceId) {
          const targetService = snapshot?.settings?.services.find((s) => s.id === serviceId);
          const sName = targetService?.name ?? serviceId;
          void apply(
            () => window.agentDesktop.saveSettings({ activeServiceId: serviceId }),
            `已切换生效服务为【${sName}】`,
          ).then(() => {
            setSettingsToast(`已切换至【${sName}】，底层连接已即时热重载！`, 'success');
          });
        }
        return;
      }
      case 'delete-service': {
        const serviceId = button.dataset.serviceId;
        if (serviceId && snapshot?.settings) {
          const targetService = snapshot.settings.services.find((s) => s.id === serviceId);
          const sName = targetService?.name ?? serviceId;
          const remaining = snapshot.settings.services.filter((s) => s.id !== serviceId);
          let nextActive = snapshot.settings.activeServiceId;
          if (nextActive === serviceId) {
            nextActive = remaining[0]?.id ?? '';
          }
          void apply(
            () => window.agentDesktop.saveSettings({ services: remaining, activeServiceId: nextActive }),
            `已删除服务【${sName}】`,
          ).then(() => {
            setSettingsToast(`已删除服务【${sName}】`, 'success');
          });
        }
        return;
      }
      case 'test-service': {
        const serviceId = button.dataset.serviceId;
        if (serviceId && snapshot?.settings) {
          const service = snapshot.settings.services.find((s) => s.id === serviceId);
          if (service) {
            settingsState = { ...settingsState, isTesting: true, testFeedback: { serviceId } };
            renderSettings();
            void (async () => {
              try {
                const res = await window.agentDesktop.testModelConnection(service);
                settingsState = {
                  ...settingsState,
                  isTesting: false,
                  testFeedback: { serviceId, success: res.success, latencyMs: res.latencyMs, error: res.error },
                };
                renderSettings();
                if (res.success) {
                  setSettingsToast(`【${service.name}】探活成功！真实延迟: ${res.latencyMs}ms`, 'success');
                } else {
                  setSettingsToast(`【${service.name}】探活失败: ${res.error || '连接异常'}`, 'error');
                }
              } catch (e: unknown) {
                const err = e instanceof Error ? e.message : String(e);
                settingsState = {
                  ...settingsState,
                  isTesting: false,
                  testFeedback: { serviceId, success: false, error: err },
                };
                renderSettings();
                setSettingsToast(`探活异常: ${err}`, 'error');
              }
            })();
          }
        }
        return;
      }
      case 'apply-provider-preset': {
        const presetId = button.dataset.presetId;
        const preset = RECOMMENDED_PROVIDER_PRESETS.find((p) => p.id === presetId);
        if (preset) {
          const nameEl = document.querySelector<HTMLInputElement>('#form-service-name');
          const typeEl = document.querySelector<HTMLSelectElement>('#form-service-type');
          const baseEl = document.querySelector<HTMLInputElement>('#form-service-base-url');
          const modelEl = document.querySelector<HTMLInputElement>('#form-service-model');
          const reasoningEl = document.querySelector<HTMLSelectElement>('#form-service-reasoning');
          if (nameEl) nameEl.value = preset.category === 'thirdparty' ? preset.name : `${preset.name} (官方)`;
          if (typeEl) typeEl.value = preset.providerType;
          if (baseEl) baseEl.value = preset.defaultBaseURL;
          if (modelEl) modelEl.value = preset.defaultModel;
          if (reasoningEl) reasoningEl.value = preset.defaultReasoning;
        }
        return;
      }
      case 'toggle-key-visibility': {
        const keyInput = document.querySelector<HTMLInputElement>('#form-service-api-key');
        if (keyInput) {
          keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
        }
        return;
      }
      case 'test-form-service': {
        const baseUrl = document.querySelector<HTMLInputElement>('#form-service-base-url')?.value.trim() ?? '';
        const apiKey = document.querySelector<HTMLInputElement>('#form-service-api-key')?.value.trim() ?? '';
        const modelName = document.querySelector<HTMLInputElement>('#form-service-model')?.value.trim() ?? '';
        settingsState = { ...settingsState, isTesting: true, testFeedback: null };
        renderSettings();
        void (async () => {
          try {
            const res = await window.agentDesktop.testModelConnection({ baseURL: baseUrl, apiKey, modelName });
            settingsState = {
              ...settingsState,
              isTesting: false,
              testFeedback: { success: res.success, latencyMs: res.latencyMs, error: res.error },
            };
            renderSettings();
            if (res.success) {
              setSettingsToast(`端点探活成功！真实延迟: ${res.latencyMs}ms`, 'success');
            } else {
              setSettingsToast(`端点探活失败: ${res.error || '连接异常'}`, 'error');
            }
          } catch (e: unknown) {
            const err = e instanceof Error ? e.message : String(e);
            settingsState = {
              ...settingsState,
              isTesting: false,
              testFeedback: { success: false, error: err },
            };
            renderSettings();
            setSettingsToast(`探活异常: ${err}`, 'error');
          }
        })();
        return;
      }
      case 'submit-service-form': {
        const id = document.querySelector<HTMLInputElement>('#form-service-id')?.value || `service-${Date.now()}`;
        const name = document.querySelector<HTMLInputElement>('#form-service-name')?.value.trim() || '新服务';
        const providerType = (document.querySelector<HTMLSelectElement>('#form-service-type')?.value as any) || 'openai';
        const baseURL = document.querySelector<HTMLInputElement>('#form-service-base-url')?.value.trim() || 'https://api.deepseek.com';
        const modelName = document.querySelector<HTMLInputElement>('#form-service-model')?.value.trim() || 'deepseek-v4-pro';
        const apiKey = document.querySelector<HTMLInputElement>('#form-service-api-key')?.value.trim() ?? '';
        const reasoningEffort = (document.querySelector<HTMLSelectElement>('#form-service-reasoning')?.value as any) || 'medium';

        const newService: ModelServiceConfig = {
          id,
          name,
          providerType,
          baseURL,
          modelName,
          apiKey,
          reasoningEffort,
        };

        const currentServices = snapshot?.settings?.services ?? [];
        const idx = currentServices.findIndex((s) => s.id === id);
        let updatedList: ModelServiceConfig[];
        if (idx >= 0) {
          updatedList = [...currentServices];
          updatedList[idx] = newService;
        } else {
          updatedList = [...currentServices, newService];
        }

        void apply(
          () => window.agentDesktop.saveSettings({ services: updatedList, activeServiceId: id }),
          '已保存服务配置并设为当前生效',
        ).then(() => {
          setSettingsToast(`已保存【${name}】并设为当前生效！大模型连接已即时热重载`, 'success');
        });
        settingsState = { ...settingsState, isAddServiceOpen: false, isAddThirdParty: false, editingServiceId: null, testFeedback: null };
        renderSettings();
        return;
      }
      case 'save-general-settings': {
        const lang = document.querySelector<HTMLSelectElement>('#setting-language')?.value || 'zh-CN';
        const rounds = Number(document.querySelector<HTMLInputElement>('#setting-history-rounds')?.value || 20);
        void apply(
          () => window.agentDesktop.saveSettings({ language: lang, maxHistoryRounds: rounds }),
          '日常设置已保存',
        ).then(() => {
          setSettingsToast('日常设置已保存！', 'success');
        });
        return;
      }
      case 'save-permission-settings': {
        const selectedPolicy = (document.querySelector<HTMLInputElement>('input[name="permissionPolicy"]:checked')?.value as any) || 'auto';
        const psChecked = Boolean(document.querySelector<HTMLInputElement>('#setting-powershell')?.checked);
        void apply(
          () => window.agentDesktop.saveSettings({ permissionPolicy: selectedPolicy, enablePowershellExecution: psChecked }),
          '全局权限策略已保存并生效',
        ).then(() => {
          setSettingsToast(`全局权限策略已更新为【${selectedPolicy}】，终端命令执行已${psChecked ? '开启' : '关闭'}！`, 'success');
        });
        return;
      }
      case 'open-config-folder': {
        void window.agentDesktop.openConfigDir();
        feedback('已在文件管理器中定位配置目录');
        return;
      }
      case 'open-add-mcp': {
        settingsState = {
          ...settingsState,
          isAddMcpOpen: true,
          editingMcpId: null,
          isTestingMcp: false,
          mcpTestFeedback: null,
        };
        renderSettings();
        return;
      }
      case 'close-add-mcp': {
        settingsState = {
          ...settingsState,
          isAddMcpOpen: false,
          editingMcpId: null,
          isTestingMcp: false,
          mcpTestFeedback: null,
        };
        renderSettings();
        return;
      }
      case 'apply-mcp-preset': {
        const presetId = button.dataset.presetId;
        const preset = RECOMMENDED_MCP_PRESETS.find((p) => p.id === presetId);
        if (preset) {
          const idEl = document.querySelector<HTMLInputElement>('#form-mcp-id');
          const cmdEl = document.querySelector<HTMLInputElement>('#form-mcp-command');
          const argsEl = document.querySelector<HTMLInputElement>('#form-mcp-args');
          const autoApproveEl = document.querySelector<HTMLInputElement>('#form-mcp-auto-approve');
          if (idEl && !settingsState.editingMcpId) idEl.value = preset.id;
          if (cmdEl) cmdEl.value = preset.defaultCommand;
          if (argsEl) argsEl.value = preset.defaultArgs;
          if (autoApproveEl) autoApproveEl.value = preset.defaultAutoApprove;
        }
        return;
      }
      case 'edit-mcp-server': {
        const serverId = button.dataset.serverId;
        if (serverId) {
          settingsState = {
            ...settingsState,
            isAddMcpOpen: true,
            editingMcpId: serverId,
            isTestingMcp: false,
            mcpTestFeedback: null,
          };
          renderSettings();
        }
        return;
      }
      case 'delete-mcp-server': {
        const serverId = button.dataset.serverId;
        if (serverId) {
          void apply(
            () => window.agentDesktop.deleteMcpServer(serverId),
            `已移除 MCP 服务【${serverId}】`,
          ).then(() => {
            setSettingsToast(`已成功移除 MCP 服务【${serverId}】`, 'success');
          });
        }
        return;
      }
      case 'toggle-mcp-server': {
        const serverId = button.dataset.serverId;
        if (serverId && snapshot?.settings?.mcpServers) {
          const existing = snapshot.settings.mcpServers[serverId];
          if (existing) {
            const nextDisabled = !existing.disabled;
            const updatedConfig = { ...existing, disabled: nextDisabled };
            void apply(
              () => window.agentDesktop.saveMcpServer(serverId, updatedConfig),
              nextDisabled ? `已禁用 MCP 服务【${serverId}】` : `已启用 MCP 服务【${serverId}】`,
            ).then(() => {
              setSettingsToast(`MCP 服务【${serverId}】已${nextDisabled ? '禁用' : '启用并热重载'}`, 'success');
            });
          }
        }
        return;
      }
      case 'test-mcp-server': {
        const serverId = button.dataset.serverId;
        if (serverId && snapshot?.settings?.mcpServers) {
          const cfg = snapshot.settings.mcpServers[serverId];
          if (cfg) {
            settingsState = {
              ...settingsState,
              isTestingMcp: true,
              mcpTestFeedback: { serverId, success: false, latencyMs: 0, toolCount: 0 },
            };
            renderSettings();
            void (async () => {
              try {
                const res = await window.agentDesktop.testMcpConnection(cfg, serverId);
                settingsState = {
                  ...settingsState,
                  isTestingMcp: false,
                  mcpTestFeedback: {
                    serverId,
                    success: res.success,
                    latencyMs: res.latencyMs,
                    toolCount: res.toolCount,
                    ...(res.error ? { error: res.error } : {}),
                  },
                };
                renderSettings();
                if (res.success) {
                  setSettingsToast(`【${serverId}】探活成功！已挂载 ${res.toolCount} 个工具 (延迟 ${res.latencyMs}ms)`, 'success');
                } else {
                  setSettingsToast(`【${serverId}】探活失败: ${res.error || '通信或进程异常'}`, 'error');
                }
              } catch (e: unknown) {
                const err = e instanceof Error ? e.message : String(e);
                settingsState = {
                  ...settingsState,
                  isTestingMcp: false,
                  mcpTestFeedback: { serverId, success: false, latencyMs: 0, toolCount: 0, error: err },
                };
                renderSettings();
                setSettingsToast(`探活异常: ${err}`, 'error');
              }
            })();
          }
        }
        return;
      }
      case 'test-form-mcp': {
        const command = document.querySelector<HTMLInputElement>('#form-mcp-command')?.value.trim() ?? '';
        const argsStr = document.querySelector<HTMLInputElement>('#form-mcp-args')?.value.trim() ?? '';
        const cwd = document.querySelector<HTMLInputElement>('#form-mcp-cwd')?.value.trim() || undefined;
        const serverId = document.querySelector<HTMLInputElement>('#form-mcp-id')?.value.trim() || 'test-server';

        if (!command) {
          setSettingsToast('请先填写执行命令 (Command)', 'error');
          return;
        }

        const args = argsStr ? argsStr.split(/\s+/).filter(Boolean) : [];
        const tempConfig: McpServerConfig = {
          command,
          ...(args.length > 0 ? { args } : {}),
          ...(cwd ? { cwd } : {}),
        };

        settingsState = {
          ...settingsState,
          isTestingMcp: true,
          mcpTestFeedback: null,
        };
        renderSettings();
        void (async () => {
          try {
            const res = await window.agentDesktop.testMcpConnection(tempConfig, serverId);
            settingsState = {
              ...settingsState,
              isTestingMcp: false,
              mcpTestFeedback: {
                serverId,
                success: res.success,
                latencyMs: res.latencyMs,
                toolCount: res.toolCount,
                ...(res.error ? { error: res.error } : {}),
              },
            };
            renderSettings();
            if (res.success) {
              setSettingsToast(`探活成功！握手正常并发现 ${res.toolCount} 个工具 (延迟 ${res.latencyMs}ms)`, 'success');
            } else {
              setSettingsToast(`探活失败: ${res.error || '进程启动或握手异常'}`, 'error');
            }
          } catch (e: unknown) {
            const err = e instanceof Error ? e.message : String(e);
            settingsState = {
              ...settingsState,
              isTestingMcp: false,
              mcpTestFeedback: { serverId, success: false, latencyMs: 0, toolCount: 0, error: err },
            };
            renderSettings();
            setSettingsToast(`探活异常: ${err}`, 'error');
          }
        })();
        return;
      }
      case 'submit-mcp-form': {
        const id = document.querySelector<HTMLInputElement>('#form-mcp-id')?.value.trim() || '';
        const command = document.querySelector<HTMLInputElement>('#form-mcp-command')?.value.trim() || '';
        const argsStr = document.querySelector<HTMLInputElement>('#form-mcp-args')?.value.trim() ?? '';
        const cwd = document.querySelector<HTMLInputElement>('#form-mcp-cwd')?.value.trim() || undefined;
        const autoApproveStr = document.querySelector<HTMLInputElement>('#form-mcp-auto-approve')?.value.trim() ?? '';
        const disabled = Boolean(document.querySelector<HTMLInputElement>('#form-mcp-disabled')?.checked);

        if (!id) {
          setSettingsToast('请填写服务标识 ID', 'error');
          return;
        }
        if (!command) {
          setSettingsToast('请填写执行命令 (Command)', 'error');
          return;
        }

        const args = argsStr ? argsStr.split(/\s+/).filter(Boolean) : [];
        const autoApprove = autoApproveStr
          ? autoApproveStr.split(',').map((s) => s.trim()).filter(Boolean)
          : [];

        const mcpConfig: McpServerConfig = {
          command,
          ...(args.length > 0 ? { args } : {}),
          ...(cwd ? { cwd } : {}),
          ...(autoApprove.length > 0 ? { autoApprove } : {}),
          disabled,
        };

        void apply(
          () => window.agentDesktop.saveMcpServer(id, mcpConfig),
          `已保存 MCP 服务【${id}】`,
        ).then(() => {
          setSettingsToast(`已保存 MCP 服务【${id}】！子进程与工具已热加载`, 'success');
        });

        settingsState = {
          ...settingsState,
          isAddMcpOpen: false,
          editingMcpId: null,
          isTestingMcp: false,
          mcpTestFeedback: null,
        };
        renderSettings();
        return;
      }
      case 'reload-mcp-servers': {
        void apply(
          () => window.agentDesktop.reloadMcpServers(),
          '正在重新载入全部 MCP 服务…',
        ).then(() => {
          setSettingsToast('已完成全部 MCP 服务的热重载与工具注册！', 'success');
        });
        return;
      }
      default:
        break;
    }
  }

  const toggleProjectEl = target.closest<HTMLElement>('[data-action="toggle-project-expanded"]');
  if (toggleProjectEl && !button) {
    const projectId = toggleProjectEl.dataset.projectId;
    if (projectId) {
      void apply(() => window.agentDesktop.toggleProjectExpanded(projectId));
      return;
    }
  }

  const sessionItem = target.closest<HTMLElement>('.session-item');
  if (sessionItem && !button && sessionItem.dataset.sessionId) {
    if (target.closest('.session-rename-input')) {
      return;
    }
    void apply(() => window.agentDesktop.switchSession(sessionItem.dataset.sessionId!), '已切换会话');
    return;
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
      const selectedServiceId = target.value;
      if (selectedServiceId && snapshot?.settings?.services.some((s) => s.id === selectedServiceId)) {
        const sName = snapshot.settings.services.find((s) => s.id === selectedServiceId)?.name ?? selectedServiceId;
        void apply(
          () => window.agentDesktop.saveSettings({ activeServiceId: selectedServiceId }),
          `已切换生效服务为【${sName}】`,
        );
      } else {
        void apply(() => window.agentDesktop.setModelMode(target.value as 'live'));
      }
    } else if (target.dataset.action === 'set-permission-mode') {
      void apply(
        () => window.agentDesktop.setPermissionMode(target.value as any),
        `权限模式已切换为【${target.selectedOptions[0]?.text?.trim() ?? target.value}】`,
      );
    } else if (target.dataset.action === 'set-reasoning-effort') {
      void apply(
        () => window.agentDesktop.setReasoningEffort(target.value as any),
        `模型推理强度已切换为【${target.selectedOptions[0]?.text?.trim() ?? target.value}】`,
      );
    }
  } else if (target instanceof HTMLInputElement && target.id === 'composer-file-picker') {
    if (target.files && target.files.length > 0) {
      for (let i = 0; i < target.files.length; i++) {
        const file = target.files[i];
        if (!file) continue;
        void apply(
          () =>
            window.agentDesktop.addAttachment({
              id: crypto.randomUUID(),
              name: file.name,
              size: file.size,
              type: file.type || 'text/plain',
              path: (file as any).path,
            }),
          `已添加附件：${file.name}`,
        );
      }
      target.value = '';
    }
  }
});

root.addEventListener('dragover', (event) => {
  const card = (event.target as Element)?.closest('.main-prompt-card');
  if (card) {
    event.preventDefault();
    card.classList.add('drag-over');
  }
});

root.addEventListener('dragleave', (event) => {
  const card = (event.target as Element)?.closest('.main-prompt-card');
  if (card) {
    card.classList.remove('drag-over');
  }
});

root.addEventListener('drop', (event) => {
  const card = (event.target as Element)?.closest('.main-prompt-card');
  if (card) {
    event.preventDefault();
    card.classList.remove('drag-over');
    if (event.dataTransfer?.files?.length) {
      for (let i = 0; i < event.dataTransfer.files.length; i++) {
        const file = event.dataTransfer.files[i];
        if (!file) continue;
        void apply(
          () =>
            window.agentDesktop.addAttachment({
              id: crypto.randomUUID(),
              name: file.name,
              size: file.size,
              type: file.type || 'text/plain',
              path: (file as any).path,
            }),
          `已拖入附件：${file.name}`,
        );
      }
    }
  }
});

root.addEventListener('paste', (event) => {
  if (event.target instanceof HTMLTextAreaElement && event.target.id === 'task-input') {
    if (event.clipboardData?.files?.length) {
      event.preventDefault();
      for (let i = 0; i < event.clipboardData.files.length; i++) {
        const file = event.clipboardData.files[i];
        if (!file) continue;
        void apply(
          () =>
            window.agentDesktop.addAttachment({
              id: crypto.randomUUID(),
              name: file.name,
              size: file.size,
              type: file.type || 'text/plain',
              path: (file as any).path,
            }),
          `已粘贴附件：${file.name}`,
        );
      }
    }
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (settingsState.isAddMcpOpen) {
      settingsState = { ...settingsState, isAddMcpOpen: false, editingMcpId: null, isTestingMcp: false, mcpTestFeedback: null };
      renderSettings();
    } else if (settingsState.isAddServiceOpen) {
      settingsState = { ...settingsState, isAddServiceOpen: false, isAddThirdParty: false, editingServiceId: null, testFeedback: null };
      renderSettings();
    } else if (settingsState.isOpen) {
      settingsState = { ...settingsState, isOpen: false, testFeedback: null, toast: null };
      renderSettings();
    }
  }
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
