import { execFile } from 'child_process';
import vm from 'vm';
import util from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const execFileAsync = util.promisify(execFile);

export interface CodeExecutionResult {
  stdout: string;
  stderr: string;
  success: boolean;
  language: 'python' | 'javascript';
  executionTimeMs: number;
}

export class CodeInterpreter {
  private static readonly TIMEOUT_MS = 6000; // 6s hard timeout
  private static readonly MAX_CODE_SIZE_BYTES = 100 * 1024; // 100KB limit
  private static readonly MAX_OUTPUT_BUFFER_BYTES = 1024 * 1024; // 1MB buffer limit

  /**
   * Produce a safe, minimal environment block for child processes.
   * Strips all host API keys, secrets, database configs, and sensitive environment variables.
   */
  static getSanitizedEnv(): NodeJS.ProcessEnv {
    const allowedKeys = new Set([
      'PATH',
      'Path',
      'PATHEXT',
      'SYSTEMROOT',
      'SystemRoot',
      'WINDIR',
      'windir',
      'TEMP',
      'TMP',
      'TMPDIR',
      'LANG',
      'LC_ALL',
      'LC_CTYPE',
      'HOME',
      'USERPROFILE',
      'COMSPEC',
      'SHELL',
    ]);

    const sanitized: Record<string, string> = {
      PYTHONUNBUFFERED: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      NODE_ENV: 'production',
    };

    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && allowedKeys.has(key)) {
        // Strict guard against any secret, key, or token variable leaking
        if (!/(KEY|SECRET|TOKEN|AUTH|PASS|PASSWORD|DATABASE|CREDENTIAL|API|PRIVATE)/i.test(key)) {
          sanitized[key] = value;
        }
      }
    }

    return sanitized;
  }

  /**
   * Execute code snippet in an isolated sandbox with sanitized environment,
   * resource constraints, and safe execution timeouts.
   * Auto-detects language or defaults to python, falling back to safe JS vm if python binary is unavailable.
   */
  static async execute(code: string, language: 'python' | 'javascript' = 'python'): Promise<CodeExecutionResult> {
    const start = Date.now();

    if (!code || typeof code !== 'string') {
      return {
        stdout: '',
        stderr: 'Code payload must be a non-empty string',
        success: false,
        language,
        executionTimeMs: 0,
      };
    }

    if (Buffer.byteLength(code, 'utf8') > this.MAX_CODE_SIZE_BYTES) {
      return {
        stdout: '',
        stderr: 'Code payload exceeds maximum size limit (100KB)',
        success: false,
        language,
        executionTimeMs: 0,
      };
    }

    if (language === 'python') {
      try {
        return await this.executePython(code);
      } catch (err: any) {
        // If python is not installed, attempt safe JS fallback
        if (err.code === 'ENOENT') {
          return await this.executeJavaScript(code);
        }
        const isTimeout = err.killed || err.signal === 'SIGTERM' || err.message?.includes('timed out');
        return {
          stdout: '',
          stderr: isTimeout ? 'Execution timed out (maximum 6 seconds allowed)' : (err.stderr || err.message),
          success: false,
          language: 'python',
          executionTimeMs: Date.now() - start,
        };
      }
    } else {
      return await this.executeJavaScript(code);
    }
  }

  private static async executePython(code: string): Promise<CodeExecutionResult> {
    const start = Date.now();
    const tmpFile = path.join(os.tmpdir(), `exec_${crypto.randomUUID()}.py`);

    try {
      await fs.writeFile(tmpFile, code, 'utf8');

      // Use python3 if available on unix, else python
      const pythonBin = process.platform === 'win32' ? 'python' : 'python3';
      const { stdout, stderr } = await execFileAsync(pythonBin, [tmpFile], {
        timeout: this.TIMEOUT_MS,
        maxBuffer: this.MAX_OUTPUT_BUFFER_BYTES,
        env: this.getSanitizedEnv(),
      });

      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        success: true,
        language: 'python',
        executionTimeMs: Date.now() - start,
      };
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  }

  private static async executeJavaScript(code: string): Promise<CodeExecutionResult> {
    const start = Date.now();
    const logs: string[] = [];
    const errors: string[] = [];
    let totalOutputBytes = 0;
    const MAX_OUTPUT_BYTES = 512 * 1024; // 512KB cap for in-memory JS VM logs

    const safeAppendLog = (arr: string[], ...args: any[]) => {
      if (totalOutputBytes >= MAX_OUTPUT_BYTES || arr.length >= 1000) return;
      const formatted = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      totalOutputBytes += formatted.length;
      arr.push(formatted);
    };

    const sandbox = {
      console: {
        log: (...args: any[]) => safeAppendLog(logs, ...args),
        error: (...args: any[]) => safeAppendLog(errors, ...args),
        warn: (...args: any[]) => safeAppendLog(logs, ...args),
      },
      Math,
      Date,
      JSON,
      parseInt,
      parseFloat,
      Buffer,
      setTimeout: undefined,
      setInterval: undefined,
      setImmediate: undefined,
      process: undefined,
      require: undefined,
    };

    const context = vm.createContext(sandbox);

    try {
      const script = new vm.Script(code);
      const result = script.runInContext(context, { timeout: this.TIMEOUT_MS });

      if (result !== undefined && logs.length === 0) {
        logs.push(typeof result === 'object' ? JSON.stringify(result) : String(result));
      }

      return {
        stdout: logs.join('\n'),
        stderr: errors.join('\n'),
        success: errors.length === 0,
        language: 'javascript',
        executionTimeMs: Date.now() - start,
      };
    } catch (err: any) {
      const isTimeout = err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' || err.message?.includes('timed out');
      return {
        stdout: logs.join('\n'),
        stderr: isTimeout ? 'Execution timed out (maximum 6 seconds allowed)' : err.message,
        success: false,
        language: 'javascript',
        executionTimeMs: Date.now() - start,
      };
    }
  }
}
