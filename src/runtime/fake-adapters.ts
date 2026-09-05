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

import type { ModelChatInput, ModelChatOutput, ModelPlanInput, ModelProvider } from './model-provider.js';

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

  public chatCompletion(input: ModelChatInput): ModelChatOutput {
    const lastUserMsg = [...input.messages].reverse().find((m) => m.role === 'user');
    const text = lastUserMsg?.content.toLowerCase() ?? '';

    // If user says greeting or general inquiry:
    if (
      text.includes('你好') ||
      text.includes('hi') ||
      text.includes('hello') ||
      text.includes('是谁') ||
      text.includes('帮助')
    ) {
      return {
        content:
          '你好！我是 Agent_XXXXX 本地工作区智能助手。我具备双重沙箱安全保护，能够读取工作区文件、执行数据分析清洗，并使用 ExcelJS 与 docx 引擎为您生成具备真实动态公式的 Excel 工作簿与规范格式的 Word 周报。请问今天有什么任务需要我处理？',
      };
    }

    // If previous message was a tool execution result:
    const lastMsg = input.messages[input.messages.length - 1];
    if (lastMsg?.role === 'tool') {
      return {
        content: `任务已顺利完成！${lastMsg.content}，产物已保存在本地沙箱 artifacts/ 目录下，并通过了物理证据链校验（ZIP 结构与有效数据校验通过）。`,
      };
    }

    // If user asks to process excel / sales:
    if (
      text.includes('excel') ||
      text.includes('sales') ||
      text.includes('销售') ||
      text.includes('表格') ||
      text.includes('汇总')
    ) {
      return {
        content: '正在为您分析并汇总销售数据，即将调用 Excel 引擎生成汇总表格。',
        toolCalls: [
          {
            id: this.createId('tool-call'),
            name: 'office.process_excel',
            arguments: { source: 'sales.csv', target: 'sales-summary.xlsx' },
          },
        ],
      };
    }

    // If user asks to generate word report / meeting:
    if (
      text.includes('word') ||
      text.includes('周报') ||
      text.includes('报告') ||
      text.includes('会议') ||
      text.includes('meeting')
    ) {
      return {
        content: '正在为您整理会议纪要，即将调用 Word 引擎生成结构化周报。',
        toolCalls: [
          {
            id: this.createId('tool-call'),
            name: 'office.generate_word_report',
            arguments: { source: 'meeting-notes.md', target: 'weekly-meeting-report.docx' },
          },
        ],
      };
    }

    // Default conversational reply:
    return {
      content: `收到您的输入："${lastUserMsg?.content ?? ''}"。我已经准备好为您处理本地工作区文件，您可以让我读取 CSV/Excel 表格、生成 Word 报告或清洗分析数据。`,
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
