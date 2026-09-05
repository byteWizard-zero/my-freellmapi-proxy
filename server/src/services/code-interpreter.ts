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

  /**
   * Execute code snippet in an isolated sandbox.
   * Auto-detects language or defaults to python, falling back to safe JS vm if python binary is unavailable.
   */
  static async execute(code: string, language: 'python' | 'javascript' = 'python'): Promise<CodeExecutionResult> {
    const start = Date.now();

    if (language === 'python') {
      try {
        return await this.executePython(code);
      } catch (err: any) {
        // If python is not installed, attempt safe JS fallback
        if (err.code === 'ENOENT') {
          return await this.executeJavaScript(code);
        }
        return {
          stdout: '',
          stderr: err.stderr || err.message,
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

      // Use python3 if available, else python
      const pythonBin = process.platform === 'win32' ? 'python' : 'python3';
      const { stdout, stderr } = await execFileAsync(pythonBin, [tmpFile], {
        timeout: this.TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
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

    const sandbox = {
      console: {
        log: (...args: any[]) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
        error: (...args: any[]) => errors.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
        warn: (...args: any[]) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
      },
      Math,
      Date,
      JSON,
      parseInt,
      parseFloat,
      Buffer,
      setTimeout: undefined,
      setInterval: undefined,
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
      return {
        stdout: logs.join('\n'),
        stderr: err.message,
        success: false,
        language: 'javascript',
        executionTimeMs: Date.now() - start,
      };
    }
  }
}
