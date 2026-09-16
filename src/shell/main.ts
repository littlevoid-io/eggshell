import { app, ipcMain, screen, session } from 'electron';
import { readResolvedApp, type ResolvedApp } from '../config/resolved.js';
import { createLogBroadcast, type LogBroadcast } from '../logging/broadcast.js';
import type { Logger } from '../logging/logger.js';
import { resolvePackageAsset, resolveRoots } from '../paths/roots.js';
import { parseShellArgs } from './args.js';
import {
  attachFeatures,
  createOverlays,
  createShellRouter,
  type ShellOverlays,
} from './bootstrap.js';
import { applyBrowserPermissions } from './browser-permissions.js';
import { applyChromiumFlags } from './chromium-flags.js';
import { createDashboard } from './dashboard/index.js';
import { keepDisplayAwake, watchParent } from './lifecycle.js';
import { createShellLogger } from './logger.js';
import { forwardConsoleMessages } from './renderer-logs.js';
import { createWindows, type ManagedWindow } from './windows/create.js';
import { toDisplaySnapshots } from './windows/displays.js';
import { watchTopology, type TopologyWatcher } from './windows/topology.js';

const args = parseShellArgs(process.argv);
const resolved = readResolvedApp(args.resolvedAppPath);
const { config } = resolved;

app.setName(config.productName);
app.setPath('userData', resolved.userData);
applyChromiumFlags(app.commandLine, config.chromiumFlags, resolved.isDev);

function buildDashboardStatus(
  resolvedApp: ResolvedApp,
  windows: readonly ManagedWindow[],
  overlays: ShellOverlays
) {
  return {
    resolved: resolvedApp,
    windows,
    displays: () => toDisplaySnapshots(screen),
    processes: () => [],
    offline: overlays.offline,
    companion: overlays.companion,
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

interface DashboardInitOptions {
  readonly windows: readonly ManagedWindow[];
  readonly overlays: ShellOverlays;
  readonly recalculateLayout: () => void;
  readonly logs: LogBroadcast;
  readonly logger: Logger;
}

function initDashboard(options: DashboardInitOptions) {
  const roots = resolveRoots({ projectRoot: resolved.appDir, userDataRoot: resolved.userData });
  return createDashboard({
    config: config.dashboard,
    uiDirectory: resolvePackageAsset(roots, 'dist/dashboard-ui'),
    status: buildDashboardStatus(resolved, options.windows, options.overlays),
    actions: buildDashboardActions(options.windows, options.overlays, options.recalculateLayout),
    logs: options.logs,
    logger: options.logger,
  });
}

function startDashboard(
  windows: readonly ManagedWindow[],
  overlays: ShellOverlays,
  reapply: () => void,
  logs: LogBroadcast,
  logger: Logger
) {
  const dashboard = initDashboard({ windows, overlays, recalculateLayout: reapply, logs, logger });
  void dashboard.start();
  return dashboard;
}

function registerShutdown(
  overlays: ShellOverlays,
  topology: TopologyWatcher,
  dashboard: ReturnType<typeof initDashboard>
): void {
  app.once('before-quit', () => {
    overlays.offline.dispose();
    overlays.companion.dispose();
    topology.dispose();
    void dashboard.stop();
  });
}

async function setupLogger(resolvedApp: ResolvedApp, logBufferSize: number) {
  const logBroadcast = createLogBroadcast(logBufferSize);
  const logger = await createShellLogger(resolvedApp, [logBroadcast]);
  return { logBroadcast, logger };
}

function initShell(resolvedApp: ResolvedApp, parentPid?: number) {
  applyBrowserPermissions(session.defaultSession, resolvedApp.config.browserPermissions);
  keepDisplayAwake();
  if (parentPid !== undefined) watchParent(parentPid, () => app.quit());
}

async function onReady(): Promise<void> {
  const { logBroadcast, logger } = await setupLogger(resolved, config.dashboard.logBufferSize);
  initShell(resolved, args.parentPid);
  const windows = createWindows({ resolved, screen, logger });
  const router = createShellRouter(ipcMain, windows, () => app.quit(), logger);
  const overlays = createOverlays(resolved, windows, router, logger);
  attachFeatures(resolved, windows, overlays, () => app.quit(), logger);
  for (const { id, window } of windows) forwardConsoleMessages(window, id, logger);
  const topology = watchTopology({ resolved, screen, windows, logger });
  const dashboard = startDashboard(
    windows,
    overlays,
    () => topology.reapply(),
    logBroadcast,
    logger
  );
  registerShutdown(overlays, topology, dashboard);
  logger.info('Windows opened', { count: windows.length, isDev: resolved.isDev });
}

void app.whenReady().then(onReady);
app.on('window-all-closed', () => app.quit());
