/**
 * View manager for companion overlay (T4.3).
 *
 * Attaches WebContentsView to target BrowserWindow.contentView in Electron >= 44.
 */

import { WebContentsView, type BrowserWindow } from 'electron';
import type { Logger } from '../../logging/logger.js';
import { noopLogger } from '../../logging/logger.js';

interface ActiveViewRecord {
  readonly view: WebContentsView;
  readonly onResize: () => void;
  readonly onClosed: () => void;
}

export interface CompanionViewManagerOptions {
  readonly assetPath: string;
  readonly preloadPath?: string | undefined;
  readonly viewFactory?:
    ((options?: { webPreferences?: Electron.WebPreferences }) => WebContentsView) | undefined;
  readonly logger?: Logger | undefined;
}

export class CompanionViewManager {
  private readonly viewsByWindow = new Map<BrowserWindow, ActiveViewRecord>();
  private readonly assetPath: string;
  private readonly preloadPath?: string | undefined;
  private readonly viewFactory?:
    ((options?: { webPreferences?: Electron.WebPreferences }) => WebContentsView) | undefined;
  private readonly logger: Logger;

  constructor(options: CompanionViewManagerOptions) {
    this.assetPath = options.assetPath;
    this.preloadPath = options.preloadPath;
    this.viewFactory = options.viewFactory;
    this.logger = options.logger ?? noopLogger;
  }

  show(windows: readonly BrowserWindow[]): void {
    for (const window of windows) {
      this.attachToWindow(window);
    }
  }

  hide(windows: readonly BrowserWindow[]): void {
    for (const window of windows) {
      this.detachFromWindow(window);
    }
  }

  destroy(): void {
    const windows = [...this.viewsByWindow.keys()];
    this.hide(windows);
  }

  private attachToWindow(window: BrowserWindow): void {
    if (window.isDestroyed() || this.viewsByWindow.has(window)) {
      return;
    }

    const view = this.createView();
    const bounds = window.getContentBounds();
    view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });

    const onResize = () => this.handleWindowResize(window, view);
    const onClosed = () => this.detachFromWindow(window);
    window.on('resize', onResize);
    window.on('closed', onClosed);

    window.contentView.addChildView(view);
    this.viewsByWindow.set(window, { view, onResize, onClosed });
    void view.webContents.loadFile(this.assetPath);
    this.logger.debug('companion overlay: attached view to window', { id: window.id });
  }

  private detachFromWindow(window: BrowserWindow): void {
    const record = this.viewsByWindow.get(window);
    if (!record) {
      return;
    }
    this.viewsByWindow.delete(window);
    window.removeListener('resize', record.onResize);
    window.removeListener('closed', record.onClosed);
    if (!window.isDestroyed()) {
      window.contentView.removeChildView(record.view);
    }
    if (!record.view.webContents.isDestroyed()) {
      record.view.webContents.close();
    }
    this.logger.debug('companion overlay: detached view from window', { id: window.id });
  }

  private handleWindowResize(window: BrowserWindow, view: WebContentsView): void {
    if (!window.isDestroyed()) {
      const bounds = window.getContentBounds();
      view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
    }
  }

  private createView(): WebContentsView {
    const webPreferences: Electron.WebPreferences = {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    };
    if (this.preloadPath !== undefined) {
      webPreferences.preload = this.preloadPath;
    }
    if (this.viewFactory !== undefined) {
      return this.viewFactory({ webPreferences });
    }
    return new WebContentsView({ webPreferences });
  }
}
