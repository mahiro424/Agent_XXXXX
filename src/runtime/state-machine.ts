import type { ThreadStatus, TurnStatus } from './protocol.js';

export class InvalidTransitionError extends Error {
  public constructor(entity: 'thread' | 'turn', from: string, to: string) {
    super(`invalid ${entity} transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

const turnTransitions: Record<TurnStatus, readonly TurnStatus[]> = {
  planning: ['awaiting_approval', 'paused', 'cancelled', 'failed'],
  awaiting_approval: ['executing', 'paused', 'cancelled', 'failed'],
  executing: ['verifying', 'paused', 'cancelled', 'failed', 'reconciliation_required'],
  verifying: ['completed', 'paused', 'cancelled', 'failed', 'reconciliation_required'],
  paused: ['awaiting_approval', 'executing', 'verifying', 'cancelled', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
  reconciliation_required: [],
};

const threadTransitions: Record<ThreadStatus, readonly ThreadStatus[]> = {
  active: ['paused', 'cancelled', 'reconciliation_required'],
  paused: ['active', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
  reconciliation_required: [],
};

export function transitionTurnStatus(from: TurnStatus, to: TurnStatus): TurnStatus {
  if (!turnTransitions[from].includes(to)) {
    throw new InvalidTransitionError('turn', from, to);
  }
  return to;
}

export function transitionThreadStatus(from: ThreadStatus, to: ThreadStatus): ThreadStatus {
  if (!threadTransitions[from].includes(to)) {
    throw new InvalidTransitionError('thread', from, to);
  }
  return to;
}
