import type { BrowserWindow, Rectangle } from 'electron';
import type { WindowPlacement } from '../../layout/types.js';

export function sameBounds(a: Rectangle, b: Rectangle): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Moves an existing window onto a new placement after a display change. */
export function applyPlacement(window: BrowserWindow, placement: WindowPlacement): void {
  if (window.isDestroyed()) return;
  const kiosk = placement.mode === 'kiosk';
  if (window.isKiosk() !== kiosk) window.setKiosk(kiosk);
  if ((placement.mode === 'fullscreen') !== window.isFullScreen()) {
    window.setFullScreen(placement.mode === 'fullscreen');
  }
  window.setBounds(placement.bounds);
}

/** Kiosk and fullscreen windows snap to a display, so only their display is checked; windowed placements must match exactly. */
export function matchesPlacement(
  window: BrowserWindow,
  placement: WindowPlacement,
  displayIdOf: (bounds: Rectangle) => number
): boolean {
  if (window.isDestroyed()) return true;
  const bounds = window.getBounds();
  if (placement.mode === 'windowed') return sameBounds(bounds, placement.bounds);
  return placement.displayId === null || displayIdOf(bounds) === placement.displayId;
}
