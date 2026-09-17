import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, WebContents } from 'electron';
import { createFakeClock } from '../../__testing__/fake-clock.js';
import type { CompanionOverlay } from '../companion/index.js';
import type { OfflineOverlay } from '../offline/index.js';
import type { ManagedWindow } from '../windows/create.js';
import { createActions } from './actions.js';

interface FakeWindowOptions {
  destroyed?: boolean;
  minimized?: boolean;
  alwaysOnTop?: boolean;
}

function createFakeWindow(options: FakeWindowOptions = {}) {
  const reloadFn = vi.fn();
  const focusFn = vi.fn();
  const showFn = vi.fn();
  const restoreFn = vi.fn();
  const moveTopFn = vi.fn();
  const setAlwaysOnTopFn = vi.fn();
  const isAlwaysOnTopFn = vi.fn().mockReturnValue(options.alwaysOnTop ?? false);
  const isMinimizedFn = vi.fn().mockReturnValue(options.minimized ?? false);
  const isDestroyedFn = vi.fn().mockReturnValue(options.destroyed ?? false);

  const window = {
    isDestroyed: isDestroyedFn,
    isMinimized: isMinimizedFn,
    isAlwaysOnTop: isAlwaysOnTopFn,
    setAlwaysOnTop: setAlwaysOnTopFn,
    moveTop: moveTopFn,
    restore: restoreFn,
    show: showFn,
    focus: focusFn,
    webContents: {
      reload: reloadFn,
    } as unknown as WebContents,
  } as unknown as BrowserWindow;

  return {
    window,
    reloadFn,
    focusFn,
    showFn,
    restoreFn,
    moveTopFn,
    setAlwaysOnTopFn,
    isAlwaysOnTopFn,
    isMinimizedFn,
    isDestroyedFn,
  };
}

describe('dashboard actions', () => {
  it('reloads webContents only on non-destroyed windows', () => {
    const active = createFakeWindow({ destroyed: false });
    const destroyed = createFakeWindow({ destroyed: true });
    const windows: readonly ManagedWindow[] = [
      { id: 'active', window: active.window },
      { id: 'destroyed', window: destroyed.window },
    ];

    const actions = createActions({
      windows,
      offline: { toggle: vi.fn(), setShowing: vi.fn() } as unknown as OfflineOverlay,
      companion: { toggle: vi.fn(), setShowing: vi.fn() } as unknown as CompanionOverlay,
      recalculateLayout: vi.fn(),
      relaunch: vi.fn(),
      quit: vi.fn(),
    });

    actions.reloadWindows();
    expect(active.reloadFn).toHaveBeenCalledTimes(1);
    expect(destroyed.reloadFn).not.toHaveBeenCalled();
  });

  it('focuses non-destroyed windows, restores if minimized, and elevates z-order', () => {
    const clock = createFakeClock();
    const focusApp = vi.fn();
    const minimized = createFakeWindow({ destroyed: false, minimized: true, alwaysOnTop: false });
    const normal = createFakeWindow({ destroyed: false, minimized: false, alwaysOnTop: true });
    const destroyed = createFakeWindow({ destroyed: true, minimized: false });
    const windows: readonly ManagedWindow[] = [
      { id: 'minimized', window: minimized.window },
      { id: 'normal', window: normal.window },
      { id: 'destroyed', window: destroyed.window },
    ];

    const actions = createActions({
      windows,
      offline: { toggle: vi.fn(), setShowing: vi.fn() } as unknown as OfflineOverlay,
      companion: { toggle: vi.fn(), setShowing: vi.fn() } as unknown as CompanionOverlay,
      recalculateLayout: vi.fn(),
      relaunch: vi.fn(),
      quit: vi.fn(),
      focusApp,
      clock,
    });

    actions.focusWindows();
    expect(focusApp).toHaveBeenCalledTimes(1);

    expect(minimized.restoreFn).toHaveBeenCalledTimes(1);
    expect(minimized.showFn).toHaveBeenCalledTimes(1);
    expect(minimized.setAlwaysOnTopFn).toHaveBeenNthCalledWith(1, true);
    expect(minimized.moveTopFn).toHaveBeenCalledTimes(1);
    expect(minimized.focusFn).toHaveBeenCalledTimes(1);

    expect(normal.restoreFn).not.toHaveBeenCalled();
    expect(normal.showFn).toHaveBeenCalledTimes(1);
    expect(normal.setAlwaysOnTopFn).toHaveBeenCalledWith(true);
    expect(normal.setAlwaysOnTopFn).toHaveBeenCalledTimes(1);
    expect(normal.moveTopFn).toHaveBeenCalledTimes(1);
    expect(normal.focusFn).toHaveBeenCalledTimes(1);

    expect(destroyed.restoreFn).not.toHaveBeenCalled();
    expect(destroyed.showFn).not.toHaveBeenCalled();
    expect(destroyed.focusFn).not.toHaveBeenCalled();

    clock.advance(100);
    expect(minimized.setAlwaysOnTopFn).toHaveBeenNthCalledWith(2, false);
    expect(normal.setAlwaysOnTopFn).toHaveBeenCalledTimes(1);
  });

  it('debounces demotion across rapid focus requests so alwaysOnTop stays consistent', () => {
    const clock = createFakeClock();
    const normal = createFakeWindow({ destroyed: false, minimized: false, alwaysOnTop: false });
    const windows: readonly ManagedWindow[] = [{ id: 'normal', window: normal.window }];

    const actions = createActions({
      windows,
      offline: { toggle: vi.fn(), setShowing: vi.fn() } as unknown as OfflineOverlay,
      companion: { toggle: vi.fn(), setShowing: vi.fn() } as unknown as CompanionOverlay,
      recalculateLayout: vi.fn(),
      relaunch: vi.fn(),
      quit: vi.fn(),
      clock,
    });

    actions.focusWindows();
    expect(normal.setAlwaysOnTopFn).toHaveBeenNthCalledWith(1, true);

    clock.advance(50);
    normal.isAlwaysOnTopFn.mockReturnValue(true);

    actions.focusWindows();
    expect(normal.setAlwaysOnTopFn).toHaveBeenNthCalledWith(2, true);

    clock.advance(50);
    expect(normal.setAlwaysOnTopFn).toHaveBeenCalledTimes(2);

    clock.advance(50);
    expect(normal.setAlwaysOnTopFn).toHaveBeenNthCalledWith(3, false);
    expect(normal.setAlwaysOnTopFn).toHaveBeenCalledTimes(3);
  });

  it('delegates recalculateLayout and brings windows to front, restart, and quit', () => {
    const recalculateLayout = vi.fn();
    const relaunch = vi.fn();
    const quit = vi.fn();
    const focusApp = vi.fn();
    const normal = createFakeWindow({ destroyed: false, minimized: false });
    const windows: readonly ManagedWindow[] = [{ id: 'normal', window: normal.window }];

    const actions = createActions({
      windows,
      offline: { toggle: vi.fn(), setShowing: vi.fn() } as unknown as OfflineOverlay,
      companion: { toggle: vi.fn(), setShowing: vi.fn() } as unknown as CompanionOverlay,
      recalculateLayout,
      relaunch,
      quit,
      focusApp,
    });

    actions.recalculateLayout();
    expect(recalculateLayout).toHaveBeenCalledTimes(1);
    expect(focusApp).toHaveBeenCalledTimes(1);
    expect(normal.showFn).toHaveBeenCalledTimes(1);
    expect(normal.moveTopFn).toHaveBeenCalledTimes(1);
    expect(normal.focusFn).toHaveBeenCalledTimes(1);

    actions.restart();
    expect(relaunch).toHaveBeenCalledTimes(1);

    actions.quit();
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('handles offline and companion overlay visibility toggling and setting', () => {
    const offlineToggle = vi.fn();
    const offlineSetShowing = vi.fn();
    const companionToggle = vi.fn();
    const companionSetShowing = vi.fn();

    const actions = createActions({
      windows: [],
      offline: {
        toggle: offlineToggle,
        setShowing: offlineSetShowing,
      } as unknown as OfflineOverlay,
      companion: {
        toggle: companionToggle,
        setShowing: companionSetShowing,
      } as unknown as CompanionOverlay,
      recalculateLayout: vi.fn(),
      relaunch: vi.fn(),
      quit: vi.fn(),
    });

    actions.setOffline(undefined);
    expect(offlineToggle).toHaveBeenCalledTimes(1);
    actions.setOffline(true);
    expect(offlineSetShowing).toHaveBeenCalledWith(true);
    actions.setOffline(false);
    expect(offlineSetShowing).toHaveBeenCalledWith(false);

    actions.setCompanion(undefined);
    expect(companionToggle).toHaveBeenCalledTimes(1);
    actions.setCompanion(true);
    expect(companionSetShowing).toHaveBeenCalledWith(true);
    actions.setCompanion(false);
    expect(companionSetShowing).toHaveBeenCalledWith(false);
  });
});
