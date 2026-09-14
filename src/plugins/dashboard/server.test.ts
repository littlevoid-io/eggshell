import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardServer } from './server.js';
import { DashboardLogStore } from './logger.js';
import type { DashboardActions, DashboardConfig, DashboardStatusData } from './types.js';

function createDummyStatusData(): DashboardStatusData {
  return {
    appId: 'eggshell',
    productName: 'Electron Shell',
    platform: 'win32',
    arch: 'x64',
    uptime: 42,
    memory: { rss: 1000, heapTotal: 500, heapUsed: 300 },
    displays: [],
    combinedBounds: { x: 0, y: 0, width: 1920, height: 1080 },
    windows: [],
    offlineOverlay: { enabled: true, isShowing: false, isForcedShow: false },
    companionOverlay: { isShowing: false },
  };
}

describe('DashboardServer (T4.2)', () => {
  let activeServer: DashboardServer | null = null;

  afterEach(async () => {
    if (activeServer) {
      await activeServer.stop();
      activeServer = null;
    }
  });

  it('serves status data on GET /api/status', async () => {
    const config: DashboardConfig = {
      enabled: true,
      port: 0,
      host: '127.0.0.1',
      allowRestart: false,
    };
    const logStore = new DashboardLogStore();
    const actions: DashboardActions = {
      reloadWindows: vi.fn(),
      focusWindows: vi.fn(),
      toggleOffline: vi.fn(),
      toggleCompanion: vi.fn(),
    };

    activeServer = new DashboardServer({
      config,
      getStatusData: createDummyStatusData,
      actions,
      logStore,
      assetsPath: 'nonexistent-assets-path',
    });

    const port = await activeServer.start();
    const response = await fetch(`http://127.0.0.1:${port}/api/status`);
    expect(response.status).toBe(200);

    const data = (await response.json()) as DashboardStatusData;
    expect(data.appId).toBe('eggshell');
    expect(data.uptime).toBe(42);
  });

  it('triggers action on POST /api/reload-windows', async () => {
    const config: DashboardConfig = {
      enabled: true,
      port: 0,
      host: '127.0.0.1',
      allowRestart: false,
    };
    const reloadFn = vi.fn();
    activeServer = new DashboardServer({
      config,
      getStatusData: createDummyStatusData,
      actions: {
        reloadWindows: reloadFn,
        focusWindows: vi.fn(),
        toggleOffline: vi.fn(),
        toggleCompanion: vi.fn(),
      },
      logStore: new DashboardLogStore(),
      assetsPath: 'nonexistent-assets-path',
    });

    const port = await activeServer.start();
    const response = await fetch(`http://127.0.0.1:${port}/api/reload-windows`, {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    expect(reloadFn).toHaveBeenCalledTimes(1);
  });

  it('requires token when token is configured', async () => {
    const config: DashboardConfig = {
      enabled: true,
      port: 0,
      host: '127.0.0.1',
      token: 'test-secret',
      allowRestart: false,
    };
    activeServer = new DashboardServer({
      config,
      getStatusData: createDummyStatusData,
      actions: {
        reloadWindows: vi.fn(),
        focusWindows: vi.fn(),
        toggleOffline: vi.fn(),
        toggleCompanion: vi.fn(),
      },
      logStore: new DashboardLogStore(),
      assetsPath: 'nonexistent-assets-path',
    });

    const port = await activeServer.start();
    const unauthResponse = await fetch(`http://127.0.0.1:${port}/api/status`);
    expect(unauthResponse.status).toBe(401);

    const authResponse = await fetch(`http://127.0.0.1:${port}/api/status`, {
      headers: { Authorization: 'Bearer test-secret' },
    });
    expect(authResponse.status).toBe(200);
  });
});
