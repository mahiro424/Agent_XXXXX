import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalDocumentEngine } from '../src/runtime/document-engine.js';
import { LocalWorkspaceSandbox } from '../src/runtime/sandbox.js';
import { EvidenceVerifier } from '../src/runtime/verifier.js';

const roots: string[] = [];

function temporaryWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-real-document-engine-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Local Document Engine', () => {
  it('normalizes Markdown, text, and CSV sources for a report', () => {
    const engine = new LocalDocumentEngine();

    expect(engine.readSource('meeting-notes.md', Buffer.from('# Notes\r\nShip Friday.\r\n'))).toEqual({
      name: 'meeting-notes.md',
      kind: 'markdown',
      text: '# Notes\nShip Friday.',
    });
    expect(engine.readSource('decisions.txt', Buffer.from('Owner: Maya\r\nStatus: approved\r\n'))).toEqual({
      name: 'decisions.txt',
      kind: 'text',
      text: 'Owner: Maya\nStatus: approved',
    });
    expect(engine.readSource('sales.csv', Buffer.from('owner,amount\nMaya,120\n'))).toEqual({
      name: 'sales.csv',
      kind: 'csv',
      text: 'owner | amount\nMaya | 120',
    });
  });

  it('creates a real OOXML package that can be reopened and rendered', () => {
    const engine = new LocalDocumentEngine();
    const docx = engine.createDocx({
      title: 'Weekly Meeting Report',
      sources: [
        { name: 'meeting-notes.md', kind: 'markdown', text: '# Notes\nShip Friday.' },
        { name: 'decisions.txt', kind: 'text', text: 'Owner: Maya' },
        { name: 'sales.csv', kind: 'csv', text: 'owner | amount\nMaya | 120' },
      ],
    });

    expect(docx.subarray(0, 4).toString('binary')).toBe('PK\x03\x04');
    const text = engine.readDocx(docx);
    expect(text).toContain('Weekly Meeting Report');
    expect(text).toContain('Ship Friday.');
    expect(text).toContain('owner | amount');
    expect(engine.renderDocx(docx)).toBe(text);
  });

  it('passes independent structure, content, reopen, and hash evidence for a docx artifact', () => {
    const root = temporaryWorkspace();
    const sandbox = new LocalWorkspaceSandbox({ rootDir: root });
    const engine = new LocalDocumentEngine();
    const docx = engine.createDocx({
      title: 'Weekly Meeting Report',
      sources: [{ name: 'meeting-notes.md', kind: 'markdown', text: 'Ship Friday.' }],
    });
    const artifact = sandbox.writeArtifactBuffer('weekly-meeting-report.docx', docx);

    const result = new EvidenceVerifier().verify({
      artifactPath: artifact.path,
      requiredText: ['Weekly Meeting Report', 'Ship Friday.'],
      requireDocxStructure: true,
    });

    expect(result.status).toBe('VERIFIED');
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.checks.find((check) => check.name === 'docx_structure')?.status).toBe('passed');
    expect(readFileSync(artifact.path).subarray(0, 4).toString('binary')).toBe('PK\x03\x04');
  });

  it('keeps binary writes inside artifacts and refuses overwrite or traversal', () => {
    const root = temporaryWorkspace();
    const sandbox = new LocalWorkspaceSandbox({ rootDir: root });
    const bytes = Buffer.from([0, 1, 2, 3]);

    sandbox.writeArtifactBuffer('report.bin', bytes);
    expect(() => sandbox.writeArtifactBuffer('report.bin', bytes)).toThrow('artifact_exists');
    expect(() => sandbox.readFileBuffer('../outside.bin')).toThrow('path_outside_workspace');
    expect(() => sandbox.writeArtifactBuffer('../escape.bin', bytes)).toThrow('path_outside_workspace');
    expect(readFileSync(join(root, 'artifacts', 'report.bin'))).toEqual(bytes);
  });
});
