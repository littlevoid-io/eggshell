import path from 'node:path';
import { BrowserWindow, type BrowserWindowConstructorOptions, type Screen } from 'electron';
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
  readonly logger: Logger;
}

export function shellPreloadPath(): string {
  return path.join(import.meta.dirname, '..', 'preload.cjs');
}

function windowOptions(
  placement: WindowPlacement,
  config: WindowConfig,
  resolved: ResolvedApp
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
    webPreferences: {
      preload: shellPreloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      zoomFactor: config.zoomFactor,
    },
  };
}

function openWindow(
  placement: WindowPlacement,
  config: WindowConfig,
  resolved: ResolvedApp,
  logger: Logger
): BrowserWindow {
  const window = new BrowserWindow(windowOptions(placement, config, resolved));
  if (placement.mode === 'kiosk') lockKiosk(window, resolved.isDev, logger);
  if (config.showWhenReady) window.once('ready-to-show', () => window.show());
  void window.loadURL(toWindowUrl(config.url, resolved.appDir));
  return window;
}

function logProblem(logger: Logger, problem: LayoutProblem): void {
  const level = problem.severity === 'error' ? 'error' : 'warn';
  logger[level](problem.message, { windowId: problem.windowId, fieldPath: problem.fieldPath });
}

/** Resolves placement for every configured window and opens the ones that got one. */
export function createWindows({ resolved, screen, logger }: CreateWindowsOptions): ManagedWindow[] {
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
    return [
      { id: placement.windowId, window: openWindow(placement, windowConfig, resolved, logger) },
    ];
  });
}
