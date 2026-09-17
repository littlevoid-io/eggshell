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
}

function reloadManagedWindow({ window }: ManagedWindow): void {
  if (!window.isDestroyed()) {
    window.webContents.reload();
  }
}

function restoreAndTop(window: ManagedWindow['window']): boolean {
  if (window.isMinimized()) {
    window.restore();
  }
  const wasAlwaysOnTop = window.isAlwaysOnTop();
  window.show();
  window.setAlwaysOnTop(true);
  window.moveTop();
  return wasAlwaysOnTop;
}

function focusManagedWindow({ window }: ManagedWindow): void {
  if (window.isDestroyed()) {
    return;
  }
  const wasAlwaysOnTop = restoreAndTop(window);
  window.focus();
  if (!wasAlwaysOnTop) {
    window.setAlwaysOnTop(false);
  }
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
    focusWindows: () => {
      sources.focusApp?.();
      sources.windows.forEach(focusManagedWindow);
    },
    recalculateLayout: () => sources.recalculateLayout(),
    setOffline: showing => setOverlayVisibility(sources.offline, showing),
    setCompanion: showing => setOverlayVisibility(sources.companion, showing),
    restart: () => sources.relaunch(),
    quit: () => sources.quit(),
  };
}
