import type { Clock, TimerHandle } from '../../clock.js';
import { systemClock } from '../../clock.js';
import type { CompanionOverlay } from '../companion/index.js';
import type { OfflineOverlay } from '../offline/index.js';
import type { ManagedWindow } from '../windows/create.js';
import type { DashboardActions } from './types.js';

export interface ActionSources {
  readonly windows: readonly ManagedWindow[];
  readonly offline: OfflineOverlay;
  readonly companion: CompanionOverlay;
  readonly recalculateLayout: () => void;
  readonly relaunch: () => void;
  readonly quit: () => void;
  readonly focusApp?: (() => void) | undefined;
  readonly clock?: Clock | undefined;
}

const pendingDemotions = new WeakMap<ManagedWindow['window'], TimerHandle>();

function reloadManagedWindow({ window }: ManagedWindow): void {
  if (!window.isDestroyed()) {
    window.webContents.reload();
  }
}

function restoreAndTop(window: ManagedWindow['window']): boolean {
  if (window.isMinimized()) {
    window.restore();
  }
  const wasAlwaysOnTop = !pendingDemotions.has(window) && window.isAlwaysOnTop();
  window.show();
  window.setAlwaysOnTop(true);
  window.moveTop();
  return wasAlwaysOnTop;
}

function demoteTopmost(window: ManagedWindow['window']): void {
  pendingDemotions.delete(window);
  if (!window.isDestroyed()) {
    window.setAlwaysOnTop(false);
  }
}

function scheduleDemote(window: ManagedWindow['window'], clock: Clock): void {
  const existing = pendingDemotions.get(window);
  if (existing !== undefined) {
    clock.clearTimeout(existing);
  }
  pendingDemotions.set(
    window,
    clock.setTimeout(() => demoteTopmost(window), 100)
  );
}

function focusManagedWindow({ window }: ManagedWindow, clock: Clock): void {
  if (window.isDestroyed()) {
    return;
  }
  const wasAlwaysOnTop = restoreAndTop(window);
  window.focus();
  if (!wasAlwaysOnTop) {
    scheduleDemote(window, clock);
  }
}

function focusAllWindows(sources: ActionSources): void {
  const clock = sources.clock ?? systemClock;
  sources.focusApp?.();
  sources.windows.forEach(w => focusManagedWindow(w, clock));
}

function setOverlayVisibility(
  overlay: { toggle(): void; setShowing(showing: boolean): void },
  showing: boolean | undefined
): void {
  if (showing === undefined) {
    overlay.toggle();
    return;
  }
  overlay.setShowing(showing);
}

export function createActions(sources: ActionSources): DashboardActions {
  return {
    reloadWindows: () => sources.windows.forEach(reloadManagedWindow),
    focusWindows: () => focusAllWindows(sources),
    recalculateLayout: () => {
      sources.recalculateLayout();
      focusAllWindows(sources);
    },
    setOffline: showing => setOverlayVisibility(sources.offline, showing),
    setCompanion: showing => setOverlayVisibility(sources.companion, showing),
    restart: () => sources.relaunch(),
    quit: () => sources.quit(),
  };
}
