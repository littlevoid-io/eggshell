import type { BrowserWindow } from 'electron';
import pRetry from 'p-retry';
import type { Logger } from '../../logging/logger.js';

const ERR_ABORTED = -3;
const SHOW_FALLBACK_MS = 10_000;
const SHOW_RETRY_INTERVAL_MS = 200;
const SHOW_RETRY_ATTEMPTS = 25;

export function logLoadFailure(window: BrowserWindow, id: string, logger: Logger): void {
  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, url, isMainFrame) => {
      if (!isMainFrame || errorCode === ERR_ABORTED) return;
      logger.error('window failed to load', { windowId: id, errorCode, errorDescription, url });
    }
  );
}

export function logRendererHealth(window: BrowserWindow, id: string, logger: Logger): void {
  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error('renderer process gone', { windowId: id, ...details });
  });
  window.on('unresponsive', () => logger.warn('window unresponsive', { windowId: id }));
  window.on('responsive', () => logger.info('window responsive again', { windowId: id }));
}

/** An unattended kiosk window should never disappear or reappear without a trace. */
export function logVisibilityEvents(window: BrowserWindow, id: string, logger: Logger): void {
  const log = (event: string): void =>
    logger.info(`window ${event}`, { windowId: id, isVisible: window.isVisible() });
  window.on('hide', () => log('hide'));
  window.on('minimize', () => log('minimize'));
  window.on('restore', () => log('restore'));
}

function logShownState(window: BrowserWindow, id: string, reason: string, logger: Logger): void {
  logger.info('window shown', {
    windowId: id,
    reason,
    bounds: window.getBounds(),
    isVisible: window.isVisible(),
    isMinimized: window.isMinimized(),
  });
}

function attemptShow(window: BrowserWindow): void {
  if (window.isDestroyed() || window.isVisible()) return;
  window.show();
  throw new Error('window not yet visible');
}

function logGiveUp(window: BrowserWindow, id: string, logger: Logger): void {
  if (window.isDestroyed()) return;
  logger.error('window never reported visible after repeated show() calls', {
    windowId: id,
    attempts: SHOW_RETRY_ATTEMPTS,
  });
}

/**
 * electron/electron#5384: a native Show() call has been observed on Windows to
 * not set WS_VISIBLE, leaving isVisible() false forever with no error. Retrying
 * show() is the documented community workaround; there is no event that fires
 * when this resolves, so this must poll.
 */
async function confirmVisible(window: BrowserWindow, id: string, logger: Logger): Promise<void> {
  try {
    await pRetry(() => attemptShow(window), {
      retries: SHOW_RETRY_ATTEMPTS - 1,
      factor: 1,
      minTimeout: SHOW_RETRY_INTERVAL_MS,
      onFailedAttempt: error =>
        logger.warn('window still not visible; retrying show()', {
          windowId: id,
          attempt: error.attemptNumber,
        }),
    });
  } catch {
    logGiveUp(window, id, logger);
    return;
  }
  if (!window.isDestroyed()) logger.info('window visibility confirmed', { windowId: id });
}

export function showWhenReady(window: BrowserWindow, id: string, logger: Logger): void {
  let shown = false;
  const show = (reason: string): void => {
    if (shown || window.isDestroyed()) return;
    shown = true;
    window.show();
    logShownState(window, id, reason, logger);
    void confirmVisible(window, id, logger);
  };
  window.once('ready-to-show', () => show('ready-to-show'));
  setTimeout(() => show('fallback timeout; ready-to-show never fired'), SHOW_FALLBACK_MS).unref();
}
