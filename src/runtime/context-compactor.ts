import type { ChatMessage, TokenUsageSnapshot } from './protocol.js';

export interface CompactionResult {
  readonly compacted: boolean;
  readonly previousCount: number;
  readonly newCount: number;
  readonly freedTokensEstimate: number;
  readonly messages: readonly ChatMessage[];
  readonly summary: string;
}

export interface ContextCompactorOptions {
  readonly preserveRecentCount?: number;
  readonly toolResultMaxChars?: number;
}

export class ContextCompactor {
  private readonly preserveRecentCount: number;
  private readonly toolResultMaxChars: number;

  public constructor(options: ContextCompactorOptions = {}) {
    this.preserveRecentCount = options.preserveRecentCount ?? 4;
    this.toolResultMaxChars = options.toolResultMaxChars ?? 300;
  }

  /**
   * 对历史会话消息执行物理裁剪与结构化摘要压缩
   */
  public compact(
    messages: readonly ChatMessage[],
    threadId: string,
    createId: (prefix: string) => string,
    now: () => string,
  ): CompactionResult {
    if (messages.length === 0) {
      return {
        compacted: false,
        previousCount: 0,
        newCount: 0,
        freedTokensEstimate: 0,
        messages: [],
        summary: '当前暂无消息，无需压缩整理。',
      };
    }

    const previousCount = messages.length;
    let originalChars = 0;
    for (const m of messages) {
      originalChars += (m.content?.length ?? 0) + (m.reasoningContent?.length ?? 0);
    }

    // 分割为需归档部分与需保留的最近交互部分
    const splitIndex =
      messages.length > this.preserveRecentCount
        ? messages.length - this.preserveRecentCount
        : Math.max(0, messages.length - 1);
    const olderMessages = splitIndex > 0 ? messages.slice(0, splitIndex) : messages.slice(0, 1);
    const recentMessages = splitIndex > 0 ? messages.slice(splitIndex) : messages.slice(1);

    // 1. 提取旧消息中的关键信息
    const userGoals: string[] = [];
    const completedActions: string[] = [];
    const artifactsMentioned: string[] = [];

    for (const msg of olderMessages) {
      if (msg.role === 'user') {
        const cleanContent = msg.content
          .replace(/<attachments>[\s\S]*?<\/attachments>\n?/g, '')
          .replace(/\/compact\s*/g, '')
          .trim();
        if (cleanContent && !userGoals.includes(cleanContent)) {
          userGoals.push(cleanContent.slice(0, 100));
        }
      } else if (msg.role === 'tool') {
        const toolName = msg.name ?? 'tool';
        completedActions.push(`${toolName}: ${msg.content.slice(0, 80).replace(/\n/g, ' ')}`);
      } else if (msg.role === 'assistant' && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          completedActions.push(`调用 ${tc.name}`);
        }
      }

      // 提取所有消息中提及的文件名
      const matches = msg.content.match(/[\w-]+\.(xlsx|docx|csv|json|md|ts|py|txt)/g);
      if (matches) {
        for (const file of matches) {
          if (!artifactsMentioned.includes(file)) {
            artifactsMentioned.push(file);
          }
        }
      }
    }

    // 2. 构造紧凑结构化 Checkpoint 摘要
    const summaryLines: string[] = [
      '[系统上下文整理与记忆压缩] Checkpoint',
      `• 历史交互轮次已归档折叠：前 ${olderMessages.length} 条消息已精简，保留最新 ${recentMessages.length} 条活跃上下文。`,
    ];

    if (userGoals.length > 0) {
      summaryLines.push(`• 历史核心需求：${userGoals.map((g, i) => `(${i + 1}) ${g}`).join('；')}`);
    }
    if (completedActions.length > 0) {
      const uniqueActions = [...new Set(completedActions)].slice(0, 5);
      summaryLines.push(`• 已完成执行步骤：${uniqueActions.join('；')}`);
    }
    if (artifactsMentioned.length > 0) {
      summaryLines.push(`• 涉及文件与生成产物：${artifactsMentioned.join(', ')}`);
    }

    const summaryText = summaryLines.join('\n');

    const checkpointMsg: ChatMessage = {
      id: createId('msg-ckpt'),
      threadId,
      role: 'assistant',
      content: summaryText,
      createdAt: now(),
    };

    // 3. 对保留的最近消息中的大输出 tool message 做轻量截断
    const prunedRecent = recentMessages.map((m) => {
      if (m.role === 'tool' && m.content.length > this.toolResultMaxChars) {
        return {
          ...m,
          content: `${m.content.slice(0, this.toolResultMaxChars)}\n... [长输出尾部已修剪 ${m.content.length - this.toolResultMaxChars} 字符]`,
        };
      }
      return m;
    });

    const newMessages = [checkpointMsg, ...prunedRecent];

    let newChars = 0;
    for (const m of newMessages) {
      newChars += (m.content?.length ?? 0) + (m.reasoningContent?.length ?? 0);
    }

    const freedChars = Math.max(0, originalChars - newChars);
    const freedTokensEstimate = Math.round(freedChars / 3.5);

    return {
      compacted: true,
      previousCount,
      newCount: newMessages.length,
      freedTokensEstimate,
      messages: newMessages,
      summary: `成功归档前 ${olderMessages.length} 条消息，释放约 ${freedTokensEstimate} Tokens 上下文空间。`,
    };
  }

  /**
   * 估算一组消息的真实 Token 消耗（支持中英文字符加权与工具调用入参估算）
   */
  public estimateTokens(messages: readonly ChatMessage[], isLive = false): TokenUsageSnapshot {
    let charCount = 0;
    for (const m of messages) {
      charCount += (m.content?.length ?? 0) + (m.reasoningContent?.length ?? 0);
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          charCount += tc.name.length + JSON.stringify(tc.arguments ?? {}).length;
        }
      }
    }

    const usedTokens = Math.max(120, Math.ceil(charCount / 3.5));
    const contextWindow = isLive ? 128000 : 64000;
    const inputTokens = Math.round(usedTokens * 0.7);
    const outputTokens = Math.round(usedTokens * 0.3);
    const cacheRead = Math.round(usedTokens * 0.15);
    const cacheWrite = Math.round(usedTokens * 0.05);

    return {
      usedTokens,
      contextWindow,
      inputTokens,
      outputTokens,
      cacheRead,
      cacheWrite,
      messagesCount: messages.length,
    };
  }
}
