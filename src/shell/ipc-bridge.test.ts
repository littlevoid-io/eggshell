import { describe, expect, it, vi } from 'vitest';
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { IPC_BRIDGE_CHANNEL, registerIpcBridge } from './ipc-bridge.js';
import type { IpcDispatcher } from './ipc-bridge.js';
import { ConfigError } from '../errors.js';
import type { Logger, LogFields } from '../logging/logger.js';
import type { IpcInvocation } from '../plugin-api/types.js';

/**
 * Electron cannot run inside vitest (established convention: see
 * `hardening.test.ts`'s module doc). This fake duck-types only the slice of
 * `IpcMain` that `ipc-bridge.ts` actually calls, captures the single
 * registered handler, and is cast through `unknown` at the boundary.
 */
function createFakeIpcMain() {
  let handler: ((event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) | null = null;
  const removeHandler = vi.fn();

  const fakeIpcMain = {
    handle(_channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) {
      handler = listener;
    },
    removeHandler,
  };

  return {
    ipcMain: fakeIpcMain as unknown as IpcMain,
    invoke: (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!handler) {
        throw new Error('no handler registered');
      }
      return handler(event, ...args);
    },
    removeHandler,
  };
}

function fakeEvent(webContents: unknown): IpcMainInvokeEvent {
  return { sender: webContents } as unknown as IpcMainInvokeEvent;
}

function fakeWebContents(id: string): WebContents {
  return { id } as unknown as WebContents;
}

interface LoggedError {
  readonly message: string;
  readonly fields?: LogFields;
}

function createCapturingLogger(): Logger & { readonly errors: LoggedError[] } {
  const errors: LoggedError[] = [];
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (message, fields) =>
      errors.push(fields === undefined ? { message } : { message, fields }),
    errors,
  };
}

interface RecordedCall {
  readonly channel: string;
  readonly invocation: IpcInvocation;
  readonly args: unknown[];
}

function createFakeRegistry(
  handler: (channel: string, invocation: IpcInvocation, ...args: unknown[]) => unknown
) {
  const calls: RecordedCall[] = [];
  const registry: IpcDispatcher = {
    dispatchIpc: (channel, invocation, ...args) => {
      calls.push({ channel, invocation, args });
      return handler(channel, invocation, ...args);
    },
  };
  return { registry, calls };
}

const windowMap = new Map<string, string>([['sender-1', 'window-main']]);
function windowIdForWebContents(webContents: WebContents): string | undefined {
  return windowMap.get((webContents as unknown as { id: string }).id);
}

describe('registerIpcBridge', () => {
  it('dispatches a registered, allow-listed channel to the registry with the right channel and args', async () => {
    const { registry, calls } = createFakeRegistry(() => 'ok');
    const { ipcMain, invoke } = createFakeIpcMain();
    registerIpcBridge({
      ipcMain,
      registry,
      windowIdForWebContents,
      allowedChannels: ['dashboard:refresh'],
    });

    const result = await invoke(fakeEvent(fakeWebContents('sender-1')), {
      channel: 'dashboard:refresh',
      args: ['a', 1],
    });

    expect(result).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.channel).toBe('dashboard:refresh');
    expect(calls[0]?.args).toEqual(['a', 1]);
  });

  it('SECURITY: derives windowId from the sender and ignores/overrides a renderer-supplied windowId', async () => {
    const { registry, calls } = createFakeRegistry(() => 'ok');
    const { ipcMain, invoke } = createFakeIpcMain();
    registerIpcBridge({
      ipcMain,
      registry,
      windowIdForWebContents,
      allowedChannels: ['dashboard:refresh'],
    });

    await invoke(fakeEvent(fakeWebContents('sender-1')), {
      channel: 'dashboard:refresh',
      args: [],
      // A compromised renderer trying to impersonate another window.
      windowId: 'someone-elses-window',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.invocation).toEqual({ windowId: 'window-main' });
  });

  it('rejects a request from an unknown sender', async () => {
    const { registry } = createFakeRegistry(() => 'ok');
    const { ipcMain, invoke } = createFakeIpcMain();
    registerIpcBridge({
      ipcMain,
      registry,
      windowIdForWebContents,
      allowedChannels: ['dashboard:refresh'],
    });

    await expect(
      invoke(fakeEvent(fakeWebContents('unrecognized-sender')), {
        channel: 'dashboard:refresh',
        args: [],
      })
    ).rejects.toThrow(ConfigError);
  });

  it('rejects a channel not in the allow-list with a clear error, not a silent no-op', async () => {
    const { registry, calls } = createFakeRegistry(() => 'ok');
    const { ipcMain, invoke } = createFakeIpcMain();
    registerIpcBridge({
      ipcMain,
      registry,
      windowIdForWebContents,
      allowedChannels: ['dashboard:refresh'],
    });

    await expect(
      invoke(fakeEvent(fakeWebContents('sender-1')), {
        channel: 'other-plugin:secret',
        args: [],
      })
    ).rejects.toThrow(/other-plugin:secret/);
    expect(calls).toHaveLength(0);
  });

  describe('allow-list evaluation timing', () => {
    it('ORDERING RACE: a channel registered after registerIpcBridge() is reachable via a dynamic (function-form) allow-list', async () => {
      const { registry, calls } = createFakeRegistry(() => 'ok');
      const { ipcMain, invoke } = createFakeIpcMain();
      // Mirrors T3.4's real ordering: the bridge is wired at window-creation
      // time, and this mutable list only gains an entry afterward, once a
      // plugin's setup() registers its channel with the PluginRegistry.
      const liveChannels: string[] = [];
      registerIpcBridge({
        ipcMain,
        registry,
        windowIdForWebContents,
        allowedChannels: () => liveChannels,
      });

      // A snapshot taken at registerIpcBridge() time would have been empty.
      liveChannels.push('dashboard:refresh');

      const result = await invoke(fakeEvent(fakeWebContents('sender-1')), {
        channel: 'dashboard:refresh',
        args: [],
      });

      expect(result).toBe('ok');
      expect(calls).toHaveLength(1);
    });

    it('a static iterable form still works, and still denies a channel it does not list', async () => {
      const { registry, calls } = createFakeRegistry(() => 'ok');
      const { ipcMain, invoke } = createFakeIpcMain();
      registerIpcBridge({
        ipcMain,
        registry,
        windowIdForWebContents,
        allowedChannels: ['dashboard:refresh'],
      });

      const result = await invoke(fakeEvent(fakeWebContents('sender-1')), {
        channel: 'dashboard:refresh',
        args: [],
      });
      expect(result).toBe('ok');

      await expect(
        invoke(fakeEvent(fakeWebContents('sender-1')), { channel: 'dashboard:other', args: [] })
      ).rejects.toThrow(/dashboard:other/);
      expect(calls).toHaveLength(1);
    });

    it('denies every channel by default when allowedChannels is omitted (deny-all)', async () => {
      const { registry, calls } = createFakeRegistry(() => 'ok');
      const { ipcMain, invoke } = createFakeIpcMain();
      registerIpcBridge({ ipcMain, registry, windowIdForWebContents });

      await expect(
        invoke(fakeEvent(fakeWebContents('sender-1')), { channel: 'dashboard:refresh', args: [] })
      ).rejects.toThrow(ConfigError);
      expect(calls).toHaveLength(0);
    });

    it('the allow-list is a gate independent of registry registration: a channel the registry would happily dispatch is still denied if not allow-listed', async () => {
      const { registry, calls } = createFakeRegistry(channel => `handled:${channel}`);
      const { ipcMain, invoke } = createFakeIpcMain();
      registerIpcBridge({
        ipcMain,
        registry,
        windowIdForWebContents,
        // The registry (fake here) would dispatch "dashboard:restart" just
        // fine -- it is a real, working handler. The allow-list omits it on
        // purpose, e.g. because the main window shows untrusted remote
        // content that must never reach a trusted-UI-only command.
        allowedChannels: ['dashboard:refresh'],
      });

      await expect(
        invoke(fakeEvent(fakeWebContents('sender-1')), {
          channel: 'dashboard:restart',
          args: [],
        })
      ).rejects.toThrow(/dashboard:restart/);
      expect(calls).toHaveLength(0);
    });
  });

  describe('envelope validation', () => {
    function makeBridge() {
      const { registry, calls } = createFakeRegistry(() => 'ok');
      const { ipcMain, invoke } = createFakeIpcMain();
      registerIpcBridge({ ipcMain, registry, windowIdForWebContents, allowedChannels: ['p:c'] });
      return { invoke, calls };
    }

    it('rejects a non-string channel, naming the "channel" field', async () => {
      const { invoke } = makeBridge();
      await expect(
        invoke(fakeEvent(fakeWebContents('sender-1')), { channel: 42, args: [] })
      ).rejects.toThrow(/channel/);
    });

    it('rejects an empty channel string, naming the "channel" field', async () => {
      const { invoke } = makeBridge();
      await expect(
        invoke(fakeEvent(fakeWebContents('sender-1')), { channel: '', args: [] })
      ).rejects.toThrow(/channel/);
    });

    it('rejects non-array args, naming the "args" field', async () => {
      const { invoke } = makeBridge();
      await expect(
        invoke(fakeEvent(fakeWebContents('sender-1')), { channel: 'p:c', args: 'not-an-array' })
      ).rejects.toThrow(/args/);
    });

    it('rejects an oversized payload, naming the "args" field', async () => {
      const { invoke } = makeBridge();
      const huge = 'x'.repeat(2_000_000);
      await expect(
        invoke(fakeEvent(fakeWebContents('sender-1')), { channel: 'p:c', args: [huge] })
      ).rejects.toThrow(/args/);
    });

    it('rejects a non-JSON-serializable arg (a function), naming the "args" field', async () => {
      const { invoke } = makeBridge();
      await expect(
        invoke(fakeEvent(fakeWebContents('sender-1')), {
          channel: 'p:c',
          args: [() => undefined],
        })
      ).rejects.toThrow(/args/);
    });
  });

  it('sanitizes a thrown plugin-handler error: no stack or filesystem path reaches the caller, and the full error is logged main-side', async () => {
    const originalError = new Error(
      "ENOENT: no such file or directory, open 'C:\\Users\\ben\\secret\\config.json'"
    );
    const { registry } = createFakeRegistry(() => {
      throw originalError;
    });
    const logger = createCapturingLogger();
    const { ipcMain, invoke } = createFakeIpcMain();
    registerIpcBridge({
      ipcMain,
      registry,
      windowIdForWebContents,
      logger,
      allowedChannels: ['dashboard:refresh'],
    });

    let caught: unknown;
    try {
      await invoke(fakeEvent(fakeWebContents('sender-1')), {
        channel: 'dashboard:refresh',
        args: [],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).not.toContain('C:\\Users\\ben\\secret');
    expect(message).not.toContain(originalError.stack ?? '__no-stack__');
    expect(message).not.toBe(originalError.message);

    expect(logger.errors.length).toBeGreaterThan(0);
    const loggedFields = logger.errors[0]?.fields;
    expect(String(loggedFields?.['error'])).toContain('config.json');
  });

  it("a plugin handler's return value reaches the caller", async () => {
    const { registry } = createFakeRegistry(() => ({ status: 'ok', count: 3 }));
    const { ipcMain, invoke } = createFakeIpcMain();
    registerIpcBridge({
      ipcMain,
      registry,
      windowIdForWebContents,
      allowedChannels: ['dashboard:refresh'],
    });

    const result = await invoke(fakeEvent(fakeWebContents('sender-1')), {
      channel: 'dashboard:refresh',
      args: [],
    });

    expect(result).toEqual({ status: 'ok', count: 3 });
  });

  it('dispose() removes the handler', () => {
    const { registry } = createFakeRegistry(() => 'ok');
    const { ipcMain, removeHandler } = createFakeIpcMain();
    const { dispose } = registerIpcBridge({
      ipcMain,
      registry,
      windowIdForWebContents,
      allowedChannels: ['dashboard:refresh'],
    });

    dispose();

    expect(removeHandler).toHaveBeenCalledWith(IPC_BRIDGE_CHANNEL);
  });
});

/**
 * `preload.ts` normally runs only inside a real (or faked) Electron
 * preload context: requiring the bare `electron` package from plain Node
 * returns a filesystem path string, not `{ contextBridge, ipcRenderer }`,
 * so importing it unmocked here would throw. `vi.doMock` substitutes a
 * fake `electron` module before a fresh dynamic import re-runs
 * `preload.ts`'s module body (its `contextBridge.exposeInMainWorld` call
 * is a load-time side effect, not something exported to call directly),
 * which lets this assert on the exact object handed to the fake
 * `contextBridge` -- the strongest available check that `ipcRenderer`
 * itself, or any arbitrary-channel escape, is never part of that surface.
 */
describe('preload surface', () => {
  it('exposes only { invoke } on the main world, never ipcRenderer itself, and invoke forwards through the one bridge channel', async () => {
    const exposeInMainWorld = vi.fn();
    const rendererInvoke = vi.fn().mockResolvedValue('ok');

    vi.resetModules();
    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld },
      ipcRenderer: { invoke: rendererInvoke },
    }));

    await import('./preload.js');

    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    const [world, exposedApi] = exposeInMainWorld.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(world).toBe('eggshell');

    // Exactly one member, and it is not `ipcRenderer` (or a reference to
    // it) passed straight through -- that would hand untrusted content the
    // ability to invoke any channel, not just this bridge's one.
    expect(Object.keys(exposedApi)).toEqual(['invoke']);
    expect(exposedApi['invoke']).not.toBe(rendererInvoke);
    expect(typeof exposedApi['invoke']).toBe('function');

    const invoke = exposedApi['invoke'] as (
      channel: string,
      ...args: unknown[]
    ) => Promise<unknown>;
    await invoke('some-plugin:some-channel', 'arg1', 2);

    expect(rendererInvoke).toHaveBeenCalledTimes(1);
    expect(rendererInvoke).toHaveBeenCalledWith(IPC_BRIDGE_CHANNEL, {
      channel: 'some-plugin:some-channel',
      args: ['arg1', 2],
    });

    vi.doUnmock('electron');
  });
});
