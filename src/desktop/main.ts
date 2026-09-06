import electronPkg from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = electronPkg;
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DesktopSession } from './session.js';
import type { DesktopApprovalDecision, DesktopSnapshot } from './session.js';
import type { AppRoute, ShellModelMode } from '../ui/app-shell.js';
import type { FilePermissionMode } from '../ui/demo-home.js';

let mainWindow: BrowserWindowType | undefined;
let desktopSession: DesktopSession | undefined;

function requireSession(): DesktopSession {
  if (desktopSession === undefined) {
    throw new Error('desktop session is not ready');
  }
  return desktopSession;
}

function requireSnapshot(): DesktopSnapshot {
  return requireSession().snapshot();
}

function isModelMode(value: unknown): value is ShellModelMode {
  return value === 'live';
}

function isPermissionMode(value: unknown): value is FilePermissionMode {
  return (
    value === 'full-access' ||
    value === 'auto' ||
    value === 'accept-edits' ||
    value === 'risk-gated' ||
    value === 'ask-approval' ||
    value === 'read-only'
  );
}

function isReasoningEffort(value: unknown): value is 'max' | 'high' | 'medium' | 'low' | 'off' {
  return (
    value === 'max' ||
    value === 'high' ||
    value === 'medium' ||
    value === 'low' ||
    value === 'off'
  );
}

function isAppRoute(value: unknown): value is AppRoute {
  return (
    value === 'demo-home' ||
    value === 'cases' ||
    value === 'scheduled-tasks' ||
    value === 'skills' ||
    value === 'connectors' ||
    value === 'workspace-session' ||
    value === 'task-plan'
  );
}

function isApprovalDecision(value: unknown): value is DesktopApprovalDecision {
  return value === 'approved' || value === 'rejected';
}

function sendState(): void {
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('desktop:state-changed', requireSnapshot());
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('desktop:get-snapshot', () => requireSnapshot());
  ipcMain.handle('desktop:select-workspace', async () => {
    if (mainWindow === undefined) {
      throw new Error('desktop window is not ready');
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择本地工作区',
      properties: ['openDirectory', 'createDirectory'],
    });
    const workspaceRoot = result.filePaths[0];
    if (result.canceled || workspaceRoot === undefined) {
      return requireSnapshot();
    }
    const snapshot = requireSession().selectWorkspace(workspaceRoot);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:set-task-input', (_event, input: unknown) => {
    if (typeof input !== 'string') {
      throw new TypeError('task input must be a string');
    }
    const snapshot = requireSession().setTaskInput(input);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:choose-quick-task', (_event, task: unknown) => {
    if (typeof task !== 'string') {
      throw new TypeError('quick task must be a string');
    }
    const snapshot = requireSession().chooseQuickTask(task);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:navigate', (_event, route: unknown) => {
    if (!isAppRoute(route)) {
      throw new TypeError('unsupported app route');
    }
    const snapshot = requireSession().navigate(route);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:set-model-mode', (_event, mode: unknown) => {
    if (!isModelMode(mode)) {
      throw new TypeError('unsupported model mode');
    }
    const snapshot = requireSession().setModelMode(mode);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:set-permission-mode', (_event, mode: unknown) => {
    if (!isPermissionMode(mode)) {
      throw new TypeError('unsupported permission mode');
    }
    const snapshot = requireSession().setPermissionMode(mode);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:submit-plan', () => {
    const snapshot = requireSession().submitPlan();
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:respond-approval', (_event, decision: unknown) => {
    if (!isApprovalDecision(decision)) {
      throw new TypeError('unsupported approval decision');
    }
    const snapshot = requireSession().respondApproval(decision);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:set-skill', async (_event, skillId: unknown) => {
    if (typeof skillId !== 'string') {
      throw new TypeError('skillId must be a string');
    }
    const snapshot = await requireSession().setSkill(skillId);
    sendState();
    return snapshot;
  });
  ipcMain.handle(
    'desktop:send-message',
    async (_event, input: unknown, options?: { skillId?: string }) => {
      if (typeof input !== 'string') {
        throw new TypeError('message input must be a string');
      }
      const snapshot = await requireSession().sendMessage(input, options);
      sendState();
      return snapshot;
    },
  );
  ipcMain.handle('desktop:stop-task', () => {
    const snapshot = requireSession().stopTask();
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:add-attachment', (_event, item: unknown) => {
    if (typeof item !== 'object' || item === null) {
      throw new TypeError('attachment must be an object');
    }
    const snapshot = requireSession().addAttachment(item as any);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:remove-attachment', (_event, id: unknown) => {
    if (typeof id !== 'string') {
      throw new TypeError('attachment id must be a string');
    }
    const snapshot = requireSession().removeAttachment(id);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:clear-attachments', () => {
    const snapshot = requireSession().clearAttachments();
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:set-reasoning-effort', (_event, effort: unknown) => {
    if (!isReasoningEffort(effort)) {
      throw new TypeError('unsupported reasoning effort');
    }
    const snapshot = requireSession().setReasoningEffort(effort);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:compact-context', async () => {
    const snapshot = await requireSession().compactContext();
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:create-session', async (_event, options?: { projectId?: string; title?: string }) => {
    const snapshot = await requireSession().createSession(options);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:switch-session', async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') {
      throw new TypeError('sessionId must be a string');
    }
    const snapshot = await requireSession().switchSession(sessionId);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:toggle-pin-session', async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') {
      throw new TypeError('sessionId must be a string');
    }
    const snapshot = await requireSession().togglePinSession(sessionId);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:rename-session', async (_event, sessionId: unknown, newTitle: unknown) => {
    if (typeof sessionId !== 'string' || typeof newTitle !== 'string') {
      throw new TypeError('invalid arguments for rename-session');
    }
    const snapshot = await requireSession().renameSession(sessionId, newTitle);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:delete-session', async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') {
      throw new TypeError('sessionId must be a string');
    }
    const snapshot = await requireSession().deleteSession(sessionId);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:create-project', async (_event, name: unknown, folderPath: unknown) => {
    if (typeof name !== 'string' || typeof folderPath !== 'string') {
      throw new TypeError('invalid arguments for create-project');
    }
    const snapshot = await requireSession().createProject(name, folderPath);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:delete-project', async (_event, projectId: unknown) => {
    if (typeof projectId !== 'string') {
      throw new TypeError('projectId must be a string');
    }
    const snapshot = await requireSession().deleteProject(projectId);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:toggle-project-expanded', async (_event, projectId: unknown) => {
    if (typeof projectId !== 'string') {
      throw new TypeError('projectId must be a string');
    }
    const snapshot = await requireSession().toggleProjectExpanded(projectId);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:prompt-select-folder', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择项目工作区文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) {
      return undefined;
    }
    return result.filePaths[0];
  });
  ipcMain.handle('desktop:get-settings', () => {
    return requireSession().getSettings();
  });
  ipcMain.handle('desktop:save-settings', async (_event, patch: unknown) => {
    if (typeof patch !== 'object' || patch === null) {
      throw new TypeError('settings patch must be an object');
    }
    const snapshot = await requireSession().saveSettings(patch as any);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:test-model-connection', async (_event, service: unknown) => {
    if (typeof service !== 'object' || service === null) {
      throw new TypeError('service config must be an object');
    }
    const result = await requireSession().testModelConnection(service as any);
    sendState();
    return result;
  });
  ipcMain.handle('desktop:open-config-dir', async () => {
    const configPath = requireSession().getConfigFilePath();
    shell.showItemInFolder(configPath);
  });
  ipcMain.handle('desktop:test-mcp-connection', async (_event, config: unknown, serverId?: unknown) => {
    if (typeof config !== 'object' || config === null) {
      throw new TypeError('mcp config must be an object');
    }
    const sId = typeof serverId === 'string' ? serverId : 'test';
    return await requireSession().testMcpConnection(config as any, sId);
  });
  ipcMain.handle('desktop:save-mcp-server', async (_event, id: unknown, config: unknown) => {
    if (typeof id !== 'string' || typeof config !== 'object' || config === null) {
      throw new TypeError('invalid arguments for save-mcp-server');
    }
    const snapshot = await requireSession().saveMcpServer(id, config as any);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:delete-mcp-server', async (_event, id: unknown) => {
    if (typeof id !== 'string') {
      throw new TypeError('id must be a string');
    }
    const snapshot = await requireSession().deleteMcpServer(id);
    sendState();
    return snapshot;
  });
  ipcMain.handle('desktop:reload-mcp-servers', async () => {
    const snapshot = await requireSession().reloadMcpServers();
    sendState();
    return snapshot;
  });
}

function createMainWindow(): BrowserWindowType {
  const preloadPath = fileURLToPath(new URL('./preload.cjs', import.meta.url));
  const indexPath = fileURLToPath(new URL('./index.html', import.meta.url));
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#ffffff',
      symbolColor: '#0f172a',
      height: 44,
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[PRELOAD ERROR] ${preloadPath}:`, error);
  });
  window.webContents.on('console-message', (event) => {
    console.log(`[RENDERER] ${event.message}`);
  });
  window.on('closed', () => {
    mainWindow = undefined;
  });
  void window.loadFile(indexPath);
  return window;
}

async function startDesktop(): Promise<void> {
  await app.whenReady();
  Menu.setApplicationMenu(null);
  const eventLogPath = join(app.getPath('userData'), 'runtime-events.jsonl');
  desktopSession = new DesktopSession({ eventLogPath });
  registerIpcHandlers();
  mainWindow = createMainWindow();
  desktopSession.subscribe(sendState);
  app.on('activate', () => {
    if (mainWindow === undefined) {
      mainWindow = createMainWindow();
    }
  });
}

void startDesktop();

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
