import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, WebContentsView } from 'electron';
import { CompanionViewManager } from './view.js';

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

describe('CompanionViewManager (T4.3)', () => {
  it('attaches WebContentsView and sizes to window on show', () => {
    const { window, contentView, listeners } = createMockBrowserWindow();
    const { view, setBounds, loadFile } = createMockView();

    const manager = new CompanionViewManager({
      assetPath: 'C:/assets/companion.html',
      viewFactory: () => view,
    });

    manager.show([window]);

    expect(contentView.addChildView).toHaveBeenCalledWith(view);
    expect(setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(loadFile).toHaveBeenCalledWith('C:/assets/companion.html');
    expect(listeners.has('resize')).toBe(true);
  });

  it('updates view bounds when window resize event fires', () => {
    const { window, listeners } = createMockBrowserWindow();
    const { view, setBounds } = createMockView();

    const manager = new CompanionViewManager({
      assetPath: 'C:/assets/companion.html',
      viewFactory: () => view,
    });

    manager.show([window]);
    expect(setBounds).toHaveBeenCalledTimes(1);

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

  it('detaches view and removes listener on hide and destroy', () => {
    const { window, contentView, listeners } = createMockBrowserWindow();
    const { view, close } = createMockView();

    const manager = new CompanionViewManager({
      assetPath: 'C:/assets/companion.html',
      viewFactory: () => view,
    });

    manager.show([window]);
    expect(contentView.addChildView).toHaveBeenCalledTimes(1);

    manager.hide([window]);
    expect(contentView.removeChildView).toHaveBeenCalledWith(view);
    expect(listeners.has('resize')).toBe(false);
    expect(listeners.has('closed')).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);

    manager.destroy();
  });

  it('detaches view and removes listeners on window closed event', () => {
    const { window, listeners, contentView } = createMockBrowserWindow();
    const { view, close } = createMockView();

    const manager = new CompanionViewManager({
      assetPath: 'C:/assets/companion.html',
      viewFactory: () => view,
    });

    manager.show([window]);
    const closedListener = listeners.get('closed');
    expect(closedListener).toBeDefined();

    // Simulate window closed before hide
    (window.isDestroyed as ReturnType<typeof vi.fn>).mockReturnValue(true);
    closedListener!();

    expect(listeners.has('resize')).toBe(false);
    expect(listeners.has('closed')).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
    expect(contentView.removeChildView).not.toHaveBeenCalled(); // since window is destroyed

    // hiding shouldn't throw or retry
    manager.hide([window]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not attach view to a destroyed window', () => {
    const { window, contentView } = createMockBrowserWindow();
    (window.isDestroyed as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const { view } = createMockView();

    const manager = new CompanionViewManager({
      assetPath: 'C:/assets/companion.html',
      viewFactory: () => view,
    });

    manager.show([window]);
    expect(contentView.addChildView).not.toHaveBeenCalled();
  });
});
