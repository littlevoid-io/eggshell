import chalk from 'chalk';
import { ConfigError, isEggshellError } from '../errors.js';
import type { LogFields, Logger, LogLevel } from '../logging/logger.js';

const LEVEL_COLORS: Record<LogLevel, (text: string) => string> = {
  debug: chalk.gray,
  info: chalk.cyan,
  warn: chalk.yellow,
  error: chalk.red,
};

function formatFields(fields: LogFields | undefined): string {
  const rest = Object.entries(fields ?? {}).filter(([key]) => key !== 'scope');
  return rest.length === 0 ? '' : ` ${chalk.dim(JSON.stringify(Object.fromEntries(rest)))}`;
}

function write(level: LogLevel, message: string, fields?: LogFields): void {
  const scope = typeof fields?.['scope'] === 'string' ? fields['scope'] : 'cli';
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${LEVEL_COLORS[level](`[${scope}]`)} ${message}${formatFields(fields)}\n`);
}

/** Colored per-scope terminal output for the CLI process. */
export const terminalLogger: Logger = {
  debug: (message, fields) => write('debug', message, fields),
  info: (message, fields) => write('info', message, fields),
  warn: (message, fields) => write('warn', message, fields),
  error: (message, fields) => write('error', message, fields),
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
