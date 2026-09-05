import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DefaultApprovalPolicy } from '../src/runtime/approval-policy.js';
import { LocalWorkspaceSandbox } from '../src/runtime/sandbox.js';
import type { SandboxDecision, SandboxOperation } from '../src/runtime/protocol.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('DefaultApprovalPolicy', () => {
  it.each([
    ['read', 'allowed', 'workspace_read_allowed'],
    ['write_artifact', 'allowed', 'artifact_write_allowed'],
    ['workspace_write', 'approval_required', 'workspace_write_requires_approval'],
    ['overwrite_input', 'denied', 'input_overwrite_denied'],
    ['external_access', 'approval_required', 'external_access_requires_approval'],
    ['network', 'denied', 'network_disabled'],
  ] as const)('%s returns %s with stable reason %s', (operation, decision, reasonCode) => {
    const result = new DefaultApprovalPolicy().decide({
      operation: operation as SandboxOperation,
      targetPath: 'meeting-notes.md',
    });

    expect(result.decision).toBe(decision);
    expect(result.reasonCode).toBe(reasonCode);
  });
});

describe('LocalWorkspaceSandbox', () => {
  function createSandbox(): {
    root: string;
    sandbox: LocalWorkspaceSandbox;
    decisions: SandboxDecision[];
  } {
    const root = mkdtempSync(join(tmpdir(), 'agent-sandbox-'));
    roots.push(root);
    writeFileSync(join(root, 'meeting-notes.md'), 'Discuss launch risks.\n', 'utf8');
    mkdirSync(join(root, 'inputs'), { recursive: true });
    writeFileSync(join(root, 'inputs', 'decisions.txt'), 'Ship on Friday.\n', 'utf8');
    const decisions: SandboxDecision[] = [];
    const sandbox = new LocalWorkspaceSandbox({
      rootDir: root,
      onDecision: (decision) => decisions.push(decision),
    });
    return { root, sandbox, decisions };
  }

  it('reads files inside the workspace and emits an allowed audit decision', () => {
    const { sandbox, decisions } = createSandbox();

    expect(sandbox.readFile('meeting-notes.md')).toBe('Discuss launch risks.\n');
    expect(decisions.at(-1)?.decision).toBe('allowed');
    expect(decisions.at(-1)?.reasonCode).toBe('workspace_read_allowed');
  });

  it('writes new artifacts only below the task artifacts directory', () => {
    const { root, sandbox } = createSandbox();

    const result = sandbox.writeArtifact('weekly/report.txt', 'verified report');

    expect(result.path).toBe(join(root, 'artifacts', 'weekly', 'report.txt'));
    expect(readFileSync(result.path, 'utf8')).toBe('verified report');
  });

  it('rejects workspace escape and path traversal before reading', () => {
    const { sandbox, decisions } = createSandbox();

    const decision = sandbox.check({ operation: 'read', targetPath: '../outside.txt' });

    expect(decision.decision).toBe('denied');
    expect(decision.reasonCode).toBe('path_outside_workspace');
    expect(() => sandbox.readFile('../outside.txt')).toThrow('path_outside_workspace');
    expect(decisions.at(-1)?.reasonCode).toBe('path_outside_workspace');
  });

  it('rejects input overwrite and artifact overwrite by default', () => {
    const { sandbox, decisions } = createSandbox();

    const inputDecision = sandbox.check({
      operation: 'overwrite_input',
      targetPath: 'meeting-notes.md',
    });
    expect(inputDecision.decision).toBe('denied');
    expect(inputDecision.reasonCode).toBe('input_overwrite_denied');

    sandbox.writeArtifact('weekly/report.txt', 'first');
    expect(() => sandbox.writeArtifact('weekly/report.txt', 'second')).toThrow('artifact_exists');
    expect(decisions.at(-1)?.reasonCode).toBe('artifact_exists');
  });

  it('keeps network closed and gates external/workspace writes', () => {
    const { sandbox } = createSandbox();

    expect(sandbox.check({ operation: 'network' })).toMatchObject({
      decision: 'denied',
      reasonCode: 'network_disabled',
    });
    expect(sandbox.check({ operation: 'external_access' })).toMatchObject({
      decision: 'approval_required',
      reasonCode: 'external_access_requires_approval',
    });
    expect(sandbox.check({ operation: 'workspace_write', targetPath: 'notes.md' })).toMatchObject({
      decision: 'approval_required',
      reasonCode: 'workspace_write_requires_approval',
    });
  });
});
