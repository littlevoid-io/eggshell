import type { BrowserWindow, IpcMain, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { Blackout } from './blackout.js';
import { registerBuiltinChannels } from './channels.js';
import { createIpcRouter, IPC_CHANNEL } from './ipc.js';
import type { ManagedWindow } from './windows/create.js';

type InvokeHandler = (event: { sender: WebContents }, payload: unknown) => Promise<unknown>;

function setupTestEnvironment() {
  const webContentsA = {
    isDestroyed: () => false,
    send: vi.fn(),
  };
  const webContentsB = {
    isDestroyed: () => false,
    send: vi.fn(),
  };
  const windowA: ManagedWindow = {
    id: 'window-a',
    window: { webContents: webContentsA } as unknown as BrowserWindow,
  };
  const windowB: ManagedWindow = {
    id: 'window-b',
    window: { webContents: webContentsB } as unknown as BrowserWindow,
  };
  const windows = [windowA, windowB];
  const quit = vi.fn();
  const blackout: Blackout = {
    show: vi.fn(),
    hide: vi.fn(),
  };

  let invokeHandler: InvokeHandler | undefined;
  const fakeIpcMain = {
    handle: (channel: string, listener: unknown) => {
      if (channel === IPC_CHANNEL) {
        invokeHandler = listener as InvokeHandler;
      }
    },
  };

  const windowIdOf = (sender: WebContents) =>
    windows.find(w => (w.window.webContents as unknown as WebContents) === sender)?.id;
  const router = createIpcRouter(windowIdOf, {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  });

  registerBuiltinChannels(router, { windows, quit, blackout });
  router.attach(fakeIpcMain as unknown as Pick<IpcMain, 'handle'>);

  return {
    webContentsA: webContentsA as unknown as WebContents & { send: ReturnType<typeof vi.fn> },
    webContentsB: webContentsB as unknown as WebContents & { send: ReturnType<typeof vi.fn> },
    quit,
    blackout,
    invoke: (sender: WebContents, channel: string, ...args: unknown[]) =>
      invokeHandler!({ sender }, { channel, args }),
  };
}

describe('registerBuiltinChannels', () => {
  it('state-sync:update from window A sends eggshell:event to B only', async () => {
    const { webContentsA, webContentsB, invoke } = setupTestEnvironment();
    const state = { theme: 'dark', counter: 42 };

    await invoke(webContentsA, 'state-sync:update', state);

    expect(webContentsA.send).not.toHaveBeenCalled();
    expect(webContentsB.send).toHaveBeenCalledWith('eggshell:event', {
      channel: 'state-sync:on-update',
      args: [state],
    });
  });

  it('state-sync:send-event from window A sends eggshell:event to B only', async () => {
    const { webContentsA, webContentsB, invoke } = setupTestEnvironment();
    const event = { action: 'refresh' };

    await invoke(webContentsA, 'state-sync:send-event', event);

    expect(webContentsA.send).not.toHaveBeenCalled();
    expect(webContentsB.send).toHaveBeenCalledWith('eggshell:event', {
      channel: 'state-sync:on-event',
      args: [event],
    });
  });

  it('state-sync:request-current from window A sends eggshell:event to B only', async () => {
    const { webContentsA, webContentsB, invoke } = setupTestEnvironment();

    await invoke(webContentsA, 'state-sync:request-current');

    expect(webContentsA.send).not.toHaveBeenCalled();
    expect(webContentsB.send).toHaveBeenCalledWith('eggshell:event', {
      channel: 'state-sync:on-request-current',
      args: [],
    });
  });

  it('app:quit calls quit', async () => {
    const { webContentsA, quit, invoke } = setupTestEnvironment();

    await invoke(webContentsA, 'app:quit');

    expect(quit).toHaveBeenCalledOnce();
  });

  it('blackout:show calls blackout.show', async () => {
    const { webContentsA, blackout, invoke } = setupTestEnvironment();

    await invoke(webContentsA, 'blackout:show');

    expect(blackout.show).toHaveBeenCalledOnce();
  });

  it('blackout:hide calls blackout.hide', async () => {
    const { webContentsA, blackout, invoke } = setupTestEnvironment();

    await invoke(webContentsA, 'blackout:hide');

    expect(blackout.hide).toHaveBeenCalledOnce();
  });
});
