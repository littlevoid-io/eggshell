/**
 * Electron `screen` -> window supervisor wiring (T3.7).
 *
 * This is the file where the original lockup (ARCHITECTURE.md, "The lockup
 * that justifies the layout design") was actually caused: cause 3 was a
 * synchronous, timeout-less touch probe invalidated by every display-changed
 * event, blocking the event loop until the machine had to be power-cycled.
 * Every design choice below exists to make that structurally impossible
 * again, not just avoided by convention.
 *
 * ## Hazard 1 — the touch probe must never be awaited here
 *
 * `getTouchDisplayIds` is typed `() => readonly number[]` — synchronous,
 * already-resolved data, never a `Promise`. That is deliberate at the type
 * level: a `TouchProbe.detect()` (`src/layout/probes/types.ts`) returns a
 * `Promise`, so it cannot even be plugged into this slot directly, let alone
 * awaited from inside a `screen` event handler. The probe result reaches
 * `apply` like this:
 *
 *   1. The caller (T3.4's `launch()`) resolves the configured `TouchProbe`
 *      once, at startup, before constructing this bridge (an ordinary async
 *      `await probe.detect(signal)` at the I/O edge, not inside any event
 *      path).
 *   2. The caller stores the result in a plain mutable holder it owns and
 *      passes `() => holder.current` as `getTouchDisplayIds`.
 *   3. If the caller ever wants a fresher answer, it re-runs `detect()` on
 *      its own explicit schedule (e.g. a `setInterval` wholly outside this
 *      module) and updates the same holder. This file never schedules,
 *      triggers, or even knows about that refresh — it only ever calls the
 *      synchronous getter, at the moment `apply`/`verify` run.
 *
 * This file deliberately does not re-probe per display event — that was
 * exactly the original defect. `resolveLayout` (T2.2) already treats
 * `touchDisplayIds` as injected data for precisely this reason (I9,
 * ARCHITECTURE.md I10).
 *
 * ## Hazard 2 — `screen` cannot be touched before `app.whenReady()`
 *
 * `screen` is injected, never imported, and `createDisplayEventBridge` reads
 * it immediately (`getAllDisplays()`/`getPrimaryDisplay()`) to seed the
 * supervisor with today's topology. Electron throws if `screen` is touched
 * before `app.whenReady()` resolves, so **T3.4 must not call this factory
 * until after `whenReady()`** — there is no lazy path here that defers the
 * first read.
 *
 * ## Hazard 3 — do not defeat the supervisor's own dedup
 *
 * Applying a layout perturbs monitor work-area and re-fires
 * `display-metrics-changed` (cause 2 of the lockup). `topologySignature`
 * (T2.1) and the supervisor's dedup already absorb that. This file's job is
 * only to pass real, freshly-read snapshots through unchanged on every
 * event — never to add its own retry, debounce, or re-apply logic on top.
 * If a retry belongs anywhere, it belongs in `src/layout/supervisor.ts`, not
 * here.
 */

import type { Display, Screen } from 'electron';
import type { Clock } from '../clock.js';
import type { Logger } from '../logging/logger.js';
import { noopLogger } from '../logging/logger.js';
import { createTopologySupervisor } from '../layout/supervisor.js';
import type { TopologySupervisor, TopologySupervisorOptions } from '../layout/supervisor.js';
import { resolveLayout } from '../layout/resolve.js';
import type {
  Bounds,
  DisplaySnapshot,
  DisplayRoleRule,
  LayoutInput,
  WindowPlacement,
} from '../layout/types.js';
import type { WindowConfig } from '../config/types.js';
import { applyPlacement, toDisplaySnapshots } from './windows.js';
import type { ManagedWindow } from './windows.js';

// ---------------------------------------------------------------------------
// Tuning defaults — mirror config/schema.ts's supervisorPolicySchema
// defaults exactly (T3.4 passes that schema's output straight through as
// `SupervisorTuning`; these are only the fallback used when a caller
// constructs this bridge directly, without going through config at all).
// ---------------------------------------------------------------------------

const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_MAX_ATTEMPTS_PER_TOPOLOGY = 5;
const DEFAULT_VERIFY_DELAY_MS = 500;
const DEFAULT_GIVE_UP_AFTER_MS = 30_000;
const DEFAULT_MAX_GLOBAL_ATTEMPTS = 20;
const DEFAULT_GLOBAL_RATE_WINDOW_MS = 60_000;

/**
 * Pixel tolerance for `verify`'s bounds comparison. Exact equality is too
 * strict: fractional DPI scale factors (125%/150%/175%) round device pixels
 * on the way through Electron's own DIP<->physical conversion, and OS chrome
 * insets can shift a reported edge by a similarly small amount — both
 * routinely off by a pixel or two on real hardware, never by more. 2px
 * absorbs that rounding while staying far tighter than any real placement
 * error: a wrong-monitor or wrong-mode placement differs by hundreds or
 * thousands of pixels, so it can never slip through this tolerance.
 */
const DEFAULT_VERIFY_TOLERANCE_PX = 2;

export type SupervisorTuning = Omit<
  TopologySupervisorOptions,
  'clock' | 'apply' | 'verify' | 'logger'
>;

export interface DisplayEventBridgeOptions {
  /**
   * Electron's `screen` module, injected rather than imported (see module
   * doc, hazard 2). Must not be passed — and this factory must not be
   * called — before `app.whenReady()` has resolved.
   */
  readonly screen: Screen;
  readonly clock: Clock;
  /** The real windows this shell created (T3.1's `createWindows`), looked up by `WindowPlacement.windowId`. */
  readonly windows: readonly ManagedWindow[];
  /** The consumer's window configs, passed straight through to `resolveLayout` as data. */
  readonly windowConfigs: readonly WindowConfig[];
  readonly roles?: Readonly<Record<string, DisplayRoleRule>>;
  /**
   * Synchronous accessor for the last-known touch-capable display ids. See
   * module doc, hazard 1: this is data, never a probe call. Defaults to
   * `() => []` (no touch information).
   */
  readonly getTouchDisplayIds?: () => readonly number[];
  readonly logger?: Logger;
  /** Default 2 — see `DEFAULT_VERIFY_TOLERANCE_PX` above. */
  readonly verifyTolerancePx?: number;
  /** Supervisor tuning knobs, all optional; unset fields use this module's own defaults (see above). */
  readonly supervisor?: Partial<SupervisorTuning>;
}

export interface DisplayEventBridge {
  /** Removes every `screen` listener this bridge registered, then disposes the underlying supervisor. Idempotent. */
  dispose(): void;
  /** The underlying supervisor's state, exposed read-only for diagnostics/tests. */
  readonly supervisorState: TopologySupervisor['state'];
}

/** All state one bridge instance closes over, threaded explicitly rather than nested-function-captured, matching `layout/supervisor.ts`'s pattern. */
interface BridgeContext {
  readonly screen: Screen;
  readonly logger: Logger;
  readonly windowsById: ReadonlyMap<string, ManagedWindow>;
  readonly windowConfigs: readonly WindowConfig[];
  readonly roles: Readonly<Record<string, DisplayRoleRule>> | undefined;
  readonly getTouchDisplayIds: () => readonly number[];
  readonly verifyTolerancePx: number;
}

/**
 * Builds the supervisor and the `screen` subscription together as one unit,
 * rather than accepting a pre-built `TopologySupervisor`. A caller (T3.4) has
 * no correct way to hand-wire `apply`/`verify` itself without re-deriving
 * exactly the logic this file exists to own (resolve, look up the right
 * window, apply, tolerant-compare) — splitting construction across two call
 * sites would let T3.4 attach the supervisor's `apply`/`verify` to the wrong
 * window set, or to a stale `windowConfigs`/`roles` snapshot, with no type
 * error to catch it. One factory call means one place decides how a
 * `WindowPlacement` becomes a real `BrowserWindow` mutation, and `dispose()`
 * can then safely own tearing down both the listeners and the supervisor as
 * a single unit, exactly as the task's `dispose()` contract expects.
 *
 * Must be called only after `app.whenReady()` — see module doc, hazard 2.
 */
export function createDisplayEventBridge(options: DisplayEventBridgeOptions): DisplayEventBridge {
  const logger = options.logger ?? noopLogger;
  const ctx: BridgeContext = {
    screen: options.screen,
    logger,
    windowsById: new Map(options.windows.map(window => [window.id, window])),
    windowConfigs: options.windowConfigs,
    roles: options.roles,
    getTouchDisplayIds: options.getTouchDisplayIds ?? (() => []),
    verifyTolerancePx: options.verifyTolerancePx ?? DEFAULT_VERIFY_TOLERANCE_PX,
  };

  const supervisor = createTopologySupervisor({
    clock: options.clock,
    logger,
    debounceMs: options.supervisor?.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    maxAttemptsPerTopology:
      options.supervisor?.maxAttemptsPerTopology ?? DEFAULT_MAX_ATTEMPTS_PER_TOPOLOGY,
    verifyDelayMs: options.supervisor?.verifyDelayMs ?? DEFAULT_VERIFY_DELAY_MS,
    giveUpAfterMs: options.supervisor?.giveUpAfterMs ?? DEFAULT_GIVE_UP_AFTER_MS,
    maxGlobalAttempts: options.supervisor?.maxGlobalAttempts ?? DEFAULT_MAX_GLOBAL_ATTEMPTS,
    globalRateWindowMs: options.supervisor?.globalRateWindowMs ?? DEFAULT_GLOBAL_RATE_WINDOW_MS,
    apply: displays => applyDisplays(ctx, displays),
    verify: displays => verifyDisplays(ctx, displays),
  });

  const onDisplayEvent = (): void => {
    // Always re-read the full current set from `screen` rather than trusting
    // whatever single `Display` the event carried — see module doc, hazard
    // 3: this must stay a plain pass-through of real data, never its own
    // decision logic.
    const displays = readCurrentSnapshots(ctx.screen);
    supervisor.onDisplaysChanged(displays);
  };

  options.screen.on('display-added', onDisplayEvent);
  options.screen.on('display-removed', onDisplayEvent);
  options.screen.on('display-metrics-changed', onDisplayEvent);

  // Seed the supervisor with today's topology immediately — without this,
  // a machine whose displays never change again would never place a single
  // window. Safe only because the caller is required to construct this
  // bridge after `app.whenReady()` (hazard 2).
  onDisplayEvent();

  return {
    dispose(): void {
      options.screen.off('display-added', onDisplayEvent);
      options.screen.off('display-removed', onDisplayEvent);
      options.screen.off('display-metrics-changed', onDisplayEvent);
      supervisor.dispose();
    },
    get supervisorState() {
      return supervisor.state;
    },
  };
}

function readCurrentSnapshots(screen: Screen): DisplaySnapshot[] {
  const displays: Display[] = screen.getAllDisplays();
  const primaryDisplayId = screen.getPrimaryDisplay().id;
  return toDisplaySnapshots(displays, primaryDisplayId);
}

/**
 * Builds `resolveLayout`'s input, omitting `roles` entirely rather than
 * setting it to `undefined` — required under `exactOptionalPropertyTypes`,
 * and correct regardless: "no roles configured" and "roles explicitly
 * undefined" must mean the same thing to `resolveLayout`.
 */
function buildLayoutInput(ctx: BridgeContext, displays: readonly DisplaySnapshot[]): LayoutInput {
  return {
    displays,
    windows: ctx.windowConfigs,
    touchDisplayIds: ctx.getTouchDisplayIds(),
    ...(ctx.roles === undefined ? {} : { roles: ctx.roles }),
  };
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

/**
 * Resolves a layout and applies every placement it could actually produce.
 * A window absent from `windows` because of an unknown id is logged and
 * skipped (never thrown — see module doc rule on unknown window ids); a
 * `LayoutProblem` at `error` severity is logged loudly and, after every
 * placement that *could* be applied has been, surfaced by throwing — this
 * is what "fails loudly instead of silently producing a black window" means
 * in practice: a technician sees the error immediately, and the supervisor's
 * bounded circuit breaker (not this file) governs any retry.
 */
function applyDisplays(ctx: BridgeContext, displays: readonly DisplaySnapshot[]): void {
  const resolution = resolveLayout(buildLayoutInput(ctx, displays));

  let hadError = false;
  for (const problem of resolution.problems) {
    logLayoutProblem(ctx.logger, problem.severity, problem);
    if (problem.severity === 'error') {
      hadError = true;
    }
  }

  for (const placement of resolution.placements) {
    applyOnePlacement(ctx, placement);
  }

  if (hadError) {
    const codes = resolution.problems
      .filter(problem => problem.severity === 'error')
      .map(problem => problem.code)
      .join(', ');
    throw new Error(
      `display-events: layout resolution had error-severity problem(s): ${codes}; see logged details`
    );
  }
}

function logLayoutProblem(
  logger: Logger,
  severity: 'error' | 'warning',
  problem: {
    readonly code: string;
    readonly message: string;
    readonly fieldPath: string;
    readonly windowId: string | null;
  }
): void {
  const fields = { code: problem.code, fieldPath: problem.fieldPath, windowId: problem.windowId };
  if (severity === 'error') {
    logger.error(`display-events: layout problem: ${problem.message}`, fields);
  } else {
    logger.warn(`display-events: layout problem: ${problem.message}`, fields);
  }
}

function applyOnePlacement(ctx: BridgeContext, placement: WindowPlacement): void {
  const window = ctx.windowsById.get(placement.windowId);
  if (window === undefined) {
    ctx.logger.error('display-events: placement names an unknown window id; skipping', {
      windowId: placement.windowId,
    });
    return;
  }
  applyPlacement(window.native, placement, ctx.logger);
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

/**
 * Re-resolves the same layout and compares each resulting placement against
 * the target window's actual, current bounds, within `verifyTolerancePx`.
 * Never throws: an unknown window id or a mismatch is a verification
 * *failure* (`false`), not an exception — this is what the supervisor's
 * circuit breaker retries against, so it must behave like ordinary data, not
 * an error path.
 */
function verifyDisplays(ctx: BridgeContext, displays: readonly DisplaySnapshot[]): boolean {
  const resolution = resolveLayout(buildLayoutInput(ctx, displays));

  return resolution.placements.every(placement => verifyOnePlacement(ctx, placement));
}

function verifyOnePlacement(ctx: BridgeContext, placement: WindowPlacement): boolean {
  const window = ctx.windowsById.get(placement.windowId);
  if (window === undefined) {
    ctx.logger.error('display-events: verify found no window for placement; treating as mismatch', {
      windowId: placement.windowId,
    });
    return false;
  }
  const actual = window.native.getBounds();
  return boundsWithinTolerance(actual, placement.bounds, ctx.verifyTolerancePx);
}

function boundsWithinTolerance(a: Bounds, b: Bounds, tolerancePx: number): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerancePx &&
    Math.abs(a.y - b.y) <= tolerancePx &&
    Math.abs(a.width - b.width) <= tolerancePx &&
    Math.abs(a.height - b.height) <= tolerancePx
  );
}
