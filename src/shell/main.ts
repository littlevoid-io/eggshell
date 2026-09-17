import path from 'node:path';
import { app, ipcMain, screen, session } from 'electron';
import { readResolvedApp, type ResolvedApp } from '../config/resolved.js';
import { createLogBroadcast, type LogBroadcast } from '../logging/broadcast.js';
import type { Logger } from '../logging/logger.js';
import { userDataFor } from '../paths/user-data.js';
import { parseShellArgs } from './args.js';
import {
  attachFeatures,
  createOverlays,
  createShellRouter,
  type ShellOverlays,
} from './bootstrap.js';
import { applyBrowserPermissions } from './browser-permissions.js';
import { applyChromiumFlags } from './chromium-flags.js';
import { startShellDashboard } from './dashboard-setup.js';
import { createRelaunchController, type RelaunchController } from './relaunch.js';
import { loadChromeExtensions } from './extensions.js';
import type { IpcRouter } from './ipc.js';
import { initLifecycle, registerShutdown, type ShellShutdownServices } from './lifecycle.js';
import { createShellLogger } from './logger.js';
import { resolveShellPaths } from './paths.js';
import { startProductionProcesses, type ProductionProcesses } from './processes.js';
import { forwardConsoleMessages } from './renderer-logs.js';
import { startSoak, type SoakRunner } from './soak/index.js';
import { createWindows, type ManagedWindow } from './windows/create.js';
import { watchTopology, type TopologyWatcher } from './windows/topology.js';

const STAGED_CONFIG_FILENAME = 'eggshell.json';

const paths = resolveShellPaths(import.meta.dirname, app.isPackaged);
const args = parseShellArgs(
  process.argv,
  app.isPackaged ? path.join(app.getAppPath(), STAGED_CONFIG_FILENAME) : undefined
);
const resolved = readResolvedApp(args.resolvedAppPath, config => ({
  appDir: app.getAppPath(),
  userData: userDataFor(config.appId),
}));
const { config } = resolved;

app.setName(config.productName);
app.setPath('userData', resolved.userData);
applyChromiumFlags(app.commandLine, config.chromiumFlags, resolved.isDev);

async function setupLogger(resolvedApp: ResolvedApp, logBufferSize: number) {
  const logBroadcast = createLogBroadcast(logBufferSize);
  const logger = await createShellLogger(resolvedApp, {
    stdout: args.parentPid !== undefined || process.stdout.isTTY === true,
    extraStreams: [logBroadcast],
  });
  return { logBroadcast, logger };
}

async function initShell(resolvedApp: ResolvedApp, logger: Logger, parentPid?: number) {
  applyBrowserPermissions(session.defaultSession, resolvedApp.config.browserPermissions);
  initLifecycle(parentPid);
  const { chromeExtensions } = resolvedApp.config;
  await loadChromeExtensions(session.defaultSession, chromeExtensions, resolvedApp.appDir, logger);
}

function initWindows(resolvedApp: ResolvedApp, logger: Logger): ManagedWindow[] {
  const windows = createWindows({
    resolved: resolvedApp,
    screen,
    preloadPath: paths.preload,
    logger,
  });
  for (const { id, window } of windows) forwardConsoleMessages(window, id, logger);
  return windows;
}

interface ServiceOptions {
  readonly windows: readonly ManagedWindow[];
  readonly overlays: ShellOverlays;
  readonly router: IpcRouter;
  readonly topology: TopologyWatcher;
  readonly processes: ProductionProcesses;
  readonly logs: LogBroadcast;
  readonly logger: Logger;
  readonly relaunch: RelaunchController;
}

function initSoak(options: ServiceOptions): SoakRunner {
  return startSoak({
    config: config.soak,
    windows: options.windows,
    resolved,
    router: options.router,
    logger: options.logger,
    isPackaged: app.isPackaged,
  });
}

function startServices(options: ServiceOptions): ShellShutdownServices {
  const holder: { runner?: SoakRunner } = {};
  const relaunch = () => {
    options.relaunch.request();
    app.quit();
  };
  const dashboard = startShellDashboard({
    ...options,
    resolved,
    recalculateLayout: () => options.topology.reapply(),
    processes: () => options.processes.statuses(),
    uiDirectory: paths.dashboardUi,
    getSoak: () => holder.runner?.state,
    relaunch,
  });
  holder.runner = initSoak(options);
  return { ...options, dashboard, soak: holder.runner };
}

function openKiosk(
  windows: readonly ManagedWindow[],
  logger: Logger
): Pick<ServiceOptions, 'overlays' | 'router' | 'topology'> {
  const quit = () => app.quit();
  const router = createShellRouter(ipcMain, windows, quit, logger);
  const overlays = createOverlays(resolved, windows, router, logger, paths);
  attachFeatures(resolved, windows, overlays, quit, logger);
  const topology = watchTopology({ resolved, screen, windows, logger });
  return { overlays, router, topology };
}

async function onReady(): Promise<void> {
  const relaunch = createRelaunchController();
  const { logBroadcast, logger } = await setupLogger(resolved, config.dashboard.logBufferSize);
  await initShell(resolved, logger, args.parentPid);
  const processes = await startProductionProcesses(resolved, app.isPackaged, logger);
  const windows = initWindows(resolved, logger);
  const kiosk = openKiosk(windows, logger);
  const services = startServices({
    ...kiosk,
    windows,
    processes,
    logs: logBroadcast,
    logger,
    relaunch,
  });
  registerShutdown(services, relaunch, args.parentPid);
  logger.info('Windows opened', { count: windows.length, isDev: resolved.isDev });
}

void app.whenReady().then(onReady);
app.on('window-all-closed', () => app.quit());
