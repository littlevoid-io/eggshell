import type { IpcMain, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../logging/logger.js';
import {
  IPC_CHANNEL,
  createIpcRouter,
  parseIpcPayload,
  sendEvent,
  type IpcContext,
} from './ipc.js';

function createCapturingLogger(): {
  logger: Logger;
  warnings: Array<{ message: string; fields?: Record<string, unknown> | undefined }>;
} {
  const warnings: Array<{ message: string; fields?: Record<string, unknown> | undefined }> = [];
  return {
    warnings,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: (message, fields) => {
        warnings.push({ message, fields });
      },
      error: () => undefined,
    },
  };
}

describe('parseIpcPayload', () => {
  it('accepts a valid payload with channel and args array', () => {
    expect(parseIpcPayload({ channel: 'x', args: [1] })).toEqual({
      channel: 'x',
      args: [1],
    });
    expect(parseIpcPayload({ channel: 'test', args: [] })).toEqual({
      channel: 'test',
      args: [],
    });
  });

  it('rejects a string', () => {
    expect(parseIpcPayload('some-string')).toBeUndefined();
  });

  it('rejects missing args or invalid types', () => {
    expect(parseIpcPayload({ channel: 'x' })).toBeUndefined();
    expect(parseIpcPayload({ args: [1] })).toBeUndefined();
    expect(parseIpcPayload({ channel: 'x', args: 'not-an-array' })).toBeUndefined();
    expect(parseIpcPayload({ channel: 123, args: [1] })).toBeUndefined();
    expect(parseIpcPayload(null)).toBeUndefined();
    expect(parseIpcPayload(undefined)).toBeUndefined();
    expect(parseIpcPayload([1, 2, 3])).toBeUndefined();
  });
});

describe('createIpcRouter', () => {
  it('throws if handle is called twice on the same channel', () => {
    const { logger } = createCapturingLogger();
    const router = createIpcRouter(() => undefined, logger);
    router.handle('test:channel', () => 'first');
    expect(() => {
      router.handle('test:channel', () => 'second');
    }).toThrow('Channel "test:channel" is already registered');
  });

  it('returns registered channels from channels()', () => {
    const { logger } = createCapturingLogger();
    const router = createIpcRouter(() => undefined, logger);
    router.handle('chan-1', () => 1);
    router.handle('chan-2', () => 2);
    expect(router.channels()).toEqual(['chan-1', 'chan-2']);
  });

  it("attached handler returns handler's result with the resolved windowId", async () => {
    type HandlerFunction = (event: { sender: WebContents }, payload: unknown) => Promise<unknown>;
    let attachedHandler: HandlerFunction | undefined;
    const fakeIpcMain = {
      handle: (channel: string, listener: unknown) => {
        if (channel === IPC_CHANNEL) {
          attachedHandler = listener as HandlerFunction;
        }
      },
    };

    const fakeSender = { isDestroyed: () => false } as unknown as WebContents;
    const windowIdOf = (sender: WebContents) => (sender === fakeSender ? 'win-test' : undefined);
    const { logger } = createCapturingLogger();
    const router = createIpcRouter(windowIdOf, logger);

    router.handle('math:add', (context: IpcContext, a: unknown, b: unknown) => {
      expect(context.windowId).toBe('win-test');
      expect(context.sender).toBe(fakeSender);
      return Number(a) + Number(b);
    });
    router.attach(fakeIpcMain as unknown as Pick<IpcMain, 'handle'>);

    expect(attachedHandler).toBeDefined();
    const result = await attachedHandler!(
      { sender: fakeSender },
      { channel: 'math:add', args: [3, 4] }
    );
    expect(result).toBe(7);
  });

  it('attached handler rejects with "Unknown IPC channel" for unregistered channel and logs warning', async () => {
    type HandlerFunction = (event: { sender: WebContents }, payload: unknown) => Promise<unknown>;
    let attachedHandler: HandlerFunction | undefined;
    const fakeIpcMain = {
      handle: (channel: string, listener: unknown) => {
        if (channel === IPC_CHANNEL) {
          attachedHandler = listener as HandlerFunction;
        }
      },
    };

    const fakeSender = { isDestroyed: () => false } as unknown as WebContents;
    const windowIdOf = (sender: WebContents) => (sender === fakeSender ? 'win-test' : undefined);
    const { logger, warnings } = createCapturingLogger();
    const router = createIpcRouter(windowIdOf, logger);
    router.attach(fakeIpcMain as unknown as Pick<IpcMain, 'handle'>);

    await expect(
      attachedHandler!({ sender: fakeSender }, { channel: 'nonexistent', args: [] })
    ).rejects.toThrow('Unknown IPC channel "nonexistent"');

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toBe('Unknown IPC channel "nonexistent"');
    expect(warnings[0]?.fields).toEqual({ windowId: 'win-test' });
  });

  it('attached handler throws on invalid payload', async () => {
    type HandlerFunction = (event: { sender: WebContents }, payload: unknown) => Promise<unknown>;
    let attachedHandler: HandlerFunction | undefined;
    const fakeIpcMain = {
      handle: (_channel: string, listener: unknown) => {
        attachedHandler = listener as HandlerFunction;
      },
    };

    const fakeSender = { isDestroyed: () => false } as unknown as WebContents;
    const { logger } = createCapturingLogger();
    const router = createIpcRouter(() => undefined, logger);
    router.attach(fakeIpcMain as unknown as Pick<IpcMain, 'handle'>);

    await expect(attachedHandler!({ sender: fakeSender }, 'not-valid')).rejects.toThrow(
      'Invalid IPC payload'
    );
  });
});

describe('sendEvent', () => {
  it('skips a destroyed target', () => {
    const sendSpy = vi.fn();
    const destroyedTarget = {
      isDestroyed: () => true,
      send: sendSpy,
    };
    sendEvent(destroyedTarget, 'test-channel', 'data');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('sends event to active target', () => {
    const sendSpy = vi.fn();
    const activeTarget = {
      isDestroyed: () => false,
      send: sendSpy,
    };
    sendEvent(activeTarget, 'test-channel', 'arg1', 'arg2');
    expect(sendSpy).toHaveBeenCalledWith('eggshell:event', {
      channel: 'test-channel',
      args: ['arg1', 'arg2'],
    });
  });
});
