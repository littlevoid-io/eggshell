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
interface CursorState {
  readonly keys: Map<BrowserWindow, string>;
  readonly windows: Set<BrowserWindow>;
  visible: boolean;
}

function attachWindow(state: CursorState, window: BrowserWindow): void {
  state.windows.add(window);
  window.webContents.on('did-finish-load', () => {
    state.keys.delete(window);
    void applyTo(window, state.keys, state.visible);
  });
  window.on('closed', () => state.windows.delete(window));
}

export function createCursorController(initiallyVisible: boolean): CursorController {
  const state: CursorState = { keys: new Map(), windows: new Set(), visible: initiallyVisible };
  return {
    get visible() {
      return state.visible;
    },
    attach: window => attachWindow(state, window),
    toggle() {
      state.visible = !state.visible;
      state.windows.forEach(window => void applyTo(window, state.keys, state.visible));
    },
  };
}
