import { app, screen } from 'electron';
import type { ResolvedApp } from '../config/resolved.js';
import type { LogBroadcast } from '../logging/broadcast.js';
import type { Logger } from '../logging/logger.js';
import { resolvePackageAsset, resolveRoots } from '../paths/roots.js';
import type { ShellOverlays } from './bootstrap.js';
import { createDashboard, type Dashboard } from './dashboard/index.js';
import type { SoakState } from './soak/types.js';
import type { ManagedWindow } from './windows/create.js';
import { toDisplaySnapshots } from './windows/displays.js';

function buildDashboardStatus(
  resolvedApp: ResolvedApp,
  windows: readonly ManagedWindow[],
  overlays: ShellOverlays,
  getSoak?: () => SoakState | undefined
) {
  return {
    resolved: resolvedApp,
    windows,
    displays: () => toDisplaySnapshots(screen),
    processes: () => [],
    offline: overlays.offline,
    companion: overlays.companion,
    soak: getSoak,
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
  readonly logs: LogBroadcast;
  readonly logger: Logger;
  readonly getSoak?: () => SoakState | undefined;
}

function resolveUiDirectory(resolved: ResolvedApp): string {
  const roots = resolveRoots({ projectRoot: resolved.appDir, userDataRoot: resolved.userData });
  return resolvePackageAsset(roots, 'dist/dashboard-ui');
}

function buildDashboardInputs(options: DashboardSetupOptions) {
  return {
    status: buildDashboardStatus(
      options.resolved,
      options.windows,
      options.overlays,
      options.getSoak
    ),
    actions: buildDashboardActions(options.windows, options.overlays, options.recalculateLayout),
  };
}

function createShellDashboardInstance(options: DashboardSetupOptions) {
  const { status, actions } = buildDashboardInputs(options);
  return createDashboard({
    config: options.resolved.config.dashboard,
    uiDirectory: resolveUiDirectory(options.resolved),
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
