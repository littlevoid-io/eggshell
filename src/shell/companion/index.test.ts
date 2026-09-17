import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, WebContents } from 'electron';
import type { ResolvedApp } from '../../config/resolved.js';
import type { CompanionConfig } from '../../config/types.js';
import { shellConfigSchema } from '../../config/schema/index.js';
import { noopLogger } from '../../logging/logger.js';
import type { IpcHandler, IpcRouter } from '../ipc.js';
import type { OverlayView } from '../overlay-view.js';
import type { ManagedWindow } from '../windows/create.js';
import { createCompanionOverlay, type CompanionStatus } from './index.js';

function createOverlaySpy(): OverlayView & { showCalls: number; hideCalls: number } {
  let isVisible = false;
  let showCalls = 0;
  let hideCalls = 0;
  return {
    get visible() {
      return isVisible;
    },
    get webContents() {
      return {} as WebContents;
    },
    get window() {
      return {} as BrowserWindow;
    },
    get showCalls() {
      return showCalls;
    },
    get hideCalls() {
      return hideCalls;
    },
    show: () => {
      isVisible = true;
      showCalls++;
    },
    hide: () => {
      isVisible = false;
      hideCalls++;
    },
    destroy: () => {},
  };
}

function createMockRouter(): IpcRouter & { handlers: Map<string, IpcHandler> } {
  const handlers = new Map<string, IpcHandler>();
  return {
    handlers,
    handle: (channel, handler) => {
      handlers.set(channel, handler);
    },
    channels: () => Array.from(handlers.keys()),
    attach: () => {},
  };
}

function createMockResolved(): ResolvedApp {
  const userData = path.resolve('userData');
  return {
    appDir: path.resolve('appDir'),
    userData,
    isDev: true,
    config: shellConfigSchema.parse({
      appId: 'com.example.app',
      productName: 'Kiosk Product',
      version: '1.2.3',
      windows: [{ id: 'main', url: 'http://localhost:3000' }],
      logging: {
        level: 'info',
        file: { enabled: true, directory: 'logs', maxSize: '10m', maxFiles: 5 },
      },
      companion: { enabled: true, port: 3005, path: '/' },
    }),
  };
}

describe('createCompanionOverlay', () => {
  it('returns status containing built url, title defaulting to productName, and QR data URL', async () => {
    const overlaySpy = createOverlaySpy();
    const attach = vi.fn().mockReturnValue(overlaySpy);
    const router = createMockRouter();
    const openFolder = vi.fn().mockResolvedValue('');
    const resolved = createMockResolved();
    const config: CompanionConfig = {
      enabled: true,
      url: 'http://192.168.1.100:3005/',
      port: 3005,
      path: '/',
    };
    const windows: ManagedWindow[] = [{ id: 'main', window: {} as BrowserWindow }];

    createCompanionOverlay({
      config,
      resolved,
      windows,
      attach,
      router,
      openFolder,
      logger: noopLogger,
    });

    const statusHandler = router.handlers.get('companion:status');
    expect(statusHandler).toBeDefined();

    const status = (await statusHandler?.(
      { windowId: 'main', sender: {} as WebContents },
      {}
    )) as CompanionStatus;

    expect(status.url).toBe('http://192.168.1.100:3005/');
    expect(status.title).toBe('Kiosk Product');
    expect(status.description).toBe('Scan to connect to this kiosk');
    expect(status.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(status.logDirectory).toBe(path.resolve(resolved.userData, 'logs'));
  });

  it('calls openFolder with log directory on companion:open-logs IPC', async () => {
    const overlaySpy = createOverlaySpy();
    const attach = vi.fn().mockReturnValue(overlaySpy);
    const router = createMockRouter();
    const openFolder = vi.fn().mockResolvedValue('');
    const resolved = createMockResolved();
    const config: CompanionConfig = {
      enabled: true,
      port: 3005,
      path: '/',
    };

    createCompanionOverlay({
      config,
      resolved,
      windows: [{ id: 'main', window: {} as BrowserWindow }],
      attach,
      router,
      openFolder,
      logger: noopLogger,
    });

    const openLogsHandler = router.handlers.get('companion:open-logs');
    expect(openLogsHandler).toBeDefined();
    await openLogsHandler?.({ windowId: 'main', sender: {} as WebContents });
    expect(openFolder).toHaveBeenCalledWith(path.resolve(resolved.userData, 'logs'));
  });

  it('toggles overlay visibility and dismisses on companion:dismiss IPC', () => {
    const overlaySpy = createOverlaySpy();
    const attach = vi.fn().mockReturnValue(overlaySpy);
    const router = createMockRouter();
    const openFolder = vi.fn().mockResolvedValue('');
    const resolved = createMockResolved();
    const config: CompanionConfig = {
      enabled: true,
      port: 3005,
      path: '/',
    };

    const overlay = createCompanionOverlay({
      config,
      resolved,
      windows: [{ id: 'main', window: {} as BrowserWindow }],
      attach,
      router,
      openFolder,
      logger: noopLogger,
    });

    expect(overlay.visible).toBe(false);
    overlay.toggle();
    expect(overlay.visible).toBe(true);
    overlay.toggle();
    expect(overlay.visible).toBe(false);

    overlay.setShowing(true);
    expect(overlay.visible).toBe(true);

    const dismissHandler = router.handlers.get('companion:dismiss');
    expect(dismissHandler).toBeDefined();
    dismissHandler?.({ windowId: 'main', sender: {} as WebContents });
    expect(overlay.visible).toBe(false);

    overlay.dispose();
  });

  it('returns no-op overlay and logs on toggle when config.enabled is false', () => {
    const attach = vi.fn();
    const router = createMockRouter();
    const openFolder = vi.fn();
    const resolved = createMockResolved();
    const infoSpy = vi.fn();
    const logger = { ...noopLogger, info: infoSpy };
    const config: CompanionConfig = {
      enabled: false,
      port: 3005,
      path: '/',
    };

    const overlay = createCompanionOverlay({
      config,
      resolved,
      windows: [{ id: 'main', window: {} as BrowserWindow }],
      attach,
      router,
      openFolder,
      logger,
    });

    expect(attach).not.toHaveBeenCalled();
    expect(router.handlers.size).toBe(0);
    expect(overlay.visible).toBe(false);
    overlay.toggle();
    expect(infoSpy).toHaveBeenCalledWith('companion overlay is disabled in config');
  });
});
