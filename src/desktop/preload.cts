import { contextBridge, ipcRenderer } from 'electron';
import type {
  DesktopApi,
  DesktopApprovalDecision,
  DesktopSnapshot,
} from './session.js';
import type { AppRoute } from '../ui/app-shell.js';

const stateChangedChannel = 'desktop:state-changed';

const api: DesktopApi = {
  getSnapshot: () => ipcRenderer.invoke('desktop:get-snapshot') as Promise<DesktopSnapshot>,
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: DesktopSnapshot): void => {
      listener(snapshot);
    };
    ipcRenderer.on(stateChangedChannel, handler);
    return () => ipcRenderer.removeListener(stateChangedChannel, handler);
  },
  selectWorkspace: (workspaceRoot?: string) =>
    ipcRenderer.invoke('desktop:select-workspace', workspaceRoot) as Promise<DesktopSnapshot>,
  setTaskInput: (input) =>
    ipcRenderer.invoke('desktop:set-task-input', input) as Promise<DesktopSnapshot>,
  chooseQuickTask: (task) =>
    ipcRenderer.invoke('desktop:choose-quick-task', task) as Promise<DesktopSnapshot>,
  navigate: (route: AppRoute) =>
    ipcRenderer.invoke('desktop:navigate', route) as Promise<DesktopSnapshot>,
  setModelMode: (mode) =>
    ipcRenderer.invoke('desktop:set-model-mode', mode) as Promise<DesktopSnapshot>,
  setPermissionMode: (mode) =>
    ipcRenderer.invoke('desktop:set-permission-mode', mode) as Promise<DesktopSnapshot>,
  setSkill: (skillId: string) =>
    ipcRenderer.invoke('desktop:set-skill', skillId) as Promise<DesktopSnapshot>,
  sendMessage: (input: string, options?: { skillId?: string }) =>
    ipcRenderer.invoke('desktop:send-message', input, options) as Promise<DesktopSnapshot>,
  submitPlan: () => ipcRenderer.invoke('desktop:submit-plan') as Promise<DesktopSnapshot>,
  respondApproval: (decision: DesktopApprovalDecision) =>
    ipcRenderer.invoke('desktop:respond-approval', decision) as Promise<DesktopSnapshot>,
  stopTask: () => ipcRenderer.invoke('desktop:stop-task') as Promise<DesktopSnapshot>,
  addAttachment: (item) =>
    ipcRenderer.invoke('desktop:add-attachment', item) as Promise<DesktopSnapshot>,
  removeAttachment: (id) =>
    ipcRenderer.invoke('desktop:remove-attachment', id) as Promise<DesktopSnapshot>,
  clearAttachments: () =>
    ipcRenderer.invoke('desktop:clear-attachments') as Promise<DesktopSnapshot>,
  setReasoningEffort: (effort) =>
    ipcRenderer.invoke('desktop:set-reasoning-effort', effort) as Promise<DesktopSnapshot>,
  compactContext: () =>
    ipcRenderer.invoke('desktop:compact-context') as Promise<DesktopSnapshot>,
  createSession: (options) =>
    ipcRenderer.invoke('desktop:create-session', options) as Promise<DesktopSnapshot>,
  switchSession: (sessionId) =>
    ipcRenderer.invoke('desktop:switch-session', sessionId) as Promise<DesktopSnapshot>,
  togglePinSession: (sessionId) =>
    ipcRenderer.invoke('desktop:toggle-pin-session', sessionId) as Promise<DesktopSnapshot>,
  renameSession: (sessionId, newTitle) =>
    ipcRenderer.invoke('desktop:rename-session', sessionId, newTitle) as Promise<DesktopSnapshot>,
  deleteSession: (sessionId) =>
    ipcRenderer.invoke('desktop:delete-session', sessionId) as Promise<DesktopSnapshot>,
  createProject: (name, folderPath) =>
    ipcRenderer.invoke('desktop:create-project', name, folderPath) as Promise<DesktopSnapshot>,
  deleteProject: (projectId) =>
    ipcRenderer.invoke('desktop:delete-project', projectId) as Promise<DesktopSnapshot>,
  toggleProjectExpanded: (projectId) =>
    ipcRenderer.invoke('desktop:toggle-project-expanded', projectId) as Promise<DesktopSnapshot>,
  promptSelectFolder: () =>
    ipcRenderer.invoke('desktop:prompt-select-folder') as Promise<string | undefined>,
  getSettings: () => ipcRenderer.invoke('desktop:get-settings') as Promise<any>,
  saveSettings: (patch) =>
    ipcRenderer.invoke('desktop:save-settings', patch) as Promise<DesktopSnapshot>,
  testModelConnection: (service) =>
    ipcRenderer.invoke('desktop:test-model-connection', service) as Promise<any>,
  fetchAvailableModels: (service) =>
    ipcRenderer.invoke('desktop:fetch-models', service) as Promise<any>,
  openConfigDir: () => ipcRenderer.invoke('desktop:open-config-dir') as Promise<void>,
  testMcpConnection: (config, serverId) =>
    ipcRenderer.invoke('desktop:test-mcp-connection', config, serverId) as Promise<any>,
  saveMcpServer: (id, config) =>
    ipcRenderer.invoke('desktop:save-mcp-server', id, config) as Promise<DesktopSnapshot>,
  deleteMcpServer: (id) =>
    ipcRenderer.invoke('desktop:delete-mcp-server', id) as Promise<DesktopSnapshot>,
  reloadMcpServers: () =>
    ipcRenderer.invoke('desktop:reload-mcp-servers') as Promise<DesktopSnapshot>,
};

contextBridge.exposeInMainWorld('agentDesktop', api);

