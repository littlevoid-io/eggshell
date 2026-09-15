/**
 * Crash/unresponsive watchdog for kiosk windows: recovers a renderer that
 * crashed, hung, or failed to load -- no one is watching an unattended
 * display to notice.
 *
 * - Two-tier budget: Tier 1 is a per-windowId ledger (WindowRecord), so one
 *   crash-looping window can't exhaust another's budget. Tier 2 is a shared
 *   RateWindow (rate-window.ts) capping total reload attempts across every
 *   window combined -- same pattern as layout/supervisor.ts and
 *   process/supervisor.ts.
 * - Both tiers self-heal with no dangling timer: Tier 1's healthyResetMs
 *   timer is armed on recovery and cancelled FIRST on any new failure (a
 *   stale timer must never wipe out an unrelated later crash-loop's count);
 *   an already-`failed` window is instead lazily re-checked against
 *   `failedAt` only when its next event arrives -- a terminal state keeps no
 *   timer pending.
 * - `disarm()` must run before any window/process is torn down during
 *   shutdown (same ordering `ProcessSupervisor.dispose()` requires) --
 *   otherwise this watchdog "helpfully" reloads a window shutdown is
 *   actively killing. `dispose()` adds full listener/timer cleanup once
 *   teardown is underway.
 * - `unresponsiveGraceMs` arms only once, on the FIRST `'unresponsive'`
 *   signal -- Chromium re-fires it repeatedly while still hung, so
 *   restarting the timer on every repeat would let a permanent hang dodge
 *   the deadline forever.
 * - `did-fail-load`: `ERR_ABORTED` (-3) is ordinary navigation cancellation,
 *   not a failure. A sub-frame failure logs but never reloads the window.
 * - `child-process-gone` (GPU/utility process loss) is out of scope: it has
 *   no `windowId`, doesn't fit this module's per-window attach model.
 * - A window that always recovers just past `healthyResetMs` before its next
 *   crash reloads forever, by design -- `healthyResetMs` is the operator's
 *   own definition of "healthy," and Tier 2 bounds rate, not lifetime count.
 */

import type { Event, RenderProcessGoneDetails, WebContents } from 'electron';
import type { Clock, TimerHandle } from '../clock.js';
import type { Logger } from '../logging/logger.js';
import { noopLogger } from '../logging/logger.js';
import type { Outcome } from '../errors.js';
import { computeBackoffMs } from '../process/backoff.js';
import { createRateWindow, type RateWindow } from '../process/rate-window.js';


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
  /** Tier 2: rolling reload rate ceiling across all windows. */
  readonly rateWindow: RateWindow;
}

const ERR_ABORTED = -3;

export function createWatchdog(options: WatchdogOptions): Watchdog {
  const maxGlobalReloads = options.maxGlobalReloads ?? 10;
  const globalRateWindowMs = options.globalRateWindowMs ?? 60_000;
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
    maxGlobalReloads,
    globalRateWindowMs,
    armed: true,
    disposed: false,
    globalGivenUp: false,
    records: new Map(),
    attachments: new Map(),
    rateWindow: createRateWindow(options.clock, globalRateWindowMs, maxGlobalReloads),
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
  ctx.rateWindow.prune();
  if (ctx.globalGivenUp && !ctx.rateWindow.isExceeded()) {
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
  if (ctx.rateWindow.isExceeded()) {
    giveUpGlobalRate(ctx);
    // This window's own budget is untouched — the attempt never ran, so it
    // never counted against Tier 1. A later event for this window (or the
    // next attempt to run once Tier 2 drains) reconsiders it normally.
    record.state = 'suspended';
    return;
  }

  record.attempts += 1;
  ctx.rateWindow.record();
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
