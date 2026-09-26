import { redactSecrets } from './redact.js';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface LogRecord {
  level: LogLevel;
  message: string;
  scope?: string;
  data?: Record<string, unknown>;
  time: string;
}

export interface Logger {
  error(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
  child(scope: string): Logger;
  readonly level: LogLevel;
}

export interface LoggerOptions {
  level?: LogLevel;
  format?: 'text' | 'json';
  scope?: string;
  sink?: (record: LogRecord) => void;
}

/**
 * Structured logger. Everything goes to stderr so that stdout stays clean for
 * `--json` command output. All messages and data pass through secret redaction.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? parseLevel(process.env.STORYOPS_LOG_LEVEL ?? process.env.EDITORIAL_LOG_LEVEL) ?? 'info';
  const format = options.format ?? 'text';
  const sink =
    options.sink ??
    ((record: LogRecord) => {
      if (format === 'json') {
        process.stderr.write(`${JSON.stringify(record)}\n`);
        return;
      }
      const prefix = record.level === 'info' ? '' : `${record.level.toUpperCase()}: `;
      const scope = record.scope && record.level === 'debug' ? `[${record.scope}] ` : '';
      const data = record.data && Object.keys(record.data).length > 0 && ORDER[level] >= ORDER.debug ? ` ${JSON.stringify(record.data)}` : '';
      process.stderr.write(`${prefix}${scope}${record.message}${data}\n`);
    });

  const emit = (recordLevel: LogLevel, message: string, data?: Record<string, unknown>) => {
    if (ORDER[recordLevel] > ORDER[level]) return;
    const record: LogRecord = {
      level: recordLevel,
      message: redactSecrets(message),
      time: new Date().toISOString(),
    };
    if (options.scope) record.scope = options.scope;
    if (data) record.data = JSON.parse(redactSecrets(JSON.stringify(data))) as Record<string, unknown>;
    sink(record);
  };

  return {
    level,
    error: (m, d) => emit('error', m, d),
    warn: (m, d) => emit('warn', m, d),
    info: (m, d) => emit('info', m, d),
    debug: (m, d) => emit('debug', m, d),
    child: (scope) => createLogger({ ...options, level, format, sink, scope: options.scope ? `${options.scope}:${scope}` : scope }),
  };
}

export function parseLevel(value: string | undefined): LogLevel | undefined {
  if (value === 'error' || value === 'warn' || value === 'info' || value === 'debug') return value;
  return undefined;
}

/** Logger that discards everything; handy in tests and library use. */
export const silentLogger: Logger = createLogger({ level: 'error', sink: () => undefined });

/** Logger that collects records in memory (tests). */
export function memoryLogger(level: LogLevel = 'debug'): Logger & { records: LogRecord[] } {
  const records: LogRecord[] = [];
  const logger = createLogger({ level, sink: (r) => records.push(r) });
  return Object.assign(logger, { records });
}
