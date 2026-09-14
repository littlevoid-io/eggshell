/**
 * Dashboard status data and action builders (T4.2).
 */

import { screen, type BrowserWindow } from 'electron';
import type { ShellContext } from '../../plugin-api/types.js';
import type {
  DashboardActions,
  DashboardStatusData,
  DisplayStatusItem,
  WindowStatusItem,
} from './types.js';

export function createDashboardActions(context: ShellContext<BrowserWindow>): DashboardActions {
  return {
    reloadWindows: () => reloadAllWindows(context),
    focusWindows: () => focusAllWindows(context),
    toggleOffline: (show?: boolean) => toggleOfflineOverlay(context, show),
    toggleCompanion: (show?: boolean) => toggleCompanionOverlay(context, show),
  };
}

function reloadAllWindows(context: ShellContext<BrowserWindow>): void {
  for (const handle of context.windows.list()) {
    const win = handle.native;
    if (win && !win.isDestroyed()) {
      win.webContents.reload();
    }
  }
}

function focusAllWindows(context: ShellContext<BrowserWindow>): void {
  for (const handle of context.windows.list()) {
    const win = handle.native;
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  }
}

function toggleOfflineOverlay(context: ShellContext<BrowserWindow>, show?: boolean): void {
  try {
    const current = (context.status.read?.() as { isForcedShow?: boolean } | undefined);
    const target = show ?? !current?.isForcedShow;
    context.status.publish({ isForcedShow: target, isShowing: target });
  } catch {
    // Suppress if status bus is not available
  }
}

function toggleCompanionOverlay(context: ShellContext<BrowserWindow>, show?: boolean): void {
  try {
    const current = (context.status.read?.() as { companionShowing?: boolean } | undefined);
    const target = show ?? !current?.companionShowing;
    context.status.publish({ companionShowing: target });
  } catch {
    // Suppress if status bus is not available
  }
}

export function buildStatusData(context: ShellContext<BrowserWindow>): DashboardStatusData {
  const windows = extractWindowStatus(context);
  const displays = getDisplayInfo();
  const offlineStatus = (context.status.read?.() as {
    isShowing?: boolean;
    isForcedShow?: boolean;
  } | undefined);

  return {
    appId: 'eggshell',
    productName: 'Electron Shell',
    platform: process.platform,
    arch: process.arch,
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    displays,
    combinedBounds: { x: 0, y: 0, width: 1920, height: 1080 },
    windows,
    offlineOverlay: {
      enabled: true,
      isShowing: Boolean(offlineStatus?.isShowing),
      isForcedShow: Boolean(offlineStatus?.isForcedShow),
    },
    companionOverlay: {
      isShowing: false,
    },
  };
}

function extractWindowStatus(context: ShellContext<BrowserWindow>): WindowStatusItem[] {
  return context.windows.list().map(handle => {
    const win = handle.native;
    const isDestroyed = win ? win.isDestroyed() : true;
    return {
      id: handle.id,
      url: isDestroyed ? undefined : win?.webContents.getURL(),
      bounds: isDestroyed || !win ? null : win.getBounds(),
      isDestroyed,
    };
  });
}

function getDisplayInfo(): DisplayStatusItem[] {
  try {
    return screen.getAllDisplays().map(d => ({
      id: d.id,
      label: d.label,
      bounds: d.bounds,
      touchSupport: d.touchSupport,
    }));
  } catch {
    return [];
  }
}
