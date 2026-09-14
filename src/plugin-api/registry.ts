/**
 * Plugin registry (T2.10): the runtime behind the plugin seam. Creates one
 * `ShellContext` per registered `ShellPlugin` and runs `setup` for each.
 * Owns plugin lifecycle only — the namespaced ipc/command/status mechanics
 * it composes into each context live in `registries.ts`.
 *
 * Sequential by design: `setup` calls run one after another, in registration
 * order, each fully awaited before the next starts. This keeps plugin log
 * lines and channel/command registration order deterministic, and matches
 * the ordering guarantee `teardownAll` relies on (exact reverse of a known,
 * fully-settled order). Nothing here needs setup calls to run independently
 * of each other's timing, so concurrency would only trade that determinism
 * for speed the exhibit start-up path does not need.
 *
 * A throwing/rejecting `setup` or `teardown` is isolated: logged at `error`,
 * recorded in `getFailures()`, and the rest continue. One broken optional
 * overlay must never stop the exhibit from starting or shutting down.
 */

import { PluginError } from '../errors.js';
import { createChildLogger, noopLogger } from '../logging/logger.js';
import type { Logger } from '../logging/logger.js';
import type { ShellRoots } from '../paths/roots.js';
import type { ExhibitConfig } from '../config/types.js';
import { createShellContext } from './context.js';
import { NamespacedHandlers, StatusStore } from './registries.js';
import type {
  ShellPlugin,
  ShellContext,
  WindowRegistry,
  IpcInvocation,
  IpcHandler,
  CommandHandler,
  PluginFailure,
} from './types.js';

/** Used when the caller has no real window registry to inject yet (tests; before Phase 3 wires Electron). */
const emptyWindowRegistry: WindowRegistry = {
  get: () => undefined,
  list: () => [],
};

export interface PluginRegistryOptions {
  roots: ShellRoots;
  logger?: Logger;
  /** `config.plugins` from the validated `ExhibitConfig` — each plugin sees only its own `[id]` slice. */
  pluginConfig?: ExhibitConfig['plugins'];
  windows?: WindowRegistry;
}

export class PluginRegistry {
  private readonly roots: ShellRoots;
  private readonly logger: Logger;
  private readonly pluginConfig: ExhibitConfig['plugins'] | undefined;
  private readonly windows: WindowRegistry;

  private readonly plugins = new Map<string, ShellPlugin>();
  private readonly setupSucceededIds: string[] = [];
  private readonly failures: PluginFailure[] = [];
  private readonly ipc = new NamespacedHandlers<[IpcInvocation, ...unknown[]]>();
  private readonly commands = new NamespacedHandlers<unknown[]>();
  private readonly status = new StatusStore();
  private closed = false;

  constructor(options: PluginRegistryOptions) {
    this.roots = options.roots;
    this.logger = options.logger ?? noopLogger;
    this.pluginConfig = options.pluginConfig;
    this.windows = options.windows ?? emptyWindowRegistry;
  }

  /** Adds a plugin. Throws `PluginError` on a duplicate id or once setup has closed. */
  register(plugin: ShellPlugin): void {
    if (this.closed) {
      throw new PluginError(
        `Cannot register plugin "${plugin.id}": the plugin seam has already closed setup.`,
        { pluginId: plugin.id }
      );
    }
    if (this.plugins.has(plugin.id)) {
      throw new PluginError(`Plugin id "${plugin.id}" is already registered.`, {
        pluginId: plugin.id,
      });
    }
    this.plugins.set(plugin.id, plugin);
  }

  /** Runs `setup` for every registered plugin, sequentially, then closes the seam. */
  async setupAll(): Promise<readonly PluginFailure[]> {
    if (this.closed) {
      throw new PluginError('setupAll() has already run; the plugin seam is closed.');
    }
    for (const plugin of this.plugins.values()) {
      const context = this.createContextFor(plugin.id);
      try {
        await plugin.setup(context);
        this.setupSucceededIds.push(plugin.id);
      } catch (error) {
        this.recordFailure(plugin.id, 'setup', error);
      }
    }
    this.closed = true;
    return this.failures;
  }

  /** Runs `teardown` in reverse setup order. A throwing teardown does not stop the rest. */
  async teardownAll(): Promise<readonly PluginFailure[]> {
    const teardownFailures: PluginFailure[] = [];
    for (const pluginId of [...this.setupSucceededIds].reverse()) {
      const plugin = this.plugins.get(pluginId);
      if (!plugin?.teardown) {
        continue;
      }
      try {
        await plugin.teardown();
      } catch (error) {
        teardownFailures.push(this.recordFailure(pluginId, 'teardown', error));
      }
    }
    return teardownFailures;
  }

  /** Invokes a namespaced command (e.g. `"dashboard:refresh"`). Throws `PluginError` if unknown. */
  invokeCommand(name: string, ...args: unknown[]): unknown {
    return this.commands.invoke(name, 'command', args);
  }

  /**
   * Dispatches a namespaced IPC channel (e.g. `"dashboard:status"`) on
   * behalf of `invocation.windowId`. Throws `PluginError` if unknown. The
   * Phase 3 shell adapter builds `invocation` from the Electron event and
   * must never forward the event itself (see `IpcInvocation`).
   */
  dispatchIpc(channel: string, invocation: IpcInvocation, ...args: unknown[]): unknown {
    return this.ipc.invoke(channel, 'IPC channel', [invocation, ...args]);
  }

  getStatus(pluginId: string): unknown {
    return this.status.read(pluginId);
  }

  getFailures(): readonly PluginFailure[] {
    return this.failures;
  }

  isClosed(): boolean {
    return this.closed;
  }

  private createContextFor(pluginId: string): ShellContext {
    return createShellContext({
      pluginId,
      roots: this.roots,
      logger: this.logger,
      config: this.pluginConfig?.[pluginId],
      windows: this.windows,
      onRegisterIpcHandler: (channel, handler) => this.registerIpc(pluginId, channel, handler),
      onRegisterCommand: (name, handler) => this.registerCommand(pluginId, name, handler),
      onPublishStatus: value => this.status.publish(pluginId, value),
      onReadStatus: () => this.status.read(pluginId),
    });
  }

  private registerIpc(pluginId: string, channel: string, handler: IpcHandler): void {
    this.assertOpen(pluginId);
    this.ipc.register(pluginId, channel, handler, 'IPC channel');
  }

  private registerCommand(pluginId: string, name: string, handler: CommandHandler): void {
    this.assertOpen(pluginId);
    this.commands.register(pluginId, name, handler, 'command');
  }

  private assertOpen(pluginId: string): void {
    if (this.closed) {
      throw new PluginError(
        `Plugin "${pluginId}" cannot register a new channel or command: setup has already closed.`,
        { pluginId }
      );
    }
  }

  private recordFailure(
    pluginId: string,
    phase: PluginFailure['phase'],
    error: unknown
  ): PluginFailure {
    const failure: PluginFailure = { pluginId, phase, error };
    this.failures.push(failure);
    const scopedLogger = createChildLogger(this.logger, pluginId);
    scopedLogger.error(`Plugin "${pluginId}" failed during ${phase}.`, {
      phase,
      error: error instanceof Error ? error.message : String(error),
    });
    return failure;
  }
}
