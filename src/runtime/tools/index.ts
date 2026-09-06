import { ToolRegistry } from './tool-registry.js';
import {
  EditFileToolHandler,
  ListDirToolHandler,
  ReadFileToolHandler,
  WriteArtifactToolHandler,
  WriteFileToolHandler,
} from './workspace-file-tools.js';
import { GenerateWordReportToolHandler, ProcessExcelToolHandler } from './office-tools.js';
import { ExecuteScriptToolHandler, RunCommandToolHandler } from './script-tools.js';
import { McpToolAdapter } from './mcp-tool-adapter.js';

export * from './tool-interface.js';
export * from './tool-registry.js';
export * from './workspace-file-tools.js';
export * from './office-tools.js';
export * from './script-tools.js';
export * from './mcp-tool-adapter.js';

/**
 * 创建预装载所有系统标准工具处理器的工具注册中心
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // 1. 文件系统工具
  registry.register(new ReadFileToolHandler());
  registry.register(new WriteFileToolHandler());
  registry.register(new EditFileToolHandler());
  registry.register(new ListDirToolHandler());
  registry.register(new WriteArtifactToolHandler());

  // 2. Office 与文档工具
  registry.register(new ProcessExcelToolHandler());
  registry.register(new GenerateWordReportToolHandler());

  // 3. 终端命令与代码执行沙箱工具
  registry.register(new RunCommandToolHandler());
  registry.register(new ExecuteScriptToolHandler());

  // 4. MCP 协议适配器
  registry.register(new McpToolAdapter());

  return registry;
}
