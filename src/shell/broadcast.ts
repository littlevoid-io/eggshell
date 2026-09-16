import type { WebContents } from 'electron';
import { sendEvent } from './ipc.js';
import type { ManagedWindow } from './windows/create.js';

export function broadcastEvent(
  windows: readonly ManagedWindow[],
  channel: string,
  args: readonly unknown[],
  except?: WebContents
): void {
  for (const { window } of windows) {
    if (window.webContents !== except) {
      sendEvent(window.webContents, channel, ...args);
    }
  }
}
