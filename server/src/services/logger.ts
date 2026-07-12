export interface LogEntry {
  timestamp: string;
  stream: 'stdout' | 'stderr';
  text: string;
}

const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

export const logBuffer: LogEntry[] = [];
const MAX_LOGS = 1000;
const listeners = new Set<(entry: LogEntry) => void>();

let isIntercepting = false;
let stdoutBuffer = '';
let stderrBuffer = '';

function addLogLine(stream: 'stdout' | 'stderr', text: string) {
  // Trim trailing carriage returns (Windows)
  const cleanText = text.replace(/\r$/, '');
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    stream,
    text: cleanText,
  };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.shift();
  }
  for (const listener of listeners) {
    try {
      listener(entry);
    } catch (err) {
      // Prevent listener exceptions from crashing stdout/stderr operations
    }
  }
}

function interceptStream(stream: 'stdout' | 'stderr', chunk: any) {
  if (isIntercepting) return;
  try {
    isIntercepting = true;
    const data = typeof chunk === 'string' ? chunk : (chunk?.toString() ?? '');
    const currentBuffer = stream === 'stdout' ? stdoutBuffer + data : stderrBuffer + data;
    const lines = currentBuffer.split('\n');
    const lastLine = lines.pop() ?? '';
    
    if (stream === 'stdout') {
      stdoutBuffer = lastLine;
    } else {
      stderrBuffer = lastLine;
    }

    for (const line of lines) {
      addLogLine(stream, line);
    }
  } catch (err) {
    // Avoid any throwing inside process.stdout/stderr wrappers
  } finally {
    isIntercepting = false;
  }
}

export function startLogging() {
  process.stdout.write = function (chunk: any, encoding?: any, callback?: any) {
    interceptStream('stdout', chunk);
    return originalStdoutWrite.apply(process.stdout, arguments as any);
  } as any;

  process.stderr.write = function (chunk: any, encoding?: any, callback?: any) {
    interceptStream('stderr', chunk);
    return originalStderrWrite.apply(process.stderr, arguments as any);
  } as any;
}

export function addLogListener(listener: (entry: LogEntry) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
