/**
 * Window crash and console error/warning monitor for soak fuzzer (T4.4).
 */

import type { BrowserWindow } from 'electron';
import type { Logger } from '../../logging/logger.js';
import { noopLogger } from '../../logging/logger.js';
import type { ConsoleMessageReport, CrashReport } from './types.js';

interface WindowListeners {
  readonly renderProcessGone: (
    event: unknown,
    details: { reason: string; exitCode: number }
  ) => void;
  readonly consoleMessage: (
    detailsOrEvent: unknown,
    levelArg?: unknown,
    messageArg?: unknown
  ) => void;
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
      consoleMessage: (details, level, msg) => this.handleConsole(windowId, details, level, msg),
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
    this.logger.error('soak fuzzer: renderer crash detected', { windowId, reason: details.reason });
    this.onCrash?.(report);
  }

  private handleConsole(
    windowId: string,
    first: unknown,
    levelArg?: unknown,
    msgArg?: unknown
  ): void {
    const parsed = parseConsoleDetails(first, levelArg, msgArg);
    if (!parsed) return;
    const report: ConsoleMessageReport = {
      windowId,
      timestamp: Date.now(),
      level: parsed.level,
      message: parsed.message,
      lineNumber: parsed.lineNumber,
      sourceId: parsed.sourceId,
    };
    this.logger.warn('soak fuzzer: console error/warning detected', {
      windowId,
      level: parsed.level,
      message: parsed.message,
    });
    this.onError?.(report);
  }
}

interface ParsedConsole {
  level: 'error' | 'warning';
  message: string;
  lineNumber?: number | undefined;
  sourceId?: string | undefined;
}

function parseConsoleDetails(
  first: unknown,
  levelArg?: unknown,
  msgArg?: unknown
): ParsedConsole | null {
  if (typeof first === 'object' && first !== null && 'message' in first) {
    const details = first as {
      level?: string;
      message?: string;
      lineNumber?: number;
      sourceId?: string;
    };
    if (details.level === 'error' || details.level === 'warning') {
      return {
        level: details.level,
        message: details.message ?? '',
        lineNumber: details.lineNumber,
        sourceId: details.sourceId,
      };
    }
    return null;
  }
  if (levelArg === 3) {
    return { level: 'error', message: typeof msgArg === 'string' ? msgArg : String(msgArg ?? '') };
  }
  if (levelArg === 2) {
    return {
      level: 'warning',
      message: typeof msgArg === 'string' ? msgArg : String(msgArg ?? ''),
    };
  }
  return null;
}
