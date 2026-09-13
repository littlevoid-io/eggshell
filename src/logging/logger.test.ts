import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Logger, LogFields, LogLevel } from './logger.js';
import { createChildLogger, noopLogger, withMinimumLevel } from './logger.js';
import { consoleLogger } from './console-logger.js';

interface CapturedCall {
  level: LogLevel;
  message: string;
  fields?: LogFields;
}

function createCapturingLogger(): { logger: Logger; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const record =
    (level: LogLevel) =>
    (message: string, fields?: LogFields): void => {
      if (fields === undefined) {
        calls.push({ level, message });
      } else {
        calls.push({ level, message, fields });
      }
    };
  return {
    calls,
    logger: {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    },
  };
}

describe('createChildLogger', () => {
  it('passes message and level through to the parent', () => {
    const { logger: parent, calls } = createCapturingLogger();
    const child = createChildLogger(parent, 'scope-a');

    child.info('hello');
    child.error('boom');

    expect(calls[0]?.level).toBe('info');
    expect(calls[0]?.message).toBe('hello');
    expect(calls[1]?.level).toBe('error');
    expect(calls[1]?.message).toBe('boom');
  });

  it('tags output with scope, and nested children compose both scopes', () => {
    const { logger: parent, calls } = createCapturingLogger();
    const childA = createChildLogger(parent, 'a');
    const childB = createChildLogger(childA, 'b');

    childA.info('from a');
    childB.info('from b');

    expect(calls[0]?.fields?.['scope']).toBe('a');
    expect(calls[1]?.fields?.['scope']).toBe('a:b');
  });

  it('does not mutate or affect the parent logger', () => {
    const { logger: parent, calls } = createCapturingLogger();
    const child = createChildLogger(parent, 'scope-a');

    parent.info('direct call');
    child.info('child call');

    expect(calls[0]?.fields).toBeUndefined();
    expect(calls[1]?.fields?.['scope']).toBe('scope-a');
    expect(Object.keys(parent)).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('preserves caller fields merged with the injected scope field', () => {
    const { logger: parent, calls } = createCapturingLogger();
    const child = createChildLogger(parent, 'scope-a');

    child.info('with fields', { userId: 'u1', count: 3 });

    expect(calls[0]?.fields).toEqual({ userId: 'u1', count: 3, scope: 'scope-a' });
  });
});

describe('noopLogger', () => {
  it('accepts all four levels and does nothing', () => {
    expect(() => noopLogger.debug('x')).not.toThrow();
    expect(() => noopLogger.info('x', { a: 1 })).not.toThrow();
    expect(() => noopLogger.warn('x')).not.toThrow();
    expect(() => noopLogger.error('x', { a: 1 })).not.toThrow();
  });
});

describe('withMinimumLevel', () => {
  it("drops debug/info and forwards warn/error at minimum 'warn'", () => {
    const { logger: base, calls } = createCapturingLogger();
    const filtered = withMinimumLevel(base, 'warn');

    filtered.debug('d');
    filtered.info('i');
    filtered.warn('w');
    filtered.error('e');

    expect(calls.map(call => call.level)).toEqual(['warn', 'error']);
  });
});

describe('consoleLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes debug to console.debug', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    consoleLogger.debug('msg', { a: 1 });
    expect(spy).toHaveBeenCalledWith('msg', { a: 1 });
  });

  it('routes info to console.info', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    consoleLogger.info('msg');
    expect(spy).toHaveBeenCalledWith('msg');
  });

  it('routes warn to console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    consoleLogger.warn('msg', { a: 1 });
    expect(spy).toHaveBeenCalledWith('msg', { a: 1 });
  });

  it('routes error to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleLogger.error('msg');
    expect(spy).toHaveBeenCalledWith('msg');
  });
});
