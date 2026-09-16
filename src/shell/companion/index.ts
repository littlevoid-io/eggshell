import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { ResolvedApp } from '../../config/resolved.js';
import type { CompanionConfig } from '../../config/types.js';
import type { Logger } from '../../logging/logger.js';
import type { IpcRouter } from '../ipc.js';
import type { OverlayView } from '../overlay-view.js';
import { createOverlaySet } from '../overlays/overlay-set.js';
import { selectTargetWindows } from '../overlays/targets.js';
import type { ManagedWindow } from '../windows/create.js';
import { buildCompanionUrl } from './network.js';
import { qrDataUrl } from './qr.js';

export interface CompanionStatus {
  title: string;
  description: string;
  url: string;
  qrDataUrl: string;
  version: string | undefined;
  isDev: boolean;
  logDirectory: string;
}

export interface CompanionOverlay {
  toggle(): void;
  setShowing(showing: boolean): void;
  readonly visible: boolean;
  dispose(): void;
}

export interface CompanionOverlayOptions {
  readonly config: CompanionConfig;
  readonly resolved: ResolvedApp;
  readonly windows: readonly ManagedWindow[];
  readonly attach: (window: BrowserWindow) => OverlayView;
  readonly router: IpcRouter;
  readonly openFolder: (directory: string) => Promise<unknown>;
  readonly logger: Logger;
}

function createNoopCompanionOverlay(): CompanionOverlay {
  return {
    toggle: () => {},
    setShowing: () => {},
    get visible(): boolean {
      return false;
    },
    dispose: () => {},
  };
}

function toCompanionStatus(
  title: string,
  description: string,
  url: string,
  qrDataUrl: string,
  resolved: ResolvedApp,
  logDirectory: string
): CompanionStatus {
  return {
    title,
    description,
    url,
    qrDataUrl,
    version: resolved.config.version,
    isDev: resolved.isDev,
    logDirectory,
  };
}

function createStatusProvider(
  config: CompanionConfig,
  resolved: ResolvedApp,
  url: string,
  logDirectory: string
): () => Promise<CompanionStatus> {
  let cachedQr: string | undefined;
  const title = config.title ?? resolved.config.productName;
  const description = config.description ?? 'Scan to connect to this kiosk';
  return async () => {
    if (cachedQr === undefined) cachedQr = await qrDataUrl(url);
    return toCompanionStatus(title, description, url, cachedQr, resolved, logDirectory);
  };
}

export function createCompanionOverlay(options: CompanionOverlayOptions): CompanionOverlay {
  const { config, resolved, windows, attach, router, openFolder, logger } = options;
  if (!config.enabled) return createNoopCompanionOverlay();

  const targetWindows = selectTargetWindows(windows, config.windows, logger);
  const overlaySet = createOverlaySet(targetWindows, attach);
  const url = buildCompanionUrl({ url: config.url, port: config.port, path: config.path });
  const logDir = path.resolve(resolved.userData, resolved.config.logging.file.directory);
  const getStatus = createStatusProvider(config, resolved, url, logDir);

  router.handle('companion:status', () => getStatus());
  router.handle('companion:dismiss', () => overlaySet.hide());
  router.handle('companion:open-logs', () => openFolder(logDir));

  return {
    toggle: () => (overlaySet.visible ? overlaySet.hide() : overlaySet.show()),
    setShowing: showing => (showing ? overlaySet.show() : overlaySet.hide()),
    get visible(): boolean {
      return overlaySet.visible;
    },
    dispose: () => overlaySet.destroy(),
  };
}
