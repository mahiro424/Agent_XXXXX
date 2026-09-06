import { spawn } from 'node:child_process';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface ProcessRunOptions {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs?: number | undefined;
  readonly maxOutputChars?: number | undefined;
  readonly env?: Record<string, string> | undefined;
}

export interface ProcessRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
}

export class SafeProcessRunner {
  private readonly defaultTimeoutMs: number;
  private readonly maxOutputChars: number;

  public constructor(options: { defaultTimeoutMs?: number | undefined; maxOutputChars?: number | undefined } = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 15000;
    this.maxOutputChars = options.maxOutputChars ?? 16000;
  }

  public async run(options: ProcessRunOptions): Promise<ProcessRunResult> {
    const cwd = resolve(options.cwd);
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const maxChars = options.maxOutputChars ?? this.maxOutputChars;

    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'powershell.exe' : '/bin/sh';
    const args = isWindows
      ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', options.command]
      : ['-c', options.command];

    const startTime = Date.now();

    return new Promise((resolveResult) => {
      let stdoutBuf = '';
      let stderrBuf = '';
      let timedOut = false;
      let killed = false;

      const child = spawn(shell, args, {
        cwd,
        env: {
          ...process.env,
          ...(options.env ?? {}),
          // 剥离敏感凭据保护系统
          AGENT_API_KEY: undefined,
        },
        windowsHide: true,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        killed = true;
        if (isWindows && child.pid) {
          try {
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
          } catch {
            child.kill('SIGKILL');
          }
        } else {
          child.kill('SIGKILL');
        }
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdoutBuf.length < maxChars) {
          stdoutBuf += chunk.toString('utf8');
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderrBuf.length < maxChars) {
          stderrBuf += chunk.toString('utf8');
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        resolveResult({
          exitCode: -1,
          stdout: stdoutBuf,
          stderr: `进程启动异常: ${err.message}`,
          timedOut: false,
          durationMs,
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        let finalStdout = stdoutBuf;
        if (stdoutBuf.length >= maxChars) {
          finalStdout += `\n... [输出已超出 ${maxChars} 字符上限，后续已被截断]`;
        }

        let finalStderr = stderrBuf;
        if (stderrBuf.length >= maxChars) {
          finalStderr += `\n... [错误输出已超出 ${maxChars} 字符上限，后续已被截断]`;
        }

        resolveResult({
          exitCode: code ?? (timedOut ? -1 : 0),
          stdout: finalStdout.trim(),
          stderr: timedOut ? `执行超时 (超 ${timeoutMs}ms 已强制终止)\n${finalStderr}`.trim() : finalStderr.trim(),
          timedOut,
          durationMs,
        });
      });
    });
  }
}
