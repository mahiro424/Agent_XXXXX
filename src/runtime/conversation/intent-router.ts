export type UserIntentType =
  | 'chat_direct'
  | 'read_only_explore'
  | 'task_execution'
  | 'clarification_needed';

export interface IntentAnalysisResult {
  readonly intent: UserIntentType;
  readonly confidence: number;
  readonly reasoning: string;
  readonly suggestedMode?: 'chat' | 'agent';
}

export class IntentRouter {
  public static route(input: string, context?: { workspaceFiles?: readonly string[] | undefined }): IntentAnalysisResult {
    const text = input.trim();
    if (!text) {
      return {
        intent: 'chat_direct',
        confidence: 1.0,
        reasoning: '空输入默认归类为纯对话',
        suggestedMode: 'chat',
      };
    }

    const lower = text.toLowerCase();

    const directGreetings = [
      '你好', '您好', 'hi', 'hello', 'hey', '早上好', '下午好', '晚上好',
      '是谁', '叫什么', '介绍一下你自己', '介绍自己', '你会做什么', '你能做什么', '功能介绍',
      'help', '帮助', '谢谢', '多谢', '再见', 'bye',
    ];
    const cleaned = lower.replace(/[!！?？~～.,，。呀啊吧吧呢\s]/g, '');
    if (directGreetings.some((g) => lower === g || cleaned === g || lower.startsWith(g))) {
      return {
        intent: 'chat_direct',
        confidence: 0.98,
        reasoning: '输入属于日常问候或自我介绍咨询，直接响应无需规划',
        suggestedMode: 'chat',
      };
    }

    const explainPatterns = [
      '什么是', '解释一下', '怎么理解', '区别是什么', '优缺点',
      'solid原则', '设计模式', '为什么要', '如何学习', '代码解释',
      'what is', 'explain', 'how to', 'difference between',
    ];
    if (explainPatterns.some((p) => lower.includes(p)) && !lower.includes('生成') && !lower.includes('写入') && !lower.includes('修改')) {
      return {
        intent: 'chat_direct',
        confidence: 0.95,
        reasoning: '属于知识性问答或原理解释，直接回复即可',
        suggestedMode: 'chat',
      };
    }

    const vaguePatterns = ['改一下', '优化一下', '弄一下', '帮我弄弄', '处理一下', 'fix this', 'help me with this'];
    if (vaguePatterns.includes(lower) || (text.length <= 4 && vaguePatterns.some((v) => lower.includes(v)))) {
      return {
        intent: 'clarification_needed',
        confidence: 0.9,
        reasoning: '指令信息量过低，缺少具体操作目标和对象，需要主动反问澄清',
        suggestedMode: 'agent',
      };
    }

    const exploreKeywords = [
      '看看有什么文件', '查看文件', '有哪些文件', '列出目录', '目录结构', '文件列表',
      '搜索', '查找', '在哪', '排查', '查一下', '看一下', '读一下', '显示内容',
      'list files', 'show files', 'find', 'search', 'read file', 'check directory',
    ];
    const isExplicitExplore = exploreKeywords.some((k) => lower.includes(k));
    const hasNoWriteIntents = !lower.includes('生成') && !lower.includes('写入') && !lower.includes('修改') && !lower.includes('创建') && !lower.includes('delete') && !lower.includes('write');

    if (isExplicitExplore && hasNoWriteIntents) {
      return {
        intent: 'read_only_explore',
        confidence: 0.92,
        reasoning: '属于只读工作区感知或文件排查，仅分配只读工具，无需复杂弹窗审批',
        suggestedMode: 'agent',
      };
    }

    const taskKeywords = [
      '生成', '汇总', '写入', '修改', '编辑', '创建', '更新', '导出', '替换',
      'excel', 'word', '周报', '报告', '表格', '脚本', '执行命令', '运行', 'powershell',
      'generate', 'create', 'write', 'edit', 'replace', 'run command', 'summary',
    ];
    if (taskKeywords.some((k) => lower.includes(k))) {
      return {
        intent: 'task_execution',
        confidence: 0.96,
        reasoning: '明确包含创建产物、数据处理或环境写入意图，需启动 Plan/Approval/ReAct 闭环',
        suggestedMode: 'agent',
      };
    }

    return {
      intent: 'task_execution',
      confidence: 0.7,
      reasoning: '未匹配到特定模式，默认走标准 Agent 执行通道',
      suggestedMode: 'agent',
    };
  }
}
