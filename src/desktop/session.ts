import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AppServer } from '../runtime/app-server.js';
import type { AppServerContract } from '../runtime/app-server.js';
import type { AnyRuntimeEvent, Approval, Plan, Thread, Turn } from '../runtime/protocol.js';
import { AppShellController } from '../ui/app-shell.js';
import type { AppRoute, AppShellView, ShellModelMode } from '../ui/app-shell.js';
import { DemoHomeController } from '../ui/demo-home.js';
import type { DemoHomeView, DemoModelMode } from '../ui/demo-home.js';

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

export interface DesktopSnapshot {
  readonly shell: AppShellView;
  readonly home: DemoHomeView;
  readonly route: AppRoute;
  readonly thread?: DesktopThreadView;
  readonly turn?: DesktopTurnView;
  readonly plan?: DesktopPlanView;
  readonly approval?: DesktopApprovalView;
  readonly events: readonly DesktopEventDto[];
  readonly workspaceFiles?: readonly string[];
  readonly artifactFiles?: readonly string[];
}

export type DesktopApprovalDecision = 'approved' | 'rejected';

export interface DesktopApi {
  getSnapshot(): Promise<DesktopSnapshot>;
  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void;
  selectWorkspace(): Promise<DesktopSnapshot>;
  setTaskInput(input: string): Promise<DesktopSnapshot>;
  chooseQuickTask(task: string): Promise<DesktopSnapshot>;
  navigate(route: AppRoute): Promise<DesktopSnapshot>;
  setModelMode(mode: ShellModelMode & DemoModelMode): Promise<DesktopSnapshot>;
  submitPlan(): Promise<DesktopSnapshot>;
  respondApproval(decision: DesktopApprovalDecision): Promise<DesktopSnapshot>;
  stopTask(): Promise<DesktopSnapshot>;
}

export interface DesktopSessionOptions {
  readonly eventLogPath?: string;
  readonly server?: AppServerContract;
}

export class DesktopSession {
  private readonly server: AppServerContract;
  private readonly shell: AppShellController;
  private readonly home: DemoHomeController;
  private readonly listeners = new Set<(snapshot: DesktopSnapshot) => void>();
  private activeThreadId: string | undefined;
  private activeTurnId: string | undefined;

  public constructor(options: DesktopSessionOptions = {}) {
    this.server =
      options.server ??
      new AppServer(
        options.eventLogPath === undefined ? {} : { eventLogPath: options.eventLogPath },
      );
    this.shell = new AppShellController({
      server: this.server,
      modelMode: 'fake',
      modelConnected: true,
      sandboxReady: false,
      network: 'disabled',
    });
    this.home = new DemoHomeController({
      server: this.server,
      workspaceId: 'desktop-workspace',
      liveModelAvailable: false,
    });
    this.restoreLatestSession();
  }

  public selectWorkspace(workspaceRoot: string): DesktopSnapshot {
    this.home.selectWorkspace(workspaceRoot);
    this.shell.selectWorkspace(workspaceRoot);
    return this.changedSnapshot();
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

  public setModelMode(mode: ShellModelMode & DemoModelMode): DesktopSnapshot {
    this.home.setModelMode(mode);
    this.shell.setModelMode(mode);
    return this.changedSnapshot();
  }

  public submitPlan(): DesktopSnapshot {
    const submission = this.home.submit();
    this.activeThreadId = submission.thread.id;
    this.activeTurnId = submission.turn.id;
    this.shell.bindThread(submission.thread, submission.turn);
    this.shell.navigate('task-plan');
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
    let artifactFiles: string[] | undefined;
    if (workspaceRoot && existsSync(workspaceRoot)) {
      try {
        workspaceFiles = readdirSync(workspaceRoot, { withFileTypes: true })
          .filter((e) => e.isFile() && !e.name.startsWith('.'))
          .map((e) => e.name);
        const artifactsPath = join(workspaceRoot, 'artifacts');
        if (existsSync(artifactsPath)) {
          artifactFiles = readdirSync(artifactsPath, { withFileTypes: true })
            .filter((e) => e.isFile() && !e.name.startsWith('.'))
            .map((e) => e.name);
        }
      } catch {
        // ignore read errors
      }
    }

    return {
      shell: this.shell.view(),
      home: this.home.view(),
      route: this.shell.view().route,
      ...(thread === undefined ? {} : { thread: toThreadView(thread) }),
      ...(turn === undefined ? {} : { turn: toTurnView(turn) }),
      ...(plan === undefined ? {} : { plan: toPlanView(plan, approval) }),
      ...(approval === undefined ? {} : { approval: toApprovalView(approval) }),
      events: events.map(toEventDto),
      ...(workspaceFiles === undefined ? {} : { workspaceFiles }),
      ...(artifactFiles === undefined ? {} : { artifactFiles }),
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
    const thread = this.server.listThreads().at(-1);
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
