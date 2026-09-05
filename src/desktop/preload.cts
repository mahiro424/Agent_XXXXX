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
  selectWorkspace: () => ipcRenderer.invoke('desktop:select-workspace') as Promise<DesktopSnapshot>,
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
  submitPlan: () => ipcRenderer.invoke('desktop:submit-plan') as Promise<DesktopSnapshot>,
  respondApproval: (decision: DesktopApprovalDecision) =>
    ipcRenderer.invoke('desktop:respond-approval', decision) as Promise<DesktopSnapshot>,
  stopTask: () => ipcRenderer.invoke('desktop:stop-task') as Promise<DesktopSnapshot>,
};

contextBridge.exposeInMainWorld('agentDesktop', api);
