import { app, screen } from 'electron';
import type { ResolvedApp } from '../config/resolved.js';
import type { LogBroadcast } from '../logging/broadcast.js';
import type { Logger } from '../logging/logger.js';
import type { ProcessStatus } from '../process/supervisor.js';
import type { ShellOverlays } from './bootstrap.js';
import { createDashboard, type Dashboard } from './dashboard/index.js';
import type { SoakState } from './soak/types.js';
import type { ManagedWindow } from './windows/create.js';
import { toDisplaySnapshots } from './windows/displays.js';

function buildDashboardStatus(options: DashboardSetupOptions) {
  return {
    resolved: options.resolved,
    windows: options.windows,
    displays: () => toDisplaySnapshots(screen),
    processes: options.processes,
    offline: options.overlays.offline,
    companion: options.overlays.companion,
    soak: options.getSoak,
  };
}

function buildDashboardActions(
  windows: readonly ManagedWindow[],
  overlays: ShellOverlays,
  recalculateLayout: () => void
) {
  return {
    windows,
    offline: overlays.offline,
    companion: overlays.companion,
    recalculateLayout,
    relaunch: () => {
      app.relaunch();
      app.quit();
    },
    quit: () => app.quit(),
  };
}

export interface DashboardSetupOptions {
  readonly resolved: ResolvedApp;
  readonly windows: readonly ManagedWindow[];
  readonly overlays: ShellOverlays;
  readonly recalculateLayout: () => void;
  readonly processes: () => readonly ProcessStatus[];
  readonly uiDirectory: string;
  readonly logs: LogBroadcast;
  readonly logger: Logger;
  readonly getSoak?: () => SoakState | undefined;
}

function buildDashboardInputs(options: DashboardSetupOptions) {
  return {
    status: buildDashboardStatus(options),
    actions: buildDashboardActions(options.windows, options.overlays, options.recalculateLayout),
  };
}

function createShellDashboardInstance(options: DashboardSetupOptions) {
  const { status, actions } = buildDashboardInputs(options);
  return createDashboard({
    config: options.resolved.config.dashboard,
    uiDirectory: options.uiDirectory,
    status,
    actions,
    logs: options.logs,
    logger: options.logger,
  });
}

export function startShellDashboard(options: DashboardSetupOptions): Dashboard {
  const dashboard = createShellDashboardInstance(options);
  void dashboard.start();
  return dashboard;
}
