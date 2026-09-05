import type { AppServerContract } from '../runtime/app-server.js';
import type { Thread, ThreadStatus, Turn, TurnStatus } from '../runtime/protocol.js';

export const APP_NAV_ITEMS = [
  { id: 'demo-home', label: '新会话' },
  { id: 'cases', label: '案例中心' },
  { id: 'scheduled-tasks', label: '定时任务' },
  { id: 'skills', label: '技能' },
  { id: 'connectors', label: '连接器' },
] as const;

export type AppRoute =
  | 'demo-home'
  | 'cases'
  | 'scheduled-tasks'
  | 'skills'
  | 'connectors'
  | 'workspace-session'
  | 'task-plan';

export type ShellReadiness = 'default' | 'empty' | 'disabled';
export type ShellModelMode = 'fake' | 'live';
export type ShellNetworkStatus = 'disabled' | 'enabled';

export interface AppShellView {
  readonly pageId: 'app-shell';
  readonly route: AppRoute;
  readonly readiness: ShellReadiness;
  readonly navItems: typeof APP_NAV_ITEMS;
  readonly workspaceRoot?: string;
  readonly threadId?: string;
  readonly turnId?: string;
  readonly threadStatus?: ThreadStatus;
  readonly turnStatus?: TurnStatus;
  readonly modelMode: ShellModelMode;
  readonly modelConnected: boolean;
  readonly sandboxReady: boolean;
  readonly network: ShellNetworkStatus;
  readonly minimizedToTray: boolean;
  readonly canStopTask: boolean;
  readonly disabledReason?: string;
}

export interface AppShellOptions {
  readonly server: AppServerContract;
  readonly modelMode?: ShellModelMode;
  readonly modelConnected?: boolean;
  readonly sandboxReady?: boolean;
  readonly network?: ShellNetworkStatus;
}

export class AppShellController {
  private readonly server: AppServerContract;
  private route: AppRoute = 'demo-home';
  private workspaceRoot: string | undefined;
  private activeThread: Thread | undefined;
  private activeTurn: Turn | undefined;
  private modelMode: ShellModelMode;
  private modelConnected: boolean;
  private sandboxReady: boolean;
  private network: ShellNetworkStatus;
  private minimizedToTray = false;

  public constructor(options: AppShellOptions) {
    this.server = options.server;
    this.modelMode = options.modelMode ?? 'fake';
    this.modelConnected = options.modelConnected ?? true;
    this.sandboxReady = options.sandboxReady ?? false;
    this.network = options.network ?? 'disabled';
  }

  public selectWorkspace(workspaceRoot: string): void {
    this.workspaceRoot = workspaceRoot;
    this.sandboxReady = true;
  }

  public setModelMode(mode: ShellModelMode): void {
    this.modelMode = mode;
  }

  public setModelConnected(connected: boolean): void {
    this.modelConnected = connected;
  }

  public setSandboxReady(ready: boolean): void {
    this.sandboxReady = ready;
  }

  public navigate(route: AppRoute): void {
    this.route = route;
  }

  public bindThread(thread: Thread, turn?: Turn): void {
    this.activeThread = thread;
    this.activeTurn = turn;
    if (thread.workspaceRoot !== undefined) {
      this.workspaceRoot = thread.workspaceRoot;
    }
  }

  public minimizeToTray(): void {
    this.minimizedToTray = true;
  }

  public restoreFromTray(): void {
    this.minimizedToTray = false;
  }

  public stopCurrentTask(): Thread | undefined {
    if (!this.activeThread) {
      return undefined;
    }
    if (this.activeThread.status === 'active' || this.activeThread.status === 'paused') {
      this.server.cancel(this.activeThread.id);
      this.activeThread = this.server.getThread(this.activeThread.id);
    }
    return this.activeThread;
  }

  public view(): AppShellView {
    const readiness = this.computeReadiness();
    const disabledReason = this.disabledReason(readiness);
    const base = {
      pageId: 'app-shell' as const,
      route: this.route,
      readiness,
      navItems: APP_NAV_ITEMS,
      modelMode: this.modelMode,
      modelConnected: this.modelConnected,
      sandboxReady: this.sandboxReady,
      network: this.network,
      minimizedToTray: this.minimizedToTray,
      canStopTask:
        this.activeThread?.status === 'active' || this.activeThread?.status === 'paused',
    };
    return {
      ...base,
      ...(this.workspaceRoot === undefined ? {} : { workspaceRoot: this.workspaceRoot }),
      ...(this.activeThread === undefined ? {} : { threadId: this.activeThread.id }),
      ...(this.activeTurn === undefined ? {} : { turnId: this.activeTurn.id }),
      ...(this.activeThread === undefined
        ? {}
        : { threadStatus: this.activeThread.status }),
      ...(this.activeTurn === undefined ? {} : { turnStatus: this.activeTurn.status }),
      ...(disabledReason === undefined ? {} : { disabledReason }),
    };
  }

  private computeReadiness(): ShellReadiness {
    if (this.workspaceRoot === undefined) {
      return 'empty';
    }
    if (!this.modelConnected || !this.sandboxReady) {
      return 'disabled';
    }
    return 'default';
  }

  private disabledReason(readiness: ShellReadiness): string | undefined {
    if (readiness === 'empty') {
      return '尚未选择本地工作区';
    }
    if (!this.modelConnected) {
      return '模型尚未连接';
    }
    if (!this.sandboxReady) {
      return '沙箱尚未就绪';
    }
    return undefined;
  }
}
