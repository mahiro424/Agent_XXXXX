import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppServer } from '../src/runtime/app-server.js';
import type { AnyRuntimeEvent } from '../src/runtime/protocol.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function persistentLogPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-persistence-seam-'));
  roots.push(root);
  return join(root, 'runtime-events.jsonl');
}

function approvalIdFor(events: readonly AnyRuntimeEvent[]): string {
  const event = events.find((candidate) => candidate.type === 'approval.requested');
  if (!event || event.type !== 'approval.requested') {
    throw new Error('approval.requested event was not emitted');
  }
  return event.payload.id;
}

function runFakeTurn(logPath: string): { server: AppServer; threadId: string; turnId: string } {
  const server = new AppServer({ eventLogPath: logPath });
  const thread = server.createThread({ workspaceId: 'persistent-workspace' });
  const turn = server.startTurn({ threadId: thread.id, input: '生成报告' });
  return { server, threadId: thread.id, turnId: turn.id };
}

describe('Runtime persistence and crash recovery', () => {
  it('persists JSONL events and restores threads, turns, and pending approvals', () => {
    const logPath = persistentLogPath();
    const first = runFakeTurn(logPath);
    const beforeRestart = first.server.listAllEvents();

    expect(readFileSync(logPath, 'utf8').trim().split('\n')).toHaveLength(beforeRestart.length);

    const second = new AppServer({ eventLogPath: logPath });
    expect(second.listThreads()).toEqual(first.server.listThreads());
    expect(second.getTurn(first.turnId)).toEqual(first.server.getTurn(first.turnId));
    expect(second.listEvents(first.threadId)).toEqual(beforeRestart);
    expect(second.listAllEvents().map((event) => event.sequence)).toEqual(
      beforeRestart.map((event) => event.sequence),
    );
    expect(second.listEvents(first.threadId).filter((event) => event.type === 'tool.started')).toHaveLength(0);

    second.respondApproval({
      approvalId: approvalIdFor(second.listEvents(first.threadId)),
      decision: 'approved',
    });
    const third = new AppServer({ eventLogPath: logPath });
    expect(third.getTurn(first.turnId).status).toBe('completed');
    expect(third.listEvents(first.threadId).filter((event) => event.type === 'tool.started')).toHaveLength(1);
    expect(third.listEvents(first.threadId).filter((event) => event.type === 'tool.completed')).toHaveLength(1);
  });

  it('converges an interrupted execution to RECONCILIATION_REQUIRED without replaying it', () => {
    for (const stopEvent of ['tool.started', 'artifact.verification_started'] as const) {
      const logPath = persistentLogPath();
      const first = runFakeTurn(logPath);
      first.server.respondApproval({
        approvalId: approvalIdFor(first.server.listEvents(first.threadId)),
        decision: 'approved',
      });
      const completedEvents = first.server.listEvents(first.threadId);
      const stopIndex = completedEvents.findIndex((event) => event.type === stopEvent);
      expect(stopIndex).toBeGreaterThanOrEqual(0);
      const truncatedEvents = completedEvents.slice(0, stopIndex + 1);
      writeFileSync(logPath, `${truncatedEvents.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');

      const recovered = new AppServer({ eventLogPath: logPath });
      expect(recovered.getThread(first.threadId).status).toBe('reconciliation_required');
      expect(recovered.getTurn(first.turnId).status).toBe('reconciliation_required');
      expect(recovered.listEvents(first.threadId).filter((event) => event.type === 'tool.completed')).toHaveLength(
        truncatedEvents.filter((event) => event.type === 'tool.completed').length,
      );
      expect(recovered.listEvents(first.threadId).filter((event) => event.type === 'artifact.verified')).toHaveLength(
        truncatedEvents.filter((event) => event.type === 'artifact.verified').length,
      );

      const eventCountAfterRecovery = recovered.listAllEvents().length;
      const restartedAgain = new AppServer({ eventLogPath: logPath });
      expect(restartedAgain.listAllEvents()).toHaveLength(eventCountAfterRecovery);
      expect(restartedAgain.getTurn(first.turnId).status).toBe('reconciliation_required');
    }
  });

  it('ignores only a torn final JSONL record while preserving complete history', () => {
    const logPath = persistentLogPath();
    const first = runFakeTurn(logPath);
    const completeEvents = first.server.listAllEvents();
    appendFileSync(logPath, '{"id":"torn-event', 'utf8');

    const recovered = new AppServer({ eventLogPath: logPath });
    expect(recovered.listAllEvents()).toEqual(completeEvents);
  });
});
