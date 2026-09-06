import type { RuntimeIdFactory } from './event-log.js';
import type { ChatMessage, Plan, PlanStep, ToolCall } from './protocol.js';

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

export interface ModelChatChunk {
  readonly deltaContent?: string | undefined;
  readonly deltaReasoning?: string | undefined;
}

export interface ModelChatInput {
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly AgentToolDefinition[];
  readonly workspaceFiles?: readonly string[] | undefined;
  readonly systemPrompt?: string | undefined;
  readonly onChunk?: ((chunk: ModelChatChunk) => void) | undefined;
}

export interface ModelChatOutput {
  readonly content: string;
  readonly reasoningContent?: string | undefined;
  readonly toolCalls?: readonly ToolCall[] | undefined;
  readonly usage?: {
    readonly promptTokens?: number | undefined;
    readonly completionTokens?: number | undefined;
    readonly totalTokens?: number | undefined;
  } | undefined;
}

export interface ModelConfig {
  readonly provider?: 'openai-compatible';
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly modelName?: string;
  readonly temperature?: number;
  readonly timeoutMs?: number;
  readonly reasoningEffort?: 'max' | 'high' | 'medium' | 'low' | 'off';
}

export interface ModelProvider {
  proposePlan(input: ModelPlanInput): Promise<Plan> | Plan;
  chatCompletion?(input: ModelChatInput): Promise<ModelChatOutput> | ModelChatOutput;
}

export class DeterministicModelProvider implements ModelProvider {
  public constructor(
    private readonly defaultStep?: {
      title?: string;
      toolName?: string;
      requiresApproval?: boolean;
    },
    private readonly createId: RuntimeIdFactory = (prefix) => `${prefix}-1`,
  ) {}

  public proposePlan(input: ModelPlanInput): Plan {
    const step: PlanStep = {
      id: `plan-step-${input.turnId}`,
      title: this.defaultStep?.title ?? '读取并生成周报',
      toolName: this.defaultStep?.toolName ?? 'workspace.write_report',
      risk: 'write',
      requiresApproval: this.defaultStep?.requiresApproval ?? true,
    };
    return {
      id: `plan-${input.turnId}`,
      turnId: input.turnId,
      steps: [step],
      status: 'proposed',
    };
  }

  public chatCompletion(input: ModelChatInput): ModelChatOutput {
    const lastUserMsg = [...input.messages].reverse().find((m) => m.role === 'user');
    const text = lastUserMsg?.content.toLowerCase() ?? '';

    let output: ModelChatOutput;

    if (
      text.includes('你好') ||
      text.includes('hi') ||
      text.includes('hello') ||
      text.includes('是谁') ||
      text.includes('帮助') ||
      text.includes('介绍')
    ) {
      output = {
        content:
          '你好！我是 Agent_XXXXX 本地工作区智能助手。我具备双重沙箱安全保护，能够读取工作区文件、执行数据分析清洗，并使用 ExcelJS 与 docx 引擎为您生成具备真实动态公式的 Excel 工作簿与规范格式的 Word 周报。请问今天有什么任务需要我处理？',
      };
    } else {
      const lastMsg = input.messages[input.messages.length - 1];
      if (lastMsg?.role === 'tool') {
        output = {
          content: `任务已顺利完成！${lastMsg.content}，产物已保存在本地工作区中，并通过了物理证据链校验（ZIP 结构与有效数据校验通过）。`,
        };
      } else if (
        text.includes('script') ||
        text.includes('脚本') ||
        text.includes('计算') ||
        text.includes('codeact')
      ) {
        output = {
          reasoningContent: '检测到精准数学或数据处理需求，准备调度本地脚本沙箱进行无幻觉执行。',
          content: '正在为您编写并执行本地沙箱脚本进行精确计算。',
          toolCalls: [
            {
              id: this.createId('tool-call'),
              name: 'workspace.execute_script',
              arguments: {
                language: 'node',
                script: 'console.log("计算结果: 200");',
              },
            },
          ],
        };
      } else if (
        text.includes('excel') ||
        text.includes('sales') ||
        text.includes('销售') ||
        text.includes('表格') ||
        text.includes('汇总')
      ) {
        output = {
          content: '正在为您分析并汇总销售数据，即将调用 Excel 引擎生成汇总表格。',
          toolCalls: [
            {
              id: this.createId('tool-call'),
              name: 'office.process_excel',
              arguments: { source: 'sales.csv', target: 'sales-summary.xlsx' },
            },
          ],
        };
      } else if (
        text.includes('word') ||
        text.includes('周报') ||
        text.includes('报告') ||
        text.includes('会议') ||
        text.includes('meeting')
      ) {
        output = {
          content: '正在为您整理会议纪要，即将调用 Word 引擎生成结构化周报。',
          toolCalls: [
            {
              id: this.createId('tool-call'),
              name: 'office.generate_word_report',
              arguments: { source: 'meeting-notes.md', target: 'weekly-meeting-report.docx' },
            },
          ],
        };
      } else {
        output = {
          content: `收到您的输入："${lastUserMsg?.content ?? ''}"。我已经准备好为您处理本地工作区文件，您可以让我读取 CSV/Excel 表格、生成 Word 报告或清洗分析数据。`,
        };
      }
    }

    if (input.onChunk) {
      input.onChunk({
        ...(output.reasoningContent ? { deltaReasoning: output.reasoningContent } : {}),
        ...(output.content ? { deltaContent: output.content } : {}),
      });
    }

    return output;
  }
}

export function estimateMessageTokens(messages: readonly ChatMessage[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

export function pruneContextMessages(
  messages: readonly ChatMessage[],
  maxEstimatedTokens = 8000,
): ChatMessage[] {
  if (estimateMessageTokens(messages) <= maxEstimatedTokens) {
    return [...messages];
  }

  const result: ChatMessage[] = [];
  const systemMsg = messages.find((m) => m.role === 'system');
  if (systemMsg) {
    result.push(systemMsg);
  }

  const nonSystem = messages.filter((m) => m.role !== 'system');
  const lastMsg = nonSystem[nonSystem.length - 1];
  const prior = nonSystem.slice(0, nonSystem.length - 1);

  for (const msg of prior) {
    if (msg.role === 'tool' && msg.content.length > 300) {
      result.push({
        ...msg,
        content:
          msg.content.slice(0, 150) +
          '\n... [Tool output truncated: 上下文已压缩] ...\n' +
          msg.content.slice(-100),
      });
    } else {
      result.push(msg);
    }
  }

  if (lastMsg) {
    if (lastMsg.role === 'tool' && lastMsg.content.length > 2000) {
      result.push({
        ...lastMsg,
        content:
          lastMsg.content.slice(0, 1000) +
          '\n... [Tool output truncated: 最近输出超出限额] ...\n' +
          lastMsg.content.slice(-500),
      });
    } else {
      result.push(lastMsg);
    }
  }

  return result;
}

export const DEFAULT_AGENT_TOOLS: readonly AgentToolDefinition[] = [
  {
    name: 'workspace.read_file',
    description: '读取工作区内的指定文件内容（如 Markdown、文本、CSV 或数据表格）',
    risk: 'read',
    requiresApproval: false,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '待读取文件的相对路径，如 sales.csv 或 notes.md' },
      },
      required: ['path'],
    },
  },
  {
    name: 'office.process_excel',
    description: '读取工作区内的 CSV/XLSX 数据表格，进行数值求和/统计计算，或根据自定义规格生成带动态求和公式的 Excel 工作簿 (.xlsx)',
    risk: 'write',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '数据源文件相对路径（如 data.csv）' },
        target: { type: 'string', description: '生成的目标 Excel 文件名（如 sales-summary.xlsx）' },
        title: { type: 'string', description: '工作簿标题' },
        sheets: {
          type: 'array',
          description: '可选的自定义工作表定义列表。如果不传，则自动读取源数据动态汇总生成',
        },
      },
    },
  },
  {
    name: 'office.generate_word_report',
    description: '根据材料或结构化内容生成包含主标题、分节正文与格式化对比表格的高保真 Word 报告 (.docx)',
    risk: 'write',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '生成的目标 Word 报告文件名（如 weekly-meeting-report.docx）' },
        title: { type: 'string', description: 'Word 报告主标题' },
        subtitle: { type: 'string', description: 'Word 报告副标题或编制信息' },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: '参考的工作区源材料文件名列表（如 meeting-notes.md, decisions.txt）',
        },
        sections: {
          type: 'array',
          description: '由模型撰写的结构化章节列表（包含 heading, paragraphs, table）',
        },
      },
    },
  },
  {
    name: 'workspace.write_report',
    description: '在任务产物目录下生成结构化会议周报 Word 文档 (.docx)',
    risk: 'write',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '目标文件名' },
        title: { type: 'string', description: '报告标题' },
      },
    },
  },
  {
    name: 'workspace.write_artifact',
    description: '在工作区中创建新的分析文件或导出文档',
    risk: 'write',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '产物文件名（如 summary.json 或 result.md）' },
        content: { type: 'string', description: '待写入的文本或数据内容' },
      },
      required: ['name', 'content'],
    },
  },
  {
    name: 'workspace.write_file',
    description: '向工作区写入或覆盖完整文件内容',
    risk: 'write',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目标文件相对路径' },
        content: { type: 'string', description: '待写入的完整文件文本内容' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'workspace.edit_file',
    description: '对工作区文件执行局部精准替换编辑（Search & Replace Diff）',
    risk: 'write',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目标文件相对路径' },
        targetContent: { type: 'string', description: '待查找并替换的原文本内容' },
        replacementContent: { type: 'string', description: '替换后的新文本内容' },
      },
      required: ['path', 'targetContent', 'replacementContent'],
    },
  },
  {
    name: 'workspace.list_dir',
    description: '列出工作区指定子目录下的所有文件与文件夹结构',
    risk: 'read',
    requiresApproval: false,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '子目录路径，根目录传入空字符串 ""' },
      },
    },
  },
  {
    name: 'workspace.run_command',
    description: '在工作区本地环境下安全执行终端或 PowerShell 命令并获取输出结果',
    risk: 'external',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'PowerShell 或终端命令内容' },
        timeoutMs: { type: 'number', description: '超时毫秒数，默认 30000' },
      },
      required: ['command'],
    },
  },
  {
    name: 'workspace.execute_script',
    description: '在工作区本地沙箱中安全执行 Node.js、Python 或 PowerShell 脚本，用于精准数学计算、多表数据清洗与逻辑推导，杜绝心算幻觉',
    risk: 'external',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          enum: ['node', 'python', 'powershell'],
          description: '脚本执行环境：node (Node.js/JavaScript), python (Python 3), powershell (PowerShell)',
        },
        script: {
          type: 'string',
          description: '待执行的完整脚本代码。必须自包含，将计算结果通过标准输出打印 (console.log / print / Write-Output)',
        },
        timeoutMs: {
          type: 'number',
          description: '脚本执行超时时间（毫秒），默认 30000',
        },
      },
      required: ['language', 'script'],
    },
  },
  {
    name: 'windows.open_output_directory',
    description: '在桌面资源管理器中打开任务产物所在的本地目录',
    risk: 'read',
    requiresApproval: false,
    parameters: {
      type: 'object',
      properties: {},
    },
  },
];

export function resolveModelConfig(config: ModelConfig = {}): Required<ModelConfig> {
  const apiKey = config.apiKey ?? process.env.AGENT_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? '';
  const provider: 'openai-compatible' = 'openai-compatible';
  const baseURL =
    config.baseURL ??
    process.env.AGENT_BASE_URL ??
    'https://api.deepseek.com/v1';
  const modelName =
    config.modelName ??
    process.env.AGENT_MODEL_NAME ??
    'deepseek-v4-flash';
  const temperature = config.temperature ?? 0.2;
  const timeoutMs = config.timeoutMs ?? 30000;
  const reasoningEffort = config.reasoningEffort ?? 'medium';

  return {
    provider,
    apiKey,
    baseURL: baseURL.replace(/\/+$/, ''),
    modelName,
    temperature,
    timeoutMs,
    reasoningEffort,
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

    const base = this.config.baseURL.replace(/\/+$/, '');
    const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
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

  public async chatCompletion(input: ModelChatInput): Promise<ModelChatOutput> {
    if (!this.config.apiKey) {
      throw new Error(
        'OpenAI-compatible model provider requires an API key (set AGENT_API_KEY or configure apiKey)',
      );
    }

    const tools = input.tools ?? DEFAULT_AGENT_TOOLS;
    const defaultSys = this.buildSystemPrompt(tools, input.workspaceFiles);
    const systemPrompt = input.systemPrompt ?? defaultSys;

    const formattedMessages = [
      { role: 'system', content: systemPrompt },
      ...input.messages.map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'tool',
            tool_call_id: m.toolCallId ?? 'call_default',
            content: m.content,
          };
        }
        if (m.role === 'assistant') {
          const assistantMsg: Record<string, unknown> = {
            role: 'assistant',
            content: m.content || '',
          };
          if (m.reasoningContent) {
            assistantMsg.reasoning_content = m.reasoningContent;
          }
          if (m.toolCalls && m.toolCalls.length > 0) {
            assistantMsg.tool_calls = m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name.replace(/\./g, '_'),
                arguments: JSON.stringify(tc.arguments),
              },
            }));
          }
          return assistantMsg;
        }
        return { role: m.role, content: m.content };
      }),
    ];

    const formattedTools = tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name.replace(/\./g, '_'),
        description: t.description,
        parameters: t.parameters ?? {
          type: 'object',
          properties: {},
        },
      },
    }));

    const requestBody: Record<string, unknown> = {
      model: this.config.modelName,
      messages: formattedMessages,
      temperature: this.config.temperature,
    };
    if (this.config.reasoningEffort && this.config.reasoningEffort !== 'off') {
      requestBody.reasoning_effort = this.config.reasoningEffort;
    }
    if (formattedTools.length > 0) {
      requestBody.tools = formattedTools;
    }

    const base = this.config.baseURL.replace(/\/+$/, '');
    const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    if (Boolean(input.onChunk)) {
      requestBody.stream = true;
    }

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Model API request failed with status ${response.status}: ${errorText}`);
      }

      // Check if response has readable stream for SSE
      if (
        Boolean(input.onChunk) &&
        response.body &&
        typeof (response.body as ReadableStream<Uint8Array>).getReader === 'function'
      ) {
        let accumulatedContent = '';
        let accumulatedReasoning = '';
        const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();

        const reader = (response.body as ReadableStream<Uint8Array>).getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let doneReading = false;

        while (!doneReading) {
          const { value, done } = await reader.read();
          if (done) {
            doneReading = true;
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || line.startsWith(':')) continue;
            if (line === 'data: [DONE]') {
              doneReading = true;
              break;
            }
            if (line.startsWith('data: ')) {
              try {
                const json = JSON.parse(line.slice(6)) as {
                  choices?: Array<{
                    delta?: {
                      content?: string | null;
                      reasoning_content?: string | null;
                      tool_calls?: Array<{
                        index?: number;
                        id?: string;
                        type?: string;
                        function?: { name?: string; arguments?: string };
                      }>;
                    };
                  }>;
                };
                const delta = json.choices?.[0]?.delta;
                if (delta) {
                  if (delta.reasoning_content) {
                    accumulatedReasoning += delta.reasoning_content;
                    input.onChunk?.({ deltaReasoning: delta.reasoning_content });
                  }
                  if (delta.content) {
                    accumulatedContent += delta.content;
                    input.onChunk?.({ deltaContent: delta.content });
                  }
                  if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                    for (const tc of delta.tool_calls) {
                      const idx = typeof tc.index === 'number' ? tc.index : toolCallsMap.size;
                      const existing = toolCallsMap.get(idx) ?? { id: '', name: '', arguments: '' };
                      if (tc.id) existing.id = tc.id;
                      if (tc.function?.name) existing.name += tc.function.name;
                      if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                      toolCallsMap.set(idx, existing);
                    }
                  }
                }
              } catch {
                // Ignore partial JSON lines
              }
            }
          }
        }

        const toolCalls: ToolCall[] = [];
        for (const [_, tc] of toolCallsMap) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(tc.arguments);
          } catch {
            parsedArgs = { raw: tc.arguments };
          }
          const originalName = tc.name.includes('_')
            ? tc.name.replace(/_/, '.')
            : tc.name;
          toolCalls.push({
            id: tc.id || this.createId('call'),
            name: originalName,
            arguments: parsedArgs,
          });
        }

        return {
          content: accumulatedContent,
          ...(accumulatedReasoning ? { reasoningContent: accumulatedReasoning } : {}),
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        };
      }

      // Non-streaming fallback or test mock response
      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            reasoning_content?: string | null;
            tool_calls?: Array<{
              id: string;
              type: string;
              function: { name: string; arguments: string };
            }>;
          };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };

      const choice = data.choices?.[0]?.message;
      if (!choice) {
        return { content: '大模型未返回响应内容。' };
      }

      const toolCalls: ToolCall[] = [];
      if (choice.tool_calls && choice.tool_calls.length > 0) {
        for (const tc of choice.tool_calls) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(tc.function.arguments);
          } catch {
            parsedArgs = { raw: tc.function.arguments };
          }
          const originalName = tc.function.name.includes('_')
            ? tc.function.name.replace(/_/, '.')
            : tc.function.name;
          toolCalls.push({
            id: tc.id,
            name: originalName,
            arguments: parsedArgs,
          });
        }
      }

      if (input.onChunk) {
        input.onChunk({
          ...(choice.reasoning_content ? { deltaReasoning: choice.reasoning_content } : {}),
          ...(choice.content ? { deltaContent: choice.content } : {}),
        });
      }

      return {
        content: choice.content ?? '',
        ...(choice.reasoning_content ? { reasoningContent: choice.reasoning_content } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(data.usage
          ? {
              usage: {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens,
              },
            }
          : {}),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
