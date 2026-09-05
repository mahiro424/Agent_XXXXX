import { RuntimeEngine } from './engine.js';
import type { RuntimeEngineOptions, RespondApprovalInput } from './engine.js';
import type { VerificationRequest, VerificationResult } from './verifier.js';
import type {
  AnyRuntimeEvent,
  Approval,
  ArtifactWriteResult,
  ChatMessage,
  CreateThreadInput,
  SandboxCheckInput,
  SandboxDecision,
  StartTurnInput,
  Thread,
  Turn,
} from './protocol.js';
import type { AgentSkill } from './skill.js';
import type { McpBridge } from './mcp-bridge.js';

export interface AppServerContract {
  createThread(input: CreateThreadInput): Thread;
  startTurn(input: StartTurnInput): Turn;
  startTurnAsync?(input: StartTurnInput): Promise<Turn>;
  sendMessage(
    threadId: string,
    content: string,
    options?: {
      skillId?: string;
      systemPrompt?: string;
      maxSteps?: number;
    },
  ): Promise<ChatMessage>;
  listMessages(threadId: string): readonly ChatMessage[];
  listSkills(): readonly AgentSkill[];
  getSkill(id: string): AgentSkill | undefined;
  setThreadSkill(threadId: string, skillId: string): void;
  getThreadSkill(threadId: string): AgentSkill | undefined;
  getMcpBridge(): McpBridge;
  respondApproval(input: RespondApprovalInput): Approval;
  pause(threadId: string): void;
  resumeThread(threadId: string): void;
  cancel(threadId: string): void;
  getThread(threadId: string): Thread;
  listThreads(): readonly Thread[];
  getTurn(turnId: string): Turn;
  listEvents(threadId: string): readonly AnyRuntimeEvent[];
  listAllEvents(): readonly AnyRuntimeEvent[];
  subscribeEvents(listener: (event: AnyRuntimeEvent) => void): () => void;
  checkSandbox(threadId: string, input: SandboxCheckInput): SandboxDecision;
  readWorkspaceFile(threadId: string, targetPath: string): string;
  readWorkspaceFileBuffer(threadId: string, targetPath: string): Buffer;
  writeArtifact(threadId: string, artifactName: string, content: string): ArtifactWriteResult;
  writeArtifactBuffer(
    threadId: string,
    artifactName: string,
    content: Uint8Array,
  ): ArtifactWriteResult;
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

  public async startTurnAsync(input: StartTurnInput): Promise<Turn> {
    return this.runtime.startTurnAsync(input);
  }

  public async sendMessage(
    threadId: string,
    content: string,
    options?: {
      skillId?: string;
      systemPrompt?: string;
      maxSteps?: number;
    },
  ): Promise<ChatMessage> {
    return this.runtime.sendMessage(threadId, content, options);
  }

  public listMessages(threadId: string): readonly ChatMessage[] {
    return this.runtime.listMessages(threadId);
  }

  public listSkills(): readonly AgentSkill[] {
    return this.runtime.listSkills();
  }

  public getSkill(id: string): AgentSkill | undefined {
    return this.runtime.getSkill(id);
  }

  public setThreadSkill(threadId: string, skillId: string): void {
    this.runtime.setThreadSkill(threadId, skillId);
  }

  public getThreadSkill(threadId: string): AgentSkill | undefined {
    return this.runtime.getThreadSkill(threadId);
  }

  public getMcpBridge(): McpBridge {
    return this.runtime.getMcpBridge();
  }

  public respondApproval(input: RespondApprovalInput): Approval {
    return this.runtime.respondApproval(input);
  }

  public async respondApprovalAsync(input: RespondApprovalInput): Promise<Approval> {
    return this.runtime.respondApprovalAsync(input);
  }

  public async waitForTurnCompletion(turnId: string, timeoutMs?: number): Promise<Turn> {
    return this.runtime.waitForTurnCompletion(turnId, timeoutMs);
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

  public listThreads(): readonly Thread[] {
    return this.runtime.listThreads();
  }

  public getTurn(turnId: string): Turn {
    return this.runtime.getTurn(turnId);
  }

  public listEvents(threadId: string): readonly AnyRuntimeEvent[] {
    return this.runtime.listEvents(threadId);
  }

  public listAllEvents(): readonly AnyRuntimeEvent[] {
    return this.runtime.listAllEvents();
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

  public readWorkspaceFileBuffer(threadId: string, targetPath: string): Buffer {
    return this.runtime.readWorkspaceFileBuffer(threadId, targetPath);
  }

  public writeArtifact(
    threadId: string,
    artifactName: string,
    content: string,
  ): ArtifactWriteResult {
    return this.runtime.writeArtifact(threadId, artifactName, content);
  }

  public writeArtifactBuffer(
    threadId: string,
    artifactName: string,
    content: Uint8Array,
  ): ArtifactWriteResult {
    return this.runtime.writeArtifactBuffer(threadId, artifactName, content);
  }

  public verifyArtifact(
    threadId: string,
    artifactName: string,
    options: Omit<VerificationRequest, 'artifactPath'> = {},
  ): VerificationResult {
    return this.runtime.verifyArtifact(threadId, artifactName, options);
  }
}
