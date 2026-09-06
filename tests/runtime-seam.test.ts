import { describe, expect, it } from 'vitest';
import { RuntimeEngine } from '../src/runtime/engine.js';
import { EvidenceVerifier } from '../src/runtime/verifier.js';
import type { VerificationRequest, VerificationResult } from '../src/runtime/verifier.js';
import type { AnyRuntimeEvent } from '../src/runtime/protocol.js';

function approvalIdFor(events: readonly AnyRuntimeEvent[]): string {
  const event = events.find((candidate) => candidate.type === 'approval.requested');
  if (!event || event.type !== 'approval.requested') {
    throw new Error('approval.requested event was not emitted');
  }
  return event.payload.id;
}

describe('Runtime Seam', () => {
  it('runs thread → turn → plan → approval → tool → verification', () => {
    const runtime = new RuntimeEngine();
    const thread = runtime.createThread({ workspaceId: 'demo-workspace' });
    const turn = runtime.startTurn({
      threadId: thread.id,
      input: '整理会议材料并生成周报',
    });

    expect(turn.status).toBe('awaiting_approval');
    expect(runtime.listEvents(thread.id).map((event) => event.type)).toEqual([
      'thread.created',
      'turn.started',
      'plan.proposed',
      'approval.requested',
    ]);

    runtime.respondApproval({
      approvalId: approvalIdFor(runtime.listEvents(thread.id)),
      decision: 'approved',
    });

    const finalTurn = runtime.getTurn(turn.id);
    expect(finalTurn.status).toBe('completed');
    expect(runtime.listEvents(thread.id).map((event) => event.type)).toEqual([
      'thread.created',
      'turn.started',
      'plan.proposed',
      'approval.requested',
      'approval.resolved',
      'turn.status_changed',
      'tool.started',
      'sandbox.decision',
      'tool.completed',
      'turn.status_changed',
      'artifact.verification_started',
      'sandbox.decision',
      'artifact.verified',
      'turn.status_changed',
    ]);
  });

  it('cancels a turn when the user rejects its approval', () => {
    const runtime = new RuntimeEngine();
    const thread = runtime.createThread({ workspaceId: 'demo-workspace' });
    const turn = runtime.startTurn({ threadId: thread.id, input: '生成报告' });

    runtime.respondApproval({
      approvalId: approvalIdFor(runtime.listEvents(thread.id)),
      decision: 'rejected',
    });

    expect(runtime.getTurn(turn.id).status).toBe('cancelled');
    expect(runtime.listEvents(thread.id).at(-1)?.type).toBe('turn.status_changed');
  });

  it('pauses before approval and resumes without losing history', () => {
    const runtime = new RuntimeEngine();
    const thread = runtime.createThread({ workspaceId: 'demo-workspace' });
    const turn = runtime.startTurn({ threadId: thread.id, input: '读取会议材料' });

    runtime.pause(thread.id);
    expect(runtime.getThread(thread.id).status).toBe('paused');
    expect(runtime.getTurn(turn.id).status).toBe('paused');

    runtime.resumeThread(thread.id);
    expect(runtime.getThread(thread.id).status).toBe('active');
    expect(runtime.getTurn(turn.id).status).toBe('awaiting_approval');
    expect(runtime.listEvents(thread.id).length).toBeGreaterThan(4);
  });

  it('exposes tool failure without retrying automatically', () => {
    class FailingVerifier extends EvidenceVerifier {
      public override verify(request: VerificationRequest): VerificationResult {
        return super.verify({ ...request, requiredText: ['MustContainNeverPresentText'] });
      }
    }
    const runtime = new RuntimeEngine({
      evidenceVerifier: new FailingVerifier(),
    });
    const thread = runtime.createThread({ workspaceId: 'demo-workspace' });
    const turn = runtime.startTurn({ threadId: thread.id, input: '生成报告' });

    runtime.respondApproval({
      approvalId: approvalIdFor(runtime.listEvents(thread.id)),
      decision: 'approved',
    });

    expect(runtime.getTurn(turn.id).status).toBe('failed');
    expect(runtime.listEvents(thread.id).filter((event) => event.type === 'tool.started')).toHaveLength(1);
    expect(runtime.listEvents(thread.id).at(-1)?.type).toBe('turn.status_changed');
  });

  it('locks the turn in RECONCILIATION_REQUIRED when tool outcome is uncertain', () => {
    class ReconciliationEvidenceVerifier extends EvidenceVerifier {
      public override verify(request: VerificationRequest): VerificationResult {
        return super.verify({ ...request, reconciliationRequired: true });
      }
    }
    const runtime = new RuntimeEngine({
      evidenceVerifier: new ReconciliationEvidenceVerifier(),
    });
    const thread = runtime.createThread({ workspaceId: 'demo-workspace' });
    const turn = runtime.startTurn({ threadId: thread.id, input: '写入报告' });

    runtime.respondApproval({
      approvalId: approvalIdFor(runtime.listEvents(thread.id)),
      decision: 'approved',
    });

    expect(runtime.getTurn(turn.id).status).toBe('reconciliation_required');
    expect(runtime.getThread(thread.id).status).toBe('reconciliation_required');
    expect(runtime.listEvents(thread.id).at(-1)?.type).toBe('turn.status_changed');
    expect(() => runtime.startTurn({ threadId: thread.id, input: '盲目重试' })).toThrow(
      'reconciliation_required',
    );
  });

  it('marks verification failure as a failed turn', () => {
    class FailingEvidenceVerifier extends EvidenceVerifier {
      public override verify(request: VerificationRequest): VerificationResult {
        return super.verify({ ...request, requiredText: ['NonExistentRequiredKey'] });
      }
    }
    const runtime = new RuntimeEngine({
      evidenceVerifier: new FailingEvidenceVerifier(),
    });
    const thread = runtime.createThread({ workspaceId: 'demo-workspace' });
    const turn = runtime.startTurn({ threadId: thread.id, input: '生成报告' });

    runtime.respondApproval({
      approvalId: approvalIdFor(runtime.listEvents(thread.id)),
      decision: 'approved',
    });

    expect(runtime.getTurn(turn.id).status).toBe('failed');
    expect(runtime.listEvents(thread.id).at(-2)?.type).toBe('artifact.verification_failed');
  });
});
