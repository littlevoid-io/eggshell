import chalk from 'chalk';
import { ConfigError, isEggshellError } from '../errors.js';
import type { LogFields, Logger, LogLevel } from '../logging/logger.js';
import { formatLogRecord, type LogRecord } from './log-format.js';

function extractFields(fields: LogFields | undefined): Record<string, unknown> {
  if (fields === undefined) {
    return {};
  }
  const entries = Object.entries(fields).filter(([key]) => key !== 'scope');
  return Object.fromEntries(entries);
}

function writeLog(level: LogLevel, message: string, fields?: LogFields): void {
  const scope = typeof fields?.['scope'] === 'string' ? fields['scope'] : 'cli';
  const record: LogRecord = {
    level,
    time: Date.now(),
    scope,
    message,
    fields: extractFields(fields),
  };
  const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout;
  stream.write(`${formatLogRecord(record)}\n`);
}

/** Colored per-scope terminal output for the CLI process. */
export const terminalLogger: Logger = {
  debug: (message, fields) => writeLog('debug', message, fields),
  info: (message, fields) => writeLog('info', message, fields),
  warn: (message, fields) => writeLog('warn', message, fields),
  error: (message, fields) => writeLog('error', message, fields),
};

export function formatError(error: unknown): string {
  if (error instanceof ConfigError) {
    const issues = error.issues.map(issue => `  ${chalk.yellow(issue.path)}  ${issue.message}`);
    return [chalk.red(error.message), ...issues].join('\n');
  }
  if (isEggshellError(error)) {
    return chalk.red(`${error.code}: ${error.message}`);
  }
  return chalk.red(error instanceof Error ? (error.stack ?? error.message) : String(error));
}
