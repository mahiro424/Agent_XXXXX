import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { LocalDocumentEngine } from './document-engine.js';
import type { RuntimeClock, RuntimeIdFactory } from './event-log.js';

export type VerificationStatus =
  | 'VERIFIED'
  | 'PARTIALLY_COMPLETED'
  | 'FAILED'
  | 'RECONCILIATION_REQUIRED';

export type EvidenceCheckStatus = 'passed' | 'failed' | 'uncertain';

export interface VerificationRequest {
  readonly artifactPath: string;
  readonly requiredText?: readonly string[];
  readonly optionalText?: readonly string[];
  readonly requireDocxStructure?: boolean;
  readonly reconciliationRequired?: boolean;
}

export interface EvidenceCheck {
  readonly name: string;
  readonly required: boolean;
  readonly status: EvidenceCheckStatus;
  readonly detail: string;
}

export interface VerificationResult {
  readonly id: string;
  readonly artifactPath: string;
  readonly status: VerificationStatus;
  readonly checks: readonly EvidenceCheck[];
  readonly evidence: readonly string[];
  readonly sha256?: string;
  readonly byteLength: number;
  readonly summary: string;
}

export interface EvidenceVerifierOptions {
  readonly now?: RuntimeClock;
  readonly idFactory?: RuntimeIdFactory;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultIdFactory(): RuntimeIdFactory {
  let counter = 0;
  return (prefix) => `${prefix}-${++counter}`;
}

export class EvidenceVerifier {
  private readonly now: RuntimeClock;
  private readonly createId: RuntimeIdFactory;

  public constructor(options: EvidenceVerifierOptions = {}) {
    this.now = options.now ?? defaultNow;
    this.createId = options.idFactory ?? defaultIdFactory();
  }

  public verify(request: VerificationRequest): VerificationResult {
    const checks: EvidenceCheck[] = [];
    const evidence: string[] = [`verification_started_at=${this.now()}`];

    if (!existsSync(request.artifactPath)) {
      checks.push({
        name: 'exists',
        required: true,
        status: 'failed',
        detail: 'artifact does not exist',
      });
      return this.result(request, checks, evidence, 0, undefined, 'artifact is missing');
    }

    const stat = statSync(request.artifactPath);
    checks.push({
      name: 'exists',
      required: true,
      status: 'passed',
      detail: 'artifact exists',
    });
    if (!stat.isFile()) {
      checks.push({
        name: 'regular_file',
        required: true,
        status: 'failed',
        detail: 'artifact path is not a regular file',
      });
      return this.result(request, checks, evidence, 0, undefined, 'artifact is not a regular file');
    }

    const firstRead = readFileSync(request.artifactPath);
    const byteLength = firstRead.byteLength;
    evidence.push(`byte_length=${byteLength}`);
    checks.push({
      name: 'non_empty',
      required: true,
      status: byteLength > 0 ? 'passed' : 'failed',
      detail: byteLength > 0 ? 'artifact is non-empty' : 'artifact is empty',
    });
    if (byteLength === 0) {
      return this.result(request, checks, evidence, byteLength, undefined, 'artifact is empty');
    }

    const secondRead = readFileSync(request.artifactPath);
    const hash = createHash('sha256').update(secondRead).digest('hex');
    evidence.push(`sha256=${hash}`);
    checks.push({
      name: 'reopened',
      required: true,
      status: 'passed',
      detail: 'artifact was read again and hashed',
    });

    const text = readArtifactText(request.artifactPath, secondRead);
    for (const expected of request.requiredText ?? []) {
      const passed = text.includes(expected);
      checks.push({
        name: `required_text:${expected}`,
        required: true,
        status: passed ? 'passed' : 'failed',
        detail: passed ? 'required text was found' : 'required text was not found',
      });
    }
    for (const expected of request.optionalText ?? []) {
      const passed = text.includes(expected);
      checks.push({
        name: `optional_text:${expected}`,
        required: false,
        status: passed ? 'passed' : 'failed',
        detail: passed ? 'optional text was found' : 'optional text was not found',
      });
    }

    if (request.requireDocxStructure) {
      const structured = hasDocxStructure(secondRead);
      checks.push({
        name: 'docx_structure',
        required: true,
        status: structured ? 'passed' : 'failed',
        detail: structured
          ? 'docx package markers and required XML entries were found'
          : 'docx package markers or required XML entries are missing',
      });
    }

    if (request.reconciliationRequired) {
      checks.push({
        name: 'reconciliation_gate',
        required: true,
        status: 'uncertain',
        detail: 'the side effect outcome is uncertain; reread and user decision are required',
      });
      return this.result(
        request,
        checks,
        evidence,
        byteLength,
        hash,
        'verification is blocked until the uncertain side effect is reconciled',
      );
    }

    return this.result(request, checks, evidence, byteLength, hash);
  }

  private result(
    request: VerificationRequest,
    checks: readonly EvidenceCheck[],
    evidence: readonly string[],
    byteLength: number,
    sha256: string | undefined,
    failureSummary?: string,
  ): VerificationResult {
    const hasUncertain = checks.some((check) => check.status === 'uncertain');
    const requiredFailures = checks.filter(
      (check) => check.required && check.status === 'failed',
    );
    const optionalFailures = checks.filter(
      (check) => !check.required && check.status === 'failed',
    );
    const status: VerificationStatus = hasUncertain
      ? 'RECONCILIATION_REQUIRED'
      : requiredFailures.length > 0
        ? 'FAILED'
        : optionalFailures.length > 0
          ? 'PARTIALLY_COMPLETED'
          : 'VERIFIED';
    const summary =
      failureSummary ??
      (status === 'VERIFIED'
        ? 'all required evidence checks passed'
        : status === 'PARTIALLY_COMPLETED'
          ? 'required checks passed but optional evidence is missing'
          : 'one or more required evidence checks failed');
    const resultBase = {
      id: this.createId('verification'),
      artifactPath: request.artifactPath,
      status,
      checks,
      evidence,
      byteLength,
      summary,
    };
    return sha256 === undefined ? resultBase : { ...resultBase, sha256 };
  }
}

function readArtifactText(artifactPath: string, buffer: Buffer): string {
  if (!artifactPath.toLowerCase().endsWith('.docx')) {
    return buffer.toString('utf8');
  }
  try {
    return new LocalDocumentEngine().readDocx(buffer);
  } catch {
    return '';
  }
}

function hasDocxStructure(buffer: Buffer): boolean {
  if (buffer.length < 4 || buffer.subarray(0, 4).toString('binary') !== 'PK\x03\x04') {
    return false;
  }
  const packageText = buffer.toString('latin1');
  return (
    packageText.includes('[Content_Types].xml') &&
    packageText.includes('_rels/.rels') &&
    packageText.includes('word/document.xml')
  );
}
