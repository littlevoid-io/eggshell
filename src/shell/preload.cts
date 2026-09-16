// Sandboxed preload: CommonJS, imports electron only, exposes one narrow bridge.
import electron = require('electron');

const IPC_CHANNEL = 'eggshell:ipc';

const bridge = {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> =>
    electron.ipcRenderer.invoke(IPC_CHANNEL, { channel, args }),
};

electron.contextBridge.exposeInMainWorld('eggshell', bridge);
