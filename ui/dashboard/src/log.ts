import type { ParsedLogLine } from './types.js';

export type LogLevelCategory = 'debug' | 'info' | 'warn' | 'error';
export type LogFilter = 'all' | 'info' | 'warn' | 'error';

const EXCLUDED_KEYS = new Set(['level', 'time', 'msg', 'scope', 'pid', 'hostname']);

export function mapLevel(level: number): LogLevelCategory {
  if (level <= 20) return 'debug';
  if (level <= 30) return 'info';
  if (level <= 40) return 'warn';
  return 'error';
}

export function parseLogLine(raw: string): ParsedLogLine | null {
  try {
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    if (typeof data.level !== 'number' || typeof data.msg !== 'string') return null;
    return {
      level: data.level,
      time: typeof data.time === 'number' ? data.time : Date.now(),
      msg: data.msg,
      scope: typeof data.scope === 'string' ? data.scope : undefined,
      ...data,
    };
  } catch {
    return null;
  }
}

export function formatLogTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export function extractRemainingFields(entry: ParsedLogLine): string {
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!EXCLUDED_KEYS.has(key)) {
      extras[key] = value;
    }
  }
  return Object.keys(extras).length > 0 ? JSON.stringify(extras) : '';
}

export function levelColorClass(level: number): string {
  const category = mapLevel(level);
  if (category === 'debug') return 'text-zinc-500';
  if (category === 'warn') return 'text-amber-400';
  if (category === 'error') return 'text-red-400';
  return 'text-zinc-300';
}

export function matchesLog(entry: ParsedLogLine, filter: LogFilter, search: string): boolean {
  if (filter !== 'all' && mapLevel(entry.level) !== filter) {
    return false;
  }
  if (search.length === 0) {
    return true;
  }
  const term = search.toLowerCase();
  const inMsg = entry.msg.toLowerCase().includes(term);
  const inScope = entry.scope ? entry.scope.toLowerCase().includes(term) : false;
  return inMsg || inScope;
}
