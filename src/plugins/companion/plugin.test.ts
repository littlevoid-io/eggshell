import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { createCompanionPlugin, PLUGIN_ID } from './plugin.js';
import type {
  IpcHandler,
  CommandHandler,
  ShellContext,
  WindowRegistry,
} from '../../plugin-api/types.js';
import { noopLogger } from '../../logging/logger.js';
import type { CompanionState } from './types.js';

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

describe('companion plugin (T4.3)', () => {
  it('identifies as PLUGIN_ID "companion"', () => {
    const plugin = createCompanionPlugin();
    expect(plugin.id).toBe(PLUGIN_ID);
  });

  it('skips setup when disabled by config', async () => {
    const { context, ipcHandlers, publishedStatuses } = createMockContext({ enabled: false });
    const plugin = createCompanionPlugin();

    await plugin.setup(context);

    expect(ipcHandlers.size).toBe(0);
    expect(publishedStatuses.length).toBe(0);
  });

  it('registers handlers and publishes initial state on setup', async () => {
    const { context, ipcHandlers, commandHandlers, publishedStatuses } = createMockContext();
    const showMock = vi.fn();
    const plugin = createCompanionPlugin({
      ipResolver: () => '192.168.1.42',
      qrGenerator: async text => `data:image/mock;${text}`,
      viewManager: { show: showMock, hide: vi.fn(), destroy: vi.fn() } as never,
    });

    await plugin.setup(context);

    expect(ipcHandlers.has('status')).toBe(true);
    expect(ipcHandlers.has('show')).toBe(true);
    expect(ipcHandlers.has('hide')).toBe(true);
    expect(ipcHandlers.has('dismiss')).toBe(true);
    expect(ipcHandlers.has('toggle')).toBe(true);

    expect(commandHandlers.has('status')).toBe(true);
    expect(commandHandlers.has('show')).toBe(true);

    expect(publishedStatuses.length).toBeGreaterThan(0);
    const initial = publishedStatuses[0] as CompanionState;
    expect(initial.isShowing).toBe(false);
    expect(initial.url).toBe('http://192.168.1.42:3005/');
    expect(initial.qrDataUrl).toBe('data:image/mock;http://192.168.1.42:3005/');
    expect(showMock).not.toHaveBeenCalled();

    await plugin.teardown?.();
  });

  it('shows views immediately when autoShow is configured', async () => {
    const { context, publishedStatuses } = createMockContext({ autoShow: true });
    const showMock = vi.fn();
    const plugin = createCompanionPlugin({
      qrGenerator: async () => 'data:image/mock',
      viewManager: { show: showMock, hide: vi.fn(), destroy: vi.fn() } as never,
    });

    await plugin.setup(context);

    expect(showMock).toHaveBeenCalledTimes(1);
    const initial = publishedStatuses[0] as CompanionState;
    expect(initial.isShowing).toBe(true);

    await plugin.teardown?.();
  });

  it('handles show, hide, dismiss, and toggle commands', async () => {
    const { context, commandHandlers, publishedStatuses } = createMockContext();
    const showMock = vi.fn();
    const hideMock = vi.fn();
    const plugin = createCompanionPlugin({
      qrGenerator: async () => 'data:image/mock',
      viewManager: { show: showMock, hide: hideMock, destroy: vi.fn() } as never,
    });

    await plugin.setup(context);

    const showCommand = commandHandlers.get('show');
    showCommand!();
    expect(showMock).toHaveBeenCalledTimes(1);
    let current = publishedStatuses[publishedStatuses.length - 1] as CompanionState;
    expect(current.isShowing).toBe(true);

    const dismissCommand = commandHandlers.get('dismiss');
    dismissCommand!();
    expect(hideMock).toHaveBeenCalledTimes(1);
    current = publishedStatuses[publishedStatuses.length - 1] as CompanionState;
    expect(current.isShowing).toBe(false);

    const toggleCommand = commandHandlers.get('toggle');
    toggleCommand!();
    expect(showMock).toHaveBeenCalledTimes(2);
    current = publishedStatuses[publishedStatuses.length - 1] as CompanionState;
    expect(current.isShowing).toBe(true);

    // Call show again to ensure updateViews still runs even if state hasn't changed (Item 8)
    showCommand!();
    expect(showMock).toHaveBeenCalledTimes(3);

    await plugin.teardown?.();
  });

  it('aborts setup if teardown runs while awaiting qr generation', async () => {
    const mockContext = createMockContext();
    const abortController = new AbortController();
    mockContext.context = { ...mockContext.context, signal: abortController.signal };
    
    let resolveQr: (value: string) => void;
    const qrPromise = new Promise<string>(resolve => {
      resolveQr = resolve;
    });

    const plugin = createCompanionPlugin({
      qrGenerator: () => qrPromise,
    });

    const setupPromise = plugin.setup(mockContext.context);
    
    // Simulate teardown firing before QR generator finishes
    abortController.abort();
    await plugin.teardown?.();
    
    resolveQr!('data:image/mock');
    await setupPromise;

    // Handlers should NOT be registered because it bailed
    expect(mockContext.ipcHandlers.size).toBe(0);
  });
});
