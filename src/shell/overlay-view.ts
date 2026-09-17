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
  readonly fadeDurationMs?: number | undefined;
}

interface OverlayState {
  hideTimer?: ReturnType<typeof setTimeout> | undefined;
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

function runTransitionScript(view: WebContentsView, action: 'show' | 'hide'): void {
  if (view.webContents.isDestroyed()) return;
  const script = `window.${action} && window.${action}()`;
  void view.webContents.executeJavaScript(script).catch(() => undefined);
}

function triggerTransition(view: WebContentsView, action: 'show' | 'hide'): void {
  if (view.webContents.isLoading()) {
    view.webContents.once('did-finish-load', () => runTransitionScript(view, action));
    return;
  }
  runTransitionScript(view, action);
}

function cancelHideTimer(state: OverlayState): void {
  if (state.hideTimer === undefined) return;
  clearTimeout(state.hideTimer);
  state.hideTimer = undefined;
}

function scheduleHide(
  window: BrowserWindow,
  view: WebContentsView,
  fadeDurationMs: number,
  state: OverlayState
): void {
  cancelHideTimer(state);
  state.hideTimer = setTimeout(() => {
    state.hideTimer = undefined;
    if (!view.webContents.isDestroyed()) view.setVisible(false);
    if (!window.isDestroyed()) window.webContents.focus();
  }, fadeDurationMs);
}

function destroyOverlay(
  window: BrowserWindow,
  view: WebContentsView,
  onResize: () => void,
  state: OverlayState
): void {
  cancelHideTimer(state);
  if (!window.isDestroyed()) {
    window.removeListener('resize', onResize);
    window.contentView.removeChildView(view);
  }
  if (!view.webContents.isDestroyed()) {
    view.webContents.close();
  }
}

function showOverlay(view: WebContentsView, updateBounds: () => void, state: OverlayState): void {
  cancelHideTimer(state);
  updateBounds();
  view.setVisible(true);
  view.webContents.focus();
  triggerTransition(view, 'show');
}

function hideOverlay(
  window: BrowserWindow,
  view: WebContentsView,
  fadeDurationMs: number,
  state: OverlayState
): void {
  triggerTransition(view, 'hide');
  if (fadeDurationMs > 0) {
    scheduleHide(window, view, fadeDurationMs, state);
    return;
  }
  view.setVisible(false);
  if (!window.isDestroyed()) window.webContents.focus();
}

function createOverlayHandle(
  window: BrowserWindow,
  view: WebContentsView,
  updateBounds: () => void,
  fadeDurationMs: number,
  state: OverlayState
): OverlayView {
  return {
    get visible(): boolean {
      return state.hideTimer === undefined && view.getVisible();
    },
    webContents: view.webContents,
    window,
    show: () => showOverlay(view, updateBounds, state),
    hide: () => hideOverlay(window, view, fadeDurationMs, state),
    destroy: () => destroyOverlay(window, view, updateBounds, state),
  };
}

export function attachOverlayView(options: AttachOverlayOptions): OverlayView {
  const { window, htmlPath, preloadPath, fadeDurationMs = 0 } = options;
  const view = createChildWebContentsView(preloadPath);
  const state: OverlayState = {};
  window.contentView.addChildView(view);
  const updateBounds = bindWindowBounds(window, view);
  void view.webContents.loadFile(htmlPath);
  return createOverlayHandle(window, view, updateBounds, fadeDurationMs, state);
}
