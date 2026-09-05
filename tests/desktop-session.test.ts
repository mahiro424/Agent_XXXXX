import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppServer } from '../src/runtime/app-server.js';
import { DesktopSession } from '../src/desktop/session.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-desktop-session-'));
  roots.push(root);
  writeFileSync(join(root, 'meeting-notes.md'), '# Notes\nShip Friday.\n', 'utf8');
  writeFileSync(join(root, 'decisions.txt'), 'Owner: Maya\n', 'utf8');
  writeFileSync(join(root, 'sales.csv'), 'owner,amount\nMaya,120\n', 'utf8');
  return root;
}

function preparedSession(): DesktopSession {
  const session = new DesktopSession({ server: new AppServer() });
  session.selectWorkspace(workspace());
  session.setTaskInput('整理会议材料并生成 Word 报告');
  return session;
}

describe('DesktopSession', () => {
  it('exposes empty and ready UI states without leaking the Runtime', () => {
    const session = new DesktopSession({ server: new AppServer() });
    const empty = session.snapshot();
    expect(empty.home.state).toBe('empty');
    expect(empty.home.canSubmit).toBe(false);
    expect(empty.shell.readiness).toBe('empty');

    const ready = session.selectWorkspace(workspace());
    session.setTaskInput('生成报告');
    expect(ready.home.workspaceRoot).toBeDefined();
    expect(session.snapshot().home.canSubmit).toBe(true);
    expect(session.snapshot().workspaceFiles).toContain('sales.csv');
    expect(session.snapshot().workspaceFiles).toContain('meeting-notes.md');
    expect(session.snapshot().workspaceFiles).toContain('decisions.txt');
    expect(session.snapshot()).not.toHaveProperty('server');
    expect(JSON.stringify(session.snapshot())).not.toContain('AppServer');
    expect(JSON.stringify(session.snapshot())).not.toContain('Sandbox');
  });

  it('submits a plan into awaiting approval without starting a tool', () => {
    const session = preparedSession();
    const snapshot = session.submitPlan();

    expect(snapshot.route).toBe('task-plan');
    expect(snapshot.turn?.status).toBe('awaiting_approval');
    expect(snapshot.plan?.steps[0]?.toolName).toBe('workspace.write_report');
    expect(snapshot.approval).toMatchObject({ status: 'pending' });
    expect(snapshot.events.map((event) => event.type)).toEqual([
      'thread.created',
      'turn.started',
      'plan.proposed',
      'approval.requested',
    ]);
  });

  it('updates the snapshot after approval and produces a verified report', () => {
    const session = preparedSession();
    session.submitPlan();
    const snapshot = session.respondApproval('approved');

    expect(snapshot.approval?.status).toBe('approved');
    expect(snapshot.turn?.status).toBe('completed');
    expect(snapshot.events.some((event) => event.type === 'tool.completed')).toBe(true);
    expect(snapshot.events.some((event) => event.type === 'artifact.verified')).toBe(true);
  });

  it('supports rejection and stop without executing a tool', () => {
    const rejected = preparedSession();
    rejected.submitPlan();
    const rejectedSnapshot = rejected.respondApproval('rejected');
    expect(rejectedSnapshot.turn?.status).toBe('cancelled');
    expect(rejectedSnapshot.events.some((event) => event.type === 'tool.started')).toBe(false);

    const stopped = preparedSession();
    stopped.submitPlan();
    const stoppedSnapshot = stopped.stopTask();
    expect(stoppedSnapshot.thread?.status).toBe('cancelled');
    expect(stoppedSnapshot.turn?.status).toBe('cancelled');
    expect(stoppedSnapshot.events.some((event) => event.type === 'tool.started')).toBe(false);
  });

  it('supports full-access permission mode with automatic approval and execution', () => {
    const session = preparedSession();
    session.setPermissionMode('full-access');
    expect(session.snapshot().permissionMode).toBe('full-access');
    expect(session.snapshot().home.permissionMode).toBe('full-access');

    // In full-access mode, submitting a plan automatically approves and completes
    const snapshot = session.submitPlan();
    expect(snapshot.approval?.status).toBe('approved');
    expect(snapshot.turn?.status).toBe('completed');
    expect(snapshot.events.some((event) => event.type === 'tool.completed')).toBe(true);
    expect(snapshot.events.some((event) => event.type === 'artifact.verified')).toBe(true);
  });
});
