import type { BrowserWindow } from 'electron';
import type { Logger } from '../../logging/logger.js';
import { noopLogger } from '../../logging/logger.js';
import type { ConsoleMessageReport, CrashReport } from './types.js';

interface ConsoleMessageEvent {
  readonly level: string;
  readonly message: string;
  readonly lineNumber?: number | undefined;
  readonly sourceId?: string | undefined;
}

interface WindowListeners {
  readonly renderProcessGone: (
    event: unknown,
    details: { reason: string; exitCode: number }
  ) => void;
  readonly consoleMessage: (event: unknown) => void;
}

export interface WindowMonitorOptions {
  readonly onCrash?: ((report: CrashReport) => void) | undefined;
  readonly onError?: ((report: ConsoleMessageReport) => void) | undefined;
  readonly logger?: Logger | undefined;
}

export class WindowMonitor {
  private readonly onCrash?: ((report: CrashReport) => void) | undefined;
  private readonly onError?: ((report: ConsoleMessageReport) => void) | undefined;
  private readonly logger: Logger;
  private readonly windowsById = new Map<
    string,
    { win: BrowserWindow; listeners: WindowListeners }
  >();

  constructor(options: WindowMonitorOptions = {}) {
    this.onCrash = options.onCrash;
    this.onError = options.onError;
    this.logger = options.logger ?? noopLogger;
  }

  attach(windowId: string, win: BrowserWindow): void {
    if (this.windowsById.has(windowId)) return;
    const listeners: WindowListeners = {
      renderProcessGone: (_event, details) => this.handleCrash(windowId, details),
      consoleMessage: event => this.handleConsole(windowId, event),
    };
    win.webContents.on('render-process-gone', listeners.renderProcessGone);
    win.webContents.on('console-message', listeners.consoleMessage);
    this.windowsById.set(windowId, { win, listeners });
  }

  detach(windowId: string): void {
    const entry = this.windowsById.get(windowId);
    if (!entry) return;
    entry.win.webContents.removeListener('render-process-gone', entry.listeners.renderProcessGone);
    entry.win.webContents.removeListener('console-message', entry.listeners.consoleMessage);
    this.windowsById.delete(windowId);
  }

  dispose(): void {
    for (const windowId of [...this.windowsById.keys()]) {
      this.detach(windowId);
    }
  }

  private handleCrash(windowId: string, details: { reason: string; exitCode: number }): void {
    if (details.reason === 'clean-exit') return;
    const report: CrashReport = {
      windowId,
      timestamp: Date.now(),
      reason: details.reason,
      exitCode: details.exitCode,
    };
    this.logger.error('soak: renderer crash detected', { windowId, reason: details.reason });
    this.onCrash?.(report);
  }

  private handleConsole(windowId: string, event: unknown): void {
    if (typeof event !== 'object' || event === null || !('level' in event)) {
      return;
    }
    const { level, message, lineNumber, sourceId } = event as ConsoleMessageEvent;
    if (level !== 'error' && level !== 'warning') {
      return;
    }
    const report: ConsoleMessageReport = {
      windowId,
      timestamp: Date.now(),
      level,
      message: message ?? '',
      lineNumber,
      sourceId,
    };
    this.logger.warn('soak: console error/warning detected', { windowId, level, message });
    this.onError?.(report);
  }
}

export function createCollectorMonitor(
  collector: {
    recordCrash(crash: CrashReport): void;
    recordError(error: ConsoleMessageReport): void;
  },
  logger: Logger
): WindowMonitor {
  return new WindowMonitor({
    onCrash: crash => collector.recordCrash(crash),
    onError: error => collector.recordError(error),
    logger,
  });
}
