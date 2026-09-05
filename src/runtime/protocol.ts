export const PROTOCOL_VERSION = 1 as const;

export type ThreadStatus =
  | 'active'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'reconciliation_required';

export type TurnStatus =
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'verifying'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'reconciliation_required';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ToolExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'reconciliation_required';
export type ArtifactVerificationStatus =
  | 'pending'
  | 'running'
  | 'verified'
  | 'failed'
  | 'reconciliation_required';

export interface Thread {
  readonly id: string;
  readonly workspaceId: string;
  readonly status: ThreadStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Turn {
  readonly id: string;
  readonly threadId: string;
  readonly input: string;
  readonly status: TurnStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PlanStep {
  readonly id: string;
  readonly title: string;
  readonly toolName: string;
  readonly risk: 'read' | 'write' | 'external';
  readonly requiresApproval: boolean;
}

export interface Plan {
  readonly id: string;
  readonly turnId: string;
  readonly steps: readonly PlanStep[];
  readonly status: 'proposed' | 'approved' | 'rejected';
}

export interface Approval {
  readonly id: string;
  readonly turnId: string;
  readonly planId: string;
  readonly status: ApprovalStatus;
  readonly reason: string;
  readonly resolvedAt?: string;
}

export interface ToolExecution {
  readonly id: string;
  readonly turnId: string;
  readonly planStepId: string;
  readonly toolName: string;
  readonly status: ToolExecutionStatus;
  readonly output?: string;
  readonly error?: string;
}

export interface ArtifactVerification {
  readonly id: string;
  readonly turnId: string;
  readonly artifactName: string;
  readonly status: ArtifactVerificationStatus;
  readonly evidence?: readonly string[];
  readonly error?: string;
}

export type RuntimeEventType =
  | 'thread.created'
  | 'thread.status_changed'
  | 'turn.started'
  | 'turn.status_changed'
  | 'plan.proposed'
  | 'approval.requested'
  | 'approval.resolved'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'tool.reconciliation_required'
  | 'artifact.verification_started'
  | 'artifact.verified'
  | 'artifact.verification_failed'
  | 'artifact.reconciliation_required';

export interface RuntimeEventPayloadMap {
  'thread.created': Thread;
  'thread.status_changed': Thread;
  'turn.started': Turn;
  'turn.status_changed': Turn;
  'plan.proposed': Plan;
  'approval.requested': Approval;
  'approval.resolved': Approval;
  'tool.started': ToolExecution;
  'tool.completed': ToolExecution;
  'tool.failed': ToolExecution;
  'tool.reconciliation_required': ToolExecution;
  'artifact.verification_started': ArtifactVerification;
  'artifact.verified': ArtifactVerification;
  'artifact.verification_failed': ArtifactVerification;
  'artifact.reconciliation_required': ArtifactVerification;
}

export interface RuntimeEvent<T extends RuntimeEventType = RuntimeEventType> {
  readonly id: string;
  readonly version: typeof PROTOCOL_VERSION;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly type: T;
  readonly threadId: string;
  readonly turnId?: string;
  readonly payload: RuntimeEventPayloadMap[T];
}

export type AnyRuntimeEvent = {
  [T in RuntimeEventType]: RuntimeEvent<T>;
}[RuntimeEventType];

export interface CreateThreadInput {
  readonly workspaceId: string;
}

export interface StartTurnInput {
  readonly threadId: string;
  readonly input: string;
}

export interface EventSubscription {
  readonly unsubscribe: () => void;
}
