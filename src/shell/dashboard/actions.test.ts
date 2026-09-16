import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, WebContents } from 'electron';
import type { CompanionOverlay } from '../companion/index.js';
import type { OfflineOverlay } from '../offline/index.js';
import type { ManagedWindow } from '../windows/create.js';
import { createActions } from './actions.js';

interface FakeWindowOptions {
  destroyed?: boolean;
  minimized?: boolean;
}

function createFakeWindow(options: FakeWindowOptions = {}) {
  const reloadFn = vi.fn();
  const focusFn = vi.fn();
  const showFn = vi.fn();
  const restoreFn = vi.fn();
  const isMinimizedFn = vi.fn().mockReturnValue(options.minimized ?? false);
  const isDestroyedFn = vi.fn().mockReturnValue(options.destroyed ?? false);

  const window = {
    isDestroyed: isDestroyedFn,
    isMinimized: isMinimizedFn,
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

  it('focuses non-destroyed windows and restores if minimized', () => {
    const minimized = createFakeWindow({ destroyed: false, minimized: true });
    const normal = createFakeWindow({ destroyed: false, minimized: false });
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
    });

    actions.focusWindows();
    expect(minimized.restoreFn).toHaveBeenCalledTimes(1);
    expect(minimized.showFn).toHaveBeenCalledTimes(1);
    expect(minimized.focusFn).toHaveBeenCalledTimes(1);

    expect(normal.restoreFn).not.toHaveBeenCalled();
    expect(normal.showFn).toHaveBeenCalledTimes(1);
    expect(normal.focusFn).toHaveBeenCalledTimes(1);

    expect(destroyed.restoreFn).not.toHaveBeenCalled();
    expect(destroyed.showFn).not.toHaveBeenCalled();
    expect(destroyed.focusFn).not.toHaveBeenCalled();
  });

  it('delegates recalculateLayout, restart, and quit', () => {
    const recalculateLayout = vi.fn();
    const relaunch = vi.fn();
    const quit = vi.fn();

    const actions = createActions({
      windows: [],
      offline: { toggle: vi.fn(), setShowing: vi.fn() } as unknown as OfflineOverlay,
      companion: { toggle: vi.fn(), setShowing: vi.fn() } as unknown as CompanionOverlay,
      recalculateLayout,
      relaunch,
      quit,
    });

    actions.recalculateLayout();
    expect(recalculateLayout).toHaveBeenCalledTimes(1);

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
