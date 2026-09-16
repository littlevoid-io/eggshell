import { app, ipcMain, screen, session } from 'electron';
import { readResolvedApp, type ResolvedApp } from '../config/resolved.js';
import { createLogBroadcast, type LogBroadcast } from '../logging/broadcast.js';
import type { Logger } from '../logging/logger.js';
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
import type { IpcRouter } from './ipc.js';
import { keepDisplayAwake, watchParent } from './lifecycle.js';
import { createShellLogger } from './logger.js';
import { forwardConsoleMessages } from './renderer-logs.js';
import { startSoak, type SoakRunner } from './soak/index.js';
import { createWindows, type ManagedWindow } from './windows/create.js';
import { watchTopology, type TopologyWatcher } from './windows/topology.js';

const args = parseShellArgs(process.argv);
const resolved = readResolvedApp(args.resolvedAppPath);
const { config } = resolved;

app.setName(config.productName);
app.setPath('userData', resolved.userData);
applyChromiumFlags(app.commandLine, config.chromiumFlags, resolved.isDev);

function registerShutdown(
  overlays: ShellOverlays,
  topology: TopologyWatcher,
  dashboard: { stop: () => Promise<void> },
  soak: SoakRunner
): void {
  let isQuitting = false;
  app.on('before-quit', event => {
    if (isQuitting) return;
    event.preventDefault();
    isQuitting = true;
    overlays.offline.dispose();
    overlays.companion.dispose();
    topology.dispose();
    void dashboard.stop();
    void soak.stop().finally(() => app.quit());
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

function initWindows(resolvedApp: ResolvedApp, logger: Logger): ManagedWindow[] {
  const windows = createWindows({ resolved: resolvedApp, screen, logger });
  for (const { id, window } of windows) forwardConsoleMessages(window, id, logger);
  return windows;
}

interface ServiceOptions {
  readonly resolved: ResolvedApp;
  readonly windows: readonly ManagedWindow[];
  readonly overlays: ShellOverlays;
  readonly router: IpcRouter;
  readonly reapply: () => void;
  readonly logs: LogBroadcast;
  readonly logger: Logger;
}

function startServices(options: ServiceOptions) {
  const holder: { runner?: SoakRunner } = {};
  const dashboard = startShellDashboard({
    ...options,
    recalculateLayout: options.reapply,
    getSoak: () => holder.runner?.state,
  });
  const soak = startSoak({
    config: options.resolved.config.soak,
    windows: options.windows,
    resolved: options.resolved,
    router: options.router,
    logger: options.logger,
    isPackaged: app.isPackaged,
  });
  holder.runner = soak;
  return { dashboard, soak };
}

async function onReady(): Promise<void> {
  const { logBroadcast, logger } = await setupLogger(resolved, config.dashboard.logBufferSize);
  initShell(resolved, args.parentPid);
  const windows = initWindows(resolved, logger);
  const router = createShellRouter(ipcMain, windows, () => app.quit(), logger);
  const overlays = createOverlays(resolved, windows, router, logger);
  attachFeatures(resolved, windows, overlays, () => app.quit(), logger);
  const topology = watchTopology({ resolved, screen, windows, logger });
  const { dashboard, soak } = startServices({
    resolved,
    windows,
    overlays,
    router,
    reapply: () => topology.reapply(),
    logs: logBroadcast,
    logger,
  });
  registerShutdown(overlays, topology, dashboard, soak);
  logger.info('Windows opened', { count: windows.length, isDev: resolved.isDev });
}

void app.whenReady().then(onReady);
app.on('window-all-closed', () => app.quit());
