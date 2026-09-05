import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FixtureDocumentEngine } from '../src/runtime/document-engine.js';
import { EvidenceVerifier } from '../src/runtime/verifier.js';
import { LocalWorkspaceSandbox } from '../src/runtime/sandbox.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function engineWorkspace(): { root: string; engine: FixtureDocumentEngine } {
  const root = mkdtempSync(join(tmpdir(), 'agent-document-engine-'));
  roots.push(root);
  return {
    root,
    engine: new FixtureDocumentEngine(new LocalWorkspaceSandbox({ rootDir: root })),
  };
}

describe('DocumentEngine contract', () => {
  it('reads Markdown and text through LocalWorkspaceSandbox into structured input', () => {
    const { root, engine } = engineWorkspace();
    writeFileSync(join(root, 'meeting-notes.md'), '# Meeting Notes\nDiscuss launch risks.\nShip Friday.\n', 'utf8');
    writeFileSync(join(root, 'decisions.txt'), 'Owner: Maya\nStatus: approved\n', 'utf8');

    const markdown = engine.readSource('meeting-notes.md');
    const text = engine.readSource('decisions.txt');

    expect(markdown).toMatchObject({
      format: 'markdown',
      title: 'Meeting Notes',
      paragraphs: ['Discuss launch risks.', 'Ship Friday.'],
    });
    expect(text).toMatchObject({
      format: 'text',
      title: 'decisions.txt',
      paragraphs: ['Owner: Maya', 'Status: approved'],
    });
  });

  it('reads CSV into headers and rows without bypassing the workspace boundary', () => {
    const { root, engine } = engineWorkspace();
    writeFileSync(join(root, 'sales.csv'), 'owner,amount\nMaya,120\nLeo,80\n', 'utf8');

    const document = engine.readSource('sales.csv');

    expect(document).toMatchObject({
      format: 'csv',
      table: {
        headers: ['owner', 'amount'],
        rows: [
          ['Maya', '120'],
          ['Leo', '80'],
        ],
      },
    });
  });

  it('creates a verifiable local fixture and lets EvidenceVerifier inspect it', () => {
    const { engine } = engineWorkspace();
    const result = engine.createFixtureArtifact(
      {
        title: 'Weekly Meeting Report',
        paragraphs: ['Discuss launch risks.', 'Ship Friday.'],
        sourcePaths: ['meeting-notes.md', 'decisions.txt'],
      },
      'weekly-meeting-report.fixture.json',
    );

    expect(result.status).toBe('completed');
    expect(result.format).toBe('fixture-json');
    expect(result.path).toBeDefined();
    const content = readFileSync(result.path as string, 'utf8');
    expect(content).toContain('Weekly Meeting Report');
    expect(content).toContain('Ship Friday.');

    const evidence = new EvidenceVerifier().verify({
      artifactPath: result.path as string,
      requiredText: ['document-fixture', 'Weekly Meeting Report', 'Ship Friday.'],
    });
    expect(evidence.status).toBe('VERIFIED');
  });

  it('reports real docx creation and rendering as unavailable instead of faking success', () => {
    const { engine } = engineWorkspace();
    expect(engine.capabilities).toEqual({
      fixture: 'available',
      docx: 'unavailable',
      render: 'unavailable',
    });

    const draft = {
      title: 'Report',
      paragraphs: ['Content'],
      sourcePaths: ['meeting-notes.md'],
    };
    expect(engine.createDocx(draft, 'report.docx')).toMatchObject({
      status: 'unavailable',
      format: 'docx',
      reason: 'office_renderer_unavailable',
    });
    expect(engine.renderArtifact('report.docx')).toMatchObject({
      status: 'unavailable',
      format: 'render',
      reason: 'office_renderer_unavailable',
    });
  });
});
