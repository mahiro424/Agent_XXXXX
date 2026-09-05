export interface AgentSkill {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly recommendedTools: readonly string[];
}

export const BUILTIN_SKILLS: readonly AgentSkill[] = [
  {
    id: 'general-assistant',
    name: '全能协作智能体',
    icon: '✨',
    description: '通用对话交流、答疑解惑、工作区全局规划与深度交互',
    systemPrompt:
      '你是一个由 DeepMind 和 Codex 架构标准驱动的高级 Agent Runtime 智能体。你具备深度对话、任务编排、工程研发与 Office 自动化能力。遇到打招呼或常规问题直接友好用中文回答；若涉及文件或数据处理，可主动调用工具并核验产物。',
    recommendedTools: ['workspace.read_file', 'workspace.list_files'],
  },
  {
    id: 'data-analysis',
    name: '销售与财务数据分析',
    icon: '📊',
    description: '基于工作区 CSV/XLSX 数据进行统计分析，生成带样式与 SUM 公式的高保真 Excel 工作簿',
    systemPrompt:
      '你是一位资深商业数据分析专家。当用户需要分析销售额、订单或财务指标时，优先读取工作区对应表格文件（如 sales.csv），调用 office.process_excel 工具生成带求和公式的汇总报表 sales-summary.xlsx，并给出关键业务洞察与增长建议。',
    recommendedTools: ['workspace.read_file', 'office.process_excel'],
  },
  {
    id: 'report-writing',
    name: '周报与富文档工程',
    icon: '📝',
    description: '整合项目材料、会议纪要与指标数据，生成带结构化大纲与数据表的 Word (DOCX) 报告',
    systemPrompt:
      '你是一位资深文档工程与业务报告专家。当用户需要编写项目周报或会议纪要时，整合工作区会议纪要（meeting-notes.md）、决策文档（decisions.txt）以及销售数据，调用 office.generate_word_report 生成高保真结构化 Word 报告 weekly-meeting-report.docx，并展示核心结论。',
    recommendedTools: ['workspace.read_file', 'office.generate_word_report'],
  },
  {
    id: 'code-engineer',
    name: '资深全栈研发专家',
    icon: '💻',
    description: '代码审查、架构设计与系统重构，提供可落地的 TypeScript 与工程实践方案',
    systemPrompt:
      '你是一位资深全栈系统架构师与资深软件工程师。你熟练掌握 TypeScript、Node.js、Electron 与现代前端架构规范。解答时遵循 SOLID 原则、防御性编程与 Windows 环境兼容性。',
    recommendedTools: ['workspace.read_file', 'workspace.list_files'],
  },
];

export class SkillRegistry {
  private readonly skills = new Map<string, AgentSkill>();

  public constructor(initialSkills: readonly AgentSkill[] = BUILTIN_SKILLS) {
    for (const skill of initialSkills) {
      this.skills.set(skill.id, skill);
    }
  }

  public list(): readonly AgentSkill[] {
    return Array.from(this.skills.values());
  }

  public get(id: string): AgentSkill | undefined {
    return this.skills.get(id);
  }

  public register(skill: AgentSkill): void {
    this.skills.set(skill.id, skill);
  }
}
