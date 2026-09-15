import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, WebContentsView } from 'electron';
import { noopLogger } from '../logging/logger.js';
import type { WindowHandle, WindowRegistry } from '../plugin-api/types.js';
import { createOverlayViewsCapability, OverlayViewManager } from './overlay-views.js';

function createMockBrowserWindow(id = 1): {
  window: BrowserWindow;
  contentView: {
    addChildView: ReturnType<typeof vi.fn>;
    removeChildView: ReturnType<typeof vi.fn>;
  };
  listeners: Map<string, () => void>;
} {
  const listeners = new Map<string, () => void>();
  const contentView = {
    addChildView: vi.fn(),
    removeChildView: vi.fn(),
  };

  const window = {
    id,
    isDestroyed: vi.fn().mockReturnValue(false),
    getContentBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 1920, height: 1080 }),
    contentView,
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
      return window;
    }),
    removeListener: vi.fn((event: string) => {
      listeners.delete(event);
      return window;
    }),
  } as unknown as BrowserWindow;

  return { window, contentView, listeners };
}

function createMockView(): {
  view: WebContentsView;
  setBounds: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
} {
  const setBounds = vi.fn();
  const loadFile = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  const isDestroyed = vi.fn().mockReturnValue(false);
  const view = {
    setBounds,
    webContents: { loadFile, close, isDestroyed },
  } as unknown as WebContentsView;

  return { view, setBounds, loadFile, close, isDestroyed };
}

function createMockRegistry(
  handles: readonly WindowHandle<BrowserWindow>[]
): WindowRegistry<BrowserWindow> {
  const byId = new Map(handles.map(h => [h.id, h]));
  return {
    get: id => byId.get(id),
    list: () => handles,
  };
}

describe('createOverlayViewsCapability', () => {
  it('attaches view to all windows when windowIds are omitted', () => {
    const win1 = createMockBrowserWindow(1);
    const win2 = createMockBrowserWindow(2);
    const view1 = createMockView();
    const view2 = createMockView();
    const views = [view1.view, view2.view];
    let callCount = 0;

    const registry = createMockRegistry([
      { id: 'main', native: win1.window },
      { id: 'side', native: win2.window },
    ]);
    const capability = createOverlayViewsCapability(
      registry,
      noopLogger,
      'test overlay',
      () => views[callCount++] ?? createMockView().view
    );

    const overlay = capability.createOverlay({ assetPath: 'C:/assets/test.html' });
    overlay.show();

    expect(win1.contentView.addChildView).toHaveBeenCalledWith(view1.view);
    expect(win2.contentView.addChildView).toHaveBeenCalledWith(view2.view);
    expect(view1.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(view1.loadFile).toHaveBeenCalledWith('C:/assets/test.html');
  });

  it('attaches view only to specified window ids', () => {
    const win1 = createMockBrowserWindow(1);
    const win2 = createMockBrowserWindow(2);
    const view = createMockView();

    const registry = createMockRegistry([
      { id: 'main', native: win1.window },
      { id: 'side', native: win2.window },
    ]);
    const capability = createOverlayViewsCapability(
      registry,
      noopLogger,
      'test overlay',
      () => view.view
    );

    const overlay = capability.createOverlay({ assetPath: 'C:/assets/test.html' });
    overlay.show(['side']);

    expect(win1.contentView.addChildView).not.toHaveBeenCalled();
    expect(win2.contentView.addChildView).toHaveBeenCalledWith(view.view);
  });

  it('hides view by window id and detaches view', () => {
    const { window, contentView, listeners } = createMockBrowserWindow(1);
    const { view, close } = createMockView();

    const registry = createMockRegistry([{ id: 'main', native: window }]);
    const capability = createOverlayViewsCapability(
      registry,
      noopLogger,
      'test overlay',
      () => view
    );

    const overlay = capability.createOverlay({ assetPath: 'C:/assets/test.html' });
    overlay.show(['main']);
    expect(contentView.addChildView).toHaveBeenCalledWith(view);

    overlay.hide(['main']);
    expect(contentView.removeChildView).toHaveBeenCalledWith(view);
    expect(listeners.has('resize')).toBe(false);
    expect(listeners.has('closed')).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('updates view bounds when window resize event fires', () => {
    const { window, listeners } = createMockBrowserWindow(1);
    const { view, setBounds } = createMockView();

    const registry = createMockRegistry([{ id: 'main', native: window }]);
    const capability = createOverlayViewsCapability(
      registry,
      noopLogger,
      'test overlay',
      () => view
    );

    const overlay = capability.createOverlay({ assetPath: 'C:/assets/test.html' });
    overlay.show();

    (window.getContentBounds as ReturnType<typeof vi.fn>).mockReturnValue({
      x: 0,
      y: 0,
      width: 2560,
      height: 1440,
    });
    const resizeListener = listeners.get('resize');
    expect(resizeListener).toBeDefined();
    resizeListener!();

    expect(setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 2560, height: 1440 });
  });

  it('detaches view when window emits closed event', () => {
    const { window, listeners, contentView } = createMockBrowserWindow(1);
    const { view, close } = createMockView();

    const registry = createMockRegistry([{ id: 'main', native: window }]);
    const capability = createOverlayViewsCapability(
      registry,
      noopLogger,
      'test overlay',
      () => view
    );

    const overlay = capability.createOverlay({ assetPath: 'C:/assets/test.html' });
    overlay.show();

    const closedListener = listeners.get('closed');
    expect(closedListener).toBeDefined();

    (window.isDestroyed as ReturnType<typeof vi.fn>).mockReturnValue(true);
    closedListener!();

    expect(listeners.has('resize')).toBe(false);
    expect(listeners.has('closed')).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
    expect(contentView.removeChildView).not.toHaveBeenCalled();
  });

  it('destroy tears down every attached view', () => {
    const win1 = createMockBrowserWindow(1);
    const win2 = createMockBrowserWindow(2);
    const view1 = createMockView();
    const view2 = createMockView();
    const views = [view1.view, view2.view];
    let callCount = 0;

    const registry = createMockRegistry([
      { id: 'main', native: win1.window },
      { id: 'side', native: win2.window },
    ]);
    const capability = createOverlayViewsCapability(
      registry,
      noopLogger,
      'test overlay',
      () => views[callCount++] ?? createMockView().view
    );

    const overlay = capability.createOverlay({ assetPath: 'C:/assets/test.html' });
    overlay.show();

    overlay.destroy();
    expect(win1.contentView.removeChildView).toHaveBeenCalledWith(view1.view);
    expect(win2.contentView.removeChildView).toHaveBeenCalledWith(view2.view);
    expect(view1.close).toHaveBeenCalledTimes(1);
    expect(view2.close).toHaveBeenCalledTimes(1);
  });

  it('does not attach view to a destroyed window', () => {
    const { window, contentView } = createMockBrowserWindow(1);
    (window.isDestroyed as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const { view } = createMockView();

    const registry = createMockRegistry([{ id: 'main', native: window }]);
    const capability = createOverlayViewsCapability(
      registry,
      noopLogger,
      'test overlay',
      () => view
    );

    const overlay = capability.createOverlay({ assetPath: 'C:/assets/test.html' });
    overlay.show(['main']);

    expect(contentView.addChildView).not.toHaveBeenCalled();
  });
});

describe('OverlayViewManager directly', () => {
  it('passes preloadPath to webPreferences when creating default view', () => {
    const { window } = createMockBrowserWindow(1);
    const manager = new OverlayViewManager({
      assetPath: 'C:/assets/test.html',
      preloadPath: 'C:/preload.cjs',
      logPrefix: 'test',
      viewFactory: options => {
        expect(options?.webPreferences?.preload).toBe('C:/preload.cjs');
        return createMockView().view;
      },
    });

    manager.show([window]);
    manager.destroy();
  });
});
