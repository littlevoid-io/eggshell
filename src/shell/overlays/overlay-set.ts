import type { BrowserWindow } from 'electron';
import type { OverlayView } from '../overlay-view.js';
import type { ManagedWindow } from '../windows/create.js';

export interface OverlaySet {
  readonly visible: boolean;
  show(): void;
  hide(): void;
  destroy(): void;
}

export function createOverlaySet(
  windows: readonly ManagedWindow[],
  attach: (window: BrowserWindow) => OverlayView
): OverlaySet {
  const views = windows.map(({ window }) => attach(window));
  return {
    get visible(): boolean {
      return views.some(view => view.visible);
    },
    show(): void {
      for (const view of views) view.show();
    },
    hide(): void {
      for (const view of views) view.hide();
    },
    destroy(): void {
      for (const view of views) view.destroy();
    },
  };
}
