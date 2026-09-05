import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppServer } from '../src/runtime/app-server.js';
import { LocalDocumentEngine } from '../src/runtime/document-engine.js';
import type { AnyRuntimeEvent } from '../src/runtime/protocol.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function approvalIdFor(events: readonly AnyRuntimeEvent[]): string {
  const event = events.find((candidate) => candidate.type === 'approval.requested');
  if (!event || event.type !== 'approval.requested') {
    throw new Error('approval.requested event was not emitted');
  }
  return event.payload.id;
}

function createDemoWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-golden-journey-'));
  roots.push(root);
  writeFileSync(
    join(root, 'meeting-notes.md'),
    '# Meeting Notes\nDiscuss launch risks.\nShip Friday.\n',
    'utf8',
  );
  writeFileSync(join(root, 'decisions.txt'), 'Owner: Maya\nStatus: approved\n', 'utf8');
  writeFileSync(join(root, 'sales.csv'), 'owner,amount\nMaya,120\nLeo,80\n', 'utf8');
  return root;
}

describe('Desktop Golden Journey', () => {
  it('completes the offline Local Workspace report flow with a verified docx', () => {
    const root = createDemoWorkspace();
    const server = new AppServer();
    const thread = server.createThread({ workspaceId: 'demo-workspace', workspaceRoot: root });
    const turn = server.startTurn({
      threadId: thread.id,
      input: '整理会议材料并生成周报',
    });

    server.respondApproval({
      approvalId: approvalIdFor(server.listEvents(thread.id)),
      decision: 'approved',
    });

    const events = server.listEvents(thread.id);
    const eventTypes = events.map((event) => event.type);
    expect(server.getTurn(turn.id).status).toBe('completed');
    expect(eventTypes).toContain('tool.completed');
    expect(eventTypes).toContain('artifact.verified');
    expect(eventTypes.indexOf('tool.started')).toBeLessThan(eventTypes.indexOf('tool.completed'));
    expect(eventTypes.indexOf('tool.completed')).toBeLessThan(
      eventTypes.indexOf('artifact.verification_started'),
    );
    expect(eventTypes.indexOf('artifact.verification_started')).toBeLessThan(
      eventTypes.indexOf('artifact.verified'),
    );

    const artifactPath = join(root, 'artifacts', 'weekly-meeting-report.docx');
    const reportText = new LocalDocumentEngine().readDocx(readFileSync(artifactPath));
    expect(reportText).toContain('Weekly Meeting Report');
    expect(reportText).toContain('Discuss launch risks.');
    expect(reportText).toContain('Maya | 120');

    const verified = events.find((event) => event.type === 'artifact.verified');
    expect(verified?.type).toBe('artifact.verified');
    if (verified?.type === 'artifact.verified') {
      expect(verified.payload.evidence).toContain('docx_structure:passed');
      expect(verified.payload.evidence).toContain('required_text:Weekly Meeting Report:passed');
    }
  });

  it('surfaces a real write failure once and does not automatically retry it', () => {
    const root = createDemoWorkspace();
    const artifactRoot = join(root, 'artifacts');
    // The runtime must not overwrite a pre-existing task artifact.
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(join(artifactRoot, 'weekly-meeting-report.docx'), 'existing artifact', 'utf8');

    const server = new AppServer();
    const thread = server.createThread({ workspaceId: 'demo-workspace', workspaceRoot: root });
    const turn = server.startTurn({ threadId: thread.id, input: '生成周报' });
    server.respondApproval({
      approvalId: approvalIdFor(server.listEvents(thread.id)),
      decision: 'approved',
    });

    const events = server.listEvents(thread.id);
    expect(server.getTurn(turn.id).status).toBe('failed');
    expect(events.filter((event) => event.type === 'tool.started')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'tool.failed')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'tool.completed')).toHaveLength(0);
    expect(events.filter((event) => event.type === 'artifact.verification_started')).toHaveLength(0);
  });
});
