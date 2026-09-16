// Sandboxed preload: CommonJS, imports electron only, exposes one narrow bridge.
import electron = require('electron');

const IPC_CHANNEL = 'eggshell:ipc';
const LOG_CHANNEL = 'eggshell:log';

function sendLog(level: string, message: string, fields?: Record<string, unknown>): void {
  electron.ipcRenderer.send(LOG_CHANNEL, { level, message, fields });
}

const bridge = {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> =>
    electron.ipcRenderer.invoke(IPC_CHANNEL, { channel, args }),
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
