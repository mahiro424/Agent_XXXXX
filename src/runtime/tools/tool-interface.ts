import type { Thread } from '../protocol.js';
import type { LocalWorkspaceSandbox } from '../sandbox.js';
import type { DefaultApprovalPolicy } from '../approval-policy.js';
import type { ProductionOfficeEngine } from '../office-engine.js';
import type { WorkspaceDocumentEngine } from '../document-engine.js';
import type { SafeProcessRunner } from '../process-runner.js';
import type { McpBridge } from '../mcp-bridge.js';
import type { AgentToolDefinition } from '../model-provider.js';

/**
 * 工具执行环境上下文
 * 包含工作区沙箱、审批策略、Office 引擎、进程执行器等依赖资源
 */
export interface ToolContext {
  readonly thread: Thread;
  readonly sandbox: LocalWorkspaceSandbox;
  readonly approvalPolicy: DefaultApprovalPolicy;
  readonly officeEngine: ProductionOfficeEngine;
  readonly documentEngine: WorkspaceDocumentEngine;
  readonly processRunner: SafeProcessRunner;
  readonly mcpBridge: McpBridge;
  readonly enablePowershellExecution: boolean;
  readonly verifyArtifact: (threadId: string, artifactName: string) => void;
  readonly now: () => string;
}

/**
 * 标准工具处理器接口 (Command Pattern)
 * 每个具体工具必须实现此接口，自包含定义、校验与执行逻辑
 */
export interface IToolHandler {
  /**
   * 工具唯一标识符，如 'workspace.read_file'
   */
  readonly name: string;

  /**
   * 工具的规范声明（包含 JSON Schema、风险级别等）
   */
  readonly definition?: AgentToolDefinition;

  /**
   * 判断当前工具处理器是否支持处理指定名称的工具调用
   * 默认通过 name 精确匹配，亦支持如 'mcp.*' 通配处理
   */
  canHandle(toolName: string): boolean;

  /**
   * 执行工具具体逻辑
   * @param toolName 调用的具体工具名称
   * @param args 工具入参字典
   * @param context 执行上下文
   */
  execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> | string;
}
