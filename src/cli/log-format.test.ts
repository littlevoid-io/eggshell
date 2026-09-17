import chalk from 'chalk';
import { describe, expect, it } from 'vitest';
import { formatLogRecord, parseLogLine, scopeColor } from './log-format.js';

describe('parseLogLine', () => {
  it('parses a pino JSON line into level/scope/message/fields', () => {
    const raw = JSON.stringify({
      level: 30,
      time: 1700000000000,
      msg: 'server started',
      scope: 'shell',
      port: 3000,
      pid: 12345,
      hostname: 'testhost',
    });

    const record = parseLogLine(raw);
    expect(record).toEqual({
      level: 'info',
      time: 1700000000000,
      scope: 'shell',
      message: 'server started',
      fields: { port: 3000 },
    });
  });

  it('maps pino levels correctly', () => {
    expect(parseLogLine(JSON.stringify({ level: 10, msg: 't' }))?.level).toBe('debug');
    expect(parseLogLine(JSON.stringify({ level: 20, msg: 'd' }))?.level).toBe('debug');
    expect(parseLogLine(JSON.stringify({ level: 30, msg: 'i' }))?.level).toBe('info');
    expect(parseLogLine(JSON.stringify({ level: 40, msg: 'w' }))?.level).toBe('warn');
    expect(parseLogLine(JSON.stringify({ level: 50, msg: 'e' }))?.level).toBe('error');
    expect(parseLogLine(JSON.stringify({ level: 60, msg: 'f' }))?.level).toBe('error');
  });

  it('returns undefined for non-JSON and for JSON without msg', () => {
    expect(parseLogLine('')).toBeUndefined();
    expect(parseLogLine('plain text')).toBeUndefined();
    expect(parseLogLine('{invalid json')).toBeUndefined();
    expect(parseLogLine('123')).toBeUndefined();
    expect(parseLogLine('null')).toBeUndefined();
    expect(parseLogLine('[]')).toBeUndefined();
    expect(parseLogLine(JSON.stringify({ level: 30 }))).toBeUndefined();
    expect(parseLogLine(JSON.stringify({ level: 30, msg: 123 }))).toBeUndefined();
    expect(parseLogLine(JSON.stringify({ msg: 'no level' }))).toBeUndefined();
    expect(parseLogLine(JSON.stringify({ level: 'info', msg: 'bad level' }))).toBeUndefined();
  });
});

describe('formatLogRecord', () => {
  it('output contains the scope and message', () => {
    const originalLevel = chalk.level;
    chalk.level = 0;
    try {
      const output = formatLogRecord({
        level: 'info',
        time: 1700000000000,
        scope: 'shell',
        message: 'window created',
        fields: { count: 2 },
      });
      expect(output).toContain('[shell]');
      expect(output).toContain('window created');
      expect(output).toContain('{"count":2}');
    } finally {
      chalk.level = originalLevel;
    }
  });

  it('handles undefined time and scope', () => {
    const originalLevel = chalk.level;
    chalk.level = 0;
    try {
      const output = formatLogRecord({
        level: 'warn',
        time: undefined,
        scope: undefined,
        message: 'something degraded',
        fields: {},
      });
      expect(output).toBe('[-] something degraded');
    } finally {
      chalk.level = originalLevel;
    }
  });

  it('overrides scope color with level color on warn and error', () => {
    const warnOutput = formatLogRecord({
      level: 'warn',
      time: undefined,
      scope: 'shell',
      message: 'degraded',
      fields: {},
    });
    expect(warnOutput).toBe(`${chalk.yellow('[shell]')} degraded`);

    const errorOutput = formatLogRecord({
      level: 'error',
      time: undefined,
      scope: 'shell',
      message: 'failed',
      fields: {},
    });
    expect(errorOutput).toBe(`${chalk.red('[shell]')} failed`);
  });

  it('preserves scope color on info and debug', () => {
    const infoOutput = formatLogRecord({
      level: 'info',
      time: undefined,
      scope: 'shell',
      message: 'started',
      fields: {},
    });
    const coloredScope = scopeColor('shell')('shell');
    expect(infoOutput).toBe(`${chalk.cyan(`[${coloredScope}]`)} started`);
  });
});

describe('scopeColor', () => {
  it('same scope yields the same color function twice', () => {
    const first = scopeColor('shell');
    const second = scopeColor('shell');
    expect(first).toBe(second);

    const otherFirst = scopeColor('renderer:main');
    const otherSecond = scopeColor('renderer:main');
    expect(otherFirst).toBe(otherSecond);
  });
});
