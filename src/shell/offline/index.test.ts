import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, WebContents } from 'electron';
import { createFakeClock } from '../../__testing__/fake-clock.js';
import type { OfflineConfig } from '../../config/types.js';
import { noopLogger } from '../../logging/logger.js';
import type { IpcHandler, IpcRouter } from '../ipc.js';
import type { OverlayView } from '../overlay-view.js';
import type { ManagedWindow } from '../windows/create.js';
import { createOfflineOverlay } from './index.js';

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

describe('createOfflineOverlay', () => {
  it('shows view after two offline results spanning timeoutMs and hides when back online', async () => {
    const clock = createFakeClock();
    const overlaySpy = createOverlaySpy();
    const attach = vi.fn().mockReturnValue(overlaySpy);
    const router = createMockRouter();
    let online = false;
    const probe = vi.fn().mockImplementation(async () => online);

    const config: OfflineConfig = {
      enabled: true,
      timeoutMs: 5000,
      pollIntervalMs: 5000,
    };
    const windows: ManagedWindow[] = [{ id: 'main', window: {} as BrowserWindow }];

    const overlay = createOfflineOverlay({
      config,
      windows,
      attach,
      probe,
      router,
      clock,
      logger: noopLogger,
    });

    expect(attach).toHaveBeenCalledTimes(1);
    expect(overlaySpy.visible).toBe(false);

    // First offline probe at t=5000
    clock.advance(5000);
    await Promise.resolve();
    expect(overlaySpy.visible).toBe(false);

    // Second offline probe at t=10000 (now - start = 5000 >= timeoutMs)
    clock.advance(5000);
    await Promise.resolve();
    expect(overlaySpy.visible).toBe(true);

    // Recovers online at t=15000
    online = true;
    clock.advance(5000);
    await Promise.resolve();
    expect(overlaySpy.visible).toBe(false);

    overlay.dispose();
  });

  it('hides view when offline:dismiss handler is invoked', async () => {
    const clock = createFakeClock();
    const overlaySpy = createOverlaySpy();
    const attach = vi.fn().mockReturnValue(overlaySpy);
    const router = createMockRouter();
    const probe = vi.fn().mockResolvedValue(true);

    const config: OfflineConfig = {
      enabled: true,
      timeoutMs: 5000,
      pollIntervalMs: 5000,
    };
    const windows: ManagedWindow[] = [{ id: 'main', window: {} as BrowserWindow }];

    const overlay = createOfflineOverlay({
      config,
      windows,
      attach,
      probe,
      router,
      clock,
      logger: noopLogger,
    });

    overlay.setShowing(true);
    expect(overlaySpy.visible).toBe(true);

    const dismissHandler = router.handlers.get('offline:dismiss');
    expect(dismissHandler).toBeDefined();
    dismissHandler?.({ windowId: 'main', sender: {} as WebContents });
    expect(overlaySpy.visible).toBe(false);

    overlay.dispose();
  });

  it('attaches nothing when config.enabled is false', () => {
    const clock = createFakeClock();
    const attach = vi.fn();
    const router = createMockRouter();
    const probe = vi.fn().mockResolvedValue(true);

    const config: OfflineConfig = {
      enabled: false,
      timeoutMs: 5000,
      pollIntervalMs: 5000,
    };

    const overlay = createOfflineOverlay({
      config,
      windows: [{ id: 'main', window: {} as BrowserWindow }],
      attach,
      probe,
      router,
      clock,
      logger: noopLogger,
    });

    expect(attach).not.toHaveBeenCalled();
    expect(router.handlers.size).toBe(0);
    expect(overlay.status().isShowing).toBe(false);
  });
});
