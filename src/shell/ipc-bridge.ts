/**
 * Main-process half of the IPC bridge (T3.3): the only path a renderer has
 * into `PluginRegistry.dispatchIpc`. Renderer content may be remote and
 * untrusted (see `preload.ts`'s module doc), so every decision here is
 * defensive by default:
 *
 * - **One bridge channel, not one per plugin channel.** Plugins register
 *   their namespaced channels into the `PluginRegistry` dynamically, at
 *   `setup()` time, which this module has no visibility into and no
 *   reliable ordering against (this bridge is wired to a `BrowserWindow`
 *   at window-creation time, plugin `setup()` runs afterward in T3.4's
 *   `launch()` sequence). Registering one real `ipcMain.handle` per plugin
 *   channel would mean either re-scanning the registry on every plugin
 *   registration or accepting a race where a channel registered after this
 *   file wires up is silently unreachable. A single `ipcMain.handle` sidesteps
 *   that entirely: every renderer call funnels through one envelope
 *   `{ channel, args }`, so allow-listing, envelope validation, and
 *   `windowId` derivation happen exactly once, in exactly one place, no
 *   matter when a plugin registered its handler.
 * - **`windowId` is derived here, from the Electron event's sender, and
 *   nowhere else.** A renderer-supplied `windowId` in the envelope is not
 *   merely overridden -- it is never read in the first place, because the
 *   envelope schema below only extracts `channel`/`args`. If the renderer
 *   could supply it, a compromised page could impersonate another window
 *   to a plugin.
 * - **The envelope is validated; per-channel payloads are not.** Per
 *   `plugin-api/types.ts`'s doc comments, per-channel semantics are the
 *   registering plugin's job (I5: core does not know any plugin's schema).
 *   This module only checks that the envelope is well-formed: a non-empty
 *   channel string, a JSON-serializable args array, within a size bound.
 * - **A plugin handler's throw is sanitized before it reaches the
 *   renderer.** Electron's own `ipcMain.handle` already strips a thrown
 *   error down to its `message` (never the stack) before replying, but the
 *   message itself can still carry a filesystem path or other main-process
 *   detail (e.g. a raw `ENOENT` message). This module replaces it with a
 *   fixed, channel-scoped message and logs the original in full main-side.
 */

import { z } from 'zod';
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { ConfigError } from '../errors.js';
import { formatIssuePath } from '../config/validate.js';
import { noopLogger } from '../logging/logger.js';
import type { Logger } from '../logging/logger.js';
import type { IpcInvocation } from '../plugin-api/types.js';

/**
 * The single channel every renderer invokes through, regardless of which
 * namespaced plugin channel it actually targets. Duplicated verbatim (not
 * imported) in `preload.ts`, which must keep its imports to `electron` alone
 * under `sandbox: true` -- see that file's module doc.
 */
export const IPC_BRIDGE_CHANNEL = 'eggshell:ipc';

/**
 * Bound on the serialized `args` array, in UTF-8 bytes. This channel carries
 * small control-plane payloads (commands, status snippets) between a kiosk
 * shell and its plugins, never bulk data transfer, so a generous-but-finite
 * bound catches a runaway or hostile payload without constraining any
 * legitimate use seen so far.
 */
export const MAX_ENVELOPE_BYTES = 1_048_576;

/** Structural slice of `PluginRegistry` this module needs -- injected, like `ipcMain`, so tests use a fake. */
export interface IpcDispatcher {
  dispatchIpc(channel: string, invocation: IpcInvocation, ...args: unknown[]): unknown;
}

export interface RegisterIpcBridgeOptions {
  /** Injected rather than imported so tests can supply a fake with no real Electron runtime. */
  readonly ipcMain: IpcMain;
  readonly registry: IpcDispatcher;
  /**
   * Derives the invoking window's id from the Electron event's sender.
   * Returns `undefined` for a sender this shell does not recognize as one
   * of its own windows, which the bridge treats as a hard rejection.
   */
  readonly windowIdForWebContents: (webContents: WebContents) => string | undefined;
  readonly logger?: Logger;
  /**
   * The only channel strings a renderer may invoke. Defaults to empty
   * (deny-all) rather than unrestricted -- an omitted allow-list is far more
   * likely to be an oversight than an intentional "allow everything", and
   * default-deny is this codebase's rule everywhere else a policy is
   * unspecified (see `policy.ts`).
   *
   * Accepts a plain iterable *or* a zero-arg function returning one, and is
   * re-resolved on **every** invocation -- never snapshotted once at
   * `registerIpcBridge()` time. This bridge is wired at window-creation
   * time, before T3.4's `launch()` runs plugin `setup()`, so a snapshot
   * taken at registration would permanently be empty; passing something
   * like `() => registry.listIpcChannels()` (or a live, growing
   * array/Set the caller mutates in place) lets the effective allow-list
   * grow as plugins register, without the caller having to re-call
   * `registerIpcBridge`.
   *
   * This is deliberately a *second* gate, distinct from "is this channel
   * registered in the `PluginRegistry`" -- the registry already rejects a
   * genuinely unregistered channel on its own (`dispatchIpc` throws
   * `PluginError`). The allow-list exists for defense-in-depth on top of
   * that: a kiosk's main window can display remote, untrusted page
   * content, and a plugin channel meant only for the shell's own trusted
   * UI (e.g. a dashboard's "restart the app" command) must not become
   * reachable just because it happens to be registered. Nothing here is
   * per-window yet, but the shape (`windowIdForWebContents` is already
   * per-call) leaves room for a future per-window allow-list without
   * another signature change.
   */
  readonly allowedChannels?: Iterable<string> | (() => Iterable<string>);
}

export interface IpcBridgeHandle {
  /** Removes the `ipcMain.handle` registration. Safe to call at most once per `registerIpcBridge` call. */
  dispose(): void;
}

const envelopeSchema = z.object({
  channel: z.string().min(1, 'channel must be a non-empty string'),
  args: z.array(z.unknown()),
});

interface ParsedEnvelope {
  readonly channel: string;
  readonly args: unknown[];
}

/** Wraps one or more field-path issues into the project's `ConfigError` convention (I7). */
function rejectEnvelope(summary: string, path: string, message: string): never {
  throw ConfigError.fromIssues([{ path, message }], summary);
}

/**
 * Serializes `args` through `JSON.stringify`, rejecting a function, symbol,
 * or bigint anywhere in the structure (a replacer throw aborts the whole
 * stringify) and a circular reference (which `JSON.stringify` itself
 * detects and throws on). The resulting string is reused by the caller for
 * the size check, rather than stringifying twice.
 */
function stringifyArgsOrReject(args: unknown[]): string {
  try {
    return JSON.stringify(args, (_key, value) => {
      const kind = typeof value;
      if (kind === 'function' || kind === 'symbol' || kind === 'bigint') {
        throw new Error(`args contains a non-JSON-serializable ${kind} value`);
      }
      return value;
    });
  } catch (error) {
    rejectEnvelope(
      'IPC bridge rejected a non-JSON-serializable payload',
      'args',
      error instanceof Error ? error.message : 'args is not JSON-serializable'
    );
  }
}

/** Validates the envelope's shape only -- never a plugin's per-channel payload semantics (see module doc). */
function parseEnvelope(raw: unknown): ParsedEnvelope {
  const result = envelopeSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(issue => ({
      path: formatIssuePath(issue.path),
      message: issue.message,
    }));
    throw ConfigError.fromIssues(issues, 'IPC bridge rejected a malformed envelope');
  }

  const { channel, args } = result.data;
  const serializedArgs = stringifyArgsOrReject(args);
  const byteLength = Buffer.byteLength(serializedArgs, 'utf8');
  if (byteLength > MAX_ENVELOPE_BYTES) {
    rejectEnvelope(
      'IPC bridge rejected an oversized payload',
      'args',
      `args is ${byteLength} bytes, exceeding the ${MAX_ENVELOPE_BYTES}-byte limit.`
    );
  }

  return { channel, args };
}

/**
 * Resolves `allowedChannels` fresh for this one invocation -- see the
 * doc comment on `RegisterIpcBridgeOptions.allowedChannels` for why this is
 * never cached across calls (the ordering race that motivated it).
 */
function resolveAllowedChannels(
  allowedChannels: RegisterIpcBridgeOptions['allowedChannels']
): ReadonlySet<string> {
  if (allowedChannels === undefined) {
    return new Set();
  }
  const iterable = typeof allowedChannels === 'function' ? allowedChannels() : allowedChannels;
  return new Set(iterable);
}

/** Rejects a channel that is not in the injected allow-list -- a clear error, never a silent no-op (see module doc). */
function assertChannelAllowed(channel: string, allowedChannels: ReadonlySet<string>): void {
  if (!allowedChannels.has(channel)) {
    rejectEnvelope(
      'IPC bridge rejected a channel outside the allow-list',
      'channel',
      `Channel "${channel}" is not permitted through the IPC bridge.`
    );
  }
}

/**
 * Derives `windowId` from the event's sender only -- this is the entire
 * defense against a renderer impersonating another window (see module
 * doc). An unrecognized sender is rejected before the envelope is even
 * inspected.
 */
function deriveWindowId(
  event: IpcMainInvokeEvent,
  windowIdForWebContents: RegisterIpcBridgeOptions['windowIdForWebContents']
): string {
  const windowId = windowIdForWebContents(event.sender);
  if (windowId === undefined) {
    rejectEnvelope(
      'IPC bridge rejected a request from an unrecognized sender',
      'sender',
      'The invoking webContents is not a window this shell manages.'
    );
  }
  return windowId;
}

export function registerIpcBridge(options: RegisterIpcBridgeOptions): IpcBridgeHandle {
  const logger = options.logger ?? noopLogger;

  const listener = async (
    event: IpcMainInvokeEvent,
    ...invokeArgs: unknown[]
  ): Promise<unknown> => {
    const windowId = deriveWindowId(event, options.windowIdForWebContents);
    const { channel, args } = parseEnvelope(invokeArgs[0]);
    assertChannelAllowed(channel, resolveAllowedChannels(options.allowedChannels));

    try {
      return await options.registry.dispatchIpc(channel, { windowId }, ...args);
    } catch (error) {
      logger.error(`IPC channel "${channel}" handler threw`, {
        channel,
        windowId,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
      // Deliberately a fresh message, never the original error's own
      // `message` -- that can itself carry a filesystem path (e.g. a raw
      // ENOENT) even though Electron already strips the stack.
      throw new Error(`IPC channel "${channel}" failed.`);
    }
  };

  options.ipcMain.handle(IPC_BRIDGE_CHANNEL, listener);

  return {
    dispose: () => options.ipcMain.removeHandler(IPC_BRIDGE_CHANNEL),
  };
}
