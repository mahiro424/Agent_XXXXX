import type { ChatMessage, ToolCall } from '../protocol.js';

export interface LayeredContext {
  readonly systemPrompt: string;
  readonly pinnedGoal?: string | undefined;
  readonly workspaceFiles?: readonly string[] | undefined;
  readonly compactedHistory?: string | undefined;
  readonly activeMessages: readonly ChatMessage[];
}

export interface ContextManagerOptions {
  readonly maxActiveMessages?: number;
  readonly maxToolOutputChars?: number;
  readonly preserveInitialGoal?: boolean;
}

export class ContextManager {
  private readonly maxActiveMessages: number;
  private readonly maxToolOutputChars: number;
  private readonly preserveInitialGoal: boolean;

  public constructor(options: ContextManagerOptions = {}) {
    this.maxActiveMessages = options.maxActiveMessages ?? 10;
    this.maxToolOutputChars = options.maxToolOutputChars ?? 600;
    this.preserveInitialGoal = options.preserveInitialGoal ?? true;
  }

  /** 折叠过长工具输出，防止上下文被几十万字日志冲爆 */
  public sanitizeToolOutput(rawOutput: string, toolName?: string): string {
    if (!rawOutput || rawOutput.length <= this.maxToolOutputChars) {
      return rawOutput;
    }
    const head = rawOutput.slice(0, Math.floor(this.maxToolOutputChars * 0.6));
    const tail = rawOutput.slice(-Math.floor(this.maxToolOutputChars * 0.3));
    const omittedChars = rawOutput.length - head.length - tail.length;
    return head + '\n\n[... 中间省略 ' + omittedChars + ' 字符，已在本地执行保存 ...]\n\n' + tail;
  }

  /** 组装分层结构化上下文，确保首轮目标与系统指令永不丢失 */
  public buildLayeredMessages(input: {
    systemPrompt: string;
    messages: readonly ChatMessage[];
    workspaceFiles?: readonly string[] | undefined;
  }): ChatMessage[] {
    const { systemPrompt, messages, workspaceFiles } = input;
    if (messages.length === 0) {
      return [];
    }

    let pinnedGoal: string | undefined;
    if (this.preserveInitialGoal) {
      const firstUserMsg = messages.find((m) => m.role === 'user');
      if (firstUserMsg && firstUserMsg.content.trim()) {
        pinnedGoal = firstUserMsg.content.trim();
      }
    }

    let workspaceContext = '';
    if (workspaceFiles && workspaceFiles.length > 0) {
      workspaceContext = '\n\n【当前工作区已知文件列表】:\n' + workspaceFiles.map((f) => '- ' + f).join('\n');
    }

    let augmentedSystemPrompt = systemPrompt;
    if (pinnedGoal) {
      augmentedSystemPrompt += '\n\n【用户首轮核心任务目标 (Pinned Goal)】:\n' + pinnedGoal;
    }
    if (workspaceContext) {
      augmentedSystemPrompt += workspaceContext;
    }

    // 挑选活跃轮次：保留最新 maxActiveMessages 条消息，同时对较早轮次进行精简
    const sanitizedMessages = messages.map((msg) => {
      if (msg.role === 'tool' && msg.content) {
        return {
          ...msg,
          content: this.sanitizeToolOutput(msg.content, msg.name),
        };
      }
      return msg;
    });

    if (sanitizedMessages.length <= this.maxActiveMessages) {
      return sanitizedMessages;
    }

    // 超过预算时：首条消息（如果是 user）保留，中间压缩为摘要，尾部保留活跃轮次
    const firstMsg = sanitizedMessages[0];
    if (!firstMsg) {
      return sanitizedMessages;
    }
    const recentMsgs = sanitizedMessages.slice(-this.maxActiveMessages);

    const compactedCount = sanitizedMessages.length - this.maxActiveMessages - 1;
    const summaryMsg: ChatMessage = {
      id: 'compaction-summary-' + Date.now(),
      threadId: firstMsg.threadId,
      role: 'system',
      content: '[前序 ' + compactedCount + ' 轮对话与工具调用已归档，核心目标与工作区状态已锁定置顶]',
      createdAt: new Date().toISOString(),
    };

    return [firstMsg, summaryMsg, ...recentMsgs];
  }
}
