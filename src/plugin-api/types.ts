/**
 * Plugin-facing types for the plugin seam (T2.10). Plugins register *into*
 * `ShellContext`; core never imports `src/plugins/**` in either direction
 * (I5). Keep this module Electron-free — a plugin importing it must not
 * transitively gain access to any core internal, so it depends only on
 * `../logging/logger.js` and `../paths/roots.js`.
 */

import type { Logger } from '../logging/logger.js';
import type { ShellRoots } from '../paths/roots.js';

export interface ShellPlugin<TNative = unknown> {
  id: string;
  setup(context: ShellContext<TNative>): void | Promise<void>;
  teardown?(): void | Promise<void>;
}

/**
 * Handle for a window, supplied by the shell layer at runtime. Generic over
 * `TNative` (defaulting to `unknown` so this module stays Electron-free and
 * unit-testable without a display). A plugin parameterized with a real window
 * type (e.g. `BrowserWindow`) sees `native` typed strongly. A plugin never
 * constructs one of these; it only ever receives them from `WindowRegistry`.
 */
export interface WindowHandle<TNative = unknown> {
  readonly id: string;
  readonly native?: TNative;
}

/**
 * Minimal read-only window lookup a plugin can legitimately need: which
 * windows exist, and finding one by id. Deliberately excludes any mutation
 * (move, resize, close) — placement decisions belong to the layout layer,
 * not to plugins, so this stays a lookup surface only.
 *
 * Known gap, deferred deliberately: there is no way for a plugin to push a
 * message to a specific window's renderer (e.g. Electron's
 * `webContents.send`) — `status` below is pull-only today. Adding a `send`-
 * style primitive later only breaks the Phase 3 shell implementer, not any
 * plugin consuming this interface, so it is deferred until a real plugin
 * needs it (a connectivity-reactive overlay is the likely first case)
 * rather than guessing its shape now.
 */
export interface WindowRegistry<TNative = unknown> {
  get(id: string): WindowHandle<TNative> | undefined;
  list(): readonly WindowHandle<TNative>[];
}

/**
 * Identifies which window's renderer invoked an IPC channel. Deliberately
 * not the raw Electron `IpcMainInvokeEvent` — handing that to a plugin would
 * expose `event.sender` (any window's `webContents`), a capability
 * escalation that bypasses this seam entirely. This is a plain interface
 * rather than a bare `windowId` string parameter so more fields can be added
 * later without another breaking change to `IpcHandler`. The Phase 3 shell
 * adapter derives `windowId` from the Electron event and must never forward
 * the event itself.
 */
export interface IpcInvocation {
  readonly windowId: string;
}

export type IpcHandler = (invocation: IpcInvocation, ...args: unknown[]) => unknown;

/**
 * Registers a handler under `channel`. The registry namespaces this to
 * `<pluginId>:<channel>` automatically — two plugins registering the same
 * local name never collide, and neither can hijack the other's channel.
 * This is a security boundary, not a convenience.
 *
 * Per-channel payload and response shapes are validated by the plugin
 * itself, never by core (I5: core does not know any plugin's schema). The
 * shell's preload bridge (T3.3) validates only the envelope — channel name,
 * general well-formedness — not per-channel semantics.
 */
export interface IpcRegistrar {
  handle(channel: string, handler: IpcHandler): void;
}

export type CommandHandler = (...args: unknown[]) => unknown;

/** Registers a command under `name`, namespaced per plugin exactly like `ipc`. */
export interface CommandRegistrar {
  register(name: string, handler: CommandHandler): void;
}

/**
 * Publishes/reads this plugin's own status value (e.g. for a dashboard).
 * Deliberately pull-only today — a reader calls `read()` when it wants the
 * latest value. See the gap noted on `WindowRegistry` above for why a push
 * primitive is deferred rather than missing by oversight.
 */
export interface StatusPublisher {
  publish(value: unknown): void;
  read(): unknown;
}

export interface OverlayOptions {
  readonly assetPath: string;
  readonly preloadPath?: string | undefined;
}

/** A managed overlay view a plugin can show/hide by window id, without ever touching a native window type. */
export interface OverlayHandle {
  /** Shows the overlay on the given window ids, or every currently known window if omitted. */
  show(windowIds?: readonly string[]): void;
  hide(windowIds?: readonly string[]): void;
  /** Tears down every attached view. Call on plugin teardown. */
  destroy(): void;
}

export interface ViewsCapability {
  /** Creates a new managed overlay view. Each call is an independent overlay (its own view instances per window). */
  createOverlay(options: OverlayOptions): OverlayHandle;
}

export interface ShellContext<TNative = unknown> {
  readonly windows: WindowRegistry<TNative>;
  readonly views: ViewsCapability;
  readonly ipc: IpcRegistrar;
  readonly commands: CommandRegistrar;
  readonly status: StatusPublisher;
  /** Pre-scoped to this plugin's id — every call is tagged without extra work. */
  readonly logger: Logger;
  readonly roots: ShellRoots;
  /**
   * This plugin's own validated slice of `config.plugins[id]`, typed
   * `unknown` because core does not know any plugin's schema — the plugin
   * validates it with its own (e.g. its own zod schema). This is never the
   * full `ShellConfig`: handing over the whole config would let a plugin
   * read and silently depend on unrelated settings, which is exactly what
   * this seam exists to prevent.
   */
  readonly config: unknown;
  /**
   * Signal aborted if the plugin is tearing down or the shell is closing.
   * Plugins with an async setup should check this signal after yielding,
   * before performing side effects like registering a handler or creating a view.
   */
  readonly signal: AbortSignal;
}

/** One plugin's `setup`/`teardown` failure, isolated so it never aborts the others. */
export interface PluginFailure {
  readonly pluginId: string;
  readonly phase: 'setup' | 'teardown';
  readonly error: unknown;
}
