import { existsSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
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

/**
 * 根据工作区物理根路径计算出稳定且隔离的 workspaceId
 */
export function computeWorkspaceId(folderPath?: string): string {
  if (!folderPath) {
    return 'ws-default';
  }
  const normalized = folderPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const base = basename(normalized).replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_') || 'workspace';
  const hash = createHash('md5').update(normalized.toLowerCase()).digest('hex').slice(0, 8);
  return `ws-${base}-${hash}`;
}

export interface DemoHomeView {
  readonly pageId: 'demo-home';
  readonly state: DemoHomeState;
  readonly taskInput: string;
  readonly workspaceRoot?: string;
  readonly modelMode: DemoModelMode;
  readonly permissionMode: FilePermissionMode;
  readonly quickTasks: readonly string[];
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
  private workspaceId: string;
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
  private workspaceFiles: string[] = [];

  public constructor(options: DemoHomeOptions) {
    this.server = options.server;
    this.workspaceId = options.workspaceId ?? computeWorkspaceId(options.workspaceId);
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

  public setWorkspaceFiles(files: readonly string[]): void {
    this.workspaceFiles = [...files];
  }

  public getQuickTasks(): readonly string[] {
    const files = this.workspaceFiles;
    const tasks: string[] = [];

    const tableFiles = files.filter((f) => f.endsWith('.csv') || f.endsWith('.xlsx'));
    const docFiles = files.filter((f) => f.endsWith('.md') || f.endsWith('.txt'));
    const scriptFiles = files.filter((f) => f.endsWith('.py') || f.endsWith('.js') || f.endsWith('.ts'));

    if (tableFiles.length > 0) {
      const firstTable = tableFiles[0];
      tasks.push(`汇总 ${firstTable} 数据并生成带公式的 Excel 报表`);
    }

    if (docFiles.length > 0) {
      const firstDoc = docFiles[0];
      tasks.push(`基于 ${firstDoc} 提炼要点并生成高保真 Word 报告`);
    }

    if (scriptFiles.length > 0) {
      tasks.push('运行沙箱脚本分析工作区代码与数据');
    }

    const fallbackTasks = [
      '整理工作区会议材料并生成精美 Word 周报',
      '汇总工作区业务表格并输出高保真 Excel 工作簿',
      '在安全沙箱中运行脚本进行数据清洗与计算',
    ];

    for (const fb of fallbackTasks) {
      if (tasks.length >= 3) break;
      if (!tasks.includes(fb)) {
        tasks.push(fb);
      }
    }

    return tasks;
  }

  public chooseQuickTask(task: string): void {
    const currentTasks = this.getQuickTasks();
    if (!currentTasks.includes(task) && !DEMO_QUICK_TASKS.includes(task as (typeof DEMO_QUICK_TASKS)[number])) {
      throw new Error(`unknown quick task: ${task}`);
    }
    this.taskInput = task;
  }

  public selectWorkspace(workspaceRoot: string, files?: readonly string[]): void {
    this.workspaceRoot = workspaceRoot;
    this.workspaceId = computeWorkspaceId(workspaceRoot);
    if (files) {
      this.workspaceFiles = [...files];
    } else {
      try {
        if (existsSync(workspaceRoot)) {
          const entries = readdirSync(workspaceRoot, { withFileTypes: true });
          this.workspaceFiles = entries.filter((e) => e.isFile()).map((e) => e.name);
        } else {
          this.workspaceFiles = [];
        }
      } catch {
        this.workspaceFiles = [];
      }
    }
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
      quickTasks: this.getQuickTasks(),
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
