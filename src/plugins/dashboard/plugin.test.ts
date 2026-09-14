import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { createDashboardPlugin, PLUGIN_ID } from './plugin.js';
import type { CommandHandler, ShellContext, WindowRegistry } from '../../plugin-api/types.js';
import { noopLogger } from '../../logging/logger.js';
import type { DashboardServer } from './server.js';
import type { DashboardStatus } from './types.js';

function createMockContext(config: unknown = {}): {
  context: ShellContext<BrowserWindow>;
  commands: Map<string, CommandHandler>;
  publishedStatuses: unknown[];
} {
  const commands = new Map<string, CommandHandler>();
  const publishedStatuses: unknown[] = [];

  const windows: WindowRegistry<BrowserWindow> = {
    get: () => undefined,
    list: () => [],
  };

  const context: ShellContext<BrowserWindow> = {
    windows,
    ipc: { handle: () => {} },
    commands: {
      register: (name, handler) => {
        commands.set(name, handler);
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

  return { context, commands, publishedStatuses };
}

describe('dashboard plugin (T4.2)', () => {
  it('identifies as PLUGIN_ID "dashboard"', () => {
    const plugin = createDashboardPlugin();
    expect(plugin.id).toBe(PLUGIN_ID);
  });

  it('skips setup when disabled by config', async () => {
    const { context, publishedStatuses } = createMockContext({ enabled: false });
    const plugin = createDashboardPlugin();

    await plugin.setup(context);
    expect(publishedStatuses.length).toBe(0);
  });

  it('starts server, registers commands, and publishes status on setup', async () => {
    const { context, commands, publishedStatuses } = createMockContext();
    const mockServer: DashboardServer = {
      start: vi.fn().mockResolvedValue(3005),
      stop: vi.fn().mockResolvedValue(undefined),
    } as unknown as DashboardServer;

    const plugin = createDashboardPlugin({ server: mockServer });
    await plugin.setup(context);

    expect(mockServer.start).toHaveBeenCalledTimes(1);
    expect(commands.has('status')).toBe(true);
    expect(commands.has('reload-windows')).toBe(true);
    expect(commands.has('focus-windows')).toBe(true);
    expect(publishedStatuses.length).toBe(1);

    const published = publishedStatuses[0] as DashboardStatus;
    expect(published.appId).toBe('eggshell');

    await plugin.teardown?.();
    expect(mockServer.stop).toHaveBeenCalledTimes(1);
  });
});
