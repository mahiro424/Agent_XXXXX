import type { AgentToolDefinition } from '../model-provider.js';
import type { IToolHandler, ToolContext } from './tool-interface.js';

export class ReadFileToolHandler implements IToolHandler {
  public readonly name = 'workspace.read_file';
  public readonly definition: AgentToolDefinition = {
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
  };

  public canHandle(toolName: string): boolean {
    return toolName === this.name;
  }

  public execute(
    _toolName: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): string {
    const target =
      (args.path as string) || (args.file as string) || (args.source as string);
    if (!target) {
      const allFiles = context.sandbox.listFiles();
      return `[调用错误] 请指定待读取的文件相对路径 (path)。当前工作区可用文件: ${allFiles.length > 0 ? allFiles.join(', ') : '（暂无文件）'}`;
    }
    if (context.sandbox.hasFile(target)) {
      return context.sandbox.readFile(target);
    }
    return `文件未找到: ${target}。当前工作区文件列表: ${context.sandbox.listFiles().join(', ')}`;
  }
}

export class WriteFileToolHandler implements IToolHandler {
  public readonly name = 'workspace.write_file';
  public readonly definition: AgentToolDefinition = {
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
  };

  public canHandle(toolName: string): boolean {
    return toolName === this.name;
  }

  public execute(
    _toolName: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): string {
    const target = (args.path as string) || (args.file as string);
    if (!target) {
      return '错误：未指定待写入的文件路径 (path)。';
    }
    const content = (args.content as string) ?? '';
    const decision = context.approvalPolicy.decide({ operation: 'workspace_write', targetPath: target });
    if (decision.decision === 'approval_required') {
      return `[安全审批拦截] 当前安全权限模式 (${context.approvalPolicy.getTier()}) 拦截了写入文件 "${target}" 的操作，需要人工审批确认。`;
    }
    const result = context.sandbox.writeWorkspaceFile(target, content);
    return `成功写入工作区文件: ${target} (共 ${result.bytes} 字节)`;
  }
}

export class EditFileToolHandler implements IToolHandler {
  public readonly name = 'workspace.edit_file';
  public readonly definition: AgentToolDefinition = {
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
  };

  public canHandle(toolName: string): boolean {
    return toolName === this.name;
  }

  public execute(
    _toolName: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): string {
    const target = (args.path as string) || (args.file as string);
    if (!target) {
      return '错误：未指定待编辑的文件路径 (path)。';
    }
    const targetContent = (args.targetContent as string) || (args.search as string) || '';
    const replacementContent = (args.replacementContent as string) || (args.replace as string) || '';
    const decision = context.approvalPolicy.decide({ operation: 'workspace_write', targetPath: target });
    if (decision.decision === 'approval_required') {
      return `[安全审批拦截] 当前安全权限模式 (${context.approvalPolicy.getTier()}) 拦截了局部编辑文件 "${target}" 的操作，需要人工审批确认。`;
    }
    const result = context.sandbox.editWorkspaceFile(target, targetContent, replacementContent);
    return `成功对工作区文件 ${target} 完成局部精准 Search & Replace 编辑 (${result.replacements} 处替换)`;
  }
}

export class ListDirToolHandler implements IToolHandler {
  public readonly name = 'workspace.list_dir';
  public readonly definition: AgentToolDefinition = {
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
  };

  public canHandle(toolName: string): boolean {
    return toolName === this.name;
  }

  public execute(
    _toolName: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): string {
    const subPath = (args.path as string) || '';
    const entries = context.sandbox.listDirectory(subPath);
    if (entries.length === 0) {
      return `目录为空或不存在: ${subPath || '工作区根目录'}`;
    }
    return (
      `工作区目录列表 (${subPath || '根目录'}):\n` +
      entries.map((e) => `- ${e.name} (${e.isDirectory ? '目录' : `${e.size} 字节`})`).join('\n')
    );
  }
}

export class WriteArtifactToolHandler implements IToolHandler {
  public readonly name = 'workspace.write_artifact';
  public readonly definition: AgentToolDefinition = {
    name: 'workspace.write_artifact',
    description: '在工作区中创建新的分析文件或导出文档',
    risk: 'write',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '文件名或相对路径（如 summary.json 或 result.md）' },
        content: { type: 'string', description: '待写入的文本或数据内容' },
      },
      required: ['name', 'content'],
    },
  };

  public canHandle(toolName: string): boolean {
    return toolName === this.name;
  }

  public execute(
    _toolName: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): string {
    const artifactName = (args.name as string) || (args.target as string) || 'output.txt';
    const content = (args.content as string) || '';
    const decision = context.approvalPolicy.decide({ operation: 'write_artifact', targetPath: artifactName });
    if (decision.decision === 'approval_required') {
      return `[安全审批拦截] 当前安全权限模式 (${context.approvalPolicy.getTier()}) 拦截了在工作区生成文件的操作，需要人工审批确认。`;
    }
    context.sandbox.writeArtifact(artifactName, content);
    return `成功在工作区生成文件: ${artifactName}`;
  }
}
