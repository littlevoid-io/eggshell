import type { IpcMain, WebContents } from 'electron';
import type { Logger } from '../logging/logger.js';

export const IPC_CHANNEL = 'eggshell:ipc';
export const EVENT_CHANNEL = 'eggshell:event';

export interface IpcContext {
  readonly windowId: string | undefined;
  readonly sender: WebContents;
}

export type IpcHandler = (context: IpcContext, ...args: unknown[]) => unknown;

export interface IpcRouter {
  handle(channel: string, handler: IpcHandler): void;
  attach(ipcMain: Pick<IpcMain, 'handle'>): void;
  channels(): readonly string[];
}

export function parseIpcPayload(
  payload: unknown
): { channel: string; args: unknown[] } | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record['channel'] !== 'string' || !Array.isArray(record['args'])) {
    return undefined;
  }
  return { channel: record['channel'], args: record['args'] };
}

export function sendEvent(
  target: Pick<WebContents, 'send' | 'isDestroyed'>,
  channel: string,
  ...args: unknown[]
): void {
  if (target.isDestroyed()) {
    return;
  }
  target.send(EVENT_CHANNEL, { channel, args });
}

async function routeIpc(
  handlersByChannel: ReadonlyMap<string, IpcHandler>,
  windowIdOf: (sender: WebContents) => string | undefined,
  logger: Logger,
  sender: WebContents,
  payload: unknown
): Promise<unknown> {
  const parsed = parseIpcPayload(payload);
  if (!parsed) {
    throw new Error('Invalid IPC payload');
  }
  const handler = handlersByChannel.get(parsed.channel);
  const windowId = windowIdOf(sender);
  if (!handler) {
    logger.warn(`Unknown IPC channel "${parsed.channel}"`, { windowId });
    throw new Error(`Unknown IPC channel "${parsed.channel}"`);
  }
  return await handler({ windowId, sender }, ...parsed.args);
}

export function createIpcRouter(
  windowIdOf: (sender: WebContents) => string | undefined,
  logger: Logger
): IpcRouter {
  const handlersByChannel = new Map<string, IpcHandler>();
  return {
    handle: (channel, handler) => {
      if (handlersByChannel.has(channel)) {
        throw new Error(`Channel "${channel}" is already registered`);
      }
      handlersByChannel.set(channel, handler);
    },
    channels: () => Array.from(handlersByChannel.keys()),
    attach: ipcMain => {
      ipcMain.handle(IPC_CHANNEL, (event, payload) =>
        routeIpc(handlersByChannel, windowIdOf, logger, event.sender, payload)
      );
    },
  };
}
