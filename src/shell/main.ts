import { app, ipcMain, screen, session, type BrowserWindow, type WebContents } from 'electron';
import { systemClock } from '../clock.js';
import { readResolvedApp } from '../config/resolved.js';
import type { Logger } from '../logging/logger.js';
import { resolvePackageAsset, resolveRoots } from '../paths/roots.js';
import { parseShellArgs } from './args.js';
import { createBlackout } from './blackout.js';
import { applyBrowserPermissions } from './browser-permissions.js';
import { registerBuiltinChannels } from './channels.js';
import { applyChromiumFlags } from './chromium-flags.js';
import { createCompanionOverlay, type CompanionOverlay } from './companion/index.js';
import { openFolder } from './companion/open-folder.js';
import { createCursorController, initialCursorVisible } from './cursor.js';
import { createIpcRouter, type IpcRouter } from './ipc.js';
import { attachKeybindings, type CommandHandlers } from './keybindings.js';
import { keepDisplayAwake, watchParent } from './lifecycle.js';
import { createShellLogger } from './logger.js';
import { createOfflineOverlay, type OfflineOverlay } from './offline/index.js';
import { createConnectivityProbe } from './offline/probe.js';
import { attachOverlayView, type OverlayView } from './overlay-view.js';
import { forwardConsoleMessages, registerRendererLogChannel } from './renderer-logs.js';
import { createWindows, type ManagedWindow, shellPreloadPath } from './windows/create.js';
import { watchTopology } from './windows/topology.js';

const args = parseShellArgs(process.argv);
const resolved = readResolvedApp(args.resolvedAppPath);
const { config } = resolved;

app.setName(config.productName);
app.setPath('userData', resolved.userData);
applyChromiumFlags(app.commandLine, config.chromiumFlags, resolved.isDev);

interface ShellOverlays {
  readonly offline: OfflineOverlay;
  readonly companion: CompanionOverlay;
}

function attachOverlay(asset: string): (window: BrowserWindow) => OverlayView {
  const roots = resolveRoots({ projectRoot: resolved.appDir, userDataRoot: resolved.userData });
  const htmlPath = resolvePackageAsset(roots, asset);
  return window => attachOverlayView({ window, htmlPath, preloadPath: shellPreloadPath() });
}

function createOffline(windows: readonly ManagedWindow[], router: IpcRouter, logger: Logger) {
  return createOfflineOverlay({
    config: config.offline,
    windows,
    attach: attachOverlay('assets/offline.html'),
    probe: createConnectivityProbe({ pingUrl: config.offline.pingUrl }),
    router,
    clock: systemClock,
    logger,
  });
}

function createCompanion(windows: readonly ManagedWindow[], router: IpcRouter, logger: Logger) {
  return createCompanionOverlay({
    config: config.companion,
    resolved,
    windows,
    attach: attachOverlay('assets/companion.html'),
    router,
    openFolder,
    logger,
  });
}

function createOverlays(
  windows: readonly ManagedWindow[],
  router: IpcRouter,
  logger: Logger
): ShellOverlays {
  return {
    offline: createOffline(windows, router, logger),
    companion: createCompanion(windows, router, logger),
  };
}

function attachFeatures(
  windows: readonly ManagedWindow[],
  overlays: ShellOverlays,
  logger: Logger
): void {
  const cursor = createCursorController(initialCursorVisible(config.cursor, config.windows));
  const handlers: CommandHandlers = {
    'app.quit': () => app.quit(),
    'cursor.toggle': () => cursor.toggle(),
    'offline.toggle': () => overlays.offline.toggle(),
    'companion.toggle': () => overlays.companion.toggle(),
  };
  for (const { window } of windows) {
    cursor.attach(window);
    attachKeybindings(window, config.keybindings, handlers, logger);
  }
}

function createShellRouter(windows: readonly ManagedWindow[], logger: Logger): IpcRouter {
  const windowIdOf = (sender: WebContents) =>
    windows.find(w => w.window.webContents === sender)?.id;
  registerRendererLogChannel(ipcMain, windowIdOf, logger);
  const router = createIpcRouter(windowIdOf, logger);
  registerBuiltinChannels(router, {
    windows,
    quit: () => app.quit(),
    blackout: createBlackout(() => windows[0]?.window),
  });
  return router;
}

async function onReady(): Promise<void> {
  const logger = await createShellLogger(resolved);
  applyBrowserPermissions(session.defaultSession, config.browserPermissions);
  keepDisplayAwake();
  if (args.parentPid !== undefined) watchParent(args.parentPid, () => app.quit());
  const windows = createWindows({ resolved, screen, logger });
  const router = createShellRouter(windows, logger);
  const overlays = createOverlays(windows, router, logger);
  router.attach(ipcMain);
  attachFeatures(windows, overlays, logger);
  for (const { id, window } of windows) forwardConsoleMessages(window, id, logger);
  const stopWatching = watchTopology({ resolved, screen, windows, logger });
  app.once('before-quit', () => {
    overlays.offline.dispose();
    overlays.companion.dispose();
    stopWatching();
  });
  logger.info('Windows opened', { count: windows.length, isDev: resolved.isDev });
}

void app.whenReady().then(onReady);
app.on('window-all-closed', () => app.quit());
