import type {
  ApprovalTier,
  SandboxCheckInput,
  SandboxDecisionOutcome,
  SandboxReasonCode,
} from './protocol.js';

export interface ApprovalPolicyOptions {
  readonly networkEnabled?: boolean;
  readonly tier?: ApprovalTier;
}

export interface ApprovalPolicyDecision {
  readonly decision: SandboxDecisionOutcome;
  readonly reasonCode: SandboxReasonCode;
  readonly reason: string;
}

export class DefaultApprovalPolicy {
  private readonly networkEnabled: boolean;
  private tier: ApprovalTier;

  public constructor(options: ApprovalPolicyOptions = {}) {
    this.networkEnabled = options.networkEnabled ?? false;
    this.tier = options.tier ?? 'ask-approval';
  }

  public setTier(tier: ApprovalTier): void {
    this.tier = tier;
  }

  public getTier(): ApprovalTier {
    return this.tier;
  }

  public decide(input: SandboxCheckInput): ApprovalPolicyDecision {
    if (this.tier === 'full-access') {
      if (input.operation === 'network') {
        return this.networkEnabled
          ? { decision: 'allowed', reasonCode: 'external_access_requires_approval', reason: 'full-access policy allows network access' }
          : { decision: 'denied', reasonCode: 'network_disabled', reason: 'network access is disabled by default' };
      }
      return {
        decision: 'allowed',
        reasonCode: input.operation === 'read' ? 'workspace_read_allowed' : 'artifact_write_allowed',
        reason: `full-access policy automatically approves ${input.operation}`,
      };
    }

    if (this.tier === 'auto') {
      if (input.operation === 'read' || input.operation === 'write_artifact' || input.operation === 'workspace_write') {
        return {
          decision: 'allowed',
          reasonCode: input.operation === 'read' ? 'workspace_read_allowed' : 'artifact_write_allowed',
          reason: `auto policy allows routine ${input.operation} without manual prompt`,
        };
      }
      if (input.operation === 'overwrite_input' || input.operation === 'external_access') {
        return {
          decision: 'approval_required',
          reasonCode: input.operation === 'overwrite_input' ? 'input_overwrite_denied' : 'external_access_requires_approval',
          reason: `auto policy halts for potentially destructive ${input.operation}`,
        };
      }
    }

    if (this.tier === 'accept-edits') {
      if (input.operation === 'read' || input.operation === 'write_artifact') {
        return {
          decision: 'allowed',
          reasonCode: input.operation === 'read' ? 'workspace_read_allowed' : 'artifact_write_allowed',
          reason: `accept-edits policy automatically approves ${input.operation}`,
        };
      }
      if (input.operation === 'workspace_write' || input.operation === 'external_access') {
        return {
          decision: 'approval_required',
          reasonCode: input.operation === 'workspace_write' ? 'workspace_write_requires_approval' : 'external_access_requires_approval',
          reason: `accept-edits policy requires explicit confirmation for ${input.operation}`,
        };
      }
    }

    if (this.tier === 'risk-gated') {
      if (input.operation === 'read') {
        return {
          decision: 'allowed',
          reasonCode: 'workspace_read_allowed',
          reason: 'risk-gated policy allows low-risk reads',
        };
      }
      return {
        decision: 'approval_required',
        reasonCode: input.operation === 'write_artifact' ? 'artifact_write_allowed' : 'workspace_write_requires_approval',
        reason: `risk-gated policy requires review for ${input.operation}`,
      };
    }

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
          reason: 'writing a new file is allowed inside the workspace',
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
