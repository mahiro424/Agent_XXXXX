import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DesktopSession } from './session.js';
import type { DesktopApprovalDecision, DesktopSnapshot } from './session.js';
import type { AppRoute, ShellModelMode } from '../ui/app-shell.js';

let mainWindow: BrowserWindow | undefined;
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
  return value === 'fake' || value === 'live';
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
  ipcMain.handle('desktop:stop-task', () => {
    const snapshot = requireSession().stopTask();
    sendState();
    return snapshot;
  });
}

function createMainWindow(): BrowserWindow {
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
