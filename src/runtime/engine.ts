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
import { EvidenceVerifier } from './verifier.js';
import type { VerificationRequest, VerificationResult } from './verifier.js';
import type {
  AnyRuntimeEvent,
  Approval,
  ArtifactVerification,
  ArtifactWriteResult,
  CreateThreadInput,
  Plan,
  SandboxCheckInput,
  SandboxDecision,
  StartTurnInput,
  Thread,
  ThreadStatus,
  ToolExecution,
  Turn,
  TurnStatus,
} from './protocol.js';

export interface RuntimeEngineOptions {
  readonly scenario?: FakeScenario;
  readonly now?: RuntimeClock;
  readonly idFactory?: RuntimeIdFactory;
  readonly documentEngine?: WorkspaceDocumentEngine;
  readonly eventLogPath?: string;
  readonly eventStore?: RuntimeEventStore;
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
  private readonly pausedTurnStatuses = new Map<string, TurnStatus>();
  private readonly log: EventLog;
  private readonly model: FakeModel;
  private readonly toolAdapter: FakeToolAdapter;
  private readonly verifier: FakeVerifier;
  private readonly documentEngine: WorkspaceDocumentEngine;
  private readonly evidenceVerifier: EvidenceVerifier;
  private readonly sandboxes = new Map<string, LocalWorkspaceSandbox>();
  private readonly now: RuntimeClock;
  private readonly createId: RuntimeIdFactory;

  public constructor(options: RuntimeEngineOptions = {}) {
    this.now = options.now ?? currentTime;
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
    this.model = new FakeModel(this.createId);
    this.toolAdapter = new FakeToolAdapter(options.scenario, this.createId);
    this.verifier = new FakeVerifier(options.scenario, this.createId);
    this.documentEngine = options.documentEngine ?? new LocalDocumentEngine();
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

    const plan = this.model.proposePlan(turn.id);
    this.plans.set(plan.id, plan);
    this.log.append({
      type: 'plan.proposed',
      threadId: thread.id,
      turnId: turn.id,
      payload: plan,
    });

    const approval: Approval = {
      id: this.createId('approval'),
      turnId: turn.id,
      planId: plan.id,
      status: 'pending',
      reason: 'the plan includes a workspace write action',
    };
    this.approvals.set(approval.id, approval);
    this.log.append({
      type: 'approval.requested',
      threadId: thread.id,
      turnId: turn.id,
      payload: approval,
    });

    return turn;
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
    } else {
      const toolId = this.createId('tool');
      this.logToolStarted(thread, {
        id: toolId,
        turnId: turn.id,
        planStepId: step.id,
        toolName: step.toolName,
        status: 'running',
      });
      result = this.executeWorkspaceReport(thread, turn, step, toolId);
    }

    this.finishToolExecution(thread, turn, result);
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

  private finishToolExecution(thread: Thread, turn: Turn, result: ToolExecution): void {
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
    this.verifyGeneratedArtifact(thread, verifyingTurn);
  }

  private verifyGeneratedArtifact(thread: Thread, turn: Turn): void {
    const artifactName = 'weekly-meeting-report.docx';
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
      const result = this.evidenceVerifier.verify({
        artifactPath,
        requiredText: ['Weekly Meeting Report', 'meeting-notes.md', 'decisions.txt', 'sales.csv'],
        requireDocxStructure: true,
      });
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
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
