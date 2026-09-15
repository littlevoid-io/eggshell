import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { PluginError } from '../../errors.js';
import { noopLogger } from '../../logging/logger.js';
import type {
  CommandHandler,
  IpcHandler,
  ShellContext,
  WindowHandle,
  WindowRegistry,
} from '../../plugin-api/types.js';
import { createSoakPlugin, PLUGIN_ID } from './plugin.js';
import { MemoryReportWriter } from './reporter.js';
import type { SoakReport, SoakState } from './types.js';

function createMockContext(
  config: unknown = {},
  windows: readonly WindowHandle<BrowserWindow>[] = []
): {
  context: ShellContext<BrowserWindow>;
  ipcHandlers: Map<string, IpcHandler>;
  commandHandlers: Map<string, CommandHandler>;
  publishedStatuses: unknown[];
} {
  const ipcHandlers = new Map<string, IpcHandler>();
  const commandHandlers = new Map<string, CommandHandler>();
  const publishedStatuses: unknown[] = [];
  const windowRegistry: WindowRegistry<BrowserWindow> = {
    get: id => windows.find(w => w.id === id),
    list: () => windows,
  };

  const context: ShellContext<BrowserWindow> = {
    windows: windowRegistry,
    views: {
      createOverlay: () => ({ show: () => {}, hide: () => {}, destroy: () => {} }),
    },
    ipc: { handle: (channel, handler) => ipcHandlers.set(channel, handler) },
    commands: { register: (name, handler) => commandHandlers.set(name, handler) },
    status: {
      publish: v => publishedStatuses.push(v),
      read: () => publishedStatuses[publishedStatuses.length - 1],
    },
    logger: noopLogger,
    roots: {
      packageRoot: 'C:/mock/pkg',
      projectRoot: 'C:/mock/proj',
      userDataRoot: 'C:/mock/user',
    },
    config,
    signal: new AbortController().signal,
  };

  return { context, ipcHandlers, commandHandlers, publishedStatuses };
}

function createMockWindow(bounds = { x: 0, y: 0, width: 800, height: 600 }): {
  window: BrowserWindow;
  executeMock: ReturnType<typeof vi.fn>;
} {
  const executeMock = vi.fn().mockResolvedValue(undefined);
  const webContents = { executeJavaScript: executeMock, on: vi.fn(), removeListener: vi.fn() };
  const window = {
    webContents,
    getContentBounds: vi.fn().mockReturnValue(bounds),
  } as unknown as BrowserWindow;
  return { window, executeMock };
}

describe('soak plugin (T4.4)', () => {
  it('identifies as PLUGIN_ID "soak"', () => {
    const plugin = createSoakPlugin({ isPackagedFn: () => false });
    expect(plugin.id).toBe(PLUGIN_ID);
  });

  it('refuses to run and throws PluginError when packaged', () => {
    const { context } = createMockContext();
    const plugin = createSoakPlugin({ isPackagedFn: () => true });

    expect(() => void plugin.setup(context)).toThrow(PluginError);
    try {
      void plugin.setup(context);
    } catch (error) {
      expect(error).toBeInstanceOf(PluginError);
      expect((error as PluginError).pluginId).toBe(PLUGIN_ID);
      expect((error as PluginError).code).toBe('ERR_EGGSHELL_PLUGIN');
    }
  });

  it('skips setup when disabled by config', async () => {
    const { context, ipcHandlers, publishedStatuses } = createMockContext({ enabled: false });
    const plugin = createSoakPlugin({ isPackagedFn: () => false });

    await plugin.setup(context);

    expect(ipcHandlers.size).toBe(0);
    expect(publishedStatuses.length).toBe(0);
  });

  it('registers handlers and publishes initial state on setup', async () => {
    const { context, ipcHandlers, commandHandlers, publishedStatuses } = createMockContext();
    const plugin = createSoakPlugin({ isPackagedFn: () => false, seedGenerator: () => 42 });

    await plugin.setup(context);

    expect(ipcHandlers.has('status')).toBe(true);
    expect(ipcHandlers.has('report')).toBe(true);
    expect(ipcHandlers.has('stop')).toBe(true);
    expect(commandHandlers.has('status')).toBe(true);
    expect(commandHandlers.has('report')).toBe(true);
    expect(commandHandlers.has('stop')).toBe(true);

    const initial = publishedStatuses[0] as SoakState;
    expect(initial.running).toBe(true);
    expect(initial.seed).toBe(42);
    expect(initial.actionCount).toBe(0);

    await plugin.teardown?.();
  });

  it('executes actions and writes report on teardown', async () => {
    vi.useFakeTimers();
    try {
      const { window, executeMock } = createMockWindow();
      const windows: WindowHandle<BrowserWindow>[] = [{ id: 'win-main', native: window }];
      const writer = new MemoryReportWriter();
      const { context } = createMockContext({ intervalMs: 100 }, windows);
      const plugin = createSoakPlugin({
        isPackagedFn: () => false,
        reportWriter: writer,
        seedGenerator: () => 7,
      });

      await plugin.setup(context);
      vi.advanceTimersByTime(250);

      expect(executeMock).toHaveBeenCalled();
      await plugin.teardown?.();

      const lastReport = writer.getLastReport() as SoakReport;
      expect(lastReport).toBeDefined();
      expect(lastReport.seed).toBe(7);
      expect(lastReport.completedActions).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops automatically when maxActions limit is reached', async () => {
    vi.useFakeTimers();
    try {
      const { window } = createMockWindow();
      const windows: WindowHandle<BrowserWindow>[] = [{ id: 'win-main', native: window }];
      const writer = new MemoryReportWriter();
      const { context, commandHandlers } = createMockContext(
        { intervalMs: 50, maxActions: 2 },
        windows
      );
      const plugin = createSoakPlugin({
        isPackagedFn: () => false,
        reportWriter: writer,
        seedGenerator: () => 1,
      });

      await plugin.setup(context);
      vi.advanceTimersByTime(200);

      const status = commandHandlers.get('status')!() as SoakState;
      expect(status.running).toBe(false);
      expect(status.actionCount).toBe(2);

      await plugin.teardown?.();
    } finally {
      vi.useRealTimers();
    }
  });
});
