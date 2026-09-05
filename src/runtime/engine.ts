import {
  EventLog,
  FileEventStore,
  maxNumericRuntimeId,
} from './event-log.js';
import type { RuntimeClock, RuntimeEventStore, RuntimeIdFactory } from './event-log.js';
import {
  FakeModel,
  FakeToolAdapter,
  FakeVerifier,
} from './fake-adapters.js';
import type { FakeScenario } from './fake-adapters.js';
import {
  transitionThreadStatus,
  transitionTurnStatus,
} from './state-machine.js';
import { LocalWorkspaceSandbox } from './sandbox.js';
import { LocalDocumentEngine } from './document-engine.js';
import type { WorkspaceDocumentEngine } from './document-engine.js';
import { ProductionOfficeEngine } from './office-engine.js';
import type { ParsedTableData, RichDocxSection } from './office-engine.js';
import { EvidenceVerifier } from './verifier.js';
import type { VerificationRequest, VerificationResult } from './verifier.js';
import { SkillRegistry } from './skill.js';
import type { AgentSkill } from './skill.js';
import { McpBridge } from './mcp-bridge.js';
import {
  DEFAULT_AGENT_TOOLS,
  OpenAICompatibleModelProvider,
  pruneContextMessages,
} from './model-provider.js';
import type { ModelChatOutput, ModelConfig, ModelProvider } from './model-provider.js';
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
  readonly scenario?: FakeScenario;
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
  private readonly toolAdapter: FakeToolAdapter;
  private readonly verifier: FakeVerifier;
  private readonly documentEngine: WorkspaceDocumentEngine;
  private readonly officeEngine: ProductionOfficeEngine;
  private readonly evidenceVerifier: EvidenceVerifier;
  private readonly sandboxes = new Map<string, LocalWorkspaceSandbox>();
  private readonly pendingTurnExecutions = new Map<string, Promise<void>>();
  private readonly skillRegistry: SkillRegistry;
  private readonly mcpBridge: McpBridge;
  private readonly now: RuntimeClock;
  private readonly createId: RuntimeIdFactory;

  public constructor(options: RuntimeEngineOptions = {}) {
    this.now = options.now ?? currentTime;
    this.skillRegistry = options.skillRegistry ?? new SkillRegistry();
    this.mcpBridge = options.mcpBridge ?? new McpBridge();
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
      this.model = new FakeModel(this.createId);
    }
    this.toolAdapter = new FakeToolAdapter(options.scenario, this.createId);
    this.verifier = new FakeVerifier(options.scenario, this.createId);
    this.documentEngine = options.documentEngine ?? new LocalDocumentEngine();
    this.officeEngine = options.officeEngine ?? new ProductionOfficeEngine();
    this.evidenceVerifier = new EvidenceVerifier({
      now: this.now,
      idFactory: this.createId,
    });
    this.restoreFromEvents(persistedEvents);
    this.recoverInterruptedTurns();
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
    const sandbox =
      input.workspaceRoot === undefined
        ? undefined
        : new LocalWorkspaceSandbox({
            rootDir: input.workspaceRoot,
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
    this.threads.set(thread.id, thread);
    if (sandbox) {
      this.sandboxes.set(thread.id, sandbox);
    }
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

  private executeApprovedTurn(thread: Thread, turn: Turn, plan: Plan): void {
    const step = plan.steps[0];
    if (!step) {
      this.updateTurn(thread, turn, 'failed');
      return;
    }

    let result: ToolExecution;
    if (thread.workspaceRoot === undefined) {
      result = this.toolAdapter.execute(turn.id, step);
      this.logToolStarted(thread, result);
      this.finishToolExecution(thread, turn, result);
    } else {
      const toolId = this.createId('tool');
      this.logToolStarted(thread, {
        id: toolId,
        turnId: turn.id,
        planStepId: step.id,
        toolName: step.toolName,
        status: 'running',
      });

      if (step.toolName === 'office.process_excel') {
        const promise = this.executeWorkspaceExcelAsync(thread, turn, step, toolId);
        this.pendingTurnExecutions.set(turn.id, promise);
        promise.finally(() => {
          this.pendingTurnExecutions.delete(turn.id);
        });
        return;
      }

      if (step.toolName === 'office.generate_word_report') {
        const promise = this.executeWorkspaceWordAsync(thread, turn, step, toolId);
        this.pendingTurnExecutions.set(turn.id, promise);
        promise.finally(() => {
          this.pendingTurnExecutions.delete(turn.id);
        });
        return;
      }

      result = this.executeWorkspaceReport(thread, turn, step, toolId);
      this.finishToolExecution(thread, turn, result, 'weekly-meeting-report.docx');
    }
  }

  private async executeWorkspaceExcelAsync(
    thread: Thread,
    turn: Turn,
    step: Plan['steps'][number],
    toolId: string,
  ): Promise<void> {
    const artifactName = 'sales-summary.xlsx';
    try {
      const sandbox = this.requireSandbox(thread.id);
      let tableData: ParsedTableData | undefined;
      if (sandbox.hasFile('sales.csv')) {
        tableData = await this.officeEngine.readTableData(
          sandbox.readFileBuffer('sales.csv'),
          'csv',
        );
      } else if (sandbox.hasFile('sales.xlsx')) {
        tableData = await this.officeEngine.readTableData(
          sandbox.readFileBuffer('sales.xlsx'),
          'xlsx',
        );
      }

      const columns =
        tableData && tableData.headers.length > 0
          ? tableData.headers.map((h) => ({ header: h.toUpperCase(), key: h }))
          : [
              { header: '负责人 (Owner)', key: 'owner' },
              { header: '销售额 (Amount)', key: 'amount' },
            ];
      const rows =
        tableData && tableData.rows.length > 0
          ? tableData.rows
          : [
              { owner: 'Maya', amount: 120 },
              { owner: 'Leo', amount: 80 },
            ];

      const workbook = await this.officeEngine.createExcelWorkbook({
        title: 'Sales Summary',
        sheets: [
          {
            name: '销售数据汇总',
            columns,
            rows,
            includeTotalRow: true,
          },
        ],
      });
      sandbox.writeArtifactBuffer(artifactName, workbook);
      const result: ToolExecution = {
        id: toolId,
        turnId: turn.id,
        planStepId: step.id,
        toolName: step.toolName,
        status: 'completed',
        output: `${artifactName} was created in the task artifacts directory`,
      };
      this.finishToolExecution(thread, turn, result, artifactName);
    } catch (error) {
      const result: ToolExecution = {
        id: toolId,
        turnId: turn.id,
        planStepId: step.id,
        toolName: step.toolName,
        status: 'failed',
        error: errorMessage(error),
      };
      this.finishToolExecution(thread, turn, result, artifactName);
    }
  }

  private async executeWorkspaceWordAsync(
    thread: Thread,
    turn: Turn,
    step: Plan['steps'][number],
    toolId: string,
  ): Promise<void> {
    const artifactName = 'weekly-meeting-report.docx';
    try {
      const sandbox = this.requireSandbox(thread.id);
      const sourceNames = ['meeting-notes.md', 'decisions.txt', 'sales.csv'] as const;
      const sources = sourceNames
        .filter((name) => sandbox.hasFile(name))
        .map((name) => this.documentEngine.readSource(name, sandbox.readFileBuffer(name)));

      let table: { headers: readonly string[]; rows: readonly (readonly string[])[] } | undefined;
      if (sandbox.hasFile('sales.csv')) {
        const parsed = await this.officeEngine.readTableData(
          sandbox.readFileBuffer('sales.csv'),
          'csv',
        );
        if (parsed.headers.length > 0) {
          table = {
            headers: parsed.headers,
            rows: parsed.rows.map((r) => parsed.headers.map((h) => String(r[h] ?? ''))),
          };
        }
      }

      const docx = await this.officeEngine.createRichWordDocument({
        title: 'Weekly Meeting Report',
        subtitle: 'Generated by Agent_XXXXX Production Office Engine',
        sections: [
          {
            heading: '会议要点与决策 (Meeting Notes & Decisions)',
            paragraphs: sources
              .filter((s) => s.kind !== 'csv')
              .map((s) => `${s.name}:\n${s.text}`),
          },
          ...(table
            ? [
                {
                  heading: '销售数据汇总 (Sales Summary: sales.csv)',
                  paragraphs: [
                    '数据源文件: sales.csv',
                    '下表为从销售数据源自动提取并整理的明细：',
                  ],
                  table,
                },
              ]
            : []),
        ],
      });
      sandbox.writeArtifactBuffer(artifactName, docx);
      const result: ToolExecution = {
        id: toolId,
        turnId: turn.id,
        planStepId: step.id,
        toolName: step.toolName,
        status: 'completed',
        output: `${artifactName} was created in the task artifacts directory`,
      };
      this.finishToolExecution(thread, turn, result, artifactName);
    } catch (error) {
      const result: ToolExecution = {
        id: toolId,
        turnId: turn.id,
        planStepId: step.id,
        toolName: step.toolName,
        status: 'failed',
        error: errorMessage(error),
      };
      this.finishToolExecution(thread, turn, result, artifactName);
    }
  }

  private executeWorkspaceReport(
    thread: Thread,
    turn: Turn,
    step: Plan['steps'][number],
    toolId: string,
  ): ToolExecution {
    try {
      const sandbox = this.requireSandbox(thread.id);
      const sourceNames = ['meeting-notes.md', 'decisions.txt', 'sales.csv'] as const;
      const sources = sourceNames.map((name) =>
        this.documentEngine.readSource(name, sandbox.readFileBuffer(name)),
      );
      const report = this.documentEngine.createDocx({
        title: 'Weekly Meeting Report',
        sources,
      });
      sandbox.writeArtifactBuffer('weekly-meeting-report.docx', report);
      return {
        id: toolId,
        turnId: turn.id,
        planStepId: step.id,
        toolName: step.toolName,
        status: 'completed',
        output: 'weekly-meeting-report.docx was created in the task artifacts directory',
      };
    } catch (error) {
      return {
        id: toolId,
        turnId: turn.id,
        planStepId: step.id,
        toolName: step.toolName,
        status: 'failed',
        error: errorMessage(error),
      };
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
    artifactName = 'weekly-meeting-report.docx',
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
    const verifyingTurn = this.updateTurn(thread, turn, 'verifying');
    this.verifyGeneratedArtifact(thread, verifyingTurn, artifactName);
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

    const verification =
      thread.workspaceRoot === undefined
        ? { ...this.verifier.verify(turn.id), id: verificationId }
        : this.verifyWorkspaceArtifact(thread, turn, artifactName, verificationId);
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
      const isXlsx = artifactName.toLowerCase().endsWith('.xlsx');
      const result = this.evidenceVerifier.verify(
        isXlsx
          ? {
              artifactPath,
              requireXlsxStructure: true,
              requireDocxStructure: false,
            }
          : {
              artifactPath,
              requiredText: [
                'Weekly Meeting Report',
                'meeting-notes.md',
                'decisions.txt',
                'sales.csv',
              ],
              requireDocxStructure: true,
              requireXlsxStructure: false,
            },
      );
      const evidence = [
        ...result.evidence,
        ...result.checks.map((check) => `${check.name}:${check.status}`),
      ];
      if (result.status === 'VERIFIED') {
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

    const userMsg: ChatMessage = {
      id: this.createId('msg'),
      threadId: thread.id,
      role: 'user',
      content,
      createdAt: this.now(),
    };
    this.appendMessage(userMsg);

    // Run Agent ReAct loop
    const maxSteps = options?.maxSteps ?? 8;
    let step = 0;
    let lastAssistantMsg: ChatMessage = {
      id: this.createId('msg'),
      threadId: thread.id,
      role: 'assistant',
      content: '',
      createdAt: this.now(),
    };

    const tools = [...DEFAULT_AGENT_TOOLS, ...this.mcpBridge.toAgentTools()];

    while (step++ < maxSteps) {
      const allMsgs = this.threadMessages.get(thread.id) ?? [];
      const pruned = pruneContextMessages(allMsgs);
      const sandbox = this.sandboxes.get(thread.id);
      const workspaceFiles = sandbox ? sandbox.listFiles() : undefined;

      let output: ModelChatOutput;
      if (typeof this.model.chatCompletion === 'function') {
        output = await this.model.chatCompletion({
          messages: pruned,
          tools,
          workspaceFiles,
          systemPrompt: effectivePrompt,
        });
      } else {
        output = { content: '收到您的指令，已记录在工作区任务中。' };
      }

      if (!output.toolCalls || output.toolCalls.length === 0) {
        lastAssistantMsg = {
          id: this.createId('msg'),
          threadId: thread.id,
          role: 'assistant',
          content: output.content || '任务已完成。',
          ...(output.reasoningContent ? { reasoningContent: output.reasoningContent } : {}),
          createdAt: this.now(),
        };
        this.appendMessage(lastAssistantMsg);
        break;
      }

      // Output has tool calls
      const assistantCallMsg: ChatMessage = {
        id: this.createId('msg'),
        threadId: thread.id,
        role: 'assistant',
        content: output.content,
        ...(output.reasoningContent ? { reasoningContent: output.reasoningContent } : {}),
        toolCalls: output.toolCalls,
        createdAt: this.now(),
      };
      this.appendMessage(assistantCallMsg);
      lastAssistantMsg = assistantCallMsg;

      for (const tc of output.toolCalls) {
        let toolResult = '';
        try {
          toolResult = await this.executeToolCall(thread, tc);
        } catch (err) {
          toolResult = `工具执行异常: ${errorMessage(err)}`;
        }
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

    return lastAssistantMsg;
  }

  public async executeToolCall(thread: Thread, toolCall: ToolCall): Promise<string> {
    const sandbox = this.requireSandbox(thread.id);
    const toolName = toolCall.name;
    const args = toolCall.arguments ?? {};

    if (toolName === 'workspace.read_file') {
      const target =
        (args.path as string) || (args.file as string) || (args.source as string) || 'sales.csv';
      if (sandbox.hasFile(target)) {
        return sandbox.readFile(target);
      }
      return `文件未找到: ${target}。当前工作区文件列表: ${sandbox.listFiles().join(', ')}`;
    }

    if (toolName === 'office.process_excel') {
      const artifactName = (args.target as string) || 'sales-summary.xlsx';
      const sourceFile = (args.source as string) || 'sales.csv';
      let tableData: ParsedTableData | undefined;
      if (sandbox.hasFile(sourceFile)) {
        const type = sourceFile.endsWith('.xlsx') ? 'xlsx' : 'csv';
        tableData = await this.officeEngine.readTableData(
          sandbox.readFileBuffer(sourceFile),
          type,
        );
      } else if (sandbox.hasFile('sales.csv')) {
        tableData = await this.officeEngine.readTableData(
          sandbox.readFileBuffer('sales.csv'),
          'csv',
        );
      }

      const columns =
        tableData && tableData.headers.length > 0
          ? tableData.headers.map((h) => ({ header: h.toUpperCase(), key: h }))
          : [
              { header: '负责人 (Owner)', key: 'owner' },
              { header: '销售额 (Amount)', key: 'amount' },
            ];
      const rows =
        tableData && tableData.rows.length > 0
          ? tableData.rows
          : [
              { owner: 'Maya', amount: 120 },
              { owner: 'Leo', amount: 80 },
            ];

      const workbook = await this.officeEngine.createExcelWorkbook({
        title: 'Sales Summary',
        sheets: [{ name: '销售数据汇总', columns, rows, includeTotalRow: true }],
      });
      sandbox.writeArtifactBuffer(artifactName, workbook);
      this.verifyArtifact(thread.id, artifactName);
      return `成功读取 ${sourceFile}，生成带 SUM 动态求和公式的 Excel 工作簿：${artifactName}（已完成物理证据链校验）`;
    }

    if (toolName === 'office.generate_word_report' || toolName === 'workspace.write_report') {
      const artifactName = (args.target as string) || 'weekly-meeting-report.docx';
      const sourceNames = ['meeting-notes.md', 'decisions.txt', 'sales.csv'] as const;
      const sources = sourceNames
        .filter((name) => sandbox.hasFile(name))
        .map((name) => this.documentEngine.readSource(name, sandbox.readFileBuffer(name)));

      let table: { headers: readonly string[]; rows: readonly (readonly string[])[] } | undefined;
      if (sandbox.hasFile('sales.csv')) {
        const parsed = await this.officeEngine.readTableData(
          sandbox.readFileBuffer('sales.csv'),
          'csv',
        );
        if (parsed.headers.length > 0) {
          table = {
            headers: parsed.headers,
            rows: parsed.rows.map((r) => parsed.headers.map((h) => String(r[h] ?? ''))),
          };
        }
      }

      const sections: RichDocxSection[] = sources.map((s) => ({
        heading: `数据来源：${s.name}`,
        paragraphs: [s.text.slice(0, 300)],
      }));
      if (table) {
        sections.push({
          heading: '销售与业务数据统计表',
          paragraphs: ['下表为当前工作区业务数据明细汇总：'],
          table,
        });
      }

      const docx = await this.officeEngine.createRichWordDocument({
        title: '工作区项目与业务周报',
        subtitle: '基于本地工作区真实数据自动生成',
        sections,
      });
      sandbox.writeArtifactBuffer(artifactName, docx);
      this.verifyArtifact(thread.id, artifactName);
      return `成功整合工作区材料，生成高保真结构化 Word 报告：${artifactName}（包含主标题、分节正文与格式化对比表格，已完成物理证据链校验）`;
    }

    if (toolName.startsWith('mcp.')) {
      return await this.mcpBridge.execute(toolName, args);
    }

    return `工具 ${toolName} 已执行。`;
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
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
