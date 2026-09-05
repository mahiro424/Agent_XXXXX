import { describe, expect, it } from 'vitest';
import { AppServer } from '../src/runtime/app-server.js';
import type { AnyRuntimeEvent } from '../src/runtime/protocol.js';

function approvalIdFor(events: readonly AnyRuntimeEvent[]): string {
  const event = events.find((candidate) => candidate.type === 'approval.requested');
  if (!event || event.type !== 'approval.requested') {
    throw new Error('approval.requested event was not emitted');
  }
  return event.payload.id;
}

describe('App Server Seam', () => {
  it('exposes a versioned event stream without leaking RuntimeEngine internals', () => {
    const server = new AppServer();
    const received: AnyRuntimeEvent[] = [];
    const subscription = server.subscribeEvents((event) => received.push(event));
    const thread = server.createThread({ workspaceId: 'demo-workspace' });
    server.startTurn({ threadId: thread.id, input: '生成报告' });

    expect(received).toHaveLength(4);
    expect(received.every((event) => event.version === 1)).toBe(true);
    expect(received.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(server.listEvents(thread.id)).toEqual(received);

    subscription();
    server.startTurn({ threadId: thread.id, input: '再次生成报告' });
    expect(received).toHaveLength(4);
  });

  it('accepts approval, returns history, and rejects duplicate approval responses', () => {
    const server = new AppServer();
    const thread = server.createThread({ workspaceId: 'demo-workspace' });
    server.startTurn({ threadId: thread.id, input: '生成报告' });
    const approvalId = approvalIdFor(server.listEvents(thread.id));

    const approval = server.respondApproval({ approvalId, decision: 'approved' });

    expect(approval.status).toBe('approved');
    expect(server.listEvents(thread.id).at(-1)?.type).toBe('turn.status_changed');
    expect(() => server.respondApproval({ approvalId, decision: 'approved' })).toThrow(
      'already approved',
    );
  });

  it('pauses and resumes through the public contract', () => {
    const server = new AppServer();
    const thread = server.createThread({ workspaceId: 'demo-workspace' });
    const turn = server.startTurn({ threadId: thread.id, input: '读取材料' });

    server.pause(thread.id);
    expect(server.getThread(thread.id).status).toBe('paused');
    expect(server.getTurn(turn.id).status).toBe('paused');

    server.resumeThread(thread.id);
    expect(server.getThread(thread.id).status).toBe('active');
    expect(server.getTurn(turn.id).status).toBe('awaiting_approval');
  });

  it('blocks a new turn after reconciliation is required', () => {
    const server = new AppServer({ scenario: { tool: 'reconciliation_required' } });
    const thread = server.createThread({ workspaceId: 'demo-workspace' });
    server.startTurn({ threadId: thread.id, input: '写入报告' });
    const approvalId = approvalIdFor(server.listEvents(thread.id));

    server.respondApproval({ approvalId, decision: 'approved' });

    expect(server.getThread(thread.id).status).toBe('reconciliation_required');
    expect(() => server.startTurn({ threadId: thread.id, input: '盲目重试' })).toThrow(
      'reconciliation_required',
    );
  });
});
