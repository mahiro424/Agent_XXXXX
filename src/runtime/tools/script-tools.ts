import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentToolDefinition } from '../model-provider.js';
import type { IToolHandler, ToolContext } from './tool-interface.js';

/**
 * 构造受限与脱敏的子进程环境变量
 * 仅透传最基础的系统路径，剥离所有敏感宿主变量与凭据
 */
export function createSanitizedProcessEnv(): Record<string, string> {
  const allowedKeys = [
    'PATH',
    'Path',
    'path',
    'PATHEXT',
    'SYSTEMROOT',
    'SystemRoot',
    'TEMP',
    'TMP',
    'SystemDrive',
    'COMSPEC',
    'ComSpec',
    'USERPROFILE',
    'HOME',
    'HOMEDRIVE',
    'HOMEPATH',
    'APPDATA',
    'LOCALAPPDATA',
    'NODE_ENV',
  ];

  const sanitized: Record<string, string> = {};
  for (const key of allowedKeys) {
    if (process.env[key] !== undefined) {
      sanitized[key] = process.env[key]!;
    }
  }

  // 显式屏蔽可能存在的任何凭证
  sanitized['AGENT_API_KEY'] = '';
  sanitized['OPENAI_API_KEY'] = '';
  sanitized['ANTHROPIC_API_KEY'] = '';
  return sanitized;
}

export class RunCommandToolHandler implements IToolHandler {
  public readonly name = 'workspace.run_command';
  public readonly definition: AgentToolDefinition = {
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
  };

  public canHandle(toolName: string): boolean {
    return toolName === this.name;
  }

  public async execute(
    _toolName: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    if (!context.enablePowershellExecution) {
      return '错误：当前系统设置已禁用 PowerShell 终端命令执行 (enablePowershellExecution: false)。可在左下角【设置 -> 权限与安全】中开启。';
    }
    const command = (args.command as string) || (args.cmd as string) || '';
    if (!command.trim()) {
      return '错误：未提供需要执行的命令内容 (command)。';
    }
    const decision = context.approvalPolicy.decide({ operation: 'external_access', targetPath: command });
    if (decision.decision === 'approval_required') {
      return `[安全审批拦截] 当前安全权限模式 (${context.approvalPolicy.getTier()}) 拦截了执行外部命令 "${command}" 的操作，需要人工审批确认。`;
    }
    const result = await context.processRunner.run({
      command,
      cwd: context.sandbox.rootDir,
      timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined,
      env: createSanitizedProcessEnv(),
    });
    return `[命令执行结果: 退出码 ${result.exitCode}, 耗时 ${result.durationMs}ms]\n标准输出:\n${result.stdout || '(无输出)'}${result.stderr ? `\n标准错误:\n${result.stderr}` : ''}`;
  }
}

export class ExecuteScriptToolHandler implements IToolHandler {
  public readonly name = 'workspace.execute_script';
  public readonly definition: AgentToolDefinition = {
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
          description: '待执行的完整代码脚本内容。必须自包含，将最终计算结果通过 console.log/print 打印至标准输出',
        },
        timeoutMs: {
          type: 'number',
          description: '最长执行限制毫秒数（默认 30000ms，超时将自动强制终止进程）',
        },
      },
      required: ['language', 'script'],
    },
  };

  public canHandle(toolName: string): boolean {
    return toolName === this.name;
  }

  public async execute(
    _toolName: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    if (!context.enablePowershellExecution) {
      return '错误：当前系统设置已禁用外部脚本/命令执行 (enablePowershellExecution: false)。可在左下角【设置 -> 权限与安全】中开启。';
    }
    const rawLang = String(args.language || args.lang || 'node').toLowerCase();
    const script = String(args.script || args.code || '').trim();
    if (!script) {
      return '错误：未提供待执行的脚本代码内容 (script)。';
    }

    let ext = '.js';
    let cmdPrefix = 'node';
    let normalizedLang = 'Node.js';
    if (rawLang.includes('python') || rawLang === 'py') {
      ext = '.py';
      cmdPrefix = 'python';
      normalizedLang = 'Python';
    } else if (rawLang.includes('powershell') || rawLang.includes('ps') || rawLang.includes('shell')) {
      ext = '.ps1';
      cmdPrefix = 'powershell -ExecutionPolicy Bypass -File';
      normalizedLang = 'PowerShell';
    }

    const decision = context.approvalPolicy.decide({ operation: 'external_access', targetPath: `script${ext}` });
    if (decision.decision === 'approval_required') {
      return `[安全审批拦截] 当前安全权限模式 (${context.approvalPolicy.getTier()}) 拦截了执行脚本 (${normalizedLang}) 的操作，需要人工审批确认。`;
    }

    const scratchDir = join(context.sandbox.rootDir, '.agent_scratch');
    if (!existsSync(scratchDir)) {
      mkdirSync(scratchDir, { recursive: true });
    }
    const scriptFilename = `script_${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
    const scriptFilePath = join(scratchDir, scriptFilename);
    writeFileSync(scriptFilePath, script, 'utf-8');

    const relativeScriptPath = `.agent_scratch/${scriptFilename}`;
    const command = `${cmdPrefix} ${relativeScriptPath}`;

    const result = await context.processRunner.run({
      command,
      cwd: context.sandbox.rootDir,
      timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined,
      env: createSanitizedProcessEnv(),
    });

    return `[${normalizedLang} 脚本执行结果: 退出码 ${result.exitCode}, 耗时 ${result.durationMs}ms]\n标准输出:\n${result.stdout || '(无标准输出)'}${result.stderr ? `\n标准错误:\n${result.stderr}` : ''}`;
  }
}
