import type { BrowserWindow } from 'electron';
import type { CursorConfig, WindowConfig } from '../config/types.js';

const HIDE_CURSOR_CSS = '* { cursor: none !important; }';

/** `auto` hides the cursor when any window runs in kiosk mode. */
export function initialCursorVisible(
  cursor: CursorConfig,
  windows: readonly Pick<WindowConfig, 'kiosk'>[]
): boolean {
  if (cursor.visible !== 'auto') return cursor.visible;
  return !windows.some(window => window.kiosk);
}

export interface CursorController {
  readonly visible: boolean;
  attach(window: BrowserWindow): void;
  toggle(): void;
}

async function applyTo(
  window: BrowserWindow,
  keys: Map<BrowserWindow, string>,
  visible: boolean
): Promise<void> {
  if (window.isDestroyed()) return;
  const key = keys.get(window);
  if (visible && key !== undefined) {
    keys.delete(window);
    await window.webContents.removeInsertedCSS(key);
  }
  if (!visible && key === undefined) {
    keys.set(window, await window.webContents.insertCSS(HIDE_CURSOR_CSS));
  }
}

/** Hides the cursor by injecting CSS; re-applies after every page load. */
export function createCursorController(initiallyVisible: boolean): CursorController {
  const keys = new Map<BrowserWindow, string>();
  const windows = new Set<BrowserWindow>();
  let visible = initiallyVisible;
  const applyAll = () => windows.forEach(window => void applyTo(window, keys, visible));
  return {
    get visible() {
      return visible;
    },
    attach(window) {
      windows.add(window);
      window.webContents.on('did-finish-load', () => {
        keys.delete(window);
        void applyTo(window, keys, visible);
      });
      window.on('closed', () => windows.delete(window));
    },
    toggle() {
      visible = !visible;
      applyAll();
    },
  };
}
