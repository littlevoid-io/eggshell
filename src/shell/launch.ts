/**
 * `launch()` — the library's public entry point (T3.4). Orchestrates every
 * seam Phase 2/3 built, in the order ARCHITECTURE.md and ROADMAP.md pin
 * down: single-instance lock -> resolve roots -> validate config + apply the
 * deployment override -> start `production`/`always` processes and await
 * readiness -> resolve the touch probe once -> `resolveLayout` -> create
 * windows -> harden -> run plugin `setup` -> arm the display supervisor and
 * watchdog. Shutdown is registered on `before-quit`.
 *
 * ## The `whenReady()` seam
 *
 * Two things happen strictly *before* `app.whenReady()`, and everything else
 * happens strictly after:
 *
 *   - `acquireSingleInstanceLock` (T3.5), because Electron only emits
 *     `second-instance` after `ready` — a listener attached later could miss
 *     an early duplicate launch (a startup task firing twice at logon).
 *   - Nothing else. In particular, `options.screen` is never read before
 *     `whenReady()` resolves — Electron throws if it is. Config validation,
 *     process start, layout resolution, and window creation all happen after.
 *
 * This ordering is the single most error-prone part of this file specifically
 * because the two constraints pull in opposite directions: the lock must be
 * first (cheapest, and the only gate that stops a second instance from doing
 * anything else), but `screen` cannot be touched until `whenReady()` — so the
 * lock is the only pipeline step on the "before" side of the seam.
 *
 * ## "Did not launch"
 *
 * Electron does not terminate the instance that loses the single-instance
 * lock — it keeps a live event loop until something calls `app.quit()`. I6
 * forbids `process.exit()` here, so `launch()` returns a discriminated
 * `LaunchResult` (`launched: false` carries only `reason`; `launched: true`
 * carries the real handles) — mirroring `SingleInstanceLockResult` — so a
 * caller (the CLI, or a consumer's own main.ts) cannot reach for `windows` or
 * `shutdown` without first narrowing on `launched`, and cannot silently
 * ignore the false branch the way a bare boolean invites.
 *
 * ## Fatal layout problems fail loudly
 *
 * An `error`-severity `LayoutProblem` from the initial `resolveLayout` call
 * throws a `LayoutError` before any window is created — never a degraded
 * black window. This is deliberately the same policy `display-events.ts`
 * already applies to every *later* re-resolution (a runtime display change):
 * one rule, enforced at both the startup and the steady-state layout path,
 * rather than a stricter one here and a looser one there.
 *
 * ## Composing the supervisor with shutdownAll
 *
 * `ProcessSupervisor` (T2.8) starts and monitors processes; `shutdownAll`
 * (T2.9) needs the `ManagedProcess` handles it created to actually signal
 * them. `ProcessSupervisor.getHandles()` returns exactly those — the current
 * live handle per process, already excluding anything never successfully
 * spawned or since exited — so `startProcesses` below simply reads it after
 * `start()` resolves, and `performShutdown` reads it again right before
 * `shutdownAll`, with no separate tracking wrapper around `spawn` needed.
 */

import type { BrowserWindow, IpcMain, Screen, WebContents } from 'electron';

import { LayoutError } from '../errors.js';
import type { Clock } from '../clock.js';
import { noopLogger } from '../logging/logger.js';
import type { Logger } from '../logging/logger.js';
import { resolveRoots } from '../paths/roots.js';
import type { ShellRootsInput } from '../paths/roots.js';
import { loadShellConfig } from '../config/overrides.js';
import type { ProcessConfig, ShellConfig } from '../config/types.js';
import { resolveLayout } from '../layout/resolve.js';
import type { LayoutProblem, WindowPlacement } from '../layout/types.js';
import { noopTouchProbe } from '../layout/probes/noop.js';
import type { TouchProbe } from '../layout/probes/types.js';
import { createProcessSupervisor } from '../process/supervisor.js';
import type { ProcessSupervisor, SpawnFn } from '../process/supervisor.js';
import { spawnManaged } from '../process/spawn.js';
import { shutdownAll as defaultShutdownAll } from '../process/shutdown.js';
import type { ShutdownTarget, TaskkillInvoker } from '../process/shutdown.js';
import type { ManagedProcess } from '../process/types.js';
import { PluginRegistry } from '../plugin-api/registry.js';
import type { ShellPlugin } from '../plugin-api/types.js';

import { acquireSingleInstanceLock } from './single-instance.js';
import type { SingleInstanceApp, SingleInstanceLockResult } from './single-instance.js';
import {
  applyKioskLock,
  createWindowRegistry,
  createWindows,
  applyPlacement,
  toDisplaySnapshots,
} from './windows.js';
import type { BrowserWindowFactory, ManagedWindow, WindowSpec } from './windows.js';
import {
  applyNavigationGuards,
  applyPermissionHandlers,
  createHardenedWindowOptions,
} from './hardening.js';
import { registerIpcBridge } from './ipc-bridge.js';
import type { IpcBridgeHandle } from './ipc-bridge.js';
import { createWatchdog } from './watchdog.js';
import type { Watchdog, WatchdogOptions } from './watchdog.js';
import { createDisplayEventBridge } from './display-events.js';
import type { DisplayEventBridge } from './display-events.js';

const DEFAULT_SHUTDOWN_GRACE_MS = 5000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The slice of Electron's `App` `launch()` needs, layered over
 * `SingleInstanceApp` (T3.5). Declared independently of Electron's own `App`
 * type — never imported — so tests supply a plain object and never need an
 * Electron runtime; the real `app` singleton satisfies this structurally.
 */
export interface LaunchApp extends Omit<SingleInstanceApp, 'on'> {
  whenReady(): Promise<void>;
  quit(): void;
  // Both `on` overloads are declared directly here (rather than inherited via
  // `extends`) because TypeScript does not merge overloads across an
  // `extends` boundary when the base and derived signatures share a method
  // name but differ on a literal parameter -- see the T3.4 report for detail.
  on(
    event: 'second-instance',
    listener: (event: unknown, argv: string[], workingDirectory: string) => void
  ): unknown;
  on(event: 'before-quit', listener: (event: { preventDefault(): void }) => void): unknown;
}

export interface LaunchOptions {
  /** The consumer's raw, unvalidated code config. Never read before the single-instance lock is held. */
  readonly config: unknown;
  readonly roots: ShellRootsInput;
  readonly app: LaunchApp;
  /** Electron's `screen` module. Must not be touched before `app.whenReady()` — see module doc. */
  readonly screen: Screen;
  readonly ipcMain: IpcMain;
  readonly browserWindowFactory: BrowserWindowFactory;
  /** Absolute path to the built preload script (`dist/preload.cjs`). The consumer resolves this, never discovered. */
  readonly preloadPath: string;
  readonly clock: Clock;
  readonly logger?: Logger;
  /** Defaults to `noopTouchProbe` — a consumer opts in to real touch detection explicitly. */
  readonly touchProbe?: TouchProbe;
  /** Defaults to `spawnManaged`. Injectable so tests never launch a real process. */
  readonly spawn?: SpawnFn;
  readonly plugins?: readonly ShellPlugin<BrowserWindow>[];
  /** Skips kiosk escape/devtools blocking. Default `false`. */
  readonly isDevelopment?: boolean;
  readonly watchdog?: Partial<Omit<WatchdogOptions, 'clock' | 'logger' | 'reload'>>;
  /** Top-level fallback for `shutdownAll`'s `graceMs`; each process's own `shutdown.graceMs` config takes precedence. */
  readonly shutdownGraceMs?: number;
  readonly killTree?: boolean;
  readonly taskkill?: TaskkillInvoker;
  /** Injectable so shutdown ordering is assertable without spawning real processes. Defaults to the real `shutdownAll`. */
  readonly shutdownAll?: typeof defaultShutdownAll;
  readonly processHost?: string;
}

/**
 * Discriminated on `launched`, mirroring `SingleInstanceLockResult` — see
 * module doc. `launched: false` is the only branch carrying `reason`;
 * `launched: true` is the only branch carrying the running shell's handles.
 */
export type LaunchResult =
  | {
      readonly launched: true;
      readonly windows: readonly ManagedWindow[];
      readonly pluginRegistry: PluginRegistry<BrowserWindow>;
      /** Runs the full shutdown sequence once. Also wired automatically to `before-quit`. */
      readonly shutdown: () => Promise<void>;
    }
  | { readonly launched: false; readonly reason: string };

// ---------------------------------------------------------------------------
// launch()
// ---------------------------------------------------------------------------

export async function launch(options: LaunchOptions): Promise<LaunchResult> {
  const logger = options.logger ?? noopLogger;
  const windowsHolder: { current: readonly ManagedWindow[] } = { current: [] };

  const lock = acquireSingleInstanceLock({
    app: options.app,
    logger,
    onSecondInstance: () => focusWindows(windowsHolder.current),
  });
  if (!lock.held) {
    return { launched: false, reason: lock.reason };
  }

  await options.app.whenReady();

  const roots = resolveRoots(options.roots);
  const shellConfig = loadShellConfig({ config: options.config, roots, logger });

  const processSupervisor = await startProcesses(shellConfig, options, logger);

  const touchDisplayIds = await resolveTouchDisplayIds(shellConfig, options, logger);
  const touchHolder: { current: readonly number[] } = { current: touchDisplayIds };

  const resolution = resolveLayout({
    displays: toDisplaySnapshots(
      options.screen.getAllDisplays(),
      options.screen.getPrimaryDisplay().id
    ),
    windows: shellConfig.windows,
    roles: shellConfig.display.roles,
    touchDisplayIds,
  });
  assertNoFatalLayoutProblems(resolution.problems, logger);
  const placementsByWindowId = new Map(resolution.placements.map(p => [p.windowId, p]));

  const { windows, windowsById, windowIdByWebContents } = buildWindows(
    shellConfig,
    options,
    placementsByWindowId,
    logger
  );
  windowsHolder.current = windows;

  const pluginRegistry = new PluginRegistry({
    roots,
    logger,
    pluginConfig: shellConfig.plugins,
    windows: createWindowRegistry(windows),
  });

  // Registered exactly once, process-wide -- see module doc / constraint 4.
  // `allowedChannels` is a live getter, never a snapshot -- constraint 5 --
  // so a channel a plugin registers during `setupAll()` below becomes
  // reachable without re-registering this handler.
  const ipcHandle = registerIpcBridge({
    ipcMain: options.ipcMain,
    registry: pluginRegistry,
    windowIdForWebContents: webContents => windowIdByWebContents.get(webContents),
    logger,
    allowedChannels: () => pluginRegistry.listIpcChannels(),
  });

  for (const plugin of options.plugins ?? []) {
    pluginRegistry.register(plugin);
  }
  await pluginRegistry.setupAll();

  const { watchdog, displayBridge } = armSupervision(
    shellConfig,
    options,
    windows,
    windowsById,
    touchHolder,
    logger
  );

  const state: LaunchState = {
    options,
    logger,
    shellConfig,
    windows,
    watchdog,
    displayBridge,
    ipcHandle,
    pluginRegistry,
    processSupervisor,
  };
  const shutdown = (): Promise<void> => performShutdown(state);
  registerShutdown(options, lock, logger, shutdown);

  return { launched: true, windows, pluginRegistry, shutdown };
}

// ---------------------------------------------------------------------------
// Touch probe -- resolved once, at the I/O edge, never from an event handler
// ---------------------------------------------------------------------------

async function resolveTouchDisplayIds(
  shellConfig: ShellConfig,
  options: LaunchOptions,
  logger: Logger
): Promise<readonly number[]> {
  if (!shellConfig.display.touchProbe.enabled) {
    return [];
  }
  const probe = options.touchProbe ?? noopTouchProbe;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), shellConfig.display.touchProbe.timeoutMs);
  try {
    return await probe.detect(controller.signal);
  } catch (error) {
    // TouchProbe's own contract says "must resolve, never reject" -- this is
    // a defensive second line, not a documented path (see T2.3's interface).
    logger.warn('launch: touch probe threw; continuing with no touch displays known', {
      error: describeError(error),
    });
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------

async function startProcesses(
  shellConfig: ShellConfig,
  options: LaunchOptions,
  logger: Logger
): Promise<ProcessSupervisor> {
  const supervisor = createProcessSupervisor({
    configs: shellConfig.processes,
    phase: 'production',
    clock: options.clock,
    logger,
    spawn: options.spawn ?? spawnManaged,
    ...(options.processHost === undefined ? {} : { host: options.processHost }),
  });

  try {
    await supervisor.start();
  } catch (error) {
    // A later process in config order failed; disarm the supervisor's own
    // restart bookkeeping and best-effort kill whatever earlier processes
    // did start, rather than leaving them orphaned holding ports.
    supervisor.dispose();
    await abortPartialProcesses(supervisor, options, logger);
    throw error;
  }

  return supervisor;
}

async function abortPartialProcesses(
  supervisor: ProcessSupervisor,
  options: LaunchOptions,
  logger: Logger
): Promise<void> {
  const handles = supervisor.getHandles();
  if (handles.size === 0) {
    return;
  }
  try {
    await (options.shutdownAll ?? defaultShutdownAll)(
      buildShutdownTargets(handles, new Map()),
      buildShutdownOptions(options, logger)
    );
  } catch (error) {
    logger.error('launch: cleanup after a process failed to start also failed', {
      error: describeError(error),
    });
  }
}

function buildShutdownTargets(
  handles: ReadonlyMap<string, ManagedProcess>,
  configsById: ReadonlyMap<string, ProcessConfig>
): ShutdownTarget[] {
  return [...handles.entries()].map(([id, handle]) => {
    const shutdown = configsById.get(id)?.shutdown;
    return {
      handle,
      ...(shutdown === undefined
        ? {}
        : { signal: shutdown.signal as NodeJS.Signals, graceMs: shutdown.graceMs }),
    };
  });
}

/** Shared `shutdownAll` options builder for both the process-start-failure cleanup path and real shutdown. */
function buildShutdownOptions(
  options: LaunchOptions,
  logger: Logger
): {
  readonly graceMs: number;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly killTree?: boolean;
  readonly taskkill?: TaskkillInvoker;
} {
  return {
    graceMs: options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS,
    clock: options.clock,
    logger,
    ...(options.killTree === undefined ? {} : { killTree: options.killTree }),
    ...(options.taskkill === undefined ? {} : { taskkill: options.taskkill }),
  };
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

interface BuiltWindows {
  readonly windows: readonly ManagedWindow[];
  readonly windowsById: ReadonlyMap<string, ManagedWindow>;
  /** Populated as each window is constructed; mutable afterwards if a plugin creates its own window -- constraint 6. */
  readonly windowIdByWebContents: WeakMap<WebContents, string>;
}

function allowedOriginsFor(url: string): readonly string[] {
  try {
    return [new URL(url).origin];
  } catch {
    return [];
  }
}

function buildWindows(
  shellConfig: ShellConfig,
  options: LaunchOptions,
  placementsByWindowId: ReadonlyMap<string, WindowPlacement>,
  logger: Logger
): BuiltWindows {
  const webPreferences = createHardenedWindowOptions(options.preloadPath).webPreferences;
  const specs: WindowSpec[] = shellConfig.windows.map(w => ({ id: w.id, webPreferences }));
  const windows = createWindows(specs, options.browserWindowFactory);
  const windowsById = new Map(windows.map(w => [w.id, w]));
  const configsById = new Map(shellConfig.windows.map(w => [w.id, w]));
  const windowIdByWebContents = new WeakMap<WebContents, string>();
  const isDevelopment = options.isDevelopment ?? false;

  for (const window of windows) {
    const windowConfig = configsById.get(window.id);
    if (windowConfig === undefined) {
      continue;
    }
    windowIdByWebContents.set(window.native.webContents, window.id);

    const placement = placementsByWindowId.get(window.id);
    if (placement !== undefined) {
      applyPlacement(window.native, placement, logger);
      // Escape/devtools blocking only makes sense once a window is actually
      // locked into kiosk/fullscreen -- an ordinary 'windowed' placement
      // (including one `resolveLayout` downgraded from a spanAll+kiosk
      // contradiction) must stay escapable.
      if (placement.mode !== 'windowed') {
        applyKioskLock(window.native, { isDevelopment }, logger);
      }
    }

    applyPermissionHandlers(window.native.webContents.session, shellConfig.permissions, logger);
    applyNavigationGuards(window.native.webContents, allowedOriginsFor(windowConfig.url), logger);

    if (windowConfig.showWhenReady) {
      window.native.show();
    }
  }

  return { windows, windowsById, windowIdByWebContents };
}

function focusWindows(windows: readonly ManagedWindow[]): void {
  for (const window of windows) {
    if (window.native.isMinimized()) {
      window.native.restore();
    }
    window.native.focus();
  }
}

function assertNoFatalLayoutProblems(problems: readonly LayoutProblem[], logger: Logger): void {
  const errors: LayoutProblem[] = [];
  for (const problem of problems) {
    const fields = { code: problem.code, windowId: problem.windowId, fieldPath: problem.fieldPath };
    if (problem.severity === 'error') {
      errors.push(problem);
      logger.error(`launch: layout problem: ${problem.message}`, fields);
    } else {
      logger.warn(`launch: layout problem: ${problem.message}`, fields);
    }
  }
  if (errors.length > 0) {
    throw new LayoutError(
      `launch: layout resolution failed with ${errors.length} error-severity problem(s): ` +
        errors.map(problem => `${problem.fieldPath}: ${problem.message}`).join('; ')
    );
  }
}

// ---------------------------------------------------------------------------
// Supervision -- watchdog + display supervisor, both armed only after
// windows exist and plugin setup has run.
// ---------------------------------------------------------------------------

interface Supervision {
  readonly watchdog: Watchdog;
  readonly displayBridge: DisplayEventBridge;
}

function armSupervision(
  shellConfig: ShellConfig,
  options: LaunchOptions,
  windows: readonly ManagedWindow[],
  windowsById: ReadonlyMap<string, ManagedWindow>,
  touchHolder: { readonly current: readonly number[] },
  logger: Logger
): Supervision {
  const watchdog = createWatchdog({
    clock: options.clock,
    logger,
    reload: (windowId, reason) => {
      const window = windowsById.get(windowId);
      if (window === undefined) {
        return;
      }
      logger.info('launch: watchdog reloading window', { windowId, reason });
      window.native.webContents.reload();
    },
    ...options.watchdog,
  });
  for (const window of windows) {
    watchdog.attach(window.id, window.native.webContents);
  }

  // Must run after `app.whenReady()` -- see module doc. `launch()`'s own
  // control flow already guarantees that by construction: this function is
  // only ever called after `await options.app.whenReady()` above.
  const displayBridge = createDisplayEventBridge({
    screen: options.screen,
    clock: options.clock,
    windows,
    windowConfigs: shellConfig.windows,
    roles: shellConfig.display.roles,
    getTouchDisplayIds: () => touchHolder.current,
    logger,
    supervisor: shellConfig.display.supervisor,
  });

  return { watchdog, displayBridge };
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

interface LaunchState {
  readonly options: LaunchOptions;
  readonly logger: Logger;
  readonly shellConfig: ShellConfig;
  readonly windows: readonly ManagedWindow[];
  readonly watchdog: Watchdog;
  readonly displayBridge: DisplayEventBridge;
  readonly ipcHandle: IpcBridgeHandle;
  readonly pluginRegistry: PluginRegistry<BrowserWindow>;
  readonly processSupervisor: ProcessSupervisor;
}

/**
 * Runs the full shutdown sequence, in the order ROADMAP.md's constraint 7
 * requires: `watchdog.disarm()` and the display bridge's `dispose()` must
 * both run BEFORE `shutdownAll`, or the watchdog resurrects a window
 * shutdown is destroying and the restart policy respawns a process shutdown
 * is killing. `processSupervisor.dispose()` (disarming its own restart
 * policy) likewise runs before `shutdownAll` actually signals anything --
 * see `process/shutdown.ts`'s module doc for the identical rule.
 */
async function performShutdown(state: LaunchState): Promise<void> {
  const { options, logger, shellConfig, windows } = state;

  state.watchdog.disarm();
  state.displayBridge.dispose();
  state.ipcHandle.dispose();
  await state.pluginRegistry.teardownAll();
  state.processSupervisor.dispose();

  const configsById = new Map(shellConfig.processes.map(config => [config.id, config]));
  const targets = buildShutdownTargets(state.processSupervisor.getHandles(), configsById);
  await (options.shutdownAll ?? defaultShutdownAll)(targets, buildShutdownOptions(options, logger));

  state.watchdog.dispose();
  for (const window of windows) {
    window.native.destroy();
  }
}

/** Wires `shutdown` to `before-quit`: intercept once, run shutdown, release the lock, then let quit proceed. */
function registerShutdown(
  options: LaunchOptions,
  lock: Extract<SingleInstanceLockResult, { held: true }>,
  logger: Logger,
  shutdown: () => Promise<void>
): void {
  let quitting = false;
  options.app.on('before-quit', event => {
    if (quitting) {
      return;
    }
    quitting = true;
    event.preventDefault();
    void shutdown()
      .catch((error: unknown) => {
        logger.error('launch: shutdown failed', { error: describeError(error) });
      })
      .finally(() => {
        lock.release();
        options.app.quit();
      });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
