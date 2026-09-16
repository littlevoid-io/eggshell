import path from 'node:path';
import {
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  type Screen,
  type WebPreferences,
} from 'electron';
import type { WindowConfig } from '../../config/types.js';
import type { ResolvedApp } from '../../config/resolved.js';
import { resolveLayout } from '../../layout/resolve.js';
import type { LayoutProblem, WindowPlacement } from '../../layout/types.js';
import type { Logger } from '../../logging/logger.js';
import { toDisplaySnapshots } from './displays.js';
import { lockKiosk } from './hardening.js';
import { toWindowUrl } from './url.js';

export interface ManagedWindow {
  readonly id: string;
  readonly window: BrowserWindow;
}

export interface CreateWindowsOptions {
  readonly resolved: ResolvedApp;
  readonly screen: Screen;
  readonly preloadPath: string;
  readonly logger: Logger;
}

function webPreferences(config: WindowConfig, preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    backgroundThrottling: false,
    zoomFactor: config.zoomFactor,
  };
}

function windowOptions(
  placement: WindowPlacement,
  config: WindowConfig,
  resolved: ResolvedApp,
  preloadPath: string
): BrowserWindowConstructorOptions {
  const icon = config.icon ?? resolved.config.icon;
  return {
    ...placement.bounds,
    show: !config.showWhenReady,
    kiosk: placement.mode === 'kiosk',
    fullscreen: placement.mode === 'fullscreen',
    frame: placement.mode === 'windowed',
    ...(config.backgroundColor ? { backgroundColor: config.backgroundColor } : {}),
    ...(icon ? { icon: path.resolve(resolved.appDir, icon) } : {}),
    webPreferences: webPreferences(config, preloadPath),
  };
}

/** A hidden window must not stay invisible forever if `ready-to-show` never fires. */
const SHOW_FALLBACK_MS = 10_000;

const ERR_ABORTED = -3;

function logLoadFailure(window: BrowserWindow, id: string, logger: Logger): void {
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, url, isMainFrame) => {
    if (!isMainFrame || errorCode === ERR_ABORTED) return;
    logger.error('window failed to load', { windowId: id, errorCode, errorDescription, url });
  });
}

function logRendererHealth(window: BrowserWindow, id: string, logger: Logger): void {
  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error('renderer process gone', { windowId: id, ...details });
  });
  window.on('unresponsive', () => logger.warn('window unresponsive', { windowId: id }));
  window.on('responsive', () => logger.info('window responsive again', { windowId: id }));
}

function showWhenReady(window: BrowserWindow, id: string, logger: Logger): void {
  let shown = false;
  const show = (reason: string): void => {
    if (shown || window.isDestroyed()) return;
    shown = true;
    logger.info('window shown', { windowId: id, reason });
    window.show();
  };
  window.once('ready-to-show', () => show('ready-to-show'));
  setTimeout(() => show('fallback timeout; ready-to-show never fired'), SHOW_FALLBACK_MS).unref();
}

function openWindow(
  placement: WindowPlacement,
  config: WindowConfig,
  options: CreateWindowsOptions
): BrowserWindow {
  const { resolved, logger } = options;
  const window = new BrowserWindow(windowOptions(placement, config, resolved, options.preloadPath));
  if (placement.mode === 'kiosk') lockKiosk(window, resolved.isDev, logger);
  logLoadFailure(window, config.id, logger);
  logRendererHealth(window, config.id, logger);
  if (config.showWhenReady) showWhenReady(window, config.id, logger);
  void window.loadURL(toWindowUrl(config.url, resolved.appDir));
  return window;
}

function logProblem(logger: Logger, problem: LayoutProblem): void {
  const level = problem.severity === 'error' ? 'error' : 'warn';
  logger[level](problem.message, { windowId: problem.windowId, fieldPath: problem.fieldPath });
}

/** Resolves placement for every configured window and opens the ones that got one. */
export function createWindows(options: CreateWindowsOptions): ManagedWindow[] {
  const { resolved, screen, logger } = options;
  const { config } = resolved;
  const layout = resolveLayout({
    displays: toDisplaySnapshots(screen),
    windows: config.windows,
    roles: config.display.roles,
  });
  layout.problems.forEach(problem => logProblem(logger, problem));
  return layout.placements.flatMap(placement => {
    const windowConfig = config.windows.find(window => window.id === placement.windowId);
    if (!windowConfig) return [];
    return [{ id: placement.windowId, window: openWindow(placement, windowConfig, options) }];
  });
}
