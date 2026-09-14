/**
 * `<pluginId>:<name>` namespaced handler storage backing `ShellContext.ipc`
 * and `ShellContext.commands`, plus per-plugin status storage backing
 * `ShellContext.status`. This is pure mechanical bookkeeping — build the
 * key, reject a duplicate, look a handler up, invoke it — identical for
 * `ipc` and `commands`, and unrelated to plugin lifecycle. Whether the seam
 * is still open to new registrations is a lifecycle concern owned by
 * `registry.ts`, which composes these stores with that lifecycle.
 */

import { PluginError } from '../errors.js';

/**
 * `Args` is the handler's parameter tuple (e.g. `unknown[]` for commands,
 * `[IpcInvocation, ...unknown[]]` for ipc) rather than the handler's whole
 * function type — a tuple genericizes cleanly over "a fixed first parameter
 * plus a trailing rest", which a single function-type parameter cannot.
 */
export class NamespacedHandlers<Args extends unknown[]> {
  private readonly handlers = new Map<string, (...args: Args) => unknown>();

  /** Registers `handler` under `<pluginId>:<name>`. Throws `PluginError` on a duplicate within `pluginId`. */
  register(
    pluginId: string,
    name: string,
    handler: (...args: Args) => unknown,
    kind: string
  ): void {
    const key = `${pluginId}:${name}`;
    if (this.handlers.has(key)) {
      throw new PluginError(`Plugin "${pluginId}" already registered ${kind} "${name}".`, {
        pluginId,
      });
    }
    this.handlers.set(key, handler);
  }

  /** Invokes the handler at the fully-namespaced `key`. Throws `PluginError` if none is registered. */
  invoke(key: string, kind: string, args: Args): unknown {
    const handler = this.handlers.get(key);
    if (!handler) {
      throw new PluginError(`Unknown ${kind} "${key}".`);
    }
    return handler(...args);
  }

  /** Every registered `<pluginId>:<name>` key, in registration order. */
  keys(): readonly string[] {
    return [...this.handlers.keys()];
  }
}

/** Per-plugin last-published status value, keyed by plugin id (not namespaced further — one value per plugin). */
export class StatusStore {
  private readonly values = new Map<string, unknown>();

  publish(pluginId: string, value: unknown): void {
    this.values.set(pluginId, value);
  }

  read(pluginId: string): unknown {
    return this.values.get(pluginId);
  }
}
