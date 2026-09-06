import type { AppServerContract } from '../runtime/app-server.js';
import type {
  AttachmentItem,
  ReasoningEffort,
  Thread,
  TokenUsageSnapshot,
  Turn,
} from '../runtime/protocol.js';

export type DemoHomeState = 'default' | 'empty' | 'disabled' | 'loading';
export type DemoModelMode = 'live';
export type FilePermissionMode =
  | 'full-access'
  | 'auto'
  | 'accept-edits'
  | 'risk-gated'
  | 'ask-approval'
  | 'read-only';

export const DEMO_QUICK_TASKS = [
  '整理会议材料并生成 Word 报告',
  '汇总决策并列出待办事项',
  '读取销售数据并生成周报',
] as const;

export interface DemoHomeView {
  readonly pageId: 'demo-home';
  readonly state: DemoHomeState;
  readonly taskInput: string;
  readonly workspaceRoot?: string;
  readonly modelMode: DemoModelMode;
  readonly permissionMode: FilePermissionMode;
  readonly quickTasks: typeof DEMO_QUICK_TASKS;
  readonly canSubmit: boolean;
  readonly submitLabel: string;
  readonly disabledReason?: string;
  readonly attachments: readonly AttachmentItem[];
  readonly reasoningEffort: ReasoningEffort;
  readonly tokenSnapshot?: TokenUsageSnapshot;
  readonly isCompacting: boolean;
}

export interface DemoSubmission {
  readonly route: 'task-plan';
  readonly thread: Thread;
  readonly turn: Turn;
}

export interface DemoHomeOptions {
  readonly server: AppServerContract;
  readonly workspaceId?: string;
  readonly liveModelAvailable?: boolean;
  readonly permissionMode?: FilePermissionMode;
  readonly reasoningEffort?: ReasoningEffort;
}


export class DemoHomeController {
  private readonly server: AppServerContract;
  private readonly workspaceId: string;
  private readonly liveModelAvailable: boolean;
  private taskInput = '';
  private workspaceRoot: string | undefined;
  private modelMode: DemoModelMode = 'live';
  private permissionMode: FilePermissionMode;
  private reasoningEffort: ReasoningEffort = 'max';
  private attachments: AttachmentItem[] = [];
  private tokenSnapshot?: TokenUsageSnapshot;
  private isCompacting = false;
  private loading = false;

  public constructor(options: DemoHomeOptions) {
    this.server = options.server;
    this.workspaceId = options.workspaceId ?? 'desktop-workspace';
    this.liveModelAvailable = options.liveModelAvailable ?? true;
    this.permissionMode = options.permissionMode ?? 'full-access';
    this.reasoningEffort = options.reasoningEffort ?? 'max';
  }

  public setTaskInput(input: string): void {
    this.taskInput = input;
  }

  public addAttachment(item: AttachmentItem): void {
    if (!this.attachments.some((a) => a.id === item.id)) {
      this.attachments.push(item);
    }
  }

  public removeAttachment(id: string): void {
    this.attachments = this.attachments.filter((a) => a.id !== id);
  }

  public clearAttachments(): void {
    this.attachments = [];
  }

  public getAttachments(): readonly AttachmentItem[] {
    return this.attachments;
  }

  public setReasoningEffort(effort: ReasoningEffort): void {
    this.reasoningEffort = effort;
  }

  public setTokenSnapshot(snapshot: TokenUsageSnapshot): void {
    this.tokenSnapshot = snapshot;
  }

  public setIsCompacting(isCompacting: boolean): void {
    this.isCompacting = isCompacting;
  }

  public chooseQuickTask(task: string): void {
    if (!DEMO_QUICK_TASKS.includes(task as (typeof DEMO_QUICK_TASKS)[number])) {
      throw new Error(`unknown quick task: ${task}`);
    }
    this.taskInput = task;
  }

  public selectWorkspace(workspaceRoot: string): void {
    this.workspaceRoot = workspaceRoot;
  }

  public setModelMode(mode: DemoModelMode): void {
    this.modelMode = mode;
  }

  public setPermissionMode(mode: FilePermissionMode): void {
    this.permissionMode = mode;
  }

  public view(): DemoHomeView {
    const state = this.computeState();
    const disabledReason = this.disabledReason(state);
    const base = {
      pageId: 'demo-home' as const,
      state,
      taskInput: this.taskInput,
      modelMode: this.modelMode,
      permissionMode: this.permissionMode,
      quickTasks: DEMO_QUICK_TASKS,
      canSubmit: state === 'default',
      submitLabel: state === 'loading' ? '正在生成方案…' : '生成方案',
      attachments: [...this.attachments],
      reasoningEffort: this.reasoningEffort,
      isCompacting: this.isCompacting,
    };
    return {
      ...base,
      ...(this.workspaceRoot === undefined ? {} : { workspaceRoot: this.workspaceRoot }),
      ...(this.tokenSnapshot === undefined ? {} : { tokenSnapshot: this.tokenSnapshot }),
      ...(disabledReason === undefined ? {} : { disabledReason }),
    };
  }

  public submit(): DemoSubmission {
    if (this.computeState() !== 'default' || this.workspaceRoot === undefined) {
      throw new Error(this.disabledReason(this.computeState()) ?? 'demo home is not ready');
    }
    this.loading = true;
    try {
      const thread = this.server.createThread({
        workspaceId: this.workspaceId,
        workspaceRoot: this.workspaceRoot,
      });
      const turn = this.server.startTurn({
        threadId: thread.id,
        input: this.taskInput,
      });
      return { route: 'task-plan', thread, turn };
    } finally {
      this.loading = false;
    }
  }

  private computeState(): DemoHomeState {
    if (this.loading) {
      return 'loading';
    }
    if (this.workspaceRoot === undefined) {
      return 'empty';
    }
    if (this.taskInput.trim().length === 0 && this.attachments.length === 0) {
      return 'disabled';
    }
    if (this.modelMode === 'live' && !this.liveModelAvailable) {
      return 'disabled';
    }
    return 'default';
  }

  private disabledReason(state: DemoHomeState): string | undefined {
    if (state === 'empty') {
      return '尚未选择工作区';
    }
    if (state === 'disabled' && this.taskInput.trim().length === 0 && this.attachments.length === 0) {
      return '输入任务后才能生成方案';
    }
    if (state === 'disabled' && !this.liveModelAvailable) {
      return '模型服务尚未配置，请检查 API Key 配置与网络连接';
    }
    return undefined;
  }
}
