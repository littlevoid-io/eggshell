/**
 * Status data and action builders for the dashboard plugin (T4.2).
 */

import type { BrowserWindow } from 'electron';
import type { ShellContext } from '../../plugin-api/types.js';
import type {
  DashboardActions,
  DashboardStatus,
  WindowSummary,
} from './types.js';

export function buildDashboardStatus(context: ShellContext<BrowserWindow>): DashboardStatus {
  const mem = process.memoryUsage();
  const windows = extractWindowSummaries(context);
  const busData = context.status.read?.() as Record<string, unknown> | undefined;

  return {
    appId: 'eggshell',
    platform: process.platform,
    arch: process.arch,
    uptimeSeconds: Math.floor(process.uptime()),
    memoryUsage: {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
    },
    windows,
    statusBus: busData ?? {},
  };
}

export function createDashboardActions(context: ShellContext<BrowserWindow>): DashboardActions {
  return {
    reloadWindows: () => reloadAllWindows(context),
    focusWindows: () => focusAllWindows(context),
  };
}

function extractWindowSummaries(context: ShellContext<BrowserWindow>): WindowSummary[] {
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
