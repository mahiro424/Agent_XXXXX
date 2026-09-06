import {
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DefaultApprovalPolicy } from './approval-policy.js';
import type { ApprovalPolicyDecision } from './approval-policy.js';
import type { RuntimeClock, RuntimeIdFactory } from './event-log.js';
import type {
  ArtifactWriteResult,
  SandboxCheckInput,
  SandboxDecision,
  SandboxDecisionOutcome,
  SandboxReasonCode,
} from './protocol.js';

export interface LocalWorkspaceSandboxOptions {
  readonly rootDir: string;
  readonly artifactsDirName?: string;
  readonly policy?: DefaultApprovalPolicy;
  readonly now?: RuntimeClock;
  readonly idFactory?: RuntimeIdFactory;
  readonly onDecision?: (decision: SandboxDecision) => void;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultIdFactory(): RuntimeIdFactory {
  let counter = 0;
  return (prefix) => `${prefix}-${++counter}`;
}

function isWithin(rootDir: string, candidate: string): boolean {
  const pathFromRoot = relative(rootDir, candidate);
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot));
}

export class LocalWorkspaceSandbox {
  public readonly rootDir: string;
  public readonly artifactsDir: string;

  private readonly policy: DefaultApprovalPolicy;
  private readonly now: RuntimeClock;
  private readonly createId: RuntimeIdFactory;
  private readonly onDecision: ((decision: SandboxDecision) => void) | undefined;
  private readonly realRootDir: string;
  private readonly artifactsDirName: string;

  public constructor(options: LocalWorkspaceSandboxOptions) {
    this.rootDir = resolve(options.rootDir);
    if (!existsSync(this.rootDir)) {
      mkdirSync(this.rootDir, { recursive: true });
    } else if (!statSync(this.rootDir).isDirectory()) {
      throw new Error(`workspace root is not a directory: ${this.rootDir}`);
    }
    this.realRootDir = realpathSync(this.rootDir);
    this.artifactsDirName = options.artifactsDirName ?? 'artifacts';
    this.artifactsDir = resolve(this.rootDir, this.artifactsDirName);
    this.policy = options.policy ?? new DefaultApprovalPolicy();
    this.now = options.now ?? defaultNow;
    this.createId = options.idFactory ?? defaultIdFactory();
    this.onDecision = options.onDecision;
  }

  public check(input: SandboxCheckInput): SandboxDecision {
    const decision = this.evaluate(input);
    this.emit(decision);
    return decision;
  }

  public artifactPath(artifactName: string): string {
    const targetPath = join(this.artifactsDirName, artifactName);
    const decision = this.check({ operation: 'read', targetPath });
    this.assertAllowed(decision);
    const absolutePath = this.resolveInsideArtifacts(artifactName);
    if (existsSync(absolutePath)) {
      this.assertRealPathInsideRoot(absolutePath);
    }
    return absolutePath;
  }

  public listFiles(): readonly string[] {
    if (!existsSync(this.rootDir)) {
      return [];
    }
    const entries = readdirSync(this.rootDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => e.name);
  }

  public hasFile(targetPath: string): boolean {
    const absolutePath = this.resolveInsideRoot(targetPath);
    return (
      isWithin(this.rootDir, absolutePath) &&
      existsSync(absolutePath) &&
      statSync(absolutePath).isFile()
    );
  }

  public readFile(targetPath: string): string {
    return this.readFileBuffer(targetPath).toString('utf8');
  }

  public readFileBuffer(targetPath: string): Buffer {
    const decision = this.check({ operation: 'read', targetPath });
    this.assertAllowed(decision);
    const absolutePath = this.resolveInsideRoot(targetPath);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      throw new Error(`workspace file is not readable: ${targetPath}`);
    }
    this.assertRealPathInsideRoot(absolutePath);
    return readFileSync(absolutePath);
  }

  public writeArtifact(artifactName: string, content: string): ArtifactWriteResult {
    return this.writeArtifactBuffer(artifactName, Buffer.from(content, 'utf8'));
  }

  public writeArtifactBuffer(
    artifactName: string,
    content: Uint8Array,
  ): ArtifactWriteResult {
    const targetPath = join(this.artifactsDirName, artifactName);
    const decision = this.check({ operation: 'write_artifact', targetPath });
    this.assertAllowed(decision);

    const absolutePath = this.resolveInsideArtifacts(artifactName);
    const parentPath = dirname(absolutePath);
    mkdirSync(parentPath, { recursive: true });
    this.assertRealPathInsideRoot(parentPath);
    if (existsSync(absolutePath)) {
      const existsDecision = this.createDecision(
        'write_artifact',
        'denied',
        'artifact_exists',
        'the task artifact already exists and cannot be overwritten',
        targetPath,
      );
      this.emit(existsDecision);
      throw new Error(`sandbox denied: ${existsDecision.reasonCode}`);
    }

    try {
      writeFileSync(absolutePath, Buffer.from(content), { flag: 'wx' });
    } catch (error) {
      if (isFileExistsError(error)) {
        const existsDecision = this.createDecision(
          'write_artifact',
          'denied',
          'artifact_exists',
          'the task artifact already exists and cannot be overwritten',
          targetPath,
        );
        this.emit(existsDecision);
        throw new Error(`sandbox denied: ${existsDecision.reasonCode}`);
      }
      throw error;
    }

    return {
      path: absolutePath,
      bytes: content.byteLength,
    };
  }

  public writeWorkspaceFile(targetPath: string, content: string): ArtifactWriteResult {
    const decision = this.check({ operation: 'workspace_write', targetPath });
    this.assertAllowed(decision);

    const absolutePath = this.resolveInsideRoot(targetPath);
    const parentPath = dirname(absolutePath);
    mkdirSync(parentPath, { recursive: true });
    this.assertRealPathInsideRoot(parentPath);

    writeFileSync(absolutePath, content, 'utf8');
    return {
      path: absolutePath,
      bytes: Buffer.byteLength(content, 'utf8'),
    };
  }

  public editWorkspaceFile(
    targetPath: string,
    targetContent: string,
    replacementContent: string,
  ): { path: string; replacements: number } {
    const decision = this.check({ operation: 'workspace_write', targetPath });
    this.assertAllowed(decision);

    const absolutePath = this.resolveInsideRoot(targetPath);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      throw new Error(`workspace file is not found for editing: ${targetPath}`);
    }
    this.assertRealPathInsideRoot(absolutePath);

    const original = readFileSync(absolutePath, 'utf8');
    if (!original.includes(targetContent)) {
      throw new Error(`target content was not found in ${targetPath} to replace`);
    }

    const updated = original.replace(targetContent, replacementContent);
    writeFileSync(absolutePath, updated, 'utf8');

    return {
      path: absolutePath,
      replacements: 1,
    };
  }

  public listDirectory(subPath = ''): readonly { name: string; isDirectory: boolean; size: number }[] {
    const targetDir = subPath ? this.resolveInsideRoot(subPath) : this.rootDir;
    if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
      return [];
    }
    this.assertRealPathInsideRoot(targetDir);

    const entries = readdirSync(targetDir, { withFileTypes: true });
    return entries.map((e) => {
      const fullPath = join(targetDir, e.name);
      let size = 0;
      if (e.isFile()) {
        try {
          size = statSync(fullPath).size;
        } catch {
          // ignore
        }
      }
      return {
        name: e.name,
        isDirectory: e.isDirectory(),
        size,
      };
    });
  }

  private evaluate(input: SandboxCheckInput): SandboxDecision {
    if (input.operation === 'network' || input.operation === 'external_access') {
      return this.fromPolicy(input, this.policy.decide(input));
    }

    if (!input.targetPath) {
      return this.createDecision(
        input.operation,
        'denied',
        'path_outside_workspace',
        'a target path is required for this workspace operation',
      );
    }

    const absolutePath = this.resolveInsideRoot(input.targetPath);
    if (!isWithin(this.rootDir, absolutePath)) {
      return this.createDecision(
        input.operation,
        'denied',
        'path_outside_workspace',
        'the requested path is outside the selected workspace',
        input.targetPath,
      );
    }

    if (input.operation === 'write_artifact') {
      if (!isWithin(this.rootDir, absolutePath)) {
        return this.createDecision(
          input.operation,
          'denied',
          'path_outside_workspace',
          'artifacts must be written inside the workspace directory',
          input.targetPath,
        );
      }
      if (existsSync(absolutePath)) {
        return this.createDecision(
          input.operation,
          'denied',
          'artifact_exists',
          'the task artifact already exists and cannot be overwritten',
          input.targetPath,
        );
      }
    }

    const policyDecision = this.policy.decide(input);
    return this.fromPolicy(input, policyDecision);
  }

  private fromPolicy(
    input: SandboxCheckInput,
    decision: ApprovalPolicyDecision,
  ): SandboxDecision {
    return this.createDecision(
      input.operation,
      decision.decision,
      decision.reasonCode,
      decision.reason,
      input.targetPath,
    );
  }

  private createDecision(
    operation: SandboxCheckInput['operation'],
    decision: SandboxDecisionOutcome,
    reasonCode: SandboxReasonCode,
    reason: string,
    targetPath?: string,
  ): SandboxDecision {
    const base = {
      id: this.createId('sandbox-decision'),
      operation,
      decision,
      reasonCode,
      reason,
      occurredAt: this.now(),
    };
    return targetPath === undefined ? base : { ...base, targetPath };
  }

  private emit(decision: SandboxDecision): void {
    this.onDecision?.(decision);
  }

  private assertAllowed(decision: SandboxDecision): void {
    if (decision.decision !== 'allowed') {
      throw new Error(`sandbox denied: ${decision.reasonCode}`);
    }
  }

  private resolveInsideRoot(targetPath: string): string {
    return resolve(this.rootDir, targetPath);
  }

  private resolveInsideArtifacts(artifactName: string): string {
    const absolutePath = resolve(this.artifactsDir, artifactName);
    if (!isWithin(this.artifactsDir, absolutePath)) {
      throw new Error('sandbox denied: path_outside_workspace');
    }
    return absolutePath;
  }

  private assertRealPathInsideRoot(candidatePath: string): void {
    const realCandidate = realpathSync(candidatePath);
    if (!isWithin(this.realRootDir, realCandidate)) {
      throw new Error('sandbox denied: path_outside_workspace');
    }
  }
}

function isFileExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
