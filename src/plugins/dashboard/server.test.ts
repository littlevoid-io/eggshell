import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DashboardServer } from './server.js';
import type { DashboardConfig, DashboardStatus } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const assetPath = path.resolve(__dirname, 'assets/dashboard.html');

function createDummyStatus(): DashboardStatus {
  return {
    appId: 'eggshell',
    platform: 'win32',
    arch: 'x64',
    uptimeSeconds: 42,
    memoryUsage: { rss: 100, heapTotal: 50, heapUsed: 25 },
    windows: [],
    statusBus: {},
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

  it('serves dashboard.html on root GET', async () => {
    const config: DashboardConfig = {
      enabled: true,
      port: 0,
      host: '127.0.0.1',
      allowRestart: false,
      allowQuit: false,
    };
    activeServer = new DashboardServer({
      config,
      getStatus: createDummyStatus,
      actions: { reloadWindows: vi.fn(), focusWindows: vi.fn() },
      assetPath,
    });

    const port = await activeServer.start();
    const response = await fetch(`http://127.0.0.1:${port}/`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Eggshell Remote Dashboard');
  });

  it('serves status data on GET /api/status', async () => {
    const config: DashboardConfig = {
      enabled: true,
      port: 0,
      host: '127.0.0.1',
      allowRestart: false,
      allowQuit: false,
    };
    activeServer = new DashboardServer({
      config,
      getStatus: createDummyStatus,
      actions: { reloadWindows: vi.fn(), focusWindows: vi.fn() },
      assetPath,
    });

    const port = await activeServer.start();
    const response = await fetch(`http://127.0.0.1:${port}/api/status`);
    expect(response.status).toBe(200);
    const data = (await response.json()) as DashboardStatus;
    expect(data.appId).toBe('eggshell');
    expect(data.uptimeSeconds).toBe(42);
  });

  it('rejects unauthenticated requests when token is configured', async () => {
    const config: DashboardConfig = {
      enabled: true,
      port: 0,
      host: '127.0.0.1',
      token: 'secure-token',
      allowRestart: false,
      allowQuit: false,
    };
    activeServer = new DashboardServer({
      config,
      getStatus: createDummyStatus,
      actions: { reloadWindows: vi.fn(), focusWindows: vi.fn() },
      assetPath,
    });

    const port = await activeServer.start();
    const unauthResponse = await fetch(`http://127.0.0.1:${port}/api/status`);
    expect(unauthResponse.status).toBe(401);

    const authResponse = await fetch(`http://127.0.0.1:${port}/api/status`, {
      headers: { Authorization: 'Bearer secure-token' },
    });
    expect(authResponse.status).toBe(200);
  });
});
