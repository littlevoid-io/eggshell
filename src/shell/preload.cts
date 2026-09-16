// Sandboxed preload: CommonJS, imports electron only, exposes one narrow bridge.
import electron = require('electron');

const IPC_CHANNEL = 'eggshell:ipc';
const EVENT_CHANNEL = 'eggshell:event';
const LOG_CHANNEL = 'eggshell:log';

function sendLog(level: string, message: string, fields?: Record<string, unknown>): void {
  electron.ipcRenderer.send(LOG_CHANNEL, { level, message, fields });
}

function subscribeToEvent(channel: string, listener: (...args: unknown[]) => void): () => void {
  const onEvent = (_event: unknown, payload: unknown): void => {
    const data = payload as { channel?: unknown; args?: unknown } | null | undefined;
    if (data && data.channel === channel && Array.isArray(data.args)) {
      listener(...data.args);
    }
  };
  electron.ipcRenderer.on(EVENT_CHANNEL, onEvent);
  return () => {
    electron.ipcRenderer.removeListener(EVENT_CHANNEL, onEvent);
  };
}

const bridge = {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> =>
    electron.ipcRenderer.invoke(IPC_CHANNEL, { channel, args }),
  on: (channel: string, listener: (...args: unknown[]) => void): (() => void) =>
    subscribeToEvent(channel, listener),
  log: {
    debug: (message: string, fields?: Record<string, unknown>): void =>
      sendLog('debug', message, fields),
    info: (message: string, fields?: Record<string, unknown>): void =>
      sendLog('info', message, fields),
    warn: (message: string, fields?: Record<string, unknown>): void =>
      sendLog('warn', message, fields),
    error: (message: string, fields?: Record<string, unknown>): void =>
      sendLog('error', message, fields),
  },
};

electron.contextBridge.exposeInMainWorld('eggshell', bridge);
