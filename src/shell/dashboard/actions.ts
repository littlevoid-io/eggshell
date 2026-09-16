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
}

function reloadManagedWindow({ window }: ManagedWindow): void {
  if (!window.isDestroyed()) {
    window.webContents.reload();
  }
}

function focusManagedWindow({ window }: ManagedWindow): void {
  if (window.isDestroyed()) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
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
    focusWindows: () => sources.windows.forEach(focusManagedWindow),
    recalculateLayout: () => sources.recalculateLayout(),
    setOffline: showing => setOverlayVisibility(sources.offline, showing),
    setCompanion: showing => setOverlayVisibility(sources.companion, showing),
    restart: () => sources.relaunch(),
    quit: () => sources.quit(),
  };
}
