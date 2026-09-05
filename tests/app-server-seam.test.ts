import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppServer } from '../src/runtime/app-server.js';
import type { AnyRuntimeEvent } from '../src/runtime/protocol.js';

function approvalIdFor(events: readonly AnyRuntimeEvent[]): string {
  const event = events.find((candidate) => candidate.type === 'approval.requested');
  if (!event || event.type !== 'approval.requested') {
    throw new Error('approval.requested event was not emitted');
  }
  return event.payload.id;
}

const workspaceRoots: string[] = [];

afterEach(() => {
  for (const root of workspaceRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

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

  it('reads and writes through the public workspace contract and emits sandbox events', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-app-server-workspace-'));
    workspaceRoots.push(root);
    writeFileSync(join(root, 'meeting-notes.md'), 'workspace input', 'utf8');
    const server = new AppServer();
    const received: AnyRuntimeEvent[] = [];
    server.subscribeEvents((event) => received.push(event));
    const thread = server.createThread({ workspaceId: 'demo-workspace', workspaceRoot: root });

    expect(server.readWorkspaceFile(thread.id, 'meeting-notes.md')).toBe('workspace input');
    const artifact = server.writeArtifact(thread.id, 'report.txt', 'verified output');
    expect(readFileSync(artifact.path, 'utf8')).toBe('verified output');
    expect(server.checkSandbox(thread.id, { operation: 'network' })).toMatchObject({
      decision: 'denied',
      reasonCode: 'network_disabled',
    });
    expect(() => server.readWorkspaceFile(thread.id, '../outside.txt')).toThrow(
      'path_outside_workspace',
    );

    const sandboxEvents = received.filter((event) => event.type === 'sandbox.decision');
    expect(sandboxEvents).toHaveLength(4);
    expect(sandboxEvents.map((event) => event.payload.reasonCode)).toEqual([
      'workspace_read_allowed',
      'artifact_write_allowed',
      'network_disabled',
      'path_outside_workspace',
    ]);
  });

  it('verifies artifacts through the public contract and preserves uncertainty', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-app-server-verifier-'));
    workspaceRoots.push(root);
    const server = new AppServer();
    const thread = server.createThread({ workspaceId: 'demo-workspace', workspaceRoot: root });
    server.writeArtifact(thread.id, 'report.txt', 'Weekly report\nDecision: ship Friday');

    const verified = server.verifyArtifact(thread.id, 'report.txt', {
      requiredText: ['Weekly report', 'ship Friday'],
    });
    expect(verified.status).toBe('VERIFIED');
    expect(verified.sha256).toMatch(/^[a-f0-9]{64}$/);

    const uncertain = server.verifyArtifact(thread.id, 'report.txt', {
      reconciliationRequired: true,
    });
    expect(uncertain.status).toBe('RECONCILIATION_REQUIRED');
    expect(uncertain.checks.find((check) => check.name === 'reconciliation_gate')?.status).toBe(
      'uncertain',
    );
  });

  it('does not bypass the protocol when a thread has no workspace root', () => {
    const server = new AppServer();
    const thread = server.createThread({ workspaceId: 'memory-only' });

    expect(() => server.checkSandbox(thread.id, { operation: 'read', targetPath: 'input.txt' })).toThrow(
      'no workspaceRoot',
    );
    expect(() => server.readWorkspaceFile(thread.id, 'input.txt')).toThrow('no workspaceRoot');
    expect(() => server.writeArtifact(thread.id, 'report.txt', 'output')).toThrow('no workspaceRoot');
  });
});
