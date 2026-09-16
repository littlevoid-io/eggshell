import { describe, expect, it } from 'vitest';
import type { BrowserWindow, WebContents } from 'electron';
import type { ResolvedApp } from '../../config/resolved.js';
import type { CompanionOverlay } from '../companion/index.js';
import type { OfflineOverlay } from '../offline/index.js';
import type { ManagedWindow } from '../windows/create.js';
import { buildStatus } from './status.js';

describe('dashboard status', () => {
  it('constructs complete DashboardStatus snapshot from sources', () => {
    const activeWindow = {
      isDestroyed: () => false,
      getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
      webContents: {
        getURL: () => 'http://localhost:3000/main',
      } as unknown as WebContents,
    } as unknown as BrowserWindow;

    const destroyedWindow = {
      isDestroyed: () => true,
      getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
      webContents: {
        getURL: () => '',
      } as unknown as WebContents,
    } as unknown as BrowserWindow;

    const windows: readonly ManagedWindow[] = [
      { id: 'w1', window: activeWindow },
      { id: 'w2', window: destroyedWindow },
    ];

    const resolved = {
      config: {
        appId: 'com.test.app',
        productName: 'Test Exhibit',
        version: '2.1.0',
      },
      isDev: true,
    } as unknown as ResolvedApp;

    const status = buildStatus({
      resolved,
      windows,
      displays: () => [],
      processes: () => [],
      offline: {
        status: () => ({
          isOnline: true,
          isShowing: false,
          isForcedShow: false,
          isDismissedByUser: false,
          offlineStart: null,
        }),
      } as unknown as OfflineOverlay,
      companion: { visible: true } as unknown as CompanionOverlay,
    });

    expect(status.appId).toBe('com.test.app');
    expect(status.productName).toBe('Test Exhibit');
    expect(status.version).toBe('2.1.0');
    expect(status.isDev).toBe(true);
    expect(status.windows).toEqual([
      {
        id: 'w1',
        url: 'http://localhost:3000/main',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        isDestroyed: false,
      },
      { id: 'w2', url: undefined, bounds: null, isDestroyed: true },
    ]);
    expect(status.overlays.offline.isOnline).toBe(true);
    expect(status.overlays.companion.visible).toBe(true);
    expect(status.memory.rss).toBeGreaterThan(0);
    expect(status.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(status.soak).toBeUndefined();
  });

  it('includes soak state when source getter is provided', () => {
    const soakState = {
      running: true,
      seed: 42,
      actionCount: 10,
      crashCount: 0,
      errorCount: 1,
    };
    const status = buildStatus({
      resolved: {
        config: { appId: 'com.test.app', productName: 'Test Exhibit' },
      } as unknown as ResolvedApp,
      windows: [],
      displays: () => [],
      processes: () => [],
      offline: {
        status: () => ({
          isOnline: true,
          isShowing: false,
          isForcedShow: false,
          isDismissedByUser: false,
          offlineStart: null,
        }),
      } as unknown as OfflineOverlay,
      companion: { visible: false } as unknown as CompanionOverlay,
      soak: () => soakState,
    });
    expect(status.soak).toEqual(soakState);
  });
});
