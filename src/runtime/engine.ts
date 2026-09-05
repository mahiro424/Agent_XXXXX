import { EventLog } from './event-log.js';
import type { RuntimeClock, RuntimeIdFactory } from './event-log.js';
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
import type {
  AnyRuntimeEvent,
  Approval,
  ArtifactVerification,
  CreateThreadInput,
  Plan,
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
}

export interface RespondApprovalInput {
  readonly approvalId: string;
  readonly decision: 'approved' | 'rejected';
}

function createIncrementingIdFactory(): RuntimeIdFactory {
  let counter = 0;
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
  private readonly now: RuntimeClock;
  private readonly createId: RuntimeIdFactory;

  public constructor(options: RuntimeEngineOptions = {}) {
    this.now = options.now ?? currentTime;
    this.createId = options.idFactory ?? createIncrementingIdFactory();
    this.log = new EventLog(this.now, this.createId);
    this.model = new FakeModel(this.createId);
    this.toolAdapter = new FakeToolAdapter(options.scenario, this.createId);
    this.verifier = new FakeVerifier(options.scenario, this.createId);
  }

  public createThread(input: CreateThreadInput): Thread {
    const timestamp = this.now();
    const thread: Thread = {
      id: this.createId('thread'),
      workspaceId: input.workspaceId,
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
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

  private executeApprovedTurn(thread: Thread, turn: Turn, plan: Plan): void {
    const step = plan.steps[0];
    if (!step) {
      this.updateTurn(thread, turn, 'failed');
      return;
    }

    const result = this.toolAdapter.execute(turn.id, step);
    const started: ToolExecution = {
      id: result.id,
      turnId: result.turnId,
      planStepId: result.planStepId,
      toolName: result.toolName,
      status: 'running',
    };
    this.log.append({
      type: 'tool.started',
      threadId: thread.id,
      turnId: turn.id,
      payload: started,
    });

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
    this.verifyArtifact(thread, verifyingTurn);
  }

  private verifyArtifact(thread: Thread, turn: Turn): void {
    const verificationId = this.createId('verification');
    const started: ArtifactVerification = {
      id: verificationId,
      turnId: turn.id,
      artifactName: 'weekly-meeting-report.docx',
      status: 'running',
    };
    this.log.append({
      type: 'artifact.verification_started',
      threadId: thread.id,
      turnId: turn.id,
      payload: started,
    });

    const result = this.verifier.verify(turn.id);
    const verification: ArtifactVerification = {
      ...result,
      id: verificationId,
    };
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
