import { WebContentsView, type BrowserWindow, type WebContents } from 'electron';

export interface OverlayView {
  readonly visible: boolean;
  readonly webContents: WebContents;
  readonly window: BrowserWindow;
  show(): void;
  hide(): void;
  destroy(): void;
}

export interface AttachOverlayOptions {
  readonly window: BrowserWindow;
  readonly htmlPath: string;
  readonly preloadPath: string;
}

function createChildWebContentsView(preloadPath: string): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      transparent: true,
    },
  });
  view.setBackgroundColor('#00000000');
  view.setVisible(false);
  return view;
}

function bindWindowBounds(window: BrowserWindow, view: WebContentsView): () => void {
  const update = (): void => {
    if (window.isDestroyed()) {
      return;
    }
    const { width, height } = window.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  update();
  window.on('resize', update);
  return update;
}

function destroyOverlay(window: BrowserWindow, view: WebContentsView, onResize: () => void): void {
  if (!window.isDestroyed()) {
    window.removeListener('resize', onResize);
    window.contentView.removeChildView(view);
  }
  if (!view.webContents.isDestroyed()) {
    view.webContents.close();
  }
}

function showOverlay(view: WebContentsView, updateBounds: () => void): void {
  updateBounds();
  view.setVisible(true);
  view.webContents.focus();
}

function hideOverlay(window: BrowserWindow, view: WebContentsView): void {
  view.setVisible(false);
  if (!window.isDestroyed()) window.webContents.focus();
}

function createOverlayHandle(
  window: BrowserWindow,
  view: WebContentsView,
  updateBounds: () => void
): OverlayView {
  return {
    get visible(): boolean {
      return view.getVisible();
    },
    get webContents(): WebContents {
      return view.webContents;
    },
    get window(): BrowserWindow {
      return window;
    },
    show: () => showOverlay(view, updateBounds),
    hide: () => hideOverlay(window, view),
    destroy: () => destroyOverlay(window, view, updateBounds),
  };
}

export function attachOverlayView(options: AttachOverlayOptions): OverlayView {
  const { window, htmlPath, preloadPath } = options;
  const view = createChildWebContentsView(preloadPath);
  window.contentView.addChildView(view);
  const updateBounds = bindWindowBounds(window, view);
  void view.webContents.loadFile(htmlPath);
  return createOverlayHandle(window, view, updateBounds);
}
