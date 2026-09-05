import type { RuntimeIdFactory } from './event-log.js';
import type { Plan, PlanStep } from './protocol.js';

export interface ToolParameterSchema {
  readonly type: string;
  readonly description?: string;
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
}

export interface AgentToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly risk: 'read' | 'write' | 'external';
  readonly requiresApproval: boolean;
  readonly parameters?: ToolParameterSchema;
}

export interface ModelPlanInput {
  readonly turnId: string;
  readonly userInput: string;
  readonly workspaceFiles?: readonly string[];
  readonly tools?: readonly AgentToolDefinition[];
}

export interface ModelConfig {
  readonly provider?: 'fake' | 'openai-compatible';
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly modelName?: string;
  readonly temperature?: number;
  readonly timeoutMs?: number;
}

export interface ModelProvider {
  proposePlan(input: ModelPlanInput): Promise<Plan> | Plan;
}

export const DEFAULT_AGENT_TOOLS: readonly AgentToolDefinition[] = [
  {
    name: 'workspace.read_file',
    description: '读取工作区内的指定文件内容（如 Markdown、文本、CSV 或数据表格）',
    risk: 'read',
    requiresApproval: false,
  },
  {
    name: 'workspace.write_report',
    description: '读取会议材料与决策数据，在任务产物目录下生成结构化会议周报 Word 文档 (.docx)',
    risk: 'write',
    requiresApproval: true,
  },
  {
    name: 'workspace.write_artifact',
    description: '在任务产物目录 (artifacts/) 下创建新的分析文件或导出文档',
    risk: 'write',
    requiresApproval: true,
  },
  {
    name: 'windows.open_output_directory',
    description: '在桌面资源管理器中打开任务产物所在的本地目录',
    risk: 'read',
    requiresApproval: false,
  },
];

export function resolveModelConfig(config: ModelConfig = {}): Required<ModelConfig> {
  const apiKey = config.apiKey ?? process.env.AGENT_API_KEY ?? '';
  const provider =
    config.provider ??
    (process.env.AGENT_MODEL_PROVIDER as 'fake' | 'openai-compatible' | undefined) ??
    (apiKey.length > 0 ? 'openai-compatible' : 'fake');
  const baseURL =
    config.baseURL ??
    process.env.AGENT_BASE_URL ??
    'https://api.openai.com/v1';
  const modelName =
    config.modelName ??
    process.env.AGENT_MODEL_NAME ??
    (baseURL.includes('deepseek') ? 'deepseek-chat' : 'gpt-4o-mini');
  const temperature = config.temperature ?? 0.2;
  const timeoutMs = config.timeoutMs ?? 30000;

  return {
    provider,
    apiKey,
    baseURL: baseURL.replace(/\/+$/, ''),
    modelName,
    temperature,
    timeoutMs,
  };
}

interface RawPlanStep {
  title?: string;
  toolName?: string;
  risk?: string;
  requiresApproval?: boolean;
}

interface RawPlanOutput {
  steps?: RawPlanStep[];
}

export class OpenAICompatibleModelProvider implements ModelProvider {
  public readonly config: Required<ModelConfig>;
  private readonly createId: RuntimeIdFactory;
  private readonly fetchImpl: typeof fetch;

  public constructor(
    config: ModelConfig = {},
    createId: RuntimeIdFactory,
    fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.config = resolveModelConfig(config);
    this.createId = createId;
    this.fetchImpl = fetchImpl;
  }

  public async proposePlan(input: ModelPlanInput): Promise<Plan> {
    if (!this.config.apiKey) {
      throw new Error(
        'OpenAI-compatible model provider requires an API key (set AGENT_API_KEY or configure apiKey)',
      );
    }

    const tools = input.tools ?? DEFAULT_AGENT_TOOLS;
    const systemPrompt = this.buildSystemPrompt(tools, input.workspaceFiles);
    const userPrompt = `用户任务输入: "${input.userInput}"\n请根据可用工具与工作区上下文生成执行计划。`;

    const requestBody = {
      model: this.config.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: this.config.temperature,
      response_format: { type: 'json_object' },
    };

    const url = `${this.config.baseURL}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Model request timed out after ${this.config.timeoutMs}ms`);
      }
      throw new Error(`Failed to connect to model provider at ${url}: ${errorMessage(error)}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Model API request failed with status ${response.status} (${response.statusText}): ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Model provider returned an empty response content');
    }

    return this.parsePlanContent(input.turnId, content, tools);
  }

  private buildSystemPrompt(
    tools: readonly AgentToolDefinition[],
    workspaceFiles?: readonly string[],
  ): string {
    const toolDescriptions = tools
      .map(
        (t) =>
          `- ${t.name}: ${t.description} (风险级别: ${t.risk}, 需要审批: ${t.requiresApproval})`,
      )
      .join('\n');

    const fileSection =
      workspaceFiles && workspaceFiles.length > 0
        ? `\n当前工作区已发现文件:\n${workspaceFiles.map((f) => `- ${f}`).join('\n')}\n`
        : '';

    return `你是一个运行在桌面本地工作区 (Local Workspace) 的 HostAgent 规划中枢。
你的职责是：分析用户的自然语言输入，根据可用工具与工作区上下文，将任务拆解为精简、有序的执行步骤计划 (Plan)。

可用工具列表：
${toolDescriptions}
${fileSection}
铁律与安全规范：
1. 只能从可用工具列表中挑选工具 (toolName)。
2. 副作用操作（如写入产物、生成报告）的 risk 必须为 "write"，且 requiresApproval 必须为 true。
3. 只读操作（如读取文件、查看目录）的 risk 为 "read"，requiresApproval 通常为 false。
4. 必须输出严格合法的 JSON 对象，格式如下：
{
  "steps": [
    {
      "title": "简短的步骤描述",
      "toolName": "工具名称",
      "risk": "read" | "write" | "external",
      "requiresApproval": true | false
    }
  ]
}`;
  }

  private parsePlanContent(
    turnId: string,
    content: string,
    availableTools: readonly AgentToolDefinition[],
  ): Plan {
    let raw: RawPlanOutput;
    try {
      raw = JSON.parse(content) as RawPlanOutput;
    } catch {
      // 容错处理：尝试提取 Markdown 代码块中的 JSON
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        raw = JSON.parse(jsonMatch[1]) as RawPlanOutput;
      } else {
        throw new Error(`Failed to parse model plan output as JSON: ${content}`);
      }
    }

    const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
    if (rawSteps.length === 0) {
      throw new Error('Model provider returned a plan with no steps');
    }

    const toolMap = new Map(availableTools.map((t) => [t.name, t]));

    const steps: PlanStep[] = rawSteps.map((step) => {
      const toolName = step.toolName ?? 'workspace.read_file';
      const toolDef = toolMap.get(toolName);
      const title = step.title?.trim() || `执行 ${toolName}`;
      const risk: 'read' | 'write' | 'external' =
        step.risk === 'write' || step.risk === 'external' || step.risk === 'read'
          ? step.risk
          : (toolDef?.risk ?? 'write');
      const requiresApproval =
        typeof step.requiresApproval === 'boolean'
          ? step.requiresApproval
          : (toolDef?.requiresApproval ?? risk === 'write');

      return {
        id: this.createId('plan-step'),
        title,
        toolName,
        risk,
        requiresApproval,
      };
    });

    return {
      id: this.createId('plan'),
      turnId,
      steps,
      status: 'proposed',
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
