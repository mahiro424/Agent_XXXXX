import type {
  ArtifactVerification,
  Plan,
  PlanStep,
  ToolExecution,
} from './protocol.js';
import type { RuntimeIdFactory } from './event-log.js';

export type FakeToolOutcome = 'success' | 'failed' | 'reconciliation_required';
export type FakeVerificationOutcome = 'verified' | 'failed' | 'reconciliation_required';

export interface FakeScenario {
  readonly tool?: FakeToolOutcome;
  readonly verification?: FakeVerificationOutcome;
}

const defaultScenario: Required<FakeScenario> = {
  tool: 'success',
  verification: 'verified',
};

import type { ModelPlanInput, ModelProvider } from './model-provider.js';

export class FakeModel implements ModelProvider {
  public constructor(private readonly createId: RuntimeIdFactory) {}

  public proposePlan(turnIdOrInput: string | ModelPlanInput): Plan {
    const turnId = typeof turnIdOrInput === 'string' ? turnIdOrInput : turnIdOrInput.turnId;
    const step: PlanStep = {
      id: this.createId('plan-step'),
      title: '读取并生成会议周报',
      toolName: 'workspace.write_report',
      risk: 'write',
      requiresApproval: true,
    };
    return {
      id: this.createId('plan'),
      turnId,
      steps: [step],
      status: 'proposed',
    };
  }
}

export class FakeToolAdapter {
  private readonly scenario: Required<FakeScenario>;

  public constructor(
    scenario: FakeScenario = {},
    private readonly createId: RuntimeIdFactory,
  ) {
    this.scenario = { ...defaultScenario, ...scenario };
  }

  public execute(turnId: string, step: PlanStep): ToolExecution {
    if (this.scenario.tool === 'success') {
      return {
        id: this.createId('tool'),
        turnId,
        planStepId: step.id,
        toolName: step.toolName,
        status: 'completed',
        output: 'fake report input collected',
      };
    }

    if (this.scenario.tool === 'reconciliation_required') {
      return {
        id: this.createId('tool'),
        turnId,
        planStepId: step.id,
        toolName: step.toolName,
        status: 'reconciliation_required',
        error: 'the write outcome cannot be determined safely',
      };
    }

    return {
      id: this.createId('tool'),
      turnId,
      planStepId: step.id,
      toolName: step.toolName,
      status: 'failed',
      error: 'fake tool failure',
    };
  }
}

export class FakeVerifier {
  private readonly scenario: Required<FakeScenario>;

  public constructor(
    scenario: FakeScenario = {},
    private readonly createId: RuntimeIdFactory,
  ) {
    this.scenario = { ...defaultScenario, ...scenario };
  }

  public verify(turnId: string): ArtifactVerification {
    if (this.scenario.verification === 'verified') {
      return {
        id: this.createId('verification'),
        turnId,
        artifactName: 'weekly-meeting-report.docx',
        status: 'verified',
        evidence: ['artifact exists', 'artifact reopened', 'content structure verified'],
      };
    }

    if (this.scenario.verification === 'reconciliation_required') {
      return {
        id: this.createId('verification'),
        turnId,
        artifactName: 'weekly-meeting-report.docx',
        status: 'reconciliation_required',
        error: 'verification cannot determine whether the artifact is current',
      };
    }

    return {
      id: this.createId('verification'),
      turnId,
      artifactName: 'weekly-meeting-report.docx',
      status: 'failed',
      error: 'fake artifact verification failed',
    };
  }
}
