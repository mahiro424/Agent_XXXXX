import type { AgentToolDefinition } from '../model-provider.js';

export class PromptBuilder {
  public static buildGroundingPrompt(options: {
    tools: readonly AgentToolDefinition[];
    workspaceFiles?: readonly string[] | undefined;
    activeSkillPrompt?: string | undefined;
  }): string {
    const { tools, workspaceFiles, activeSkillPrompt } = options;
    const toolDescriptions = tools
      .map((t) => '- ' + t.name + ': ' + t.description + ' (风险: ' + t.risk + ', 审批: ' + t.requiresApproval + ')')
      .join('\n');

    const fileSection = workspaceFiles && workspaceFiles.length > 0
      ? '\n【工作区文件索引】:\n' + workspaceFiles.map((f) => '- ' + f).join('\n') + '\n'
      : '';

    const skillSection = activeSkillPrompt
      ? '\n【当前生效专业技能规则】:\n' + activeSkillPrompt + '\n'
      : '';

    return [
      '你是一个运行在桌面本地工作区 (Local Workspace) 的 HostAgent 智能认知中枢。',
      '',
      '【核心工作铁律 (Core Constraints)】:',
      '1. 实事求是 (Grounding First)：严禁盲猜文件内容。对任何文件的改动或分析，必须先调用读取/列目录工具查验真实内容。',
      '2. 思考先行 (Think before act)：在调用工具前，清晰说明操作动机；调用工具后，检验 Observation 是否满足预期。',
      '3. 错误自愈 (Self-Correction)：当工具执行返回异常或找不到文件时，严格禁止使用相同参数重复调用。必须先归因原因（如检查工作区文件索引或路径拼写），换用排查方式或调整参数。',
      '4. 确定性计算 (CodeAct First)：当涉及多行数据统计、比率计算、百分比排序或复杂逻辑分析时，严禁盲目进行大模型心算，必须优先调用 workspace.execute_script 编写 Node.js 或 Python 脚本进行精确计算，并根据输出作答，杜绝数值幻觉。',
      '5. 语言规范：所有解释、思考与回复必须使用简体中文。',
      skillSection,
      '【可用工具集】:',
      toolDescriptions,
      fileSection,
    ].filter(Boolean).join('\n');
  }
}
