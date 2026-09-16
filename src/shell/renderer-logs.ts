import type { BrowserWindow, IpcMain, WebContents } from 'electron';
import {
  LOG_LEVELS,
  createChildLogger,
  type LogFields,
  type Logger,
  type LogLevel,
} from '../logging/logger.js';

export const RENDERER_LOG_CHANNEL = 'eggshell:log';

export interface RendererLogPayload {
  level: LogLevel;
  message: string;
  fields?: LogFields;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === '[object Object]'
  );
}

function extractPayloadLevel(value: unknown): LogLevel | undefined {
  if (typeof value === 'string' && LOG_LEVELS.includes(value as LogLevel)) {
    return value as LogLevel;
  }
  return undefined;
}

export function parseRendererLogPayload(payload: unknown): RendererLogPayload | undefined {
  if (!isPlainObject(payload)) {
    return undefined;
  }
  const level = extractPayloadLevel(payload['level']);
  const message = payload['message'];
  const fields = payload['fields'];
  if (level === undefined || typeof message !== 'string') {
    return undefined;
  }
  if (fields !== undefined && !isPlainObject(fields)) {
    return undefined;
  }
  if (fields !== undefined) {
    return { level, message, fields };
  }
  return { level, message };
}

function mapConsoleLevel(level: 'info' | 'warning' | 'error' | 'debug'): LogLevel {
  if (level === 'warning') {
    return 'warn';
  }
  return level;
}

export function forwardConsoleMessages(
  window: Pick<BrowserWindow, 'webContents'>,
  windowId: string,
  logger: Logger
): void {
  const child = createChildLogger(logger, `renderer:${windowId}`);
  window.webContents.on('console-message', event => {
    const level = mapConsoleLevel(event.level);
    child[level](event.message, { source: event.sourceId, line: event.lineNumber });
  });
}

export function registerRendererLogChannel(
  ipcMain: Pick<IpcMain, 'on'>,
  windowIdOf: (sender: WebContents) => string | undefined,
  logger: Logger
): void {
  ipcMain.on(RENDERER_LOG_CHANNEL, (event, payload) => {
    const parsed = parseRendererLogPayload(payload);
    if (parsed === undefined) {
      return;
    }
    const windowId = windowIdOf(event.sender) ?? 'unknown';
    const child = createChildLogger(logger, `renderer:${windowId}`);
    child[parsed.level](parsed.message, parsed.fields);
  });
}
