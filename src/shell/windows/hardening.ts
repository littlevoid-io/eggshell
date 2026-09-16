import type { BrowserWindow, Input } from 'electron';
import type { Logger } from '../../logging/logger.js';

/** F12 and the browser devtools chords, plus F11 and Escape (kiosk/fullscreen escapes). */
export function isKioskEscape(input: Input): boolean {
  if (input.type !== 'keyDown') return false;
  const key = input.key.toLowerCase();
  const devtoolsChord =
    key === 'f12' ||
    ((input.control || input.meta) && input.shift && ['i', 'j', 'c'].includes(key));
  return devtoolsChord || key === 'f11' || key === 'escape';
}

function blockEscapes(window: BrowserWindow, logger: Logger): void {
  window.webContents.on('devtools-opened', () => {
    window.webContents.closeDevTools();
    logger.warn('blocked devtools in kiosk mode');
  });
  window.webContents.on('before-input-event', (event, input) => {
    if (!isKioskEscape(input)) return;
    event.preventDefault();
    logger.warn('blocked kiosk escape key', { key: input.key });
  });
}

/** Pins a kiosk window on top and, outside dev, blocks the keyboard ways out of it. */
export function lockKiosk(window: BrowserWindow, isDev: boolean, logger: Logger): void {
  window.setMenuBarVisibility(false);
  window.setAlwaysOnTop(true, 'screen-saver');
  window.webContents.on('context-menu', event => event.preventDefault());
  if (!isDev) blockEscapes(window, logger);
}
