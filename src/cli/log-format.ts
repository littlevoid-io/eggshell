import chalk from 'chalk';
import type { LogLevel } from '../logging/logger.js';

export interface LogRecord {
  readonly level: LogLevel;
  readonly time: number | undefined;
  readonly scope: string | undefined;
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

const SCOPE_PALETTE = [
  chalk.cyan,
  chalk.green,
  chalk.magenta,
  chalk.blue,
  chalk.yellow,
  chalk.white,
] as const;

const LEVEL_COLORS: Record<LogLevel, (text: string) => string> = {
  debug: chalk.gray,
  info: chalk.cyan,
  warn: chalk.yellow,
  error: chalk.red,
};

const EXCLUDED_KEYS = new Set(['level', 'time', 'msg', 'scope', 'pid', 'hostname']);

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function scopeColor(scope: string): (text: string) => string {
  const index = hashString(scope) % SCOPE_PALETTE.length;
  const color = SCOPE_PALETTE[index];
  return color ?? chalk.white;
}

function mapPinoLevel(level: number): LogLevel {
  if (level <= 20) {
    return 'debug';
  }
  if (level <= 30) {
    return 'info';
  }
  if (level <= 40) {
    return 'warn';
  }
  return 'error';
}

function extractRecordFields(raw: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!EXCLUDED_KEYS.has(key)) {
      fields[key] = value;
    }
  }
  return fields;
}

function formatLocalTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function parseJsonRecord(text: string): Record<string, unknown> | undefined {
  try {
    const raw = JSON.parse(text);
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function parseLogLine(text: string): LogRecord | undefined {
  const raw = parseJsonRecord(text);
  if (raw === undefined || typeof raw['level'] !== 'number' || typeof raw['msg'] !== 'string') {
    return undefined;
  }
  const time = typeof raw['time'] === 'number' ? raw['time'] : undefined;
  const scope = typeof raw['scope'] === 'string' ? raw['scope'] : undefined;
  return {
    level: mapPinoLevel(raw['level']),
    time,
    scope,
    message: raw['msg'],
    fields: extractRecordFields(raw),
  };
}

function formatBadge(record: LogRecord): string {
  const scope = record.scope ?? '-';
  if (record.level === 'warn' || record.level === 'error') {
    return LEVEL_COLORS[record.level](`[${scope}]`);
  }
  const coloredScope = record.scope === undefined ? '-' : scopeColor(record.scope)(record.scope);
  return LEVEL_COLORS[record.level](`[${coloredScope}]`);
}

export function formatLogRecord(record: LogRecord): string {
  const timePrefix = record.time === undefined ? '' : `${chalk.dim(formatLocalTime(record.time))} `;
  const badge = formatBadge(record);
  const hasFields = Object.keys(record.fields).length > 0;
  const fieldsSuffix = hasFields ? ` ${chalk.dim(JSON.stringify(record.fields))}` : '';
  return `${timePrefix}${badge} ${record.message}${fieldsSuffix}`;
}
