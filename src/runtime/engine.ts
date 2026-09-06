import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EventLog,
  FileEventStore,
  maxNumericRuntimeId,
} from './event-log.js';
import type { RuntimeClock, RuntimeEventStore, RuntimeIdFactory } from './event-log.js';
import {
  transitionThreadStatus,
  transitionTurnStatus,
} from './state-machine.js';
import { LocalWorkspaceSandbox } from './sandbox.js';
import { LocalDocumentEngine } from './document-engine.js';
import type { WorkspaceDocumentEngine } from './document-engine.js';
import { ProductionOfficeEngine } from './office-engine.js';
import { EvidenceVerifier } from './verifier.js';
import type { VerificationRequest, VerificationResult } from './verifier.js';
import { SkillRegistry } from './skill.js';
import type { AgentSkill } from './skill.js';
import { McpBridge } from './mcp-bridge.js';
import { DefaultApprovalPolicy } from './approval-policy.js';
import { SafeProcessRunner } from './process-runner.js';
import { ContextCompactor } from './context-compactor.js';
import type { CompactionResult } from './context-compactor.js';
import {
  DEFAULT_AGENT_TOOLS,
  DeterministicModelProvider,
  OpenAICompatibleModelProvider,
  pruneContextMessages,
} from './model-provider.js';
import type { AgentToolDefinition, ModelChatOutput, ModelConfig, ModelProvider } from './model-provider.js';
import { IntentRouter } from './conversation/intent-router.js';
import { ContextManager } from './conversation/context-manager.js';
import { PromptBuilder } from './conversation/prompt-builder.js';
import { ToolRegistry, createDefaultToolRegistry } from './tools/index.js';
import type { ToolContext } from './tools/index.js';
import type {
  AnyRuntimeEvent,
  Approval,
  ArtifactVerification,
  ArtifactWriteResult,
  ChatMessage,
  CreateThreadInput,
  Plan,
  SandboxCheckInput,
  SandboxDecision,
  StartTurnInput,
  Thread,
  ThreadStatus,
  ToolCall,
  ToolExecution,
  Turn,
  TurnStatus,
} from './protocol.js';

export interface RuntimeEngineOptions {
  readonly now?: RuntimeClock;
  readonly idFactory?: RuntimeIdFactory;
  readonly documentEngine?: WorkspaceDocumentEngine;
  readonly officeEngine?: ProductionOfficeEngine;
  readonly eventLogPath?: string;
  readonly eventStore?: RuntimeEventStore;
  readonly modelProvider?: ModelProvider;
  readonly modelConfig?: ModelConfig;
  readonly skillRegistry?: SkillRegistry;
  readonly mcpBridge?: McpBridge;
  readonly approvalPolicy?: DefaultApprovalPolicy;
  readonly evidenceVerifier?: EvidenceVerifier;
  readonly toolRegistry?: ToolRegistry;
}

export interface RespondApprovalInput {
  readonly approvalId: string;
  readonly decision: 'approved' | 'rejected';
}

function createIncrementingIdFactory(seed = 0): RuntimeIdFactory {
  let counter = seed;
  return (prefix) => `${prefix}-${++counter}`;
}

function currentTime(): string {
  return new Date().toISOString();
}

const terminalTurnStatuses: readonly TurnStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'reconciliation_required',
];

export class RuntimeEngine {
  private readonly threads = new Map<string, Thread>();
  private readonly turns = new Map<string, Turn>();
  private readonly plans = new Map<string, Plan>();
  private readonly approvals = new Map<string, Approval>();
  private readonly threadMessages = new Map<string, ChatMessage[]>();
  private readonly pausedTurnStatuses = new Map<string, TurnStatus>();
  private readonly threadActiveSkills = new Map<string, string>();
  private readonly log: EventLog;
  private readonly model: ModelProvider;
  private readonly documentEngine: WorkspaceDocumentEngine;
  private readonly officeEngine: ProductionOfficeEngine;
  private readonly evidenceVerifier: EvidenceVerifier;
  private readonly sandboxes = new Map<string, LocalWorkspaceSandbox>();
  private readonly pendingTurnExecutions = new Map<string, Promise<void>>();
  private readonly skillRegistry: SkillRegistry;
  private readonly mcpBridge: McpBridge;
  private readonly toolRegistry: ToolRegistry;
  private approvalPolicy: DefaultApprovalPolicy;
  private readonly processRunner: SafeProcessRunner;
  private readonly compactor: ContextCompactor;
  private readonly contextManager: ContextManager;
  private readonly now: RuntimeClock;
  private readonly createId: RuntimeIdFactory;

  public constructor(options: RuntimeEngineOptions = {}) {
    this.now = options.now ?? currentTime;
    this.skillRegistry = options.skillRegistry ?? new SkillRegistry();
    this.mcpBridge = options.mcpBridge ?? new McpBridge();
    this.toolRegistry = options.toolRegistry ?? createDefaultToolRegistry();
    this.approvalPolicy = options.approvalPolicy ?? new DefaultApprovalPolicy({ tier: 'auto' });
    this.processRunner = new SafeProcessRunner();
    this.compactor = new ContextCompactor();
    this.contextManager = new ContextManager();
    const eventStore =
      options.eventStore ??
      (options.eventLogPath === undefined ? undefined : new FileEventStore(options.eventLogPath));
    const persistedEvents = eventStore?.load() ?? [];
    this.createId =
      options.idFactory ?? createIncrementingIdFactory(maxNumericRuntimeId(persistedEvents));
    const eventLogOptions =
      eventStore === undefined
        ? { initialEvents: persistedEvents }
        : { store: eventStore, initialEvents: persistedEvents };
    this.log = new EventLog(this.now, this.createId, eventLogOptions);
    if (options.modelProvider !== undefined) {
      this.model = options.modelProvider;
    } else if (
      options.modelConfig !== undefined &&
      options.modelConfig.provider === 'openai-compatible'
    ) {
      this.model = new OpenAICompatibleModelProvider(options.modelConfig, this.createId);
    } else {
      const apiKey = process.env.AGENT_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? '';
      if (apiKey.length > 0) {
        this.model = new OpenAICompatibleModelProvider({}, this.createId);
      } else {
        this.model = new DeterministicModelProvider();
      }
    }
    this.documentEngine = options.documentEngine ?? new LocalDocumentEngine();
    this.officeEngine = options.officeEngine ?? new ProductionOfficeEngine();
    this.evidenceVerifier =
      options.evidenceVerifier ??
      new EvidenceVerifier({
        now: this.now,
        idFactory: this.createId,
      });
    this.restoreFromEvents(persistedEvents);
    this.recoverInterruptedTurns();
  }

  private enablePowershellExecution = true;
  private maxHistoryRounds = 20;

  public setApprovalPolicy(policy: DefaultApprovalPolicy): void {
    this.approvalPolicy = policy;
  }

  public getApprovalPolicy(): DefaultApprovalPolicy {
    return this.approvalPolicy;
  }

  public setEnablePowershellExecution(enabled: boolean): void {
    this.enablePowershellExecution = enabled;
  }

  public isPowershellExecutionEnabled(): boolean {
    return this.enablePowershellExecution;
  }

  public setMaxHistoryRounds(rounds: number): void {
    this.maxHistoryRounds = Math.max(5, rounds);
  }

  public getMaxHistoryRounds(): number {
    return this.maxHistoryRounds;
  }

  public compactThreadMessages(threadId: string): CompactionResult {
    const thread = this.requireThread(threadId);
    const messages = this.threadMessages.get(thread.id) ?? [];
    const result = this.compactor.compact(messages, thread.id, this.createId, this.now);
    if (result.compacted) {
      this.threadMessages.set(thread.id, [...result.messages]);
      const checkpointMsg = result.messages[0];
      if (checkpointMsg) {
        this.log.append({
          type: 'message.created',
          threadId: thread.id,
          payload: checkpointMsg,
        });
      }
    }
    return result;
  }

  public createThread(input: CreateThreadInput): Thread {
    const timestamp = this.now();
    const threadBase = {
      id: this.createId('thread'),
      workspaceId: input.workspaceId,
      status: 'active' as const,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const thread: Thread =
      input.workspaceRoot === undefined
        ? threadBase
        : { ...threadBase, workspaceRoot: input.workspaceRoot };
    if (input.workspaceRoot !== undefined) {
      if (!existsSync(input.workspaceRoot)) {
        mkdirSync(input.workspaceRoot, { recursive: true });
      }
      const sandbox = new LocalWorkspaceSandbox({
        rootDir: input.workspaceRoot,
        policy: this.approvalPolicy,
        now: this.now,
        idFactory: this.createId,
        onDecision: (decision) => {
          this.log.append({
            type: 'sandbox.decision',
            threadId: thread.id,
            payload: decision,
          });
        },
      });
      this.sandboxes.set(thread.id, sandbox);
    }
    this.threads.set(thread.id, thread);
    this.log.append({ type: 'thread.created', threadId: thread.id, payload: thread });
    return thread;
  }

  public startTurn(input: StartTurnInput): Turn {
    const thread = this.requireThread(input.threadId);
    if (thread.status !== 'active') {
      throw new Error(`thread ${thread.id} is ${thread.status}`);
    }

    const timestamp = this.now();
    const turn: Turn = {
      id: this.createId('turn'),
      threadId: thread.id,
      input: input.input,
      status: 'awaiting_approval',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.turns.set(turn.id, turn);
    this.log.append({
      type: 'turn.started',
      threadId: thread.id,
      turnId: turn.id,
      payload: turn,
    });

    const planInput = {
      turnId: turn.id,
      userInput: input.input,
      workspaceFiles: this.getWorkspaceFiles(thread.id),
      tools: DEFAULT_AGENT_TOOLS,
    };
    const planOrPromise = this.model.proposePlan(planInput);
    if (planOrPromise instanceof Promise) {
      this.handleAsyncPlan(thread, turn, planOrPromise);
      return turn;
    }

    this.recordProposedPlan(thread, turn, planOrPromise);
    return turn;
  }

  public async startTurnAsync(input: StartTurnInput): Promise<Turn> {
    const thread = this.requireThread(input.threadId);
    if (thread.status !== 'active') {
      throw new Error(`thread ${thread.id} is ${thread.status}`);
    }

    const timestamp = this.now();
    const turn: Turn = {
      id: this.createId('turn'),
      threadId: thread.id,
      input: input.input,
      status: 'awaiting_approval',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.turns.set(turn.id, turn);
    this.log.append({
      type: 'turn.started',
      threadId: thread.id,
      turnId: turn.id,
      payload: turn,
    });

    const planInput = {
      turnId: turn.id,
      userInput: input.input,
      workspaceFiles: this.getWorkspaceFiles(thread.id),
      tools: DEFAULT_AGENT_TOOLS,
    };
    const plan = await this.model.proposePlan(planInput);
    this.recordProposedPlan(thread, turn, plan);
    return this.getTurn(turn.id);
  }

  private getWorkspaceFiles(threadId: string): readonly string[] {
    const sandbox = this.sandboxes.get(threadId);
    if (!sandbox) {
      return [];
    }
    try {
      return sandbox.listFiles();
    } catch {
      return [];
    }
  }

  private recordProposedPlan(thread: Thread, turn: Turn, plan: Plan): void {
    this.plans.set(plan.id, plan);
    this.log.append({
      type: 'plan.proposed',
      threadId: thread.id,
      turnId: turn.id,
      payload: plan,
    });

    const hasApprovalRequired = plan.steps.some((s) => s.requiresApproval);
    const approval: Approval = {
      id: this.createId('approval'),
      turnId: turn.id,
      planId: plan.id,
      status: 'pending',
      reason: hasApprovalRequired
        ? 'the plan includes an action requiring user approval'
        : 'the plan is ready for user review',
    };
    this.approvals.set(approval.id, approval);
    this.log.append({
      type: 'approval.requested',
      threadId: thread.id,
      turnId: turn.id,
      payload: approval,
    });
  }

  private handleAsyncPlan(thread: Thread, turn: Turn, planPromise: Promise<Plan>): void {
    planPromise
      .then((plan) => {
        this.recordProposedPlan(thread, turn, plan);
      })
      .catch(() => {
        this.updateTurn(thread, turn, 'failed');
      });
  }

  public respondApproval(input: RespondApprovalInput): Approval {
    const approval = this.approvals.get(input.approvalId);
    if (!approval) {
      throw new Error(`approval ${input.approvalId} not found`);
    }
    if (approval.status !== 'pending') {
      throw new Error(`approval ${approval.id} is already ${approval.status}`);
    }

    const turn = this.requireTurn(approval.turnId);
    const thread = this.requireThread(turn.threadId);
    const resolvedAt = this.now();
    const resolved: Approval = {
      ...approval,
      status: input.decision,
      resolvedAt,
    };
    this.approvals.set(resolved.id, resolved);
    this.log.append({
      type: 'approval.resolved',
      threadId: thread.id,
      turnId: turn.id,
      payload: resolved,
    });

    if (input.decision === 'rejected') {
      this.updateTurn(thread, turn, 'cancelled');
      return resolved;
    }

    const plan = this.requirePlan(approval.planId);
    this.plans.set(plan.id, { ...plan, status: 'approved' });
    const executingTurn = this.updateTurn(thread, turn, 'executing');
    this.executeApprovedTurn(thread, executingTurn, plan);
    return resolved;
  }

  public async respondApprovalAsync(input: RespondApprovalInput): Promise<Approval> {
    const approval = this.respondApproval(input);
    if (input.decision === 'rejected') {
      return approval;
    }
    const turn = this.requireTurn(approval.turnId);
    const pending = this.pendingTurnExecutions.get(turn.id);
    if (pending) {
      await pending;
    }
    return approval;
  }

  public async waitForTurnCompletion(turnId: string, timeoutMs = 5000): Promise<Turn> {
    const turn = this.requireTurn(turnId);
    if (terminalTurnStatuses.includes(turn.status)) {
      return turn;
    }
    const pending = this.pendingTurnExecutions.get(turnId);
    if (pending) {
      await pending;
      return this.requireTurn(turnId);
    }
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const current = this.requireTurn(turnId);
      if (terminalTurnStatuses.includes(current.status)) {
        return current;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return this.requireTurn(turnId);
  }

  public pause(threadId: string): void {
    const thread = this.requireThread(threadId);
    if (thread.status !== 'active') {
      throw new Error(`thread ${thread.id} is ${thread.status}`);
    }
    const turn = this.currentTurn(thread.id);
    if (turn && !terminalTurnStatuses.includes(turn.status)) {
      this.pausedTurnStatuses.set(turn.id, turn.status);
      this.updateTurn(thread, turn, 'paused');
    }
    this.updateThread(thread, 'paused');
  }

  public resumeThread(threadId: string): void {
    const thread = this.requireThread(threadId);
    if (thread.status !== 'paused') {
      throw new Error(`thread ${thread.id} is ${thread.status}`);
    }
    this.updateThread(thread, 'active');
    const turn = this.currentTurn(thread.id);
    if (!turn || turn.status !== 'paused') {
      return;
    }
    const previousStatus = this.pausedTurnStatuses.get(turn.id) ?? 'awaiting_approval';
    this.pausedTurnStatuses.delete(turn.id);
    this.updateTurn(thread, turn, previousStatus);
  }

  public cancel(threadId: string): void {
    const thread = this.requireThread(threadId);
    if (thread.status !== 'active' && thread.status !== 'paused') {
      throw new Error(`thread ${thread.id} is ${thread.status}`);
    }
    const turn = this.currentTurn(thread.id);
    if (turn && !terminalTurnStatuses.includes(turn.status)) {
      this.updateTurn(thread, turn, 'cancelled');
    }
    this.updateThread(thread, 'cancelled');
  }

  public getThread(threadId: string): Thread {
    return this.requireThread(threadId);
  }

  public listThreads(): readonly Thread[] {
    return [...this.threads.values()];
  }

  public getTurn(turnId: string): Turn {
    return this.requireTurn(turnId);
  }

  public listEvents(threadId: string): readonly AnyRuntimeEvent[] {
    return this.log.list(threadId);
  }

  public listAllEvents(): readonly AnyRuntimeEvent[] {
    return this.log.listAll();
  }

  public subscribeEvents(listener: (event: AnyRuntimeEvent) => void): () => void {
    return this.log.subscribe(listener);
  }

  public checkSandbox(threadId: string, input: SandboxCheckInput): SandboxDecision {
    return this.requireSandbox(threadId).check(input);
  }

  public readWorkspaceFile(threadId: string, targetPath: string): string {
    return this.requireSandbox(threadId).readFile(targetPath);
  }

  public readWorkspaceFileBuffer(threadId: string, targetPath: string): Buffer {
    return this.requireSandbox(threadId).readFileBuffer(targetPath);
  }

  public writeArtifact(
    threadId: string,
    artifactName: string,
    content: string,
  ): ArtifactWriteResult {
    return this.requireSandbox(threadId).writeArtifact(artifactName, content);
  }

  public writeArtifactBuffer(
    threadId: string,
    artifactName: string,
    content: Uint8Array,
  ): ArtifactWriteResult {
    return this.requireSandbox(threadId).writeArtifactBuffer(artifactName, content);
  }

  public verifyArtifact(
    threadId: string,
    artifactName: string,
    options: Omit<VerificationRequest, 'artifactPath'> = {},
  ): VerificationResult {
    const artifactPath = this.requireSandbox(threadId).artifactPath(artifactName);
    return this.evidenceVerifier.verify({ artifactPath, ...options });
  }

  public createToolContext(thread: Thread): ToolContext {
    const sandbox = this.requireSandbox(thread.id);
    return {
      thread,
      sandbox,
      approvalPolicy: this.approvalPolicy,
      officeEngine: this.officeEngine,
      documentEngine: this.documentEngine,
      processRunner: this.processRunner,
      mcpBridge: this.mcpBridge,
      enablePowershellExecution: this.enablePowershellExecution,
      verifyArtifact: (threadId, artifactName) => this.verifyArtifact(threadId, artifactName),
      now: () => this.now(),
    };
  }

  private executeApprovedTurn(thread: Thread, turn: Turn, plan: Plan): void {
    const step = plan.steps[0];
    if (!step) {
      this.updateTurn(thread, turn, 'failed');
      return;
    }

    if (!this.sandboxes.has(thread.id)) {
      const tempDir = mkdtempSync(join(tmpdir(), `agent-ws-${thread.id}-`));
      (thread as { workspaceRoot?: string }).workspaceRoot = tempDir;
      const sandbox = new LocalWorkspaceSandbox({
        rootDir: tempDir,
        policy: this.approvalPolicy,
        now: this.now,
        idFactory: this.createId,
        onDecision: (decision) => {
          this.log.append({
            type: 'sandbox.decision',
            threadId: thread.id,
            payload: decision,
          });
        },
      });
      this.sandboxes.set(thread.id, sandbox);
    }

    const toolId = this.createId('tool');
    this.logToolStarted(thread, {
      id: toolId,
      turnId: turn.id,
      planStepId: step.id,
      toolName: step.toolName,
      status: 'running',
    });

    const stepArgs = step.arguments ?? {};
    const targetArtifact =
      step.targetArtifact ||
      (stepArgs.target as string) ||
      (stepArgs.path as string) ||
      (step.toolName === 'office.process_excel' || step.toolName === 'workspace.excel'
        ? 'sales-summary.xlsx'
        : 'weekly-meeting-report.docx');

    const context = this.createToolContext(thread);
    const handler = this.toolRegistry.findHandler(step.toolName);

    if (!handler) {
      const result: ToolExecution = {
        id: toolId,
        turnId: turn.id,
        planStepId: step.id,
        toolName: step.toolName,
        status: 'failed',
        error: `未知工具: "${step.toolName}"`,
      };
      this.finishToolExecution(thread, turn, result, targetArtifact);
      return;
    }

    try {
      const execResult = handler.execute(step.toolName, stepArgs, context);
      if (execResult instanceof Promise) {
        const promise = execResult
          .then((output) => {
            if (output.startsWith('[执行失败]') || output.startsWith('[安全拒绝]')) {
              const result: ToolExecution = {
                id: toolId,
                turnId: turn.id,
                planStepId: step.id,
                toolName: step.toolName,
                status: 'failed',
                error: output,
              };
              this.finishToolExecution(thread, turn, result, targetArtifact);
              return;
            }
            const result: ToolExecution = {
              id: toolId,
              turnId: turn.id,
              planStepId: step.id,
              toolName: step.toolName,
              status: 'completed',
              output,
            };
            this.finishToolExecution(thread, turn, result, targetArtifact);
          })
          .catch((error) => {
            const result: ToolExecution = {
              id: toolId,
              turnId: turn.id,
              planStepId: step.id,
              toolName: step.toolName,
              status: 'failed',
              error: errorMessage(error),
            };
            this.finishToolExecution(thread, turn, result, targetArtifact);
          });
        this.pendingTurnExecutions.set(turn.id, promise);
        promise.finally(() => {
          this.pendingTurnExecutions.delete(turn.id);
        });
      } else {
        if (execResult.startsWith('[执行失败]') || execResult.startsWith('[安全拒绝]')) {
          const result: ToolExecution = {
            id: toolId,
            turnId: turn.id,
            planStepId: step.id,
            toolName: step.toolName,
            status: 'failed',
            error: execResult,
          };
          this.finishToolExecution(thread, turn, result, targetArtifact);
          return;
        }
        const result: ToolExecution = {
          id: toolId,
          turnId: turn.id,
          planStepId: step.id,
          toolName: step.toolName,
          status: 'completed',
          output: execResult,
        };
        this.finishToolExecution(thread, turn, result, targetArtifact);
      }
    } catch (error) {
      const result: ToolExecution = {
        id: toolId,
        turnId: turn.id,
        planStepId: step.id,
        toolName: step.toolName,
        status: 'failed',
        error: errorMessage(error),
      };
      this.finishToolExecution(thread, turn, result, targetArtifact);
    }
  }

  private logToolStarted(thread: Thread, result: ToolExecution): void {
    this.log.append({
      type: 'tool.started',
      threadId: thread.id,
      turnId: result.turnId,
      payload: {
        id: result.id,
        turnId: result.turnId,
        planStepId: result.planStepId,
        toolName: result.toolName,
        status: 'running',
      },
    });
  }

  private finishToolExecution(
    thread: Thread,
    turn: Turn,
    result: ToolExecution,
    artifactName?: string,
  ): void {
    if (result.status === 'failed') {
      this.log.append({
        type: 'tool.failed',
        threadId: thread.id,
        turnId: turn.id,
        payload: result,
      });
      this.updateTurn(thread, turn, 'failed');
      return;
    }

    if (result.status === 'reconciliation_required') {
      this.log.append({
        type: 'tool.reconciliation_required',
        threadId: thread.id,
        turnId: turn.id,
        payload: result,
      });
      this.updateThread(thread, 'reconciliation_required');
      this.updateTurn(thread, turn, 'reconciliation_required');
      return;
    }

    this.log.append({
      type: 'tool.completed',
      threadId: thread.id,
      turnId: turn.id,
      payload: result,
    });

    const producesArtifact = Boolean(
      artifactName && (
        result.toolName.includes('excel') ||
        result.toolName.includes('word') ||
        result.toolName.includes('report') ||
        result.toolName === 'workspace.write_file' ||
        artifactName.endsWith('.docx') ||
        artifactName.endsWith('.xlsx')
      )
    );

    if (producesArtifact && artifactName) {
      const verifyingTurn = this.updateTurn(thread, turn, 'verifying');
      this.verifyGeneratedArtifact(thread, verifyingTurn, artifactName);
    } else {
      this.updateTurn(thread, turn, 'completed');
    }
  }

  private verifyGeneratedArtifact(
    thread: Thread,
    turn: Turn,
    artifactName = 'weekly-meeting-report.docx',
  ): void {
    const verificationId = this.createId('verification');
    const started: ArtifactVerification = {
      id: verificationId,
      turnId: turn.id,
      artifactName,
      status: 'running',
    };
    this.log.append({
      type: 'artifact.verification_started',
      threadId: thread.id,
      turnId: turn.id,
      payload: started,
    });

    const verification = this.verifyWorkspaceArtifact(thread, turn, artifactName, verificationId);
    if (verification.status === 'verified') {
      this.log.append({
        type: 'artifact.verified',
        threadId: thread.id,
        turnId: turn.id,
        payload: verification,
      });
      this.updateTurn(thread, turn, 'completed');
      return;
    }

    if (verification.status === 'reconciliation_required') {
      this.log.append({
        type: 'artifact.reconciliation_required',
        threadId: thread.id,
        turnId: turn.id,
        payload: verification,
      });
      this.updateThread(thread, 'reconciliation_required');
      this.updateTurn(thread, turn, 'reconciliation_required');
      return;
    }

    this.log.append({
      type: 'artifact.verification_failed',
      threadId: thread.id,
      turnId: turn.id,
      payload: verification,
    });
    this.updateTurn(thread, turn, 'failed');
  }

  private verifyWorkspaceArtifact(
    thread: Thread,
    turn: Turn,
    artifactName: string,
    verificationId: string,
  ): ArtifactVerification {
    try {
      const artifactPath = this.requireSandbox(thread.id).artifactPath(artifactName);
      const lower = artifactName.toLowerCase();
      const isXlsx = lower.endsWith('.xlsx');
      const isJson = lower.endsWith('.json');
      const isDocx = lower.endsWith('.docx');

      const verificationOptions: Omit<VerificationRequest, 'artifactPath'> = isXlsx
        ? {
            requireXlsxStructure: true,
            requireDocxStructure: false,
          }
        : isJson
          ? {
              requireJsonStructure: true,
            }
          : isDocx
            ? {
                ...(lower.includes('weekly-meeting-report')
                  ? { requiredText: ['Weekly Meeting Report'] }
                  : {}),
                requireDocxStructure: true,
                requireXlsxStructure: false,
              }
            : {};

      const result = this.evidenceVerifier.verify({
        artifactPath,
        ...verificationOptions,
      });
      const evidence = [
        ...result.evidence,
        ...result.checks.map((check) => `${check.name}:${check.status}`),
      ];
      if (result.status === 'VERIFIED' || result.status === 'PARTIALLY_COMPLETED') {
        return { id: verificationId, turnId: turn.id, artifactName, status: 'verified', evidence };
      }
      if (result.status === 'RECONCILIATION_REQUIRED') {
        return {
          id: verificationId,
          turnId: turn.id,
          artifactName,
          status: 'reconciliation_required',
          evidence,
          error: result.summary,
        };
      }
      return {
        id: verificationId,
        turnId: turn.id,
        artifactName,
        status: 'failed',
        evidence,
        error: result.summary,
      };
    } catch (error) {
      return {
        id: verificationId,
        turnId: turn.id,
        artifactName,
        status: 'failed',
        error: errorMessage(error),
      };
    }
  }

  private restoreFromEvents(events: readonly AnyRuntimeEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'thread.created':
          this.threads.set(event.payload.id, event.payload);
          this.restoreSandbox(event.payload);
          break;
        case 'thread.status_changed':
          this.threads.set(event.payload.id, event.payload);
          break;
        case 'turn.started':
          this.turns.set(event.payload.id, event.payload);
          break;
        case 'turn.status_changed': {
          const previous = this.turns.get(event.payload.id);
          if (event.payload.status === 'paused' && previous !== undefined) {
            this.pausedTurnStatuses.set(event.payload.id, previous.status);
          } else if (event.payload.status !== 'paused') {
            this.pausedTurnStatuses.delete(event.payload.id);
          }
          this.turns.set(event.payload.id, event.payload);
          break;
        }
        case 'plan.proposed':
          this.plans.set(event.payload.id, event.payload);
          break;
        case 'approval.requested':
          this.approvals.set(event.payload.id, event.payload);
          break;
        case 'approval.resolved': {
          this.approvals.set(event.payload.id, event.payload);
          const plan = this.plans.get(event.payload.planId);
          if (plan !== undefined) {
            this.plans.set(plan.id, {
              ...plan,
              status: event.payload.status === 'approved' ? 'approved' : 'rejected',
            });
          }
          break;
        }
        case 'message.created': {
          const msg = event.payload;
          const list = this.threadMessages.get(msg.threadId) ?? [];
          list.push(msg);
          this.threadMessages.set(msg.threadId, list);
          break;
        }
        default:
          break;
      }
    }
  }

  private restoreSandbox(thread: Thread): void {
    if (thread.workspaceRoot === undefined) {
      return;
    }
    try {
      const sandbox = new LocalWorkspaceSandbox({
        rootDir: thread.workspaceRoot,
        now: this.now,
        idFactory: this.createId,
        onDecision: (decision) => {
          this.log.append({
            type: 'sandbox.decision',
            threadId: thread.id,
            payload: decision,
          });
        },
      });
      this.sandboxes.set(thread.id, sandbox);
    } catch {
      // Keep the historical thread even when its workspace moved or disappeared.
    }
  }

  private recoverInterruptedTurns(): void {
    for (const turn of [...this.turns.values()]) {
      if (turn.status !== 'executing' && turn.status !== 'verifying') {
        continue;
      }
      const thread = this.requireThread(turn.threadId);
      if (thread.status === 'active') {
        this.updateThread(thread, 'reconciliation_required');
      }
      const currentTurn = this.requireTurn(turn.id);
      if (currentTurn.status === 'executing' || currentTurn.status === 'verifying') {
        this.updateTurn(thread, currentTurn, 'reconciliation_required');
      }
    }
  }

  private updateTurn(thread: Thread, current: Turn, nextStatus: TurnStatus): Turn {
    const status = transitionTurnStatus(current.status, nextStatus);
    const next: Turn = {
      ...current,
      status,
      updatedAt: this.now(),
    };
    this.turns.set(next.id, next);
    this.log.append({
      type: 'turn.status_changed',
      threadId: thread.id,
      turnId: next.id,
      payload: next,
    });
    return next;
  }

  private updateThread(current: Thread, nextStatus: ThreadStatus): Thread {
    const status = transitionThreadStatus(current.status, nextStatus);
    const next: Thread = {
      ...current,
      status,
      updatedAt: this.now(),
    };
    this.threads.set(next.id, next);
    this.log.append({
      type: 'thread.status_changed',
      threadId: next.id,
      payload: next,
    });
    return next;
  }

  private currentTurn(threadId: string): Turn | undefined {
    const turns = [...this.turns.values()].filter((turn) => turn.threadId === threadId);
    return turns.at(-1);
  }

  private requireSandbox(threadId: string): LocalWorkspaceSandbox {
    const thread = this.requireThread(threadId);
    const sandbox = this.sandboxes.get(thread.id);
    if (!sandbox) {
      throw new Error(`thread ${thread.id} has no workspaceRoot`);
    }
    return sandbox;
  }

  private requireThread(threadId: string): Thread {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error(`thread ${threadId} not found`);
    }
    return thread;
  }

  private requireTurn(turnId: string): Turn {
    const turn = this.turns.get(turnId);
    if (!turn) {
      throw new Error(`turn ${turnId} not found`);
    }
    return turn;
  }

  private requirePlan(planId: string): Plan {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new Error(`plan ${planId} not found`);
    }
    return plan;
  }

  public listMessages(threadId: string): readonly ChatMessage[] {
    return [...(this.threadMessages.get(threadId) ?? [])];
  }

  public appendMessage(message: ChatMessage): ChatMessage {
    const list = this.threadMessages.get(message.threadId) ?? [];
    list.push(message);
    this.threadMessages.set(message.threadId, list);
    this.log.append({
      type: 'message.created',
      threadId: message.threadId,
      payload: message,
    });
    return message;
  }

  public updateMessage(message: ChatMessage): ChatMessage {
    const list = this.threadMessages.get(message.threadId) ?? [];
    const index = list.findIndex((m) => m.id === message.id);
    if (index >= 0) {
      list[index] = message;
    } else {
      list.push(message);
    }
    this.threadMessages.set(message.threadId, list);
    this.log.append({
      type: 'message.updated',
      threadId: message.threadId,
      payload: message,
    });
    return message;
  }

  public async sendMessage(
    threadId: string,
    content: string,
    options?: {
      skillId?: string;
      systemPrompt?: string;
      maxSteps?: number;
    },
  ): Promise<ChatMessage> {
    const thread = this.requireThread(threadId);
    if (options?.skillId) {
      this.threadActiveSkills.set(thread.id, options.skillId);
    }
    const activeSkillId = options?.skillId ?? this.threadActiveSkills.get(thread.id);
    const activeSkill = activeSkillId ? this.skillRegistry.get(activeSkillId) : undefined;
    const effectivePrompt = options?.systemPrompt ?? activeSkill?.systemPrompt;
    const timestamp = this.now();
    const turn: Turn = {
      id: this.createId('turn'),
      threadId: thread.id,
      input: content,
      status: 'executing',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.turns.set(turn.id, turn);
    this.log.append({
      type: 'turn.started',
      threadId: thread.id,
      turnId: turn.id,
      payload: turn,
    });

    const finishTurn = (status: TurnStatus = 'completed') => {
      const completedTurn: Turn = {
        ...turn,
        status,
        updatedAt: this.now(),
      };
      this.turns.set(turn.id, completedTurn);
      this.log.append({
        type: 'turn.status_changed',
        threadId: thread.id,
        turnId: turn.id,
        payload: completedTurn,
      });
    };

    const userMsg: ChatMessage = {
      id: this.createId('msg'),
      threadId: thread.id,
      role: 'user',
      content,
      createdAt: timestamp,
    };
    this.appendMessage(userMsg);

    // 意图分析与路由分流
    const sandbox = this.sandboxes.get(thread.id);
    const workspaceFiles = sandbox ? sandbox.listFiles() : undefined;
    const intentResult = IntentRouter.route(content, { workspaceFiles });

    this.log.append({
      type: 'intent.classified',
      threadId: thread.id,
      payload: {
        intent: intentResult.intent,
        confidence: intentResult.confidence,
        reasoning: intentResult.reasoning,
        suggestedMode: intentResult.suggestedMode,
      },
    });

    // 1. 如果是纯对话 (chat_direct)，无需组装工具和规划，毫秒直出
    if (intentResult.intent === 'chat_direct') {
      const allMsgs = this.threadMessages.get(thread.id) ?? [];
      const pruned = pruneContextMessages(allMsgs);
      let output: ModelChatOutput;

      let streamingMsg: ChatMessage = {
        id: this.createId('msg'),
        threadId: thread.id,
        role: 'assistant',
        content: '',
        createdAt: this.now(),
      };
      let hasAppended = false;

      if (typeof this.model.chatCompletion === 'function') {
        output = await this.model.chatCompletion({
          messages: pruned,
          tools: [], // 纯对话禁用工具，防止模型误触发或胡思乱想
          workspaceFiles,
          systemPrompt: effectivePrompt ?? '你是一个亲切、专业的智能桌面架构师助手，直接用中文清晰回答用户问题。',
          onChunk: (chunk) => {
            if (!hasAppended) {
              this.appendMessage(streamingMsg);
              hasAppended = true;
            }
            streamingMsg = {
              ...streamingMsg,
              content: (streamingMsg.content || '') + (chunk.deltaContent ?? ''),
              ...(chunk.deltaReasoning
                ? { reasoningContent: (streamingMsg.reasoningContent || '') + chunk.deltaReasoning }
                : {}),
            };
            this.updateMessage(streamingMsg);
          },
        });
      } else {
        output = { content: '你好！我是您的智能助手，有什么可以帮您的吗？' };
      }

      const directMsg: ChatMessage = {
        id: streamingMsg.id,
        threadId: thread.id,
        role: 'assistant',
        content: output.content || streamingMsg.content || '您好，我随时可以为您提供帮助。',
        ...(output.reasoningContent || streamingMsg.reasoningContent
          ? { reasoningContent: output.reasoningContent || streamingMsg.reasoningContent }
          : {}),
        createdAt: streamingMsg.createdAt,
      };
      if (hasAppended) {
        this.updateMessage(directMsg);
      } else {
        this.appendMessage(directMsg);
      }
      finishTurn();
      return directMsg;
    }

    // 2. 需求模糊反问 (clarification_needed)
    if (intentResult.intent === 'clarification_needed') {
      const tableFiles = workspaceFiles?.filter((f) => f.endsWith('.csv') || f.endsWith('.xlsx')) ?? [];
      const docFiles = workspaceFiles?.filter((f) => f.endsWith('.md') || f.endsWith('.txt')) ?? [];
      const codeFiles = workspaceFiles?.filter((f) => f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.py')) ?? [];

      const options: string[] = [];
      if (tableFiles.length > 0) {
        options.push(`分析或汇总表格数据（如 ${tableFiles.slice(0, 2).join(', ')}）`);
      }
      if (docFiles.length > 0) {
        options.push(`整理参考材料并生成结构化报告（如 ${docFiles.slice(0, 2).join(', ')}）`);
      }
      if (codeFiles.length > 0) {
        options.push(`排查或运行代码与脚本（如 ${codeFiles.slice(0, 2).join(', ')}）`);
      }
      if (options.length === 0) {
        options.push('在工作区中读取、创建或修改指定文件');
        options.push('运行受控脚本或调用工具处理数据');
        options.push('提供专业技术解答与架构规划咨询');
      }

      const suggestions = options.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
      const clarifyText = `收到您的指令。当前指令较为简略，为了更精准地执行，请问您具体希望处理哪个目标？例如：\n${suggestions}\n\n您可以直接补充文件路径或详细描述期望结果。`;
      const clarifyMsg: ChatMessage = {
        id: this.createId('msg'),
        threadId: thread.id,
        role: 'assistant',
        content: clarifyText,
        createdAt: this.now(),
      };
      this.appendMessage(clarifyMsg);
      finishTurn();
      return clarifyMsg;
    }

    // 3. 只读探索 (read_only_explore) 或 任务执行 (task_execution)：运行增强型 Agent ReAct loop
    try {
      const maxSteps = options?.maxSteps ?? 8;
      let step = 0;
      let lastAssistantMsg: ChatMessage = {
        id: this.createId('msg'),
        threadId: thread.id,
        role: 'assistant',
        content: '',
        createdAt: this.now(),
      };

      const rawTools = [...DEFAULT_AGENT_TOOLS, ...this.mcpBridge.toAgentTools()];
      const filteredTools = intentResult.intent === 'read_only_explore'
        ? rawTools.filter((t) => t.risk === 'read')
        : rawTools;
      const tools = pruneToolsForSkill(filteredTools, activeSkill);

      // 注入 Grounding 和自愈提示词脚手架
      const basePrompt = effectivePrompt ?? PromptBuilder.buildGroundingPrompt({
        tools,
        workspaceFiles,
        activeSkillPrompt: activeSkill?.systemPrompt,
      });

      while (step < maxSteps) {
        step += 1;

        // 使用 ContextManager 组织分层上下文并折叠长工具输出
        const allMsgs = this.threadMessages.get(thread.id) ?? [];
        const layered = this.contextManager.buildLayeredMessages({
          systemPrompt: basePrompt,
          messages: allMsgs,
          workspaceFiles,
        });
        const pruned = pruneContextMessages(layered);

        let output: ModelChatOutput;

        let streamingMsg: ChatMessage = {
          id: this.createId('msg'),
          threadId: thread.id,
          role: 'assistant',
          content: '',
          createdAt: this.now(),
        };
        let streamAppended = false;

        if (typeof this.model.chatCompletion === 'function') {
          output = await this.model.chatCompletion({
            messages: pruned,
            tools,
            workspaceFiles,
            systemPrompt: basePrompt,
            onChunk: (chunk) => {
              if (!streamAppended) {
                this.appendMessage(streamingMsg);
                streamAppended = true;
              }
              streamingMsg = {
                ...streamingMsg,
                content: (streamingMsg.content || '') + (chunk.deltaContent ?? ''),
                ...(chunk.deltaReasoning
                  ? { reasoningContent: (streamingMsg.reasoningContent || '') + chunk.deltaReasoning }
                  : {}),
              };
              this.updateMessage(streamingMsg);
            },
          });
        } else {
          output = {
            content: `已为您处理工作区任务，共探索 ${step} 步。`,
          };
        }

        if (!output.toolCalls || output.toolCalls.length === 0) {
          const finalMsg: ChatMessage = {
            id: streamingMsg.id,
            threadId: thread.id,
            role: 'assistant',
            content: output.content || streamingMsg.content,
            ...(output.reasoningContent || streamingMsg.reasoningContent
              ? { reasoningContent: output.reasoningContent || streamingMsg.reasoningContent }
              : {}),
            createdAt: streamingMsg.createdAt,
          };
          if (streamAppended) {
            this.updateMessage(finalMsg);
          } else {
            this.appendMessage(finalMsg);
          }
          lastAssistantMsg = finalMsg;
          break;
        }

        const assistantCallMsg: ChatMessage = {
          id: streamingMsg.id,
          threadId: thread.id,
          role: 'assistant',
          content: output.content || streamingMsg.content,
          ...(output.reasoningContent || streamingMsg.reasoningContent
            ? { reasoningContent: output.reasoningContent || streamingMsg.reasoningContent }
            : {}),
          toolCalls: output.toolCalls,
          createdAt: streamingMsg.createdAt,
        };
        if (streamAppended) {
          this.updateMessage(assistantCallMsg);
        } else {
          this.appendMessage(assistantCallMsg);
        }
        lastAssistantMsg = assistantCallMsg;

        for (const tc of output.toolCalls) {
          const toolExecId = this.createId('tool-exec');
          this.log.append({
            type: 'tool.started',
            threadId: thread.id,
            turnId: turn.id,
            payload: {
              id: toolExecId,
              turnId: turn.id,
              toolName: tc.name,
              status: 'running',
              arguments: tc.arguments,
            },
          });

          let toolResult = '';
          let toolFailed = false;
          try {
            toolResult = await this.executeToolCall(thread, tc);
          } catch (err) {
            toolFailed = true;
            toolResult = `工具执行异常: ${errorMessage(err)}`;
          }

          this.log.append({
            type: toolFailed ? 'tool.failed' : 'tool.completed',
            threadId: thread.id,
            turnId: turn.id,
            payload: {
              id: toolExecId,
              turnId: turn.id,
              toolName: tc.name,
              status: toolFailed ? 'failed' : 'completed',
              output: toolResult,
              ...(toolFailed ? { error: toolResult } : {}),
            },
          });

          const toolMsg: ChatMessage = {
            id: this.createId('msg'),
            threadId: thread.id,
            role: 'tool',
            toolCallId: tc.id,
            name: tc.name,
            content: toolResult,
            createdAt: this.now(),
          };
          this.appendMessage(toolMsg);
        }
      }

      finishTurn('completed');
      return lastAssistantMsg;
    } catch (err) {
      finishTurn('failed');
      throw err;
    }
  }

  public async executeToolCall(thread: Thread, toolCall: ToolCall): Promise<string> {
    const context = this.createToolContext(thread);
    return await this.toolRegistry.execute(toolCall.name, toolCall.arguments ?? {}, context);
  }

  public getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  public listSkills(): readonly AgentSkill[] {
    return this.skillRegistry.list();
  }

  public getSkill(id: string): AgentSkill | undefined {
    return this.skillRegistry.get(id);
  }

  public registerSkill(skill: AgentSkill): void {
    this.skillRegistry.register(skill);
  }

  public setThreadSkill(threadId: string, skillId: string): void {
    this.threadActiveSkills.set(threadId, skillId);
  }

  public getThreadSkill(threadId: string): AgentSkill | undefined {
    const id = this.threadActiveSkills.get(threadId);
    return id ? this.skillRegistry.get(id) : undefined;
  }

  public getMcpBridge(): McpBridge {
    return this.mcpBridge;
  }

  public getSkillRegistry(): SkillRegistry {
    return this.skillRegistry;
  }

  public scanWorkspaceSkills(workspacePath: string): readonly AgentSkill[] {
    return this.skillRegistry.scanWorkspace(workspacePath);
  }
}

export function pruneToolsForSkill(
  tools: readonly AgentToolDefinition[],
  skill?: AgentSkill,
): readonly AgentToolDefinition[] {
  if (!skill?.requiredTools || skill.requiredTools.length === 0) {
    return tools;
  }
  const requiredSet = new Set(skill.requiredTools);
  const essentialTools = new Set(['workspace.read_file', 'workspace.list_files']);

  return tools.filter((t) => {
    if (essentialTools.has(t.name) || requiredSet.has(t.name)) {
      return true;
    }
    if (t.name.startsWith('mcp.')) {
      if (skill.allowedMcpServers && skill.allowedMcpServers.length > 0) {
        const parts = t.name.split('.');
        const serverId = parts[1];
        return serverId !== undefined && skill.allowedMcpServers.includes(serverId);
      }
    }
    return false;
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

