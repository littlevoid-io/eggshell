import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { createOfflinePlugin, PLUGIN_ID } from './plugin.js';
import type { IpcHandler, CommandHandler, ShellContext, WindowRegistry } from '../../plugin-api/types.js';
import { noopLogger } from '../../logging/logger.js';
import type { OfflineOverlayState } from './types.js';

function createMockContext(config: unknown = {}): {
  context: ShellContext<BrowserWindow>;
  ipcHandlers: Map<string, IpcHandler>;
  commandHandlers: Map<string, CommandHandler>;
  publishedStatuses: unknown[];
} {
  const ipcHandlers = new Map<string, IpcHandler>();
  const commandHandlers = new Map<string, CommandHandler>();
  const publishedStatuses: unknown[] = [];

  const windows: WindowRegistry<BrowserWindow> = {
    get: () => undefined,
    list: () => [],
  };

  const context: ShellContext<BrowserWindow> = {
    windows,
    views: {
      createOverlay: () => ({ show: vi.fn(), hide: vi.fn(), destroy: vi.fn() }),
    },
    ipc: {
      handle: (channel, handler) => {
        ipcHandlers.set(channel, handler);
      },
    },
    commands: {
      register: (name, handler) => {
        commandHandlers.set(name, handler);
      },
    },
    status: {
      publish: value => {
        publishedStatuses.push(value);
      },
      read: () => publishedStatuses[publishedStatuses.length - 1],
    },
    logger: noopLogger,
    roots: {
      packageRoot: 'C:/mock/package',
      projectRoot: 'C:/mock/project',
      userDataRoot: 'C:/mock/user',
    },
    config,
    signal: new AbortController().signal,
  };

  return { context, ipcHandlers, commandHandlers, publishedStatuses };
}

describe('offline plugin (T4.1)', () => {
  it('identifies as PLUGIN_ID "offline"', () => {
    const plugin = createOfflinePlugin();
    expect(plugin.id).toBe(PLUGIN_ID);
  });

  it('registers handlers and publishes initial state on setup', async () => {
    const { context, ipcHandlers, commandHandlers, publishedStatuses } = createMockContext();
    const plugin = createOfflinePlugin({
      viewManager: { show: vi.fn(), hide: vi.fn(), destroy: vi.fn() } as never,
    });

    await plugin.setup(context);

    expect(ipcHandlers.has('status')).toBe(true);
    expect(ipcHandlers.has('dismiss')).toBe(true);
    expect(ipcHandlers.has('force-show')).toBe(true);
    expect(ipcHandlers.has('toggle')).toBe(true);

    expect(commandHandlers.has('status')).toBe(true);
    expect(commandHandlers.has('dismiss')).toBe(true);

    expect(publishedStatuses.length).toBeGreaterThan(0);
    const initial = publishedStatuses[0] as OfflineOverlayState;
    expect(initial.isOnline).toBe(true);
    expect(initial.isShowing).toBe(false);

    await plugin.teardown?.();
  });

  it('handles user dismissal command and publishes updated state', async () => {
    const { context, commandHandlers, publishedStatuses } = createMockContext();
    const plugin = createOfflinePlugin({
      viewManager: { show: vi.fn(), hide: vi.fn(), destroy: vi.fn() } as never,
    });

    await plugin.setup(context);

    const forceShow = commandHandlers.get('force-show');
    expect(forceShow).toBeDefined();
    forceShow!();

    const lastState = publishedStatuses[publishedStatuses.length - 1] as OfflineOverlayState;
    expect(lastState.isShowing).toBe(true);
    expect(lastState.isForcedShow).toBe(true);

    const dismiss = commandHandlers.get('dismiss');
    expect(dismiss).toBeDefined();
    dismiss!();

    const dismissedState = publishedStatuses[publishedStatuses.length - 1] as OfflineOverlayState;
    expect(dismissedState.isShowing).toBe(false);
    expect(dismissedState.isDismissedByUser).toBe(true);

    await plugin.teardown?.();
  });

  it('always calls updateViews when a command is invoked even if state boolean did not change', async () => {
    const { context, commandHandlers } = createMockContext();
    const showMock = vi.fn();
    const hideMock = vi.fn();
    const plugin = createOfflinePlugin({
      viewManager: { show: showMock, hide: hideMock, destroy: vi.fn() } as never,
    });

    await plugin.setup(context);

    const forceShow = commandHandlers.get('force-show')!;
    forceShow();
    expect(showMock).toHaveBeenCalledTimes(1);

    // Re-invoke force-show, should call showMock again for any newly appeared windows
    forceShow();
    expect(showMock).toHaveBeenCalledTimes(2);

    const dismiss = commandHandlers.get('dismiss')!;
    dismiss();
    expect(hideMock).toHaveBeenCalledTimes(1);
    
    dismiss();
    expect(hideMock).toHaveBeenCalledTimes(2);

    await plugin.teardown?.();
  });

  it('skips setup when disabled by config', async () => {
    const { context, ipcHandlers, publishedStatuses } = createMockContext({ enabled: false });
    const plugin = createOfflinePlugin();

    await plugin.setup(context);

    expect(ipcHandlers.size).toBe(0);
    expect(publishedStatuses.length).toBe(0);

    await plugin.teardown?.();
  });
});
