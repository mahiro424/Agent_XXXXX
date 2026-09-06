import type { AgentToolDefinition } from '../model-provider.js';
import type { IToolHandler, ToolContext } from './tool-interface.js';

/**
 * 集中式工具注册中心 (ToolRegistry)
 * 负责工具处理器的生命周期管理、Schema 收集与执行统一派发
 */
export class ToolRegistry {
  private readonly handlers: IToolHandler[] = [];
  private readonly handlerByName = new Map<string, IToolHandler>();

  public constructor(initialHandlers: readonly IToolHandler[] = []) {
    for (const handler of initialHandlers) {
      this.register(handler);
    }
  }

  /**
   * 注册一个新的工具处理器
   */
  public register(handler: IToolHandler): this {
    this.handlers.push(handler);
    if (handler.name && !handler.name.includes('*')) {
      this.handlerByName.set(handler.name, handler);
    }
    return this;
  }

  /**
   * 根据工具名称查找能够处理该调用的处理器
   */
  public findHandler(toolName: string): IToolHandler | undefined {
    const direct = this.handlerByName.get(toolName);
    if (direct) {
      return direct;
    }
    return this.handlers.find((h) => h.canHandle(toolName));
  }

  /**
   * 判断是否存在能够处理该工具调用的处理器
   */
  public has(toolName: string): boolean {
    return this.findHandler(toolName) !== undefined;
  }

  /**
   * 获取所有注册工具的规范定义列表（用于注入 LLM Prompt/Tools 列表）
   */
  public getDefinitions(): readonly AgentToolDefinition[] {
    const defs: AgentToolDefinition[] = [];
    for (const handler of this.handlers) {
      if (handler.definition) {
        defs.push(handler.definition);
      }
    }
    return defs;
  }

  /**
   * 统一执行工具调用
   */
  public async execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    const handler = this.findHandler(toolName);
    if (!handler) {
      return `未知工具: "${toolName}"。请检查工具名称或查看当前可用工具列表。`;
    }
    return await handler.execute(toolName, args, context);
  }
}
