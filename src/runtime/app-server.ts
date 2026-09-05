import { RuntimeEngine } from './engine.js';
import type { RuntimeEngineOptions, RespondApprovalInput } from './engine.js';
import type { VerificationRequest, VerificationResult } from './verifier.js';
import type {
  AnyRuntimeEvent,
  Approval,
  ArtifactWriteResult,
  CreateThreadInput,
  SandboxCheckInput,
  SandboxDecision,
  StartTurnInput,
  Thread,
  Turn,
} from './protocol.js';

export interface AppServerContract {
  createThread(input: CreateThreadInput): Thread;
  startTurn(input: StartTurnInput): Turn;
  respondApproval(input: RespondApprovalInput): Approval;
  pause(threadId: string): void;
  resumeThread(threadId: string): void;
  cancel(threadId: string): void;
  getThread(threadId: string): Thread;
  getTurn(turnId: string): Turn;
  listEvents(threadId: string): readonly AnyRuntimeEvent[];
  subscribeEvents(listener: (event: AnyRuntimeEvent) => void): () => void;
  checkSandbox(threadId: string, input: SandboxCheckInput): SandboxDecision;
  readWorkspaceFile(threadId: string, targetPath: string): string;
  writeArtifact(threadId: string, artifactName: string, content: string): ArtifactWriteResult;
  verifyArtifact(
    threadId: string,
    artifactName: string,
    options?: Omit<VerificationRequest, 'artifactPath'>,
  ): VerificationResult;
}

export class AppServer implements AppServerContract {
  private readonly runtime: RuntimeEngine;

  public constructor(options: RuntimeEngineOptions = {}) {
    this.runtime = new RuntimeEngine(options);
  }

  public createThread(input: CreateThreadInput): Thread {
    return this.runtime.createThread(input);
  }

  public startTurn(input: StartTurnInput): Turn {
    return this.runtime.startTurn(input);
  }

  public respondApproval(input: RespondApprovalInput): Approval {
    return this.runtime.respondApproval(input);
  }

  public pause(threadId: string): void {
    this.runtime.pause(threadId);
  }

  public resumeThread(threadId: string): void {
    this.runtime.resumeThread(threadId);
  }

  public cancel(threadId: string): void {
    this.runtime.cancel(threadId);
  }

  public getThread(threadId: string): Thread {
    return this.runtime.getThread(threadId);
  }

  public getTurn(turnId: string): Turn {
    return this.runtime.getTurn(turnId);
  }

  public listEvents(threadId: string): readonly AnyRuntimeEvent[] {
    return this.runtime.listEvents(threadId);
  }

  public subscribeEvents(listener: (event: AnyRuntimeEvent) => void): () => void {
    return this.runtime.subscribeEvents(listener);
  }

  public checkSandbox(threadId: string, input: SandboxCheckInput): SandboxDecision {
    return this.runtime.checkSandbox(threadId, input);
  }

  public readWorkspaceFile(threadId: string, targetPath: string): string {
    return this.runtime.readWorkspaceFile(threadId, targetPath);
  }

  public writeArtifact(
    threadId: string,
    artifactName: string,
    content: string,
  ): ArtifactWriteResult {
    return this.runtime.writeArtifact(threadId, artifactName, content);
  }

  public verifyArtifact(
    threadId: string,
    artifactName: string,
    options: Omit<VerificationRequest, 'artifactPath'> = {},
  ): VerificationResult {
    return this.runtime.verifyArtifact(threadId, artifactName, options);
  }
}
