/**
 * Builds the `ShellContext` handed to exactly one plugin's `setup`. This
 * module only shapes the object; the registration bookkeeping — duplicate
 * ids/channels/commands, and rejecting registration once setup has closed —
 * lives in `registry.ts` and reaches this factory through the `on*`
 * callbacks below, so this file holds no mutable state of its own.
 */

import { createChildLogger } from '../logging/logger.js';
import type { Logger } from '../logging/logger.js';
import type { ShellRoots } from '../paths/roots.js';
import type { ShellContext, WindowRegistry, ViewsCapability, IpcHandler, CommandHandler } from './types.js';

export interface CreateShellContextOptions<TNative = unknown> {
  pluginId: string;
  roots: ShellRoots;
  logger: Logger;
  /** This plugin's own `config.plugins[id]` slice — see `ShellContext.config`. */
  config: unknown;
  windows: WindowRegistry<TNative>;
  views: ViewsCapability;
  onRegisterIpcHandler(channel: string, handler: IpcHandler): void;
  onRegisterCommand(name: string, handler: CommandHandler): void;
  onPublishStatus(value: unknown): void;
  onReadStatus(): unknown;
  signal: AbortSignal;
}

export function createShellContext<TNative = unknown>(
  options: CreateShellContextOptions<TNative>
): ShellContext<TNative> {
  return {
    windows: options.windows,
    views: options.views,
    ipc: { handle: options.onRegisterIpcHandler },
    commands: { register: options.onRegisterCommand },
    status: { publish: options.onPublishStatus, read: options.onReadStatus },
    logger: createChildLogger(options.logger, options.pluginId),
    roots: options.roots,
    config: options.config,
    signal: options.signal,
  };
}
