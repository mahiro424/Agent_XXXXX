import type {
  SandboxCheckInput,
  SandboxDecisionOutcome,
  SandboxReasonCode,
} from './protocol.js';

export interface ApprovalPolicyOptions {
  readonly networkEnabled?: boolean;
}

export interface ApprovalPolicyDecision {
  readonly decision: SandboxDecisionOutcome;
  readonly reasonCode: SandboxReasonCode;
  readonly reason: string;
}

export class DefaultApprovalPolicy {
  private readonly networkEnabled: boolean;

  public constructor(options: ApprovalPolicyOptions = {}) {
    this.networkEnabled = options.networkEnabled ?? false;
  }

  public decide(input: SandboxCheckInput): ApprovalPolicyDecision {
    switch (input.operation) {
      case 'read':
        return {
          decision: 'allowed',
          reasonCode: 'workspace_read_allowed',
          reason: 'reading an existing file inside the workspace is allowed',
        };
      case 'write_artifact':
        return {
          decision: 'allowed',
          reasonCode: 'artifact_write_allowed',
          reason: 'writing a new task artifact is allowed inside the artifacts directory',
        };
      case 'workspace_write':
        return {
          decision: 'approval_required',
          reasonCode: 'workspace_write_requires_approval',
          reason: 'general workspace writes require explicit approval',
        };
      case 'overwrite_input':
        return {
          decision: 'denied',
          reasonCode: 'input_overwrite_denied',
          reason: 'input files cannot be overwritten by default',
        };
      case 'external_access':
        return {
          decision: 'approval_required',
          reasonCode: 'external_access_requires_approval',
          reason: 'external access requires explicit approval',
        };
      case 'network':
        return this.networkEnabled
          ? {
              decision: 'approval_required',
              reasonCode: 'external_access_requires_approval',
              reason: 'network access is enabled only as an approval-gated capability',
            }
          : {
              decision: 'denied',
              reasonCode: 'network_disabled',
              reason: 'network access is disabled by default',
            };
    }
  }
}
