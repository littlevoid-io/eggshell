import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express, { json } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DashboardConfig } from '../../config/types.js';
import { createLogBroadcast, type LogBroadcast } from '../../logging/broadcast.js';
import { createDashboardRouter } from './router.js';
import type { DashboardActions, DashboardStatus } from './types.js';

const dummyStatus: DashboardStatus = {
  appId: 'test-app',
  productName: 'Test App',
  version: '1.0.0',
  isDev: true,
  platform: 'win32',
  arch: 'x64',
  uptimeSeconds: 123,
  memory: { rss: 100, heapUsed: 50 },
  displays: [],
  windows: [],
  processes: [],
  overlays: {
    offline: {
      isOnline: true,
      isShowing: false,
      isForcedShow: false,
      isDismissedByUser: false,
      offlineStart: null,
    },
    companion: { visible: false },
  },
};

describe('dashboard router', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>(resolve => server!.close(() => resolve()));
      server = undefined;
    }
  });

  async function startTestServer(options: {
    config?: Partial<DashboardConfig>;
    actions?: Partial<DashboardActions>;
    logs?: LogBroadcast;
  }) {
    const fullActions: DashboardActions = {
      reloadWindows: vi.fn(),
      focusWindows: vi.fn(),
      recalculateLayout: vi.fn(),
      setOffline: vi.fn(),
      setCompanion: vi.fn(),
      restart: vi.fn(),
      quit: vi.fn(),
      ...options.actions,
    };
    const logs = options.logs ?? createLogBroadcast(100);
    const config: DashboardConfig = {
      enabled: true,
      port: 0,
      host: '127.0.0.1',
      allowRestart: true,
      allowQuit: true,
      logBufferSize: 500,
      ...options.config,
    };
    const router = createDashboardRouter({
      config,
      getStatus: () => dummyStatus,
      actions: fullActions,
      logs,
    });
    const app = express();
    app.use(json());
    app.use(router);
    await new Promise<void>(resolve => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const port = (server!.address() as AddressInfo).port;
    return {
      baseUrl: `http://127.0.0.1:${port}`,
      actions: fullActions,
      logs,
    };
  }

  it('asserts GET /status returns the stub status', async () => {
    const { baseUrl } = await startTestServer({});
    const response = await fetch(`${baseUrl}/status`);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toEqual(dummyStatus);
  });

  it('POST /restart returns 403 when allowRestart is false and calls the action when true', async () => {
    const disabled = await startTestServer({ config: { allowRestart: false } });
    const responseDisabled = await fetch(`${disabled.baseUrl}/restart`, { method: 'POST' });
    expect(responseDisabled.status).toBe(403);
    expect(disabled.actions.restart).not.toHaveBeenCalled();

    await new Promise<void>(resolve => server!.close(() => resolve()));
    server = undefined;

    const enabled = await startTestServer({ config: { allowRestart: true } });
    const responseEnabled = await fetch(`${enabled.baseUrl}/restart`, { method: 'POST' });
    expect(responseEnabled.status).toBe(200);
    expect(await responseEnabled.json()).toEqual({ success: true });
    expect(enabled.actions.restart).toHaveBeenCalledTimes(1);
  });

  it('POST /toggle-offline with {show:false} calls setOffline(false)', async () => {
    const { baseUrl, actions } = await startTestServer({});
    const response = await fetch(`${baseUrl}/toggle-offline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ show: false }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(actions.setOffline).toHaveBeenCalledWith(false);
  });

  it('asserts GET /logs returns recent lines', async () => {
    const logs = createLogBroadcast(100);
    logs.write('first log\nsecond log\n');
    const { baseUrl } = await startTestServer({ logs });

    const response = await fetch(`${baseUrl}/logs`);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toEqual({ lines: ['first log', 'second log'] });
  });
});
