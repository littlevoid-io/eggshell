import type { BrowserWindow, IpcMain, WebContents } from 'electron';
import { describe, expect, it } from 'vitest';
import type { LogFields, Logger, LogLevel } from '../logging/logger.js';
import {
  forwardConsoleMessages,
  parseRendererLogPayload,
  registerRendererLogChannel,
} from './renderer-logs.js';

interface CapturedCall {
  level: LogLevel;
  message: string;
  fields?: LogFields | undefined;
}

function createCapturingLogger(): { logger: Logger; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const log = (level: LogLevel) => (message: string, fields?: LogFields) => {
    calls.push({ level, message, fields });
  };
  return {
    calls,
    logger: {
      debug: log('debug'),
      info: log('info'),
      warn: log('warn'),
      error: log('error'),
    },
  };
}

describe('parseRendererLogPayload', () => {
  it('accepts a valid payload with or without fields', () => {
    expect(
      parseRendererLogPayload({
        level: 'info',
        message: 'loaded',
        fields: { duration: 120 },
      })
    ).toEqual({
      level: 'info',
      message: 'loaded',
      fields: { duration: 120 },
    });

    expect(parseRendererLogPayload({ level: 'debug', message: 'ping' })).toEqual({
      level: 'debug',
      message: 'ping',
    });
  });

  it('rejects a bad level or missing message', () => {
    expect(parseRendererLogPayload({ level: 'verbose', message: 'x' })).toBeUndefined();
    expect(parseRendererLogPayload({ level: 10, message: 'x' })).toBeUndefined();
    expect(parseRendererLogPayload({ level: 'info' })).toBeUndefined();
    expect(parseRendererLogPayload({ level: 'info', message: 42 })).toBeUndefined();
    expect(
      parseRendererLogPayload({ level: 'info', message: 'x', fields: 'invalid' })
    ).toBeUndefined();
    expect(parseRendererLogPayload({ level: 'info', message: 'x', fields: null })).toBeUndefined();
    expect(parseRendererLogPayload(null)).toBeUndefined();
    expect(parseRendererLogPayload('string')).toBeUndefined();
    expect(parseRendererLogPayload([])).toBeUndefined();
  });
});

describe('forwardConsoleMessages', () => {
  it("maps 'warning' to warn using fake webContents and capturing Logger", () => {
    type ConsoleListener = (event: {
      level: 'info' | 'warning' | 'error' | 'debug';
      message: string;
      sourceId: string;
      lineNumber: number;
    }) => void;

    let capturedListener: ConsoleListener | undefined;
    const fakeWindow = {
      webContents: {
        on: (_event: string, listener: unknown) => {
          capturedListener = listener as ConsoleListener;
        },
      },
    };

    const { logger, calls } = createCapturingLogger();
    forwardConsoleMessages(fakeWindow as unknown as BrowserWindow, 'win-1', logger);

    expect(capturedListener).toBeDefined();
    capturedListener?.({
      level: 'warning',
      message: 'x',
      sourceId: 'app.js',
      lineNumber: 3,
    });

    expect(calls).toEqual([
      {
        level: 'warn',
        message: 'x',
        fields: {
          source: 'app.js',
          line: 3,
          scope: 'renderer:win-1',
        },
      },
    ]);
  });
});

describe('registerRendererLogChannel', () => {
  it('logs under renderer:<id> for a valid payload and ignores an invalid one', () => {
    type IpcListener = (event: { sender: unknown }, payload: unknown) => void;
    let capturedIpcListener: IpcListener | undefined;
    const fakeIpcMain = {
      on: (_channel: string, listener: unknown) => {
        capturedIpcListener = listener as IpcListener;
      },
    };

    const fakeSender = { id: 'sender-1' };
    const windowIdOf = (sender: unknown) => (sender === fakeSender ? 'main-win' : undefined);

    const { logger, calls } = createCapturingLogger();
    registerRendererLogChannel(
      fakeIpcMain as unknown as Pick<IpcMain, 'on'>,
      windowIdOf as (sender: WebContents) => string | undefined,
      logger
    );

    expect(capturedIpcListener).toBeDefined();

    capturedIpcListener?.(
      { sender: fakeSender },
      { level: 'info', message: 'app ready', fields: { ready: true } }
    );
    expect(calls).toEqual([
      {
        level: 'info',
        message: 'app ready',
        fields: {
          ready: true,
          scope: 'renderer:main-win',
        },
      },
    ]);

    capturedIpcListener?.({ sender: fakeSender }, { level: 'unknown', message: 'nope' });
    expect(calls).toHaveLength(1);

    capturedIpcListener?.({ sender: {} }, { level: 'error', message: 'something broke' });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.fields?.['scope']).toBe('renderer:unknown');
  });
});
