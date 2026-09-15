/**
 * Crash/unresponsive watchdog for kiosk windows (T3.6).
 *
 * The top real-world requirement for an unattended display: a renderer that
 * crashed, hung, or failed to load must recover itself, because nobody is
 * standing in front of the machine to notice. This module watches each
 * window's `webContents` for the handful of Electron events that mean "this
 * window is broken" and drives a bounded reload policy — never an unbounded
 * retry loop.
 *
 * ## Reuse the layout supervisor's fix, not its first attempt
 *
 * `src/layout/supervisor.ts` solves the structurally identical problem for
 * display changes, and its first version shipped with a circuit breaker
 * defeated by a flap: a single counter shared across "whatever is currently
 * being retried" was reset by activity belonging to a *different* subject.
 * The fix there — and here — is two independent tiers:
 *
 *   - **Tier 1 — per-window ledger.** Every `windowId` gets its own
 *     `WindowRecord` (`attempts`, `state`, timers), created once at
 *     `attach()` and never shared. One window crash-looping can exhaust (and
 *     permanently fail) only *its own* budget; `src/layout/supervisor.ts`'s
 *     module doc and `src/process/supervisor.ts`'s per-process ledger are
 *     both direct precedent for this, and the "per window id, never shared"
 *     framing in this file's tests is deliberately the same framing those
 *     two use for their own per-subject ledgers.
 *   - **Tier 2 — global rolling-window ceiling.** A backstop independent of
 *     window identity: at most `maxGlobalReloads` reload *attempts*, across
 *     every window combined, within a trailing `globalRateWindowMs`. This is
 *     what stops many windows each crash-looping within their own budget
 *     from adding up to unbounded total work. Named `maxGlobalReloads` /
 *     `globalRateWindowMs` — deliberately the same `globalRateWindowMs` name
 *     `src/layout/supervisor.ts` uses for its own Tier 2, since both files
 *     implement the identical per-subject-ledger + global-rolling-rate-ceiling
 *     pattern. "window" is reserved here for `BrowserWindow` — never for a
 *     span of time — which is exactly why this field is `globalRateWindowMs`,
 *     not some `...Window` variant that would read as "per BrowserWindow".
 *
 * ## Two self-healing mechanisms, both deliberately lazy (no dangling timer)
 *
 * A machine that had one bad hour must not be bricked for the rest of the
 * day, so both tiers forgive a genuinely quiet period:
 *
 *   - **Tier 1 (per window).** `healthyResetMs` is this module's one
 *     definition of "quiet enough to stop counting against a window",
 *     applied twice: proactively, via a timer armed the instant a window
 *     returns to `'healthy'` after a reload (mirroring
 *     `src/process/supervisor.ts`'s `resetAfterMs`, cancelled as the *first*
 *     step of handling any new failure — see `beginHandlingFailure` — for
 *     the exact same reason that file cancels its own reset timer before any
 *     restart-policy decision: a stale timer armed during an earlier, short
 *     healthy spell must never fire during a later, unrelated crash loop and
 *     wipe out a count that has nothing to do with it); and lazily, for a
 *     window that has already given up (`'failed'`) — checked only when the
 *     *next* qualifying event for that window arrives, by comparing
 *     `clock.now()` against `failedAt`, with **no timer kept pending while
 *     failed**. This is deliberate, not an oversight: it is what the tests
 *     mean by "leaves no pending fake-clock timers" after exhaustion (a
 *     terminal state must not keep scheduling anything), and it is
 *     symmetric with Tier 2 below. The honestly-documented cost: a window
 *     that crashes, exhausts its budget, and then emits *zero* further
 *     events of any kind (no more crashes, no more load failures) never
 *     gets this lazy check re-evaluated, and stays `'failed'` until the next
 *     event that does arrive for it. In practice that only matters if the
 *     renderer is not merely blank but has stopped generating any watchdog
 *     event at all — no different in effect from an unmonitored freeze, and
 *     outside what four DOM/process events can detect regardless of policy.
 *   - **Tier 2 (global).** Exactly `src/layout/supervisor.ts`'s Tier 2
 *     mechanism: the rolling window is recomputed from `clock.now()` every
 *     time a reload attempt is about to run, and the ceiling clears itself
 *     the moment the window has genuinely drained below it. No separate
 *     cooldown timer either — same reasoning as that file's module doc.
 *
 * ## Shutdown must disarm this before it fights T2.9/T3.4
 *
 * `disarm()` is the synchronous, permanent kill switch a shutdown sequence
 * calls *first* — before destroying any window or stopping any process —
 * exactly the same ordering rule `src/process/shutdown.ts` documents for
 * `ProcessSupervisor.dispose()`: "disarm the restart policy FIRST, then
 * actually kill what's running." Skipping this order, or calling it
 * concurrently instead of before, would let this watchdog observe a
 * shutdown-induced `render-process-gone` (Electron reports `killed` for a
 * window torn down by `BrowserWindow.destroy()` or process exit, same as it
 * would for an external kill) and "helpfully" reload a window shutdown is
 * actively tearing down — resurrecting exactly what T2.9 just killed. This
 * module deliberately does **not** special-case the `'killed'` reason by
 * value to solve that problem: a `'killed'` renderer *while armed* is still
 * a real, recoverable failure (an OS or another process force-killed it) and
 * must still reload. `disarm()` is the only gate, and it is unconditional
 * for every event this module listens to. `dispose()` goes further:
 * detaching every listener and cancelling every pending timer, for the
 * final teardown step once windows are actually being destroyed. Calling
 * `disarm()` alone (without `dispose()`) is safe and idempotent — it is
 * meant to be callable the instant shutdown begins, before it is convenient
 * to also rip out listeners.
 *
 * ## `unresponsive` grace period
 *
 * Chromium's own hang monitor already waits several seconds of a blocked
 * main thread before ever emitting `'unresponsive'`, and a page can recover
 * on its own (a GC pause, a heavy synchronous layout, a plugin overlay
 * animation starting) — reloading on the very first `'unresponsive'` would
 * make ordinary jank look identical to a real hang. `unresponsiveGraceMs`
 * (default 8s) is a second wait, started only once, on the *first*
 * `'unresponsive'` signal for a window currently healthy: Chromium re-fires
 * `'unresponsive'` repeatedly while still hung, and restarting the grace
 * timer on every repeat would let a permanently hung page dodge the
 * deadline forever — the same "never let unrelated/repeat activity reset a
 * budget" hazard this whole file exists to avoid, just at the level of one
 * timer instead of one counter. `'responsive'` arriving before the timer
 * fires cancels it with no reload at all. Total worst-case time a genuinely
 * hung kiosk sits frozen is therefore Chromium's own hang-detection latency
 * plus `unresponsiveGraceMs` — bounded, and short enough to matter for an
 * unattended display, while still forgiving brief, self-resolving jank.
 *
 * ## `did-fail-load`
 *
 * `errorCode === -3` is `ERR_ABORTED`, which fires for perfectly ordinary
 * navigation cancellation (a redirect superseding the in-flight load, a
 * second `loadURL` call) and never indicates a broken page — treated as a
 * complete non-event, never even logged as a failure. `isMainFrame === false`
 * is a sub-frame (an iframe, an ad, a widget) failing to load: the shell's
 * own top-level content may still be fine, so this module logs it at `warn`
 * and does **not** reload the whole window over it — reloading the entire
 * kiosk window because one embedded iframe hiccuped would be strictly worse
 * for an unattended display than leaving that one sub-frame broken.
 *
 * ## Deliberately out of scope: `child-process-gone`
 *
 * Electron's `child-process-gone` (GPU/utility/etc. process loss) is an
 * `app`-level event carrying no `windowId` of its own, not a
 * `webContents` event — it does not fit this module's per-window attach
 * model, which is what the hard scoping for this task binds to ("attaching
 * to per-window `webContents` events"). A GPU-process watchdog, if ever
 * needed, is a separate `app`-level concern and not layered onto this file.
 *
 * ## Any sequence of crashes that still produces unbounded reloads?
 *
 * Yes, by the same deliberate design `src/process/supervisor.ts` accepts for
 * its own `resetAfterMs`: a window that crashes, gets reloaded, stays
 * healthy for slightly *more* than `healthyResetMs` every single time, then
 * crashes again, never accumulates enough attempts inside its own
 * `healthyResetMs` window to hit `maxReloadsPerWindow` — so it gets reloaded
 * forever. This is intentional, not an oversight: `healthyResetMs` is the
 * operator's own chosen definition of "stayed up long enough to count as
 * healthy," and each restart is still rate-limited to roughly one per
 * `healthyResetMs` (plus backoff) — an unbounded *count* of reloads over an
 * unbounded amount of wall-clock time, never a tight, CPU-pegging loop. The
 * Tier 2 global ceiling does not close this either when only one window is
 * involved and its crashes are spaced out past `globalRateWindowMs` — by
 * design, since Tier 2 exists to bound *rate*, not lifetime count. See
 * "self-healing after a quiet period" test below for the mirror image: this
 * is the same mechanism working as intended, just never given a large-enough
 * gap to trip its own reset.
 */

import type { Event, RenderProcessGoneDetails, WebContents } from 'electron';
import type { Clock, TimerHandle } from '../clock.js';
import type { Logger } from '../logging/logger.js';
import { noopLogger } from '../logging/logger.js';
import type { Outcome } from '../errors.js';
import { computeBackoffMs } from '../process/backoff.js';

export type WatchdogWindowState =
  'healthy' | 'unresponsive' | 'scheduled' | 'reloading' | 'suspended' | 'failed';

export interface WatchdogWindowStatus {
  readonly windowId: string;
  readonly state: WatchdogWindowState;
  readonly reloadCount: number;
  readonly lastReason: string | undefined;
}

export interface WatchdogOptions {
  readonly clock: Clock;
  readonly logger?: Logger;
  /** Issues the actual recovery (e.g. `webContents.reload()` or re-navigating to the configured URL). Awaited; a throw/rejection is treated as a failed attempt. */
  readonly reload: (windowId: string, reason: string) => Promise<void> | void;
  /** Tier 1 per-window cap. Default 5. */
  readonly maxReloadsPerWindow?: number;
  /** Initial Tier 1 backoff delay. Default 1000. */
  readonly backoffMs?: number;
  /** Tier 1 backoff growth factor. Default 2. */
  readonly backoffMultiplier?: number;
  /** Tier 1 backoff cap. Default 30000. */
  readonly maxBackoffMs?: number;
  /** Quiet-period threshold shared by both self-healing mechanisms — see module doc. Default 600000 (10 min). */
  readonly healthyResetMs?: number;
  /** Grace period after the first `'unresponsive'` before treating a window as failed. Default 8000. */
  readonly unresponsiveGraceMs?: number;
  /** Tier 2 global cap on reload attempts within `globalRateWindowMs`. Default 10. */
  readonly maxGlobalReloads?: number;
  /** Tier 2 rolling window. Default 60000 (1 min). */
  readonly globalRateWindowMs?: number;
}

export interface Watchdog {
  /** Registers listeners for `windowId` on `webContents`. Re-attaching an id whose listeners were never detached replaces them, preserving that window's existing ledger entry. */
  attach(windowId: string, webContents: WebContents): void;
  /** Removes `windowId`'s listeners. Idempotent; a no-op if never attached. */
  detach(windowId: string): void;
  /** Permanently stops every future reload for every window. Synchronous, idempotent. Call before tearing down windows/processes — see module doc. */
  disarm(): void;
  /** `disarm()` plus: detaches every listener and cancels every pending timer. Idempotent. */
  dispose(): void;
  readonly getStatus: (windowId: string) => WatchdogWindowStatus | undefined;
  readonly getStatuses: () => readonly WatchdogWindowStatus[];
  /** Whether Tier 2's global ceiling is currently tripped. */
  readonly globallyRateLimited: boolean;
}

/** Per-window mutable state (Tier 1). One of these per attached `windowId`, never shared — see module doc. */
interface WindowRecord {
  readonly windowId: string;
  state: WatchdogWindowState;
  attempts: number;
  lastReason: string | undefined;
  failedAt: number | undefined;
  scheduledTimer: TimerHandle | undefined;
  unresponsiveTimer: TimerHandle | undefined;
  healthyResetTimer: TimerHandle | undefined;
}

interface Attachment {
  readonly webContents: WebContents;
  readonly onRenderProcessGone: (event: Event, details: RenderProcessGoneDetails) => void;
  readonly onUnresponsive: () => void;
  readonly onResponsive: () => void;
  readonly onDidFailLoad: (
    event: Event,
    errorCode: number,
    errorDescription: string,
    validatedURL: string,
    isMainFrame: boolean
  ) => void;
}

/** All mutable state for one watchdog instance, threaded explicitly through module-level functions (matches `layout/supervisor.ts`'s pattern). */
interface WatchdogContext {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly reload: WatchdogOptions['reload'];
  readonly maxReloadsPerWindow: number;
  readonly backoffMs: number;
  readonly backoffMultiplier: number;
  readonly maxBackoffMs: number;
  readonly healthyResetMs: number;
  readonly unresponsiveGraceMs: number;
  readonly maxGlobalReloads: number;
  readonly globalRateWindowMs: number;

  armed: boolean;
  disposed: boolean;
  globalGivenUp: boolean;

  readonly records: Map<string, WindowRecord>;
  readonly attachments: Map<string, Attachment>;
  /** Tier 2: `clock.now()` of each reload attempt still within `globalRateWindowMs`, oldest first. */
  readonly globalTimestamps: number[];
}

const ERR_ABORTED = -3;

export function createWatchdog(options: WatchdogOptions): Watchdog {
  const ctx: WatchdogContext = {
    clock: options.clock,
    logger: options.logger ?? noopLogger,
    reload: options.reload,
    maxReloadsPerWindow: options.maxReloadsPerWindow ?? 5,
    backoffMs: options.backoffMs ?? 1000,
    backoffMultiplier: options.backoffMultiplier ?? 2,
    maxBackoffMs: options.maxBackoffMs ?? 30_000,
    healthyResetMs: options.healthyResetMs ?? 600_000,
    unresponsiveGraceMs: options.unresponsiveGraceMs ?? 8000,
    maxGlobalReloads: options.maxGlobalReloads ?? 10,
    globalRateWindowMs: options.globalRateWindowMs ?? 60_000,
    armed: true,
    disposed: false,
    globalGivenUp: false,
    records: new Map(),
    attachments: new Map(),
    globalTimestamps: [],
  };

  return {
    attach: (windowId, webContents) => attachWindow(ctx, windowId, webContents),
    detach: windowId => detachWindow(ctx, windowId),
    disarm: () => {
      ctx.armed = false;
    },
    dispose: () => disposeWatchdog(ctx),
    getStatus: windowId => toStatus(ctx.records.get(windowId)),
    getStatuses: () => [...ctx.records.values()].map(record => toStatus(record)!),
    get globallyRateLimited() {
      return ctx.globalGivenUp;
    },
  };
}

function toStatus(record: WindowRecord | undefined): WatchdogWindowStatus | undefined {
  if (record === undefined) {
    return undefined;
  }
  return {
    windowId: record.windowId,
    state: record.state,
    reloadCount: record.attempts,
    lastReason: record.lastReason,
  };
}

// ---------------------------------------------------------------------------
// Attach / detach
// ---------------------------------------------------------------------------

function getOrCreateRecord(ctx: WatchdogContext, windowId: string): WindowRecord {
  const existing = ctx.records.get(windowId);
  if (existing !== undefined) {
    return existing;
  }
  const record: WindowRecord = {
    windowId,
    state: 'healthy',
    attempts: 0,
    lastReason: undefined,
    failedAt: undefined,
    scheduledTimer: undefined,
    unresponsiveTimer: undefined,
    healthyResetTimer: undefined,
  };
  ctx.records.set(windowId, record);
  return record;
}

function attachWindow(ctx: WatchdogContext, windowId: string, webContents: WebContents): void {
  detachWindow(ctx, windowId);
  getOrCreateRecord(ctx, windowId);

  const attachment: Attachment = {
    webContents,
    onRenderProcessGone: (_event, details) => onRenderProcessGone(ctx, windowId, details),
    onUnresponsive: () => onUnresponsive(ctx, windowId),
    onResponsive: () => onResponsive(ctx, windowId),
    onDidFailLoad: (_event, errorCode, _description, _url, isMainFrame) =>
      onDidFailLoad(ctx, windowId, errorCode, isMainFrame),
  };

  webContents.on('render-process-gone', attachment.onRenderProcessGone);
  webContents.on('unresponsive', attachment.onUnresponsive);
  webContents.on('responsive', attachment.onResponsive);
  webContents.on('did-fail-load', attachment.onDidFailLoad);

  ctx.attachments.set(windowId, attachment);
}

function detachWindow(ctx: WatchdogContext, windowId: string): void {
  const attachment = ctx.attachments.get(windowId);
  if (attachment === undefined) {
    return;
  }
  attachment.webContents.off('render-process-gone', attachment.onRenderProcessGone);
  attachment.webContents.off('unresponsive', attachment.onUnresponsive);
  attachment.webContents.off('responsive', attachment.onResponsive);
  attachment.webContents.off('did-fail-load', attachment.onDidFailLoad);
  ctx.attachments.delete(windowId);
}

// ---------------------------------------------------------------------------
// Event intake
// ---------------------------------------------------------------------------

function onRenderProcessGone(
  ctx: WatchdogContext,
  windowId: string,
  details: RenderProcessGoneDetails
): void {
  if (details.reason === 'clean-exit') {
    ctx.logger.debug('watchdog: render process exited cleanly; not a crash', { windowId });
    return;
  }
  beginHandlingFailure(ctx, windowId, `render-process-gone:${details.reason}`);
}

function onDidFailLoad(
  ctx: WatchdogContext,
  windowId: string,
  errorCode: number,
  isMainFrame: boolean
): void {
  if (errorCode === ERR_ABORTED) {
    ctx.logger.debug('watchdog: ignoring ERR_ABORTED (ordinary navigation cancellation)', {
      windowId,
    });
    return;
  }
  if (!isMainFrame) {
    ctx.logger.warn('watchdog: sub-frame load failure; not reloading the whole window', {
      windowId,
      errorCode,
    });
    return;
  }
  beginHandlingFailure(ctx, windowId, `did-fail-load:${errorCode}`);
}

function onUnresponsive(ctx: WatchdogContext, windowId: string): void {
  if (!ctx.armed) {
    return;
  }
  const record = ctx.records.get(windowId);
  if (record === undefined || (record.state !== 'healthy' && record.state !== 'unresponsive')) {
    return;
  }
  record.state = 'unresponsive';
  // Chromium re-fires 'unresponsive' repeatedly while still hung. Arm the
  // grace timer only once, on the first signal — resetting it on every
  // repeat would let a permanently hung page dodge the deadline forever.
  if (record.unresponsiveTimer !== undefined) {
    return;
  }
  record.unresponsiveTimer = ctx.clock.setTimeout(() => {
    record.unresponsiveTimer = undefined;
    beginHandlingFailure(ctx, windowId, 'unresponsive-timeout');
  }, ctx.unresponsiveGraceMs);
}

function onResponsive(ctx: WatchdogContext, windowId: string): void {
  if (!ctx.armed) {
    return;
  }
  const record = ctx.records.get(windowId);
  if (record === undefined || record.state !== 'unresponsive') {
    return;
  }
  if (record.unresponsiveTimer !== undefined) {
    ctx.clock.clearTimeout(record.unresponsiveTimer);
    record.unresponsiveTimer = undefined;
  }
  record.state = 'healthy';
  ctx.logger.debug('watchdog: window recovered responsiveness within grace period', { windowId });
}

// ---------------------------------------------------------------------------
// Failure handling: Tier 1 ledger + backoff
// ---------------------------------------------------------------------------

function beginHandlingFailure(ctx: WatchdogContext, windowId: string, reason: string): void {
  if (!ctx.armed) {
    ctx.logger.debug('watchdog: disarmed; ignoring event', { windowId, reason });
    return;
  }
  const record = ctx.records.get(windowId);
  if (record === undefined) {
    ctx.logger.debug('watchdog: event for an unattached window', { windowId, reason });
    return;
  }

  // Cancel first, unconditionally — any new qualifying failure invalidates a
  // prior "stayed healthy/quiet long enough" streak, whether that streak was
  // being tracked by the healthy-reset timer or an unresponsive grace timer.
  // See module doc on why this must run before any budget decision.
  cancelHealthyResetTimer(ctx, record);
  if (record.unresponsiveTimer !== undefined) {
    ctx.clock.clearTimeout(record.unresponsiveTimer);
    record.unresponsiveTimer = undefined;
  }

  if (record.state === 'failed') {
    if (ctx.clock.now() - record.failedAt! < ctx.healthyResetMs) {
      ctx.logger.debug('watchdog: dropping event for a window already given up on', {
        windowId,
        reason,
      });
      return;
    }
    ctx.logger.info('watchdog: quiet period elapsed; restoring reload eligibility', { windowId });
    record.attempts = 0;
    record.failedAt = undefined;
  } else if (record.state === 'scheduled' || record.state === 'reloading') {
    record.lastReason = reason;
    ctx.logger.debug('watchdog: coalescing event with an already in-flight recovery', {
      windowId,
      reason,
    });
    return;
  }

  record.lastReason = reason;
  if (record.attempts >= ctx.maxReloadsPerWindow) {
    giveUpWindow(ctx, record);
    return;
  }
  scheduleAttempt(ctx, record);
}

function scheduleAttempt(ctx: WatchdogContext, record: WindowRecord): void {
  const delayMs = computeBackoffMs(ctx, record.attempts + 1);
  record.state = 'scheduled';
  record.scheduledTimer = ctx.clock.setTimeout(() => {
    record.scheduledTimer = undefined;
    void runAttempt(ctx, record);
  }, delayMs);
}

/** Prunes Tier 2's rolling window and clears a prior global give-up once it has genuinely drained. Mirrors `layout/supervisor.ts`'s Tier 2 recompute. */
function refreshGlobalRateState(ctx: WatchdogContext): void {
  const cutoff = ctx.clock.now() - ctx.globalRateWindowMs;
  while (ctx.globalTimestamps.length > 0 && ctx.globalTimestamps[0]! < cutoff) {
    ctx.globalTimestamps.shift();
  }
  if (ctx.globalGivenUp && ctx.globalTimestamps.length < ctx.maxGlobalReloads) {
    ctx.globalGivenUp = false;
    ctx.logger.info('watchdog: global rate ceiling drained; resuming', {});
  }
}

function giveUpGlobalRate(ctx: WatchdogContext): void {
  if (ctx.globalGivenUp) {
    return;
  }
  ctx.globalGivenUp = true;
  ctx.logger.error(
    'watchdog: giving up globally — reload attempts across windows exceeded the rate ceiling',
    { maxGlobalReloads: ctx.maxGlobalReloads, globalRateWindowMs: ctx.globalRateWindowMs }
  );
}

function giveUpWindow(ctx: WatchdogContext, record: WindowRecord): void {
  cancelScheduledTimer(ctx, record);
  cancelHealthyResetTimer(ctx, record);
  record.state = 'failed';
  record.failedAt = ctx.clock.now();
  ctx.logger.error('watchdog: giving up reloading window after repeated failures', {
    windowId: record.windowId,
    attempts: record.attempts,
    maxReloadsPerWindow: ctx.maxReloadsPerWindow,
    lastReason: record.lastReason,
  });
}

type CallOutcome = Outcome<void>;

async function tryReload(
  reload: WatchdogOptions['reload'],
  windowId: string,
  reason: string
): Promise<CallOutcome> {
  try {
    await reload(windowId, reason);
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, error };
  }
}

async function runAttempt(ctx: WatchdogContext, record: WindowRecord): Promise<void> {
  if (!ctx.armed) {
    record.state = 'healthy';
    return;
  }

  refreshGlobalRateState(ctx);
  if (ctx.globalTimestamps.length >= ctx.maxGlobalReloads) {
    giveUpGlobalRate(ctx);
    // This window's own budget is untouched — the attempt never ran, so it
    // never counted against Tier 1. A later event for this window (or the
    // next attempt to run once Tier 2 drains) reconsiders it normally.
    record.state = 'suspended';
    return;
  }

  record.attempts += 1;
  ctx.globalTimestamps.push(ctx.clock.now());
  record.state = 'reloading';
  const reason = record.lastReason ?? 'unknown';

  const outcome = await tryReload(ctx.reload, record.windowId, reason);
  if (!ctx.armed) {
    record.state = 'healthy';
    return;
  }

  if (!outcome.ok) {
    ctx.logger.warn('watchdog: reload callback threw', {
      windowId: record.windowId,
      error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
    });
    if (record.attempts >= ctx.maxReloadsPerWindow) {
      giveUpWindow(ctx, record);
      return;
    }
    scheduleAttempt(ctx, record);
    return;
  }

  record.state = 'healthy';
  armHealthyResetTimer(ctx, record);
}

function armHealthyResetTimer(ctx: WatchdogContext, record: WindowRecord): void {
  record.healthyResetTimer = ctx.clock.setTimeout(() => {
    record.healthyResetTimer = undefined;
    record.attempts = 0;
  }, ctx.healthyResetMs);
}

function cancelHealthyResetTimer(ctx: WatchdogContext, record: WindowRecord): void {
  if (record.healthyResetTimer !== undefined) {
    ctx.clock.clearTimeout(record.healthyResetTimer);
    record.healthyResetTimer = undefined;
  }
}

function cancelScheduledTimer(ctx: WatchdogContext, record: WindowRecord): void {
  if (record.scheduledTimer !== undefined) {
    ctx.clock.clearTimeout(record.scheduledTimer);
    record.scheduledTimer = undefined;
  }
}

// ---------------------------------------------------------------------------
// Disposal
// ---------------------------------------------------------------------------

function disposeWatchdog(ctx: WatchdogContext): void {
  if (ctx.disposed) {
    return;
  }
  ctx.disposed = true;
  ctx.armed = false;
  for (const record of ctx.records.values()) {
    cancelScheduledTimer(ctx, record);
    cancelHealthyResetTimer(ctx, record);
    if (record.unresponsiveTimer !== undefined) {
      ctx.clock.clearTimeout(record.unresponsiveTimer);
      record.unresponsiveTimer = undefined;
    }
  }
  for (const windowId of [...ctx.attachments.keys()]) {
    detachWindow(ctx, windowId);
  }
}
