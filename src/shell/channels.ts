import type { Blackout } from './blackout.js';
import { broadcastEvent } from './broadcast.js';
import type { IpcRouter } from './ipc.js';
import type { ManagedWindow } from './windows/create.js';

export interface BuiltinChannelOptions {
  readonly windows: readonly ManagedWindow[];
  readonly quit: () => void;
  readonly blackout: Blackout;
}

export function registerBuiltinChannels(router: IpcRouter, options: BuiltinChannelOptions): void {
  const { windows, quit, blackout } = options;
  router.handle('app:quit', () => quit());
  router.handle('blackout:show', () => blackout.show());
  router.handle('blackout:hide', () => blackout.hide());
  router.handle('state-sync:update', (context, state) => {
    broadcastEvent(windows, 'state-sync:on-update', [state], context.sender);
  });
  router.handle('state-sync:send-event', (context, event) => {
    broadcastEvent(windows, 'state-sync:on-event', [event], context.sender);
  });
  router.handle('state-sync:request-current', context => {
    broadcastEvent(windows, 'state-sync:on-request-current', [], context.sender);
  });
}
