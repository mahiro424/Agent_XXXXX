import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EvidenceVerifier } from '../src/runtime/verifier.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-verifier-'));
  roots.push(root);
  return root;
}

describe('EvidenceVerifier', () => {
  it('returns VERIFIED with existence, non-empty, reopen, hash, and content evidence', () => {
    const root = workspace();
    const artifactPath = join(root, 'report.txt');
    writeFileSync(artifactPath, 'Weekly report\nKey decision: ship Friday\n', 'utf8');

    const result = new EvidenceVerifier().verify({
      artifactPath,
      requiredText: ['Weekly report', 'ship Friday'],
    });

    expect(result.status).toBe('VERIFIED');
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evidence).toContain(`byte_length=${Buffer.byteLength('Weekly report\nKey decision: ship Friday\n')}`);
    expect(result.checks.map((check) => check.name)).toEqual([
      'exists',
      'non_empty',
      'reopened',
      'required_text:Weekly report',
      'required_text:ship Friday',
    ]);
  });

  it('returns FAILED with observable reasons for missing, empty, or required content', () => {
    const root = workspace();
    const missing = new EvidenceVerifier().verify({ artifactPath: join(root, 'missing.txt') });
    expect(missing.status).toBe('FAILED');
    expect(missing.summary).toBe('artifact is missing');

    const emptyPath = join(root, 'empty.txt');
    writeFileSync(emptyPath, '', 'utf8');
    const empty = new EvidenceVerifier().verify({ artifactPath: emptyPath });
    expect(empty.status).toBe('FAILED');
    expect(empty.checks.find((check) => check.name === 'non_empty')?.detail).toBe('artifact is empty');

    const contentPath = join(root, 'content.txt');
    writeFileSync(contentPath, 'only one section', 'utf8');
    const content = new EvidenceVerifier().verify({
      artifactPath: contentPath,
      requiredText: ['missing section'],
    });
    expect(content.status).toBe('FAILED');
    expect(content.checks.find((check) => check.name === 'required_text:missing section')?.status).toBe(
      'failed',
    );
  });

  it('returns PARTIALLY_COMPLETED when only optional evidence is missing', () => {
    const root = workspace();
    const artifactPath = join(root, 'partial.txt');
    writeFileSync(artifactPath, 'required section', 'utf8');

    const result = new EvidenceVerifier().verify({
      artifactPath,
      requiredText: ['required section'],
      optionalText: ['optional appendix'],
    });

    expect(result.status).toBe('PARTIALLY_COMPLETED');
    expect(result.checks.find((check) => check.name === 'optional_text:optional appendix')?.required).toBe(
      false,
    );
  });

  it('does not mark an invalid docx structure as verified', () => {
    const root = workspace();
    const artifactPath = join(root, 'report.docx');
    writeFileSync(artifactPath, 'not a zip document', 'utf8');

    const result = new EvidenceVerifier().verify({
      artifactPath,
      requireDocxStructure: true,
    });

    expect(result.status).toBe('FAILED');
    expect(result.checks.find((check) => check.name === 'docx_structure')?.status).toBe('failed');
  });

  it('returns RECONCILIATION_REQUIRED without retrying the side effect', () => {
    const root = workspace();
    const artifactPath = join(root, 'uncertain.txt');
    writeFileSync(artifactPath, 'side effect may have happened', 'utf8');

    const result = new EvidenceVerifier().verify({
      artifactPath,
      reconciliationRequired: true,
    });

    expect(result.status).toBe('RECONCILIATION_REQUIRED');
    expect(result.checks.find((check) => check.name === 'reconciliation_gate')?.status).toBe(
      'uncertain',
    );
    expect(result.summary).toContain('uncertain side effect');
  });

  it('verifies valid json structure when requested or targeting .json file', () => {
    const root = workspace();
    const artifactPath = join(root, 'data.json');
    writeFileSync(artifactPath, JSON.stringify({ name: 'Agent', count: 42, nested: { ok: true } }), 'utf8');

    const result = new EvidenceVerifier().verify({
      artifactPath,
      requireJsonStructure: true,
    });

    expect(result.status).toBe('VERIFIED');
    expect(result.checks.find((check) => check.name === 'json_structure')?.status).toBe('passed');
  });

  it('fails verification when json structure is invalid or corrupt', () => {
    const root = workspace();
    const artifactPath = join(root, 'broken.json');
    writeFileSync(artifactPath, '{ name: "Agent", count: ', 'utf8');

    const result = new EvidenceVerifier().verify({
      artifactPath,
    });

    expect(result.status).toBe('FAILED');
    expect(result.checks.find((check) => check.name === 'json_structure')?.status).toBe('failed');
    expect(result.summary).toBe('one or more required evidence checks failed');
  });
});
