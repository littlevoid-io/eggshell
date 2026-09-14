import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { createDashboardPlugin, PLUGIN_ID } from './plugin.js';
import type { ShellContext, WindowRegistry } from '../../plugin-api/types.js';
import { noopLogger } from '../../logging/logger.js';
import type { DashboardServer } from './server.js';
import type { DashboardStatusData } from './types.js';

function createMockContext(config: unknown = {}): {
  context: ShellContext<BrowserWindow>;
  publishedStatuses: unknown[];
} {
  const publishedStatuses: unknown[] = [];

  const windows: WindowRegistry<BrowserWindow> = {
    get: () => undefined,
    list: () => [],
  };

  const context: ShellContext<BrowserWindow> = {
    windows,
    ipc: { handle: () => {} },
    commands: { register: () => {} },
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
  };

  return { context, publishedStatuses };
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

  it('starts server and publishes status on setup, stops on teardown', async () => {
    const { context, publishedStatuses } = createMockContext();
    const mockServer: DashboardServer = {
      start: vi.fn().mockResolvedValue(3005),
      stop: vi.fn().mockResolvedValue(undefined),
    } as unknown as DashboardServer;

    const plugin = createDashboardPlugin({
      server: mockServer,
    });

    await plugin.setup(context);
    expect(mockServer.start).toHaveBeenCalledTimes(1);
    expect(publishedStatuses.length).toBe(1);

    const published = publishedStatuses[0] as DashboardStatusData;
    expect(published.appId).toBe('eggshell');

    await plugin.teardown?.();
    expect(mockServer.stop).toHaveBeenCalledTimes(1);
  });
});
