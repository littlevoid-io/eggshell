import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { createDashboardRouter } from './router.js';
import type { DashboardActions, DashboardConfig, DashboardStatus } from './types.js';

function createDummyStatus(): DashboardStatus {
  return {
    appId: 'eggshell',
    platform: 'win32',
    arch: 'x64',
    uptimeSeconds: 100,
    memoryUsage: { rss: 10, heapTotal: 5, heapUsed: 3 },
    windows: [],
    statusBus: {},
  };
}

describe('createDashboardRouter (T4.2)', () => {
  it('handles GET /status', () => {
    const config: DashboardConfig = {
      enabled: true,
      port: 3005,
      host: '127.0.0.1',
      allowRestart: false,
      allowQuit: false,
    };
    const dummy = createDummyStatus();
    const router = createDashboardRouter({
      config,
      getStatus: () => dummy,
      actions: { reloadWindows: vi.fn(), focusWindows: vi.fn() },
    });

    const jsonFn = vi.fn();
    const req = { method: 'GET', url: '/status' } as unknown as Request;
    const res = { json: jsonFn } as unknown as Response;

    router(req, res, () => {});
    expect(jsonFn).toHaveBeenCalledWith(dummy);
  });

  it('triggers action on POST /reload-windows', () => {
    const reloadFn = vi.fn();
    const router = createDashboardRouter({
      config: { enabled: true, port: 3005, host: '127.0.0.1', allowRestart: false, allowQuit: false },
      getStatus: createDummyStatus,
      actions: { reloadWindows: reloadFn, focusWindows: vi.fn() },
    });

    const jsonFn = vi.fn();
    const req = { method: 'POST', url: '/reload-windows' } as unknown as Request;
    const res = { json: jsonFn } as unknown as Response;

    router(req, res, () => {});
    expect(reloadFn).toHaveBeenCalledTimes(1);
    expect(jsonFn).toHaveBeenCalledWith({ success: true });
  });

  it('gates POST /restart on allowRestart configuration', () => {
    const restartFn = vi.fn();
    const actions: DashboardActions = {
      reloadWindows: vi.fn(),
      focusWindows: vi.fn(),
      restart: restartFn,
    };

    const disabledRouter = createDashboardRouter({
      config: { enabled: true, port: 3005, host: '127.0.0.1', allowRestart: false, allowQuit: false },
      getStatus: createDummyStatus,
      actions,
    });
    const statusFn = vi.fn().mockReturnThis();
    const disabledJson = vi.fn();
    disabledRouter(
      { method: 'POST', url: '/restart' } as unknown as Request,
      { status: statusFn, json: disabledJson } as unknown as Response,
      () => {}
    );
    expect(statusFn).toHaveBeenCalledWith(403);
    expect(restartFn).not.toHaveBeenCalled();

    const enabledRouter = createDashboardRouter({
      config: { enabled: true, port: 3005, host: '127.0.0.1', allowRestart: true, allowQuit: false },
      getStatus: createDummyStatus,
      actions,
    });
    const enabledJson = vi.fn();
    enabledRouter(
      { method: 'POST', url: '/restart' } as unknown as Request,
      { json: enabledJson } as unknown as Response,
      () => {}
    );
    expect(enabledJson).toHaveBeenCalledWith({ success: true });
    expect(restartFn).toHaveBeenCalledTimes(1);
  });

  it('gates POST /quit on allowQuit configuration', () => {
    const quitFn = vi.fn();
    const actions: DashboardActions = {
      reloadWindows: vi.fn(),
      focusWindows: vi.fn(),
      quit: quitFn,
    };

    const disabledRouter = createDashboardRouter({
      config: { enabled: true, port: 3005, host: '127.0.0.1', allowRestart: false, allowQuit: false },
      getStatus: createDummyStatus,
      actions,
    });
    const statusFn = vi.fn().mockReturnThis();
    disabledRouter(
      { method: 'POST', url: '/quit' } as unknown as Request,
      { status: statusFn, json: vi.fn() } as unknown as Response,
      () => {}
    );
    expect(statusFn).toHaveBeenCalledWith(403);
    expect(quitFn).not.toHaveBeenCalled();

    const enabledRouter = createDashboardRouter({
      config: { enabled: true, port: 3005, host: '127.0.0.1', allowRestart: false, allowQuit: true },
      getStatus: createDummyStatus,
      actions,
    });
    const jsonFn = vi.fn();
    enabledRouter(
      { method: 'POST', url: '/quit' } as unknown as Request,
      { json: jsonFn } as unknown as Response,
      () => {}
    );
    expect(jsonFn).toHaveBeenCalledWith({ success: true });
    expect(quitFn).toHaveBeenCalledTimes(1);
  });
});
