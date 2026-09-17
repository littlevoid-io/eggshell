import type { BrowserWindow, IpcMain, WebContents } from 'electron';
import { systemClock } from '../clock.js';
import type { ResolvedApp } from '../config/resolved.js';
import type { Logger } from '../logging/logger.js';
import { createBlackout } from './blackout.js';
import { registerBuiltinChannels } from './channels.js';
import { createCompanionOverlay, type CompanionOverlay } from './companion/index.js';
import { openFolder } from './companion/open-folder.js';
import { createCursorController, initialCursorVisible } from './cursor.js';
import { createIpcRouter, type IpcRouter } from './ipc.js';
import { attachKeybindings, type CommandHandlers } from './keybindings.js';
import { createOfflineOverlay, type OfflineOverlay } from './offline/index.js';
import { createConnectivityProbe } from './offline/probe.js';
import { attachOverlayView, type OverlayView } from './overlay-view.js';
import type { ShellPaths } from './paths.js';
import { registerRendererLogChannel } from './renderer-logs.js';
import type { ManagedWindow } from './windows/create.js';

export interface ShellOverlays {
  readonly offline: OfflineOverlay;
  readonly companion: CompanionOverlay;
}

function attachOverlay(asset: string, paths: ShellPaths): (window: BrowserWindow) => OverlayView {
  const htmlPath = paths.asset(asset);
  return window => attachOverlayView({ window, htmlPath, preloadPath: paths.preload });
}

function createOffline(
  resolved: ResolvedApp,
  windows: readonly ManagedWindow[],
  router: IpcRouter,
  logger: Logger,
  paths: ShellPaths
) {
  return createOfflineOverlay({
    config: resolved.config.offline,
    windows,
    attach: attachOverlay('offline.html', paths),
    probe: createConnectivityProbe({ pingUrl: resolved.config.offline.pingUrl }),
    router,
    clock: systemClock,
    logger,
  });
}

function createCompanion(
  resolved: ResolvedApp,
  windows: readonly ManagedWindow[],
  router: IpcRouter,
  logger: Logger,
  paths: ShellPaths
) {
  return createCompanionOverlay({
    config: resolved.config.companion,
    resolved,
    windows,
    attach: attachOverlay('companion.html', paths),
    router,
    openFolder,
    logger,
  });
}

export function createOverlays(
  resolved: ResolvedApp,
  windows: readonly ManagedWindow[],
  router: IpcRouter,
  logger: Logger,
  paths: ShellPaths
): ShellOverlays {
  return {
    offline: createOffline(resolved, windows, router, logger, paths),
    companion: createCompanion(resolved, windows, router, logger, paths),
  };
}

function buildKeybindingHandlers(
  quit: () => void,
  cursor: ReturnType<typeof createCursorController>,
  overlays: ShellOverlays
): CommandHandlers {
  return {
    'app.quit': () => quit(),
    'cursor.toggle': () => cursor.toggle(),
    'offline.toggle': () => overlays.offline.toggle(),
    'companion.toggle': () => overlays.companion.toggle(),
    'devtools.toggle': window => {
      if (!window.isDestroyed()) window.webContents.toggleDevTools();
    },
  };
}

export function attachFeatures(
  resolved: ResolvedApp,
  windows: readonly ManagedWindow[],
  overlays: ShellOverlays,
  quit: () => void,
  logger: Logger
): void {
  const cursor = createCursorController(
    initialCursorVisible(resolved.config.cursor, resolved.config.windows)
  );
  const handlers = buildKeybindingHandlers(quit, cursor, overlays);
  for (const { window } of windows) {
    cursor.attach(window);
    attachKeybindings(window, resolved.config.keybindings, handlers, logger);
  }
}

export function createShellRouter(
  ipcMain: IpcMain,
  windows: readonly ManagedWindow[],
  quit: () => void,
  logger: Logger
): IpcRouter {
  const windowIdOf = (sender: WebContents) =>
    windows.find(w => w.window.webContents === sender)?.id;
  registerRendererLogChannel(ipcMain, windowIdOf, logger);
  const router = createIpcRouter(windowIdOf, logger);
  registerBuiltinChannels(router, {
    windows,
    quit,
    blackout: createBlackout(() => windows[0]?.window),
  });
  router.attach(ipcMain);
  return router;
}
