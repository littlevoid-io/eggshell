import type { BrowserWindow } from 'electron';
import type { OverlayView } from '../overlay-view.js';
import type { ManagedWindow } from '../windows/create.js';

export interface OverlaySet {
  readonly visible: boolean;
  readonly views: readonly OverlayView[];
  show(): void;
  hide(): void;
  destroy(): void;
}

function invokeAll(views: readonly OverlayView[], method: 'show' | 'hide' | 'destroy'): void {
  for (const view of views) view[method]();
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
    get views(): readonly OverlayView[] {
      return views;
    },
    show: () => invokeAll(views, 'show'),
    hide: () => invokeAll(views, 'hide'),
    destroy: () => invokeAll(views, 'destroy'),
  };
}
