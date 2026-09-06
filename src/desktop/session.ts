import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { AppServer } from '../runtime/app-server.js';
import type { AppServerContract } from '../runtime/app-server.js';
import type {
  AnyRuntimeEvent,
  Approval,
  ApprovalTier,
  AttachmentItem,
  ChatMessage,
  Plan,
  ReasoningEffort,
  Thread,
  TokenUsageSnapshot,
  Turn,
} from '../runtime/protocol.js';
import type { AgentSkill } from '../runtime/skill.js';
import { AppShellController } from '../ui/app-shell.js';
import type { AppRoute, AppShellView, ShellModelMode } from '../ui/app-shell.js';
import { DemoHomeController } from '../ui/demo-home.js';
import type { DemoHomeView, DemoModelMode, FilePermissionMode } from '../ui/demo-home.js';
import { DeterministicModelProvider, OpenAICompatibleModelProvider } from '../runtime/model-provider.js';
import { AttachmentReader } from '../runtime/attachment-reader.js';
import { DefaultApprovalPolicy } from '../runtime/approval-policy.js';
import { SettingsStore } from '../runtime/settings-store.js';
import type {
  AgentSettings,
  ConnectionTestResult,
  ModelServiceConfig,
} from '../runtime/settings-store.js';
import type { McpServerConfig, McpServerState } from '../runtime/mcp-types.js';
import { McpProcessSupervisor } from '../runtime/mcp-process-supervisor.js';
import type {
  ModelChatInput,
  ModelChatOutput,
  ModelConfig,
  ModelPlanInput,
  ModelProvider,
} from '../runtime/model-provider.js';
import type { RuntimeIdFactory } from '../runtime/event-log.js';

export const BUILTIN_DEEPSEEK_CONFIG: ModelConfig = {
  provider: 'openai-compatible',
  apiKey: process.env.AGENT_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? '',
  baseURL: process.env.AGENT_BASE_URL ?? 'https://api.deepseek.com',
  modelName: process.env.AGENT_MODEL_NAME ?? 'deepseek-v4-flash',
};

export class SwitchableModelProvider implements ModelProvider {
  private mode: string = 'live';
  private liveModel?: OpenAICompatibleModelProvider | undefined;
  private readonly fallbackModel: DeterministicModelProvider;
  private readonly createId: RuntimeIdFactory;

  public constructor(config: ModelConfig, idFactory?: RuntimeIdFactory) {
    let counter = 0;
    this.createId = idFactory ?? ((prefix) => `${prefix}-${++counter}`);
    this.fallbackModel = new DeterministicModelProvider(undefined, this.createId);
    if (config.apiKey && config.apiKey.length > 0) {
      this.liveModel = new OpenAICompatibleModelProvider(config, this.createId);
    }
  }

  public updateConfig(config: ModelConfig): void {
    if (config.apiKey && config.apiKey.length > 0) {
      this.liveModel = new OpenAICompatibleModelProvider(config, this.createId);
    } else {
      this.liveModel = undefined;
    }
  }

  public setMode(mode: string): void {
    this.mode = mode;
  }

  public getMode(): string {
    return this.mode;
  }

  public setModelName(modelName: string): void {
    if (this.liveModel) {
      (this.liveModel.config as { modelName: string }).modelName = modelName;
    }
  }

  public setReasoningEffort(effort: ReasoningEffort): void {
    if (this.liveModel) {
      (this.liveModel.config as { reasoningEffort?: ReasoningEffort }).reasoningEffort = effort;
    }
  }

  public async proposePlan(input: ModelPlanInput): Promise<Plan> {
    if (this.mode === 'live' && this.liveModel) {
      try {
        return await this.liveModel.proposePlan(input);
      } catch {
        return this.fallbackModel.proposePlan(input);
      }
    }
    return this.fallbackModel.proposePlan(input);
  }

  public async chatCompletion(input: ModelChatInput): Promise<ModelChatOutput> {
    if (this.mode === 'live' && this.liveModel) {
      try {
        return await this.liveModel.chatCompletion(input);
      } catch {
        return this.fallbackModel.chatCompletion(input);
      }
    }
    return this.fallbackModel.chatCompletion(input);
  }
}

export interface DesktopApprovalView {
  readonly id: string;
  readonly turnId: string;
  readonly planId: string;
  readonly status: Approval['status'];
  readonly reason: string;
  readonly resolvedAt?: string;
}

export interface DesktopPlanStepView {
  readonly id: string;
  readonly title: string;
  readonly toolName: string;
  readonly risk: Plan['steps'][number]['risk'];
  readonly requiresApproval: boolean;
}

export interface DesktopPlanView {
  readonly id: string;
  readonly turnId: string;
  readonly status: Plan['status'];
  readonly steps: readonly DesktopPlanStepView[];
}

export interface DesktopEventDto {
  readonly id: string;
  readonly version: number;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly type: string;
  readonly threadId: string;
  readonly turnId?: string;
  readonly payload: unknown;
}

export interface DesktopThreadView {
  readonly id: string;
  readonly workspaceId: string;
  readonly workspaceRoot?: string;
  readonly status: Thread['status'];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DesktopTurnView {
  readonly id: string;
  readonly threadId: string;
  readonly input: string;
  readonly status: Turn['status'];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DesktopSessionMetadata {
  readonly id: string;
  readonly title: string;
  readonly projectId?: string | undefined;
  readonly isPinned?: boolean | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastSnippet?: string | undefined;
}

export interface DesktopProject {
  readonly id: string;
  readonly name: string;
  readonly folderPath: string;
  readonly createdAt: string;
  readonly isExpanded?: boolean | undefined;
}

export interface DesktopExecutionState {
  readonly status: 'idle' | 'routing' | 'thinking' | 'tool_executing';
  readonly currentTool?: string | undefined;
  readonly detail?: string | undefined;
}

export interface DesktopSnapshot {
  readonly shell: AppShellView;
  readonly home: DemoHomeView;
  readonly route: AppRoute;
  readonly permissionMode?: FilePermissionMode;
  readonly thread?: DesktopThreadView;
  readonly turn?: DesktopTurnView;
  readonly plan?: DesktopPlanView;
  readonly approval?: DesktopApprovalView;
  readonly events: readonly DesktopEventDto[];
  readonly workspaceFiles?: readonly string[];
  readonly artifactFiles?: readonly string[];
  readonly messages?: readonly ChatMessage[];
  readonly skills?: readonly AgentSkill[];
  readonly activeSkillId?: string;
  readonly sessions?: readonly DesktopSessionMetadata[] | undefined;
  readonly projects?: readonly DesktopProject[] | undefined;
  readonly activeSessionId?: string | undefined;
  readonly settings?: AgentSettings | undefined;
  readonly activeServiceName?: string | undefined;
  readonly activeModelName?: string | undefined;
  readonly mcpServers?: readonly McpServerState[] | undefined;
  readonly isGenerating?: boolean | undefined;
  readonly executionState?: DesktopExecutionState | undefined;
}

export interface McpTestResult {
  readonly success: boolean;
  readonly latencyMs: number;
  readonly toolCount: number;
  readonly tools: readonly string[];
  readonly error?: string | undefined;
}

export type DesktopApprovalDecision = 'approved' | 'rejected';

export interface DesktopApi {
  getSnapshot(): Promise<DesktopSnapshot>;
  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void;
  selectWorkspace(workspaceRoot?: string): Promise<DesktopSnapshot>;
  setTaskInput(input: string): Promise<DesktopSnapshot>;
  chooseQuickTask(task: string): Promise<DesktopSnapshot>;
  navigate(route: AppRoute): Promise<DesktopSnapshot>;
  setModelMode(mode: ShellModelMode & DemoModelMode): Promise<DesktopSnapshot>;
  setPermissionMode(mode: FilePermissionMode): Promise<DesktopSnapshot>;
  setSkill(skillId: string): Promise<DesktopSnapshot>;
  sendMessage(input: string, options?: { skillId?: string }): Promise<DesktopSnapshot>;
  submitPlan(): Promise<DesktopSnapshot>;
  respondApproval(decision: DesktopApprovalDecision): Promise<DesktopSnapshot>;
  stopTask(): Promise<DesktopSnapshot>;
  addAttachment(item: AttachmentItem): Promise<DesktopSnapshot>;
  removeAttachment(id: string): Promise<DesktopSnapshot>;
  clearAttachments(): Promise<DesktopSnapshot>;
  setReasoningEffort(effort: ReasoningEffort): Promise<DesktopSnapshot>;
  compactContext(): Promise<DesktopSnapshot>;
  createSession(options?: { projectId?: string | undefined; title?: string | undefined; folderPath?: string | undefined } | undefined): Promise<DesktopSnapshot>;
  switchSession(sessionId: string): Promise<DesktopSnapshot>;
  togglePinSession(sessionId: string): Promise<DesktopSnapshot>;
  renameSession(sessionId: string, newTitle: string): Promise<DesktopSnapshot>;
  deleteSession(sessionId: string): Promise<DesktopSnapshot>;
  createProject(name: string, folderPath: string): Promise<DesktopSnapshot>;
  deleteProject(projectId: string): Promise<DesktopSnapshot>;
  toggleProjectExpanded(projectId: string): Promise<DesktopSnapshot>;
  promptSelectFolder(): Promise<string | undefined>;
  getSettings(): Promise<AgentSettings>;
  saveSettings(patch: Partial<AgentSettings>): Promise<DesktopSnapshot>;
  testModelConnection(service: Partial<ModelServiceConfig>): Promise<ConnectionTestResult>;
  openConfigDir(): Promise<void>;
  testMcpConnection(config: McpServerConfig, serverId?: string): Promise<McpTestResult>;
  saveMcpServer(id: string, config: McpServerConfig): Promise<DesktopSnapshot>;
  deleteMcpServer(id: string): Promise<DesktopSnapshot>;
  reloadMcpServers(): Promise<DesktopSnapshot>;
}

export interface DesktopSessionOptions {
  readonly eventLogPath?: string;
  readonly server?: AppServerContract;
  readonly modelConfig?: ModelConfig;
  readonly permissionMode?: FilePermissionMode;
  readonly liveModelAvailable?: boolean;
  readonly reasoningEffort?: ReasoningEffort;
  readonly settingsStore?: SettingsStore;
  readonly configPath?: string;
}

export class DesktopSession {
  private readonly server: AppServerContract;
  private readonly shell: AppShellController;
  private readonly home: DemoHomeController;
  private readonly listeners = new Set<(snapshot: DesktopSnapshot) => void>();
  private readonly switchableModel: SwitchableModelProvider | undefined;
  private readonly settingsStore: SettingsStore;
  private permissionMode: FilePermissionMode;
  private activeThreadId: string | undefined;
  private activeTurnId: string | undefined;
  private projects: DesktopProject[] = [];
  private sessionMeta = new Map<string, DesktopSessionMetadata>();
  private isGenerating = false;
  private executionState: DesktopExecutionState = { status: 'idle' };
  private eventUnsubscribe?: () => void;

  public constructor(options: DesktopSessionOptions = {}) {
    this.settingsStore = options.settingsStore ?? new SettingsStore(options.configPath);
    const initialSettings = this.settingsStore.load();
    this.permissionMode =
      options.permissionMode ?? (options.server ? 'ask-approval' : initialSettings.permissionPolicy);
    const isLiveAvailable = options.liveModelAvailable ?? true;
    if (!options.server) {
      const activeService = this.settingsStore.getActiveService();
      const resolvedConfig: ModelConfig = options.modelConfig ?? {
        provider: 'openai-compatible',
        apiKey: activeService.apiKey,
        baseURL: activeService.baseURL,
        modelName: activeService.modelName,
        ...(activeService.reasoningEffort ? { reasoningEffort: activeService.reasoningEffort } : {}),
      };
      this.switchableModel = new SwitchableModelProvider(resolvedConfig);
      this.server = new AppServer({
        ...(options.eventLogPath === undefined ? {} : { eventLogPath: options.eventLogPath }),
        modelProvider: this.switchableModel,
      });
    } else {
      this.server = options.server;
    }
    this.shell = new AppShellController({
      server: this.server,
      modelMode: 'live',
      modelConnected: true,
      sandboxReady: false,
      network: 'disabled',
    });
    this.home = new DemoHomeController({
      server: this.server,
      workspaceId: 'desktop-workspace',
      liveModelAvailable: isLiveAvailable,
      permissionMode: this.permissionMode,
    });
    if (typeof this.server.setEnablePowershellExecution === 'function') {
      this.server.setEnablePowershellExecution(initialSettings.enablePowershellExecution);
    }
    if (typeof this.server.setMaxHistoryRounds === 'function') {
      this.server.setMaxHistoryRounds(initialSettings.maxHistoryRounds);
    }
    if (initialSettings.mcpServers) {
      const bridge = this.server.getMcpBridge();
      for (const [id, cfg] of Object.entries(initialSettings.mcpServers)) {
        bridge.addServer(id, cfg);
      }
    }
    this.restoreLatestSession();

    if (typeof this.server.subscribeEvents === 'function') {
      this.eventUnsubscribe = this.server.subscribeEvents((event) => {
        this.handleRuntimeEvent(event);
      });
    }
  }

  private handleRuntimeEvent(event: AnyRuntimeEvent): void {
    if (event.type === 'intent.classified') {
      const payload = event.payload as { intent?: string };
      this.executionState = {
        status: 'routing',
        detail: `已识别意图 [${payload.intent ?? 'task'}]，正在准备执行...`,
      };
      this.changedSnapshot();
    } else if (event.type === 'tool.started') {
      const payload = event.payload as { toolName?: string };
      const toolName = payload.toolName ?? 'tool';
      this.executionState = {
        status: 'tool_executing',
        currentTool: toolName,
        detail: `正在调度并执行工具: ${toolName}...`,
      };
      this.changedSnapshot();
    } else if (event.type === 'tool.completed') {
      const payload = event.payload as { toolName?: string };
      const toolName = payload.toolName ?? 'tool';
      this.executionState = {
        status: 'thinking',
        currentTool: toolName,
        detail: `工具 ${toolName} 已完成，Agent 正在分析结果...`,
      };
      this.changedSnapshot();
    } else if (event.type === 'tool.failed') {
      const payload = event.payload as { toolName?: string };
      const toolName = payload.toolName ?? 'tool';
      this.executionState = {
        status: 'thinking',
        currentTool: toolName,
        detail: `工具 ${toolName} 执行遇到异常，正在自愈调整...`,
      };
      this.changedSnapshot();
    } else if (event.type === 'message.updated' || event.type === 'message.created') {
      this.changedSnapshot();
    }
  }

  public selectWorkspace(workspaceRoot?: string): DesktopSnapshot {
    const target = workspaceRoot ?? this.shell.view().workspaceRoot ?? join(tmpdir(), 'agent-workspace');
    if (!existsSync(target)) {
      mkdirSync(target, { recursive: true });
    }
    this.home.selectWorkspace(target);
    this.shell.selectWorkspace(target);
    this.server.scanWorkspaceSkills(target);
    void this.server.getMcpBridge().loadFromConfig({ workspacePath: target });
    return this.changedSnapshot();
  }

  public async setSkill(skillId: string): Promise<DesktopSnapshot> {
    if (this.activeThreadId) {
      this.server.setThreadSkill(this.activeThreadId, skillId);
    }
    return this.changedSnapshot();
  }

  public async sendMessage(
    input: string,
    options?: { skillId?: string; attachments?: readonly AttachmentItem[] },
  ): Promise<DesktopSnapshot> {
    const text = input.trim();
    const currentAttachments = options?.attachments ?? this.home.getAttachments();
    if (!text && currentAttachments.length === 0) {
      return this.snapshot();
    }

    if (text === '/compact' || text.startsWith('/compact ')) {
      this.home.setTaskInput('');
      return await this.compactContext();
    }

    if (!this.activeThreadId) {
      let workspaceRoot = this.shell.view().workspaceRoot;
      if (!workspaceRoot) {
        workspaceRoot = join(tmpdir(), 'agent-scratch', `sess-${Date.now()}`);
        mkdirSync(workspaceRoot, { recursive: true });
      }
      const thread = this.server.createThread({
        workspaceId: 'desktop-workspace',
        workspaceRoot,
      });
      this.activeThreadId = thread.id;
      this.shell.bindThread(thread, undefined);
    }

    if (this.activeThreadId && !this.sessionMeta.has(this.activeThreadId)) {
      this.sessionMeta.set(this.activeThreadId, {
        id: this.activeThreadId,
        title: text.slice(0, 24) || '临时会话',
        isPinned: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else if (this.activeThreadId) {
      const currentMeta = this.sessionMeta.get(this.activeThreadId);
      if (currentMeta && (currentMeta.title === '新临时会话' || currentMeta.title === '新项目会话')) {
        this.sessionMeta.set(this.activeThreadId, {
          ...currentMeta,
          title: text.slice(0, 24) || currentMeta.title,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    if (options?.skillId) {
      this.server.setThreadSkill(this.activeThreadId, options.skillId);
    }

    let messageText = text;
    if (currentAttachments && currentAttachments.length > 0) {
      const reader = new AttachmentReader();
      const extracted = reader.extractAll(currentAttachments);
      const attachmentsBlock = reader.formatPrompt(extracted);
      messageText = attachmentsBlock ? `${attachmentsBlock}\n\n${text || '请查阅并处理上述附件。'}` : text;
    }

    this.isGenerating = true;
    this.executionState = { status: 'thinking', detail: 'Agent 正在思考并规划...' };
    this.changedSnapshot();

    try {
      await this.server.sendMessage(this.activeThreadId, messageText, options);
    } finally {
      this.isGenerating = false;
      this.executionState = { status: 'idle' };
      this.refreshActiveBinding();
    }
    this.home.setTaskInput('');
    this.home.clearAttachments();
    return this.changedSnapshot();
  }

  public addAttachment(item: AttachmentItem): DesktopSnapshot {
    this.home.addAttachment(item);
    return this.changedSnapshot();
  }

  public removeAttachment(id: string): DesktopSnapshot {
    this.home.removeAttachment(id);
    return this.changedSnapshot();
  }

  public clearAttachments(): DesktopSnapshot {
    this.home.clearAttachments();
    return this.changedSnapshot();
  }

  public setReasoningEffort(effort: ReasoningEffort): DesktopSnapshot {
    this.home.setReasoningEffort(effort);
    if (this.switchableModel) {
      this.switchableModel.setReasoningEffort(effort);
    }
    return this.changedSnapshot();
  }

  public async compactContext(): Promise<DesktopSnapshot> {
    if (!this.activeThreadId) {
      return this.snapshot();
    }
    this.home.setIsCompacting(true);
    this.changedSnapshot();

    try {
      if (typeof this.server.compactThreadMessages === 'function') {
        this.server.compactThreadMessages(this.activeThreadId);
      } else {
        const messages = this.server.listMessages(this.activeThreadId);
        if (messages.length > 1) {
          const prompt = `/compact 请将此前对话与已执行任务梳理提炼为结构化摘要，保留关键决策、已生成文件资产与下一步规划。`;
          await this.server.sendMessage(this.activeThreadId, prompt, {
            skillId: 'general-assistant',
          });
        }
      }
    } finally {
      this.home.setIsCompacting(false);
    }
    return this.changedSnapshot();
  }

  public computeTokenSnapshot(): TokenUsageSnapshot {
    const messages = this.activeThreadId ? this.server.listMessages(this.activeThreadId) : [];
    let charCount = 0;
    for (const m of messages) {
      charCount += (m.content?.length ?? 0) + (m.reasoningContent?.length ?? 0);
    }
    const usedTokens = Math.max(120, Math.ceil(charCount / 3.5));
    const contextWindow = 128000;
    const inputTokens = Math.round(usedTokens * 0.7);
    const outputTokens = Math.round(usedTokens * 0.3);
    const cacheRead = Math.round(usedTokens * 0.15);
    const cacheWrite = Math.round(usedTokens * 0.05);

    return {
      usedTokens,
      contextWindow,
      inputTokens,
      outputTokens,
      cacheRead,
      cacheWrite,
      messagesCount: messages.length,
    };
  }

  public setTaskInput(input: string): DesktopSnapshot {
    this.home.setTaskInput(input);
    return this.changedSnapshot();
  }

  public chooseQuickTask(task: string): DesktopSnapshot {
    this.home.chooseQuickTask(task);
    return this.changedSnapshot();
  }

  public navigate(route: AppRoute): DesktopSnapshot {
    this.shell.navigate(route);
    return this.changedSnapshot();
  }

  public setPermissionMode(mode: FilePermissionMode): DesktopSnapshot {
    this.permissionMode = mode;
    this.home.setPermissionMode(mode);
    if (typeof this.server.setApprovalPolicy === 'function') {
      const policy = this.server.getApprovalPolicy ? this.server.getApprovalPolicy() : new DefaultApprovalPolicy();
      const tier: ApprovalTier =
        mode === 'full-access' || mode === 'auto' || mode === 'accept-edits' || mode === 'risk-gated' || mode === 'ask-approval'
          ? mode
          : 'ask-approval';
      policy.setTier(tier);
      this.server.setApprovalPolicy(policy);
    }
    return this.changedSnapshot();
  }

  public setModelMode(mode: ShellModelMode & DemoModelMode): DesktopSnapshot {
    this.home.setModelMode(mode);
    this.shell.setModelMode(mode);
    if (this.switchableModel) {
      this.switchableModel.setMode(mode);
    }
    return this.changedSnapshot();
  }

  public submitPlan(): DesktopSnapshot {
    const submission = this.home.submit();
    this.activeThreadId = submission.thread.id;
    this.activeTurnId = submission.turn.id;
    this.shell.bindThread(submission.thread, submission.turn);
    this.shell.navigate('task-plan');

    if (
      this.permissionMode === 'full-access' ||
      this.permissionMode === 'auto' ||
      this.permissionMode === 'accept-edits'
    ) {
      const approval = this.currentApproval();
      if (approval && approval.status === 'pending') {
        this.server.respondApproval({ approvalId: approval.id, decision: 'approved' });
        this.refreshActiveBinding();
      }
    }
    return this.changedSnapshot();
  }

  public respondApproval(decision: DesktopApprovalDecision): DesktopSnapshot {
    const approval = this.currentApproval();
    if (!approval) {
      throw new Error('no pending desktop approval');
    }
    this.server.respondApproval({ approvalId: approval.id, decision });
    this.refreshActiveBinding();
    return this.changedSnapshot();
  }

  public stopTask(): DesktopSnapshot {
    this.shell.stopCurrentTask();
    this.refreshActiveBinding();
    return this.changedSnapshot();
  }

  public async createSession(options?: {
    projectId?: string | undefined;
    title?: string | undefined;
    folderPath?: string | undefined;
  } | undefined): Promise<DesktopSnapshot> {
    let workspaceRoot: string;
    if (options?.projectId) {
      const project = this.projects.find((p) => p.id === options.projectId);
      workspaceRoot = project ? project.folderPath : join(tmpdir(), 'agent-scratch', `sess-${Date.now()}`);
    } else if (options?.folderPath) {
      workspaceRoot = options.folderPath;
    } else {
      workspaceRoot = join(tmpdir(), 'agent-scratch', `sess-${Date.now()}`);
    }

    if (!existsSync(workspaceRoot)) {
      mkdirSync(workspaceRoot, { recursive: true });
    }

    const thread = this.server.createThread({
      workspaceId: 'desktop-workspace',
      workspaceRoot,
    });

    const meta: DesktopSessionMetadata = {
      id: thread.id,
      title: options?.title ?? (options?.projectId ? '新项目会话' : '新临时会话'),
      projectId: options?.projectId,
      isPinned: false,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    };
    this.sessionMeta.set(thread.id, meta);

    this.activeThreadId = thread.id;
    this.activeTurnId = undefined;
    this.selectWorkspace(workspaceRoot);
    this.home.setTaskInput('');
    this.home.clearAttachments();
    this.shell.bindThread(thread, undefined);
    this.shell.navigate('demo-home');

    return this.changedSnapshot();
  }

  public async switchSession(sessionId: string): Promise<DesktopSnapshot> {
    const thread = this.server.listThreads().find((t) => t.id === sessionId);
    if (!thread) {
      return this.snapshot();
    }
    this.activeThreadId = thread.id;
    const events = this.server.listEvents(thread.id);
    const turn = latestTurn(events);
    this.activeTurnId = turn?.id;
    if (thread.workspaceRoot) {
      this.selectWorkspace(thread.workspaceRoot);
    }
    this.shell.bindThread(thread, turn);
    this.shell.navigate('demo-home');
    return this.changedSnapshot();
  }

  public async togglePinSession(sessionId: string): Promise<DesktopSnapshot> {
    const meta = this.sessionMeta.get(sessionId);
    if (meta) {
      this.sessionMeta.set(sessionId, { ...meta, isPinned: !meta.isPinned });
    }
    return this.changedSnapshot();
  }

  public async renameSession(sessionId: string, title: string): Promise<DesktopSnapshot> {
    const meta = this.sessionMeta.get(sessionId);
    const trimmed = title.trim();
    if (meta && trimmed) {
      this.sessionMeta.set(sessionId, { ...meta, title: trimmed });
    }
    return this.changedSnapshot();
  }

  public async deleteSession(sessionId: string): Promise<DesktopSnapshot> {
    this.sessionMeta.delete(sessionId);
    if (this.activeThreadId === sessionId) {
      const remaining = Array.from(this.sessionMeta.keys());
      if (remaining.length > 0) {
        return this.switchSession(remaining[remaining.length - 1]!);
      }
      this.activeThreadId = undefined;
      this.activeTurnId = undefined;
      this.home.setTaskInput('');
    }
    return this.changedSnapshot();
  }

  public async createProject(name: string, folderPath: string): Promise<DesktopSnapshot> {
    const resolvedPath = folderPath.trim();
    if (!existsSync(resolvedPath)) {
      mkdirSync(resolvedPath, { recursive: true });
    }
    const projName = name.trim() || basename(resolvedPath) || '新项目';
    const project: DesktopProject = {
      id: `proj-${Date.now()}`,
      name: projName,
      folderPath: resolvedPath,
      createdAt: new Date().toISOString(),
      isExpanded: true,
    };
    this.projects.push(project);
    return await this.createSession({
      projectId: project.id,
      title: `${projName} - 主会话`,
    });
  }

  public async deleteProject(projectId: string): Promise<DesktopSnapshot> {
    this.projects = this.projects.filter((p) => p.id !== projectId);
    for (const [id, meta] of this.sessionMeta.entries()) {
      if (meta.projectId === projectId) {
        this.sessionMeta.set(id, { ...meta, projectId: undefined });
      }
    }
    return this.changedSnapshot();
  }

  public async toggleProjectExpanded(projectId: string): Promise<DesktopSnapshot> {
    const proj = this.projects.find((p) => p.id === projectId);
    if (proj) {
      (proj as { isExpanded?: boolean }).isExpanded = !proj.isExpanded;
    }
    return this.changedSnapshot();
  }

  public async promptSelectFolder(): Promise<string | undefined> {
    return undefined;
  }

  public getSettings(): AgentSettings {
    return this.settingsStore.load();
  }

  public async saveSettings(patch: Partial<AgentSettings>): Promise<DesktopSnapshot> {
    this.settingsStore.save(patch);
    if (patch.permissionPolicy) {
      this.setPermissionMode(patch.permissionPolicy);
    }
    if (typeof patch.enablePowershellExecution === 'boolean' && typeof this.server.setEnablePowershellExecution === 'function') {
      this.server.setEnablePowershellExecution(patch.enablePowershellExecution);
    }
    if (typeof patch.maxHistoryRounds === 'number' && typeof this.server.setMaxHistoryRounds === 'function') {
      this.server.setMaxHistoryRounds(patch.maxHistoryRounds);
    }
    if (this.switchableModel) {
      const activeService = this.settingsStore.getActiveService();
      this.switchableModel.updateConfig({
        provider: 'openai-compatible',
        apiKey: activeService.apiKey,
        baseURL: activeService.baseURL,
        modelName: activeService.modelName,
        ...(activeService.reasoningEffort ? { reasoningEffort: activeService.reasoningEffort } : {}),
      });
    }
    return this.changedSnapshot();
  }

  public async testModelConnection(
    service: Partial<ModelServiceConfig>,
  ): Promise<ConnectionTestResult> {
    const result = await this.settingsStore.testConnection(
      service as Pick<ModelServiceConfig, 'baseURL' | 'apiKey' | 'modelName'>,
    );
    if (service.id) {
      this.settingsStore.updateServiceTestResult(service.id, {
        status: result.success ? 'success' : 'error',
        latencyMs: result.latencyMs,
        ...(result.error ? { error: result.error } : {}),
      });
    }
    this.changedSnapshot();
    return result;
  }

  public async saveMcpServer(
    id: string,
    config: McpServerConfig,
  ): Promise<DesktopSnapshot> {
    const settings = this.settingsStore.load();
    const currentMcp: Record<string, McpServerConfig> = { ...(settings.mcpServers ?? {}) };
    currentMcp[id] = config;
    this.settingsStore.save({ mcpServers: currentMcp });

    const ws = this.shell.view().workspaceRoot;
    const bridge = this.server.getMcpBridge();
    const supervisor = bridge.addServer(id, config, ws);
    if (!config.disabled) {
      try {
        await supervisor.connect(8000);
      } catch (err) {
        console.warn(`[DesktopSession] Failed to connect MCP server "${id}":`, err);
      }
    }

    return this.changedSnapshot();
  }

  public async deleteMcpServer(id: string): Promise<DesktopSnapshot> {
    const settings = this.settingsStore.load();
    const currentMcp: Record<string, McpServerConfig> = { ...(settings.mcpServers ?? {}) };
    delete currentMcp[id];
    this.settingsStore.save({ mcpServers: currentMcp });

    const bridge = this.server.getMcpBridge();
    await bridge.removeServer(id);
    return this.changedSnapshot();
  }

  public async testMcpConnection(
    config: McpServerConfig,
    serverId = 'test',
  ): Promise<McpTestResult> {
    const ws = this.shell.view().workspaceRoot;
    const supervisor = new McpProcessSupervisor(serverId, config, ws);
    const start = Date.now();
    try {
      const tools = await supervisor.connect(10000);
      const latencyMs = Date.now() - start;
      const toolNames = tools.map((t) => t.name);
      await supervisor.disconnect();
      return {
        success: true,
        latencyMs,
        toolCount: tools.length,
        tools: toolNames,
      };
    } catch (err) {
      await supervisor.disconnect();
      return {
        success: false,
        latencyMs: Date.now() - start,
        toolCount: 0,
        tools: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public async reloadMcpServers(): Promise<DesktopSnapshot> {
    const ws = this.shell.view().workspaceRoot;
    const bridge = this.server.getMcpBridge();
    const settings = this.settingsStore.load();

    if (settings.mcpServers) {
      for (const [id, cfg] of Object.entries(settings.mcpServers)) {
        bridge.addServer(id, cfg, ws);
      }
    }
    if (ws) {
      await bridge.loadFromConfig({ workspacePath: ws });
    }
    await bridge.connectAll();
    return this.changedSnapshot();
  }

  public async openConfigDir(): Promise<void> {
    // 桌面环境下由 main.ts 触发 shell.showItemInFolder
  }

  public getConfigFilePath(): string {
    return this.settingsStore.getConfigFilePath();
  }

  public listAllEvents(): readonly DesktopEventDto[] {
    return this.server.listAllEvents().map(toEventDto);
  }

  public snapshot(): DesktopSnapshot {
    const events = this.server.listAllEvents();
    const thread = this.activeThreadId === undefined ? undefined : this.server.getThread(this.activeThreadId);
    const turn = this.activeTurnId === undefined ? undefined : this.server.getTurn(this.activeTurnId);
    const plan = turn === undefined ? undefined : latestPlan(events, turn.id);
    const approval = turn === undefined ? undefined : latestApproval(events, turn.id);
    const workspaceRoot = this.shell.view().workspaceRoot;
    let workspaceFiles: string[] | undefined;
    const artifactFiles: string[] | undefined = undefined;
    if (workspaceRoot && existsSync(workspaceRoot)) {
      try {
        workspaceFiles = readdirSync(workspaceRoot, { withFileTypes: true })
          .filter((e) => e.isFile() && !e.name.startsWith('.'))
          .map((e) => e.name);
      } catch {
        // ignore read errors
      }
    }

    const messages = this.activeThreadId ? this.server.listMessages(this.activeThreadId) : [];
    const skills = this.server.listSkills();
    const activeSkillId = this.activeThreadId
      ? this.server.getThreadSkill(this.activeThreadId)?.id ?? 'general-assistant'
      : 'general-assistant';

    this.home.setTokenSnapshot(this.computeTokenSnapshot());

    return {
      shell: this.shell.view(),
      home: this.home.view(),
      route: this.shell.view().route,
      permissionMode: this.permissionMode,
      ...(thread === undefined ? {} : { thread: toThreadView(thread) }),
      ...(turn === undefined ? {} : { turn: toTurnView(turn) }),
      ...(plan === undefined ? {} : { plan: toPlanView(plan, approval) }),
      ...(approval === undefined ? {} : { approval: toApprovalView(approval) }),
      events: events.map(toEventDto),
      ...(workspaceFiles === undefined ? {} : { workspaceFiles }),
      ...(artifactFiles === undefined ? {} : { artifactFiles }),
      messages,
      skills,
      activeSkillId,
      sessions: Array.from(this.sessionMeta.values()),
      projects: this.projects,
      activeSessionId: this.activeThreadId,
      settings: this.settingsStore.load(),
      activeServiceName: this.settingsStore.getActiveService().name,
      activeModelName: this.settingsStore.getActiveService().modelName,
      mcpServers: this.server.getMcpBridge().listServers(),
      isGenerating: this.isGenerating,
      executionState: this.executionState,
    };
  }

  public subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changedSnapshot(): DesktopSnapshot {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
    return snapshot;
  }

  private restoreLatestSession(): void {
    const threads = this.server.listThreads();
    for (const t of threads) {
      if (!this.sessionMeta.has(t.id)) {
        this.sessionMeta.set(t.id, {
          id: t.id,
          title: `会话 ${t.id.slice(-4)}`,
          isPinned: false,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        });
      }
    }
    const thread = threads.at(-1);
    if (thread === undefined) {
      return;
    }
    const events = this.server.listEvents(thread.id);
    const turn = latestTurn(events);
    this.activeThreadId = thread.id;
    this.activeTurnId = turn?.id;
    if (thread.workspaceRoot !== undefined) {
      this.home.selectWorkspace(thread.workspaceRoot);
      this.shell.selectWorkspace(thread.workspaceRoot);
    }
    this.shell.bindThread(thread, turn);
    if (turn !== undefined) {
      this.shell.navigate('task-plan');
    }
  }

  private refreshActiveBinding(): void {
    if (this.activeThreadId === undefined) {
      return;
    }
    const thread = this.server.getThread(this.activeThreadId);
    if (!this.activeTurnId) {
      const events = this.server.listEvents(this.activeThreadId);
      const turnObj = latestTurn(events);
      if (turnObj) {
        this.activeTurnId = turnObj.id;
      }
    }
    const turn = this.activeTurnId === undefined ? undefined : this.server.getTurn(this.activeTurnId);
    this.shell.bindThread(thread, turn);
  }

  private currentApproval(): Approval | undefined {
    if (this.activeTurnId === undefined) {
      return undefined;
    }
    return latestApproval(this.server.listAllEvents(), this.activeTurnId);
  }
}

function latestTurn(events: readonly AnyRuntimeEvent[]): Turn | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'turn.status_changed' || event?.type === 'turn.started') {
      return event.payload;
    }
  }
  return undefined;
}

function latestPlan(events: readonly AnyRuntimeEvent[], turnId: string): Plan | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'plan.proposed' && event.turnId === turnId) {
      return event.payload;
    }
  }
  return undefined;
}

function latestApproval(events: readonly AnyRuntimeEvent[], turnId: string): Approval | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      (event?.type === 'approval.requested' || event?.type === 'approval.resolved') &&
      event.turnId === turnId
    ) {
      return event.payload;
    }
  }
  return undefined;
}

function toPlanView(plan: Plan, approval: Approval | undefined): DesktopPlanView {
  const status =
    approval?.status === 'approved'
      ? 'approved'
      : approval?.status === 'rejected'
        ? 'rejected'
        : plan.status;
  return {
    id: plan.id,
    turnId: plan.turnId,
    status,
    steps: plan.steps.map((step) => ({
      id: step.id,
      title: step.title,
      toolName: step.toolName,
      risk: step.risk,
      requiresApproval: step.requiresApproval,
    })),
  };
}

function toApprovalView(approval: Approval): DesktopApprovalView {
  return {
    id: approval.id,
    turnId: approval.turnId,
    planId: approval.planId,
    status: approval.status,
    reason: approval.reason,
    ...(approval.resolvedAt === undefined ? {} : { resolvedAt: approval.resolvedAt }),
  };
}

function toThreadView(thread: Thread): DesktopThreadView {
  return {
    id: thread.id,
    workspaceId: thread.workspaceId,
    ...(thread.workspaceRoot === undefined ? {} : { workspaceRoot: thread.workspaceRoot }),
    status: thread.status,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

function toTurnView(turn: Turn): DesktopTurnView {
  return {
    id: turn.id,
    threadId: turn.threadId,
    input: turn.input,
    status: turn.status,
    createdAt: turn.createdAt,
    updatedAt: turn.updatedAt,
  };
}

function toEventDto(event: AnyRuntimeEvent): DesktopEventDto {
  return {
    id: event.id,
    version: event.version,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
    type: event.type,
    threadId: event.threadId,
    ...(event.turnId === undefined ? {} : { turnId: event.turnId }),
    payload: JSON.parse(JSON.stringify(event.payload)) as unknown,
  };
}

declare global {
  interface Window {
    agentDesktop: DesktopApi;
  }
}
