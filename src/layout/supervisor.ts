/**
 * The window supervisor state machine (T2.4).
 *
 * This file does **not** call `resolveLayout` and does **not** probe
 * anything. It receives `apply`/`verify` callbacks and drives them through a
 * bounded state machine; all I/O stays at the edges (in whatever Electron
 * adapter T3.7 wires up), exactly per ARCHITECTURE.md's "decisions are pure
 * functions over injected data; I/O happens at the edges" principle. In
 * particular it never calls a touch probe — a probe invalidated by display
 * events inside this exact path is cause 3 of the documented lockup (a
 * synchronous, timeout-less native call blocking the event loop with no
 * recovery short of a power cycle).
 *
 * All time comes from an injected `Clock` (`src/clock.ts`), never a global
 * timer, so every rule below is deterministically testable — see
 * `supervisor.test.ts`.
 *
 * ## Two independent circuit breakers
 *
 * An earlier version of this file capped attempts with a single counter tied
 * to "the topology currently being attempted", resetting to zero whenever a
 * *different* signature showed up. That is defeated by a machine whose
 * displays flap between two (or more) topologies — A -> B -> A -> B... —
 * because every arrival of "a different signature" looked like a fresh,
 * never-tried target and reset the count. That reproduces cause 1 from
 * ARCHITECTURE.md (an unbounded retry loop) with a period greater than one.
 *
 * Two tiers, each covering the other's blind spot:
 *
 *   - **Tier 1 — per-topology ledger.** A bounded, LRU-evicted
 *     `Map<signature, {attempts, gaveUp}>`. Attempts accumulate against the
 *     *specific* signature being attempted, never reset because some other
 *     signature was visited in between — so an A/B ping-pong now correctly
 *     accumulates failures against A and against B independently. `gaveUp`
 *     is sticky per signature: once a topology has exhausted
 *     `maxAttemptsPerTopology`, it stays blocklisted regardless of what else
 *     happens, until forgotten by LRU eviction. A *different*,
 *     not-yet-given-up signature is free to proceed immediately — "given up"
 *     is a property of a topology, not of the whole supervisor.
 *   - **Tier 2 — global rolling-rate ceiling.** The ledger alone is still
 *     defeatable: a flap through more distinct signatures than the ledger's
 *     bound can hold evicts a given-up entry and "forgets" it. Tier 2 caps
 *     *total* attempts started within a trailing `globalRateWindowMs` at
 *     `maxGlobalAttempts`, independent of which signature each attempt
 *     targeted. This is the actual backstop: it bounds total work
 *     unconditionally, so eviction in Tier 1 can never re-open an unbounded
 *     loop. Tripping it is a distinct `givenUpReason: 'rate'` (vs.
 *     `'topology'`), because a technician needs to tell "this one layout is
 *     unsatisfiable" apart from "this machine's displays are flapping".
 *
 * Leaving global (`'rate'`) given-up is self-healing but not exploitable: on
 * every new event the rolling window is recomputed from `clock.now()`, and
 * the supervisor re-arms only once the window has genuinely drained below
 * the ceiling. A continuous flap keeps the window full and stays given up;
 * real quiet (e.g. a one-off monitor unplug at opening) drains it within
 * `globalRateWindowMs` and the supervisor recovers on its own. There is no
 * separate cooldown timer — the same window is both the trip condition and
 * the re-arm condition. A per-topology (`'topology'`) give-up is unaffected
 * by this: it stays given up until forgotten by LRU eviction.
 *
 * `maxGlobalAttempts`/`globalRateWindowMs` deliberately match
 * `src/shell/watchdog.ts`'s `maxGlobalReloads`/`globalRateWindowMs` names:
 * both files implement the same two-tier (per-subject ledger + global
 * rolling-rate ceiling) pattern, and "window" is reserved here for
 * `BrowserWindow` — never for a span of time.
 */

import type { Clock, TimerHandle } from '../clock.js';
import type { Logger, LogFields } from '../logging/logger.js';
import { noopLogger } from '../logging/logger.js';
import { topologySignature } from './signature.js';
import type { DisplaySnapshot } from './types.js';

export type SupervisorState = 'settled' | 'scheduled' | 'applying' | 'verifying' | 'givenUp';
export type GivenUpReason = 'topology' | 'rate';

export interface WindowSupervisorOptions {
  clock: Clock;
  apply: (displays: readonly DisplaySnapshot[]) => Promise<void> | void;
  verify: (displays: readonly DisplaySnapshot[]) => Promise<boolean> | boolean;
  debounceMs: number;
  /** Per-topology attempt cap (Tier 1). Renamed from `maxAttempts` — the old name did not say what it scoped over. */
  maxAttemptsPerTopology: number;
  verifyDelayMs: number;
  /** Optional per-topology wall-clock deadline, measured from that topology's first attempt. */
  giveUpAfterMs?: number;
  /** Global attempt-rate ceiling (Tier 2): at most this many attempts, of any topology, within `globalRateWindowMs`. */
  maxGlobalAttempts: number;
  /** The trailing window `maxGlobalAttempts` is measured over. */
  globalRateWindowMs: number;
  logger?: Logger;
}

export interface WindowSupervisor {
  onDisplaysChanged(displays: readonly DisplaySnapshot[]): void;
  readonly state: SupervisorState;
  /** Attempts made so far against whichever topology is (or was most recently) active. */
  readonly attempts: number;
  /** Set only while `state === 'givenUp'`; which circuit breaker tripped. */
  readonly givenUpReason: GivenUpReason | undefined;
  dispose(): void;
}

/** Per-topology bookkeeping (Tier 1). */
interface TopologyRecord {
  attempts: number;
  gaveUp: boolean;
  /** `clock.now()` at this topology's first attempt; anchors its `giveUpAfterMs` deadline. */
  firstAttemptAt: number | undefined;
}

/** Caps memory: an unbounded flap must not grow this map forever. Safe only because Tier 2 backstops eviction. */
const MAX_TRACKED_TOPOLOGIES = 8;

/**
 * All mutable state for one supervisor instance, threaded explicitly through
 * the module-level functions below rather than closed over, so no function
 * here is a nested definition inside `createWindowSupervisor`.
 */
interface SupervisorContext {
  readonly clock: Clock;
  readonly apply: WindowSupervisorOptions['apply'];
  readonly verify: WindowSupervisorOptions['verify'];
  readonly debounceMs: number;
  readonly maxAttemptsPerTopology: number;
  readonly verifyDelayMs: number;
  readonly giveUpAfterMs: number | undefined;
  readonly maxGlobalAttempts: number;
  readonly globalRateWindowMs: number;
  readonly logger: Logger;

  state: SupervisorState;
  givenUpReason: GivenUpReason | undefined;
  disposed: boolean;

  /** Signature of the last topology that finished a cycle with `verify` returning `true`. */
  lastSettledSignature: string | undefined;
  /** Signature of the most recently (or currently) attempted topology; backs the `attempts` getter. */
  activeSignature: string | undefined;

  /** Tier 1: bounded, LRU-ordered (oldest first) per-topology attempt ledger. */
  readonly ledger: Map<string, TopologyRecord>;
  /** Tier 2: `clock.now()` of each attempt start still within `globalRateWindowMs`, oldest first. */
  readonly attemptTimestamps: number[];

  /** Latest displays/signature seen while `scheduled` (debounce) or mid-cycle (`applying`/`verifying`). */
  pendingDisplays: readonly DisplaySnapshot[] | undefined;
  pendingSignature: string | undefined;

  scheduledTimer: TimerHandle | undefined;
  verifyTimer: TimerHandle | undefined;
}

export function createWindowSupervisor(options: WindowSupervisorOptions): WindowSupervisor {
  const ctx: SupervisorContext = {
    clock: options.clock,
    apply: options.apply,
    verify: options.verify,
    debounceMs: options.debounceMs,
    maxAttemptsPerTopology: options.maxAttemptsPerTopology,
    verifyDelayMs: options.verifyDelayMs,
    giveUpAfterMs: options.giveUpAfterMs,
    maxGlobalAttempts: options.maxGlobalAttempts,
    globalRateWindowMs: options.globalRateWindowMs,
    logger: options.logger ?? noopLogger,
    state: 'settled',
    givenUpReason: undefined,
    disposed: false,
    lastSettledSignature: undefined,
    activeSignature: undefined,
    ledger: new Map(),
    attemptTimestamps: [],
    pendingDisplays: undefined,
    pendingSignature: undefined,
    scheduledTimer: undefined,
    verifyTimer: undefined,
  };

  return {
    onDisplaysChanged: displays => handleDisplaysChanged(ctx, displays),
    get state() {
      return ctx.state;
    },
    get attempts() {
      return ctx.activeSignature === undefined
        ? 0
        : (ctx.ledger.get(ctx.activeSignature)?.attempts ?? 0);
    },
    get givenUpReason() {
      return ctx.givenUpReason;
    },
    dispose: () => disposeSupervisor(ctx),
  };
}

// ---------------------------------------------------------------------------
// Event intake
// ---------------------------------------------------------------------------

function handleDisplaysChanged(ctx: SupervisorContext, displays: readonly DisplaySnapshot[]): void {
  if (ctx.disposed) {
    return;
  }
  const signature = topologySignature(displays);

  if (ctx.givenUpReason === 'rate' && isStillRateLimited(ctx, signature)) {
    return;
  }
  if (isBlocklisted(ctx, signature)) {
    ctx.logger.debug('window supervisor: dropping event for a topology already given up on', {
      signature,
    });
    return;
  }
  // Dedup only when idle: mid-cycle, an event matching the last *settled*
  // topology is a genuine revert (see module doc), not cascade noise, and
  // must be recorded rather than dropped.
  if (ctx.state === 'settled' && signature === ctx.lastSettledSignature) {
    ctx.logger.debug('window supervisor: dropping event matching last settled topology', {
      signature,
    });
    return;
  }
  if (ctx.state === 'applying' || ctx.state === 'verifying') {
    // Never start a concurrent cycle; the latest topology is picked up once
    // the in-flight attempt finishes (see `finishCycleSuccessfully`).
    ctx.pendingDisplays = displays;
    ctx.pendingSignature = signature;
    return;
  }
  beginDebounce(ctx, displays, signature);
}

/**
 * Re-checks the Tier 2 window on every event while globally given up. Clears
 * `givenUpReason` and returns `false` (let the event proceed) once the
 * window has drained; otherwise drops the event and returns `true`.
 */
function isStillRateLimited(ctx: SupervisorContext, signature: string): boolean {
  pruneAttemptWindow(ctx);
  if (ctx.attemptTimestamps.length >= ctx.maxGlobalAttempts) {
    ctx.logger.debug('window supervisor: dropping event while rate-limited', { signature });
    return true;
  }
  ctx.givenUpReason = undefined;
  ctx.state = 'settled';
  return false;
}

function isBlocklisted(ctx: SupervisorContext, signature: string): boolean {
  return ctx.ledger.get(signature)?.gaveUp === true;
}

// ---------------------------------------------------------------------------
// Debounce
// ---------------------------------------------------------------------------

/** Starts (or restarts) the debounce window. Also used to schedule a post-failure retry after `debounceMs`. */
function beginDebounce(
  ctx: SupervisorContext,
  displays: readonly DisplaySnapshot[],
  signature: string
): void {
  ctx.pendingDisplays = displays;
  ctx.pendingSignature = signature;
  cancelScheduledTimer(ctx);
  ctx.state = 'scheduled';
  ctx.scheduledTimer = ctx.clock.setTimeout(() => startCycle(ctx), ctx.debounceMs);
}

function startCycle(ctx: SupervisorContext): void {
  ctx.scheduledTimer = undefined;
  const displays = ctx.pendingDisplays!; // always set together with pendingSignature by beginDebounce
  const signature = ctx.pendingSignature!;
  ctx.pendingDisplays = undefined;
  ctx.pendingSignature = undefined;

  pruneAttemptWindow(ctx);
  if (ctx.attemptTimestamps.length >= ctx.maxGlobalAttempts) {
    giveUpGlobalRate(ctx, signature);
    return;
  }
  void runAttempt(ctx, displays, signature);
}

// ---------------------------------------------------------------------------
// Attempt cycle (apply -> verifyDelayMs -> verify)
// ---------------------------------------------------------------------------

async function runAttempt(
  ctx: SupervisorContext,
  displays: readonly DisplaySnapshot[],
  signature: string
): Promise<void> {
  const record = getOrCreateRecord(ctx, signature);
  record.attempts += 1;
  record.firstAttemptAt ??= ctx.clock.now();
  ctx.attemptTimestamps.push(ctx.clock.now());
  ctx.activeSignature = signature;
  ctx.state = 'applying';

  const applied = await tryCall(() => ctx.apply(displays));
  if (ctx.disposed) return;
  if (!applied.ok) {
    ctx.logger.warn(
      'window supervisor: apply threw',
      attemptFields(ctx, signature, record, applied.error)
    );
    handleFailedAttempt(ctx, signature, displays, record);
    return;
  }

  ctx.state = 'verifying';
  await waitForVerifyDelay(ctx);
  if (ctx.disposed) return;

  const verified = await tryCall(() => ctx.verify(displays));
  if (ctx.disposed) return;
  if (!verified.ok) {
    ctx.logger.warn(
      'window supervisor: verify threw',
      attemptFields(ctx, signature, record, verified.error)
    );
    handleFailedAttempt(ctx, signature, displays, record);
    return;
  }

  if (verified.value) {
    ctx.lastSettledSignature = signature;
    finishCycleSuccessfully(ctx);
  } else {
    handleFailedAttempt(ctx, signature, displays, record);
  }
}

function waitForVerifyDelay(ctx: SupervisorContext): Promise<void> {
  return new Promise(resolve => {
    ctx.verifyTimer = ctx.clock.setTimeout(() => {
      ctx.verifyTimer = undefined;
      resolve();
    }, ctx.verifyDelayMs);
  });
}

/**
 * A cycle ending in success picks up whatever topology arrived meanwhile: if
 * it differs from what was just settled, a fresh cycle begins immediately
 * (debounced); if it matches (or nothing arrived), the supervisor goes idle.
 */
function finishCycleSuccessfully(ctx: SupervisorContext): void {
  const nextDisplays = ctx.pendingDisplays;
  const nextSignature = ctx.pendingSignature;
  ctx.pendingDisplays = undefined;
  ctx.pendingSignature = undefined;

  if (nextSignature !== undefined && nextSignature !== ctx.lastSettledSignature) {
    beginDebounce(ctx, nextDisplays!, nextSignature);
    return;
  }
  ctx.state = 'settled';
}

// ---------------------------------------------------------------------------
// Failure handling: two independent circuit breakers
// ---------------------------------------------------------------------------

function handleFailedAttempt(
  ctx: SupervisorContext,
  signature: string,
  displays: readonly DisplaySnapshot[],
  record: TopologyRecord
): void {
  if (hasExceededTopologyBudget(ctx, record)) {
    giveUpTopology(ctx, signature, record);
    return;
  }
  // A newer event that arrived mid-attempt takes priority over retrying the
  // stale displays; the ledger tracks attempts per signature, so this never
  // loses or resets another topology's count.
  const nextDisplays = ctx.pendingDisplays ?? displays;
  const nextSignature = ctx.pendingSignature ?? signature;
  ctx.pendingDisplays = undefined;
  ctx.pendingSignature = undefined;
  beginDebounce(ctx, nextDisplays, nextSignature);
}

function hasExceededTopologyBudget(ctx: SupervisorContext, record: TopologyRecord): boolean {
  if (record.attempts >= ctx.maxAttemptsPerTopology) {
    return true;
  }
  if (ctx.giveUpAfterMs === undefined || record.firstAttemptAt === undefined) {
    return false;
  }
  return ctx.clock.now() - record.firstAttemptAt >= ctx.giveUpAfterMs;
}

/**
 * Tier 1 give-up: blocklists exactly this signature, sticky until LRU
 * eviction forgets it. If a different, not-yet-given-up topology is already
 * queued, it starts immediately — "given up" is a property of a topology,
 * not of the whole supervisor.
 */
function giveUpTopology(ctx: SupervisorContext, signature: string, record: TopologyRecord): void {
  record.gaveUp = true;
  cancelScheduledTimer(ctx);
  cancelVerifyTimer(ctx);
  ctx.logger.error('window supervisor: giving up on this topology after repeated failures', {
    attempts: record.attempts,
    maxAttemptsPerTopology: ctx.maxAttemptsPerTopology,
    signature,
  });

  const nextDisplays = ctx.pendingDisplays;
  const nextSignature = ctx.pendingSignature;
  ctx.pendingDisplays = undefined;
  ctx.pendingSignature = undefined;

  if (nextSignature !== undefined && !isBlocklisted(ctx, nextSignature)) {
    beginDebounce(ctx, nextDisplays!, nextSignature);
    return;
  }
  ctx.state = 'givenUp';
  ctx.givenUpReason = 'topology';
}

/**
 * Tier 2 give-up: an absolute backstop independent of topology identity.
 * Unlike a per-topology give-up, this halts unconditionally — even a
 * brand-new, never-seen signature stays blocked until the rolling window
 * drains (see `isStillRateLimited`).
 */
function giveUpGlobalRate(ctx: SupervisorContext, signature: string): void {
  cancelScheduledTimer(ctx);
  cancelVerifyTimer(ctx);
  ctx.state = 'givenUp';
  ctx.givenUpReason = 'rate';
  ctx.pendingDisplays = undefined;
  ctx.pendingSignature = undefined;
  ctx.logger.error(
    'window supervisor: giving up globally — attempts are arriving faster than the rate ceiling allows (the display topology may be flapping)',
    {
      maxGlobalAttempts: ctx.maxGlobalAttempts,
      globalRateWindowMs: ctx.globalRateWindowMs,
      signature,
    }
  );
}

// ---------------------------------------------------------------------------
// Tier 1 ledger (bounded, LRU-evicted)
// ---------------------------------------------------------------------------

function getOrCreateRecord(ctx: SupervisorContext, signature: string): TopologyRecord {
  const existing = ctx.ledger.get(signature);
  const record: TopologyRecord = existing ?? {
    attempts: 0,
    gaveUp: false,
    firstAttemptAt: undefined,
  };
  // Re-insert to move this key to the most-recently-used end of the Map's
  // iteration order, so `evictOldestIfNeeded` reclaims true LRU entries.
  ctx.ledger.delete(signature);
  ctx.ledger.set(signature, record);
  evictOldestIfNeeded(ctx);
  return record;
}

function evictOldestIfNeeded(ctx: SupervisorContext): void {
  while (ctx.ledger.size > MAX_TRACKED_TOPOLOGIES) {
    const oldestKey = ctx.ledger.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    ctx.ledger.delete(oldestKey);
  }
}

// ---------------------------------------------------------------------------
// Tier 2 rolling window
// ---------------------------------------------------------------------------

function pruneAttemptWindow(ctx: SupervisorContext): void {
  const cutoff = ctx.clock.now() - ctx.globalRateWindowMs;
  while (ctx.attemptTimestamps.length > 0 && ctx.attemptTimestamps[0]! < cutoff) {
    ctx.attemptTimestamps.shift();
  }
}

// ---------------------------------------------------------------------------
// Disposal
// ---------------------------------------------------------------------------

function disposeSupervisor(ctx: SupervisorContext): void {
  if (ctx.disposed) {
    return;
  }
  ctx.disposed = true;
  cancelScheduledTimer(ctx);
  cancelVerifyTimer(ctx);
}

function cancelScheduledTimer(ctx: SupervisorContext): void {
  if (ctx.scheduledTimer !== undefined) {
    ctx.clock.clearTimeout(ctx.scheduledTimer);
    ctx.scheduledTimer = undefined;
  }
}

function cancelVerifyTimer(ctx: SupervisorContext): void {
  if (ctx.verifyTimer !== undefined) {
    ctx.clock.clearTimeout(ctx.verifyTimer);
    ctx.verifyTimer = undefined;
  }
}

// ---------------------------------------------------------------------------
// Safe call helpers
// ---------------------------------------------------------------------------

type CallOutcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

/**
 * Runs `fn`, catching both a synchronous throw and a rejected promise. This
 * is what stops an Electron call failing mid-operation (e.g. a display
 * vanishing) from ever escaping as an unhandled rejection or crashing the
 * supervisor.
 */
async function tryCall<T>(fn: () => T | Promise<T>): Promise<CallOutcome<T>> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

function attemptFields(
  ctx: SupervisorContext,
  signature: string,
  record: TopologyRecord,
  error: unknown
): LogFields {
  return {
    attempt: record.attempts,
    maxAttemptsPerTopology: ctx.maxAttemptsPerTopology,
    signature,
    error: describeError(error),
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
