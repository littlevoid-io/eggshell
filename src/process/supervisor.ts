/**
 * Multi-process supervisor with restart policy (T2.8, Requirement 9).
 *
 * The predecessor had a single hardcoded "server" slot plus a separate
 * "dev server" concept, no restart policy, and no port pre-check.
 * `createProcessSupervisor` replaces all of that with **one** `processes[]`
 * filtered by `phase` (`dev` runs `dev` + `always`; `production` runs
 * `production` + `always`) — there is no special-cased dev server.
 *
 * Per process, in config order: `assertPortsFree` (T2.5) -> spawn (T2.6) ->
 * `waitForReadiness` (T2.7). A failure at any step fails `start()` loudly,
 * naming the process and why (a port conflict or a readiness timeout each
 * already name the process id — see `port.ts`/`readiness.ts`); processes
 * later in config order are left `pending`.
 *
 * Once a process reaches `ready`, its exit is governed by `restart.policy`:
 * `never` (no restart), `onCrash` (restart on a non-zero exit code or a
 * signal, not on a clean exit), `always` (restart unconditionally).
 * Restart delay backs off from `backoffMs` by `backoffMultiplier`, capped at
 * `maxBackoffMs`, for at most `maxRestarts` attempts; exhausting the budget
 * logs once at `error` and moves the process to the terminal `failed` state.
 * A restart attempt that itself fails to become ready (its own port conflict,
 * spawn failure, or readiness timeout) is treated the same as a crash — it
 * consumes one restart attempt and is retried under the same backoff/cap,
 * rather than being a separate, unbounded retry path.
 *
 * ## Restart budgets are per process, never shared
 *
 * `src/layout/supervisor.ts` documents a real bug: a single counter shared
 * across "whatever is currently being attempted" was reset by activity
 * belonging to a *different* subject (a different display topology), which
 * defeated its circuit breaker under an A/B flap. The equivalent mistake here
 * would be a shared restart counter touched by more than one process.
 *
 * That mistake is structurally impossible in this file: each process gets
 * its own `ProcessRecord` (`restartCount`, `restartTimer`, `resetTimer`) the
 * moment the supervisor is constructed, keyed by process id, and every
 * restart function takes the specific `record` to act on as a parameter —
 * there is no shared counter anywhere for one process's exits to touch
 * another's. Test 13 asserts this directly: one process exhausting its
 * budget leaves an unrelated process's counter, and its running state,
 * untouched.
 *
 * ## No global restart ceiling (deliberate)
 *
 * The window supervisor also needed a Tier-2 global-rate ceiling, because a
 * flap through more distinct topologies than its bounded ledger can hold
 * evicts a given-up entry and "forgets" it — the per-topology cap alone is
 * defeatable by *identity* churn. There is no equivalent identity churn here:
 * a process's id never changes over its lifetime, so its ledger entry (this
 * file has exactly one process record per id, unbounded in count only by how
 * many processes are configured) can never be evicted or forgotten. Every
 * process's own `maxRestarts` cap is therefore already an absolute, permanent
 * ceiling on that process — nothing can reopen it.
 *
 * A global ceiling was still considered, for the case of many processes each
 * independently crash-looping within their own budgets. It was rejected:
 * every restart is already gated by a real, growing backoff delay (never
 * zero-cost) and a real child-process spawn (never free), so many processes
 * crash-looping at once is bounded work, not a tight loop pegging the event
 * loop the way an unthrottled retry can. A global ceiling would also silently
 * override `resetAfterMs`, which exists specifically so a process configured
 * to auto-heal indefinitely (crashing rarely, well above `resetAfterMs`
 * apart) keeps being restarted forever — see the next section. Capping that
 * globally would surprise an operator who explicitly asked for exactly that
 * behaviour.
 *
 * ## `resetAfterMs`: armed on ready, cancelled on exit
 *
 * `resetAfterMs` clears `restartCount` after a process has stayed `ready`
 * that long, so a process that crashes rarely never exhausts its budget. The
 * timer for this MUST be cancelled the instant the process exits, not left
 * to fire later: if it were left pending, a stale timer armed during an
 * earlier, short-lived `ready` period could fire *during a later, genuine
 * rapid crash loop* and wipe out a restart count that has nothing to do with
 * that earlier healthy run — the exact "unrelated activity resets my
 * counter" failure mode from the window supervisor, just via a stale timer
 * instead of a shared variable. `monitorProcess` below cancels the reset
 * timer as the very first thing it does on every exit path, before any
 * restart-policy decision, so only a timer belonging to the *current* ready
 * period can ever fire.
 *
 * Chosen semantics for a "slow flap" — a process that crashes repeatedly but
 * always stays `ready` for slightly *more* than `resetAfterMs` first: this
 * restarts it forever, by design, not as an oversight. `resetAfterMs` is the
 * operator's own definition of "stayed up long enough to count as healthy";
 * a process that clears that bar every single cycle is, by the config
 * author's own chosen threshold, healthy each time it crashes, and each
 * restart is still rate-limited to roughly one per `resetAfterMs` (plus
 * backoff) — this is not a tight, CPU-pegging loop, just an unbounded count
 * of restarts over an unbounded amount of wall-clock time. Test
 * "resetAfterMs: a slow flap ... keeps restarting forever" below asserts
 * exactly this.
 */

import type { Clock, TimerHandle } from '../clock.js';
import type { Logger } from '../logging/logger.js';
import { noopLogger } from '../logging/logger.js';
import { ProcessError } from '../errors.js';
import type { ProcessConfig } from '../config/types.js';
import { assertPortsFree } from './port.js';
import { spawnManaged, type SpawnManagedOptions } from './spawn.js';
import { waitForReadiness } from './readiness.js';
import type { ManagedProcess, ProcessExit } from './types.js';

export type SupervisorPhase = 'dev' | 'production';

export type ProcessState = 'pending' | 'starting' | 'ready' | 'restarting' | 'stopped' | 'failed';

export interface ProcessStatus {
  readonly id: string;
  readonly state: ProcessState;
  readonly restartCount: number;
  readonly lastExit: ProcessExit | undefined;
  readonly lastError: string | undefined;
}

/** Injected in place of `spawnManaged` so tests never launch a real process. */
export type SpawnFn = (options: SpawnManagedOptions) => ManagedProcess;

export interface ProcessSupervisorOptions {
  readonly configs: readonly ProcessConfig[];
  readonly phase: SupervisorPhase;
  readonly clock: Clock;
  readonly logger?: Logger;
  readonly spawn?: SpawnFn;
  readonly host?: string;
}

export interface ProcessSupervisor {
  /**
   * Starts every phase-matching process, in config order. Rejects with a
   * `ProcessError` naming the first process that fails to become ready (a
   * port conflict, a spawn failure, or a readiness timeout); processes later
   * in config order are left `pending`. Never resolves twice per process.
   */
  start(): Promise<void>;
  readonly getStatuses: () => readonly ProcessStatus[];
  readonly getStatus: (id: string) => ProcessStatus | undefined;
  /**
   * Cancels every pending restart/reset timer and stops scheduling further
   * restarts. Idempotent. Does not kill already-running child processes —
   * that is T2.9's `shutdownAll`, which owns graceful signal/grace-period/
   * force-kill orchestration; this only stops the supervisor's own bookkeeping.
   */
  dispose(): void;
  /**
   * Returns the current live `ManagedProcess` handle for each process that
   * has actually spawned and not yet exited, keyed by id. Exists
   * specifically so `shutdownAll` (`process/shutdown.ts`) can be called
   * directly against this supervisor's real handles — build its
   * `ShutdownTarget[]` straight from these entries — with no external
   * tracking wrapper to capture spawn output.
   *
   * A handle appears the instant `spawn` returns it — deliberately not
   * gated on readiness, since a process still waiting on its readiness
   * probe (or one whose readiness timed out while the OS process is still
   * running) is a real process `shutdownAll` must still be able to reach.
   * It disappears the instant its `exited` settles, for any reason: a
   * process that never successfully spawned (`exited` rejected) never
   * appears at all; one that has since exited and not (yet) been
   * restarted is absent until its replacement spawns. After a restart,
   * only the replacement handle appears — never the stale original, which
   * would target a pid Windows may since have recycled for an unrelated
   * process, exactly the hazard `shutdown.ts` is careful about.
   */
  getHandles(): ReadonlyMap<string, ManagedProcess>;
}

/** All mutable state for one supervised process, keyed by id — see the module doc comment on why this is never shared. */
interface ProcessRecord {
  readonly config: ProcessConfig;
  state: ProcessState;
  restartCount: number;
  lastExit: ProcessExit | undefined;
  lastError: string | undefined;
  restartTimer: TimerHandle | undefined;
  resetTimer: TimerHandle | undefined;
  /** The current live handle, set by `trackHandle` the instant spawn succeeds and cleared the instant it exits — see `getHandles`. */
  handle: ManagedProcess | undefined;
}

/** Mutable context threaded explicitly through module-level functions, matching `layout/supervisor.ts`'s pattern. */
interface SupervisorContext {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly spawnFn: SpawnFn;
  readonly host: string | undefined;
  readonly records: ReadonlyMap<string, ProcessRecord>;
  disposed: boolean;
}

function selectConfigs(
  configs: readonly ProcessConfig[],
  phase: SupervisorPhase
): readonly ProcessConfig[] {
  return configs.filter(config => config.phase === phase || config.phase === 'always');
}

function toStatus(record: ProcessRecord): ProcessStatus {
  return {
    id: record.config.id,
    state: record.state,
    restartCount: record.restartCount,
    lastExit: record.lastExit,
    lastError: record.lastError,
  };
}

export function createProcessSupervisor(options: ProcessSupervisorOptions): ProcessSupervisor {
  const records = new Map<string, ProcessRecord>();
  for (const config of selectConfigs(options.configs, options.phase)) {
    records.set(config.id, {
      config,
      state: 'pending',
      restartCount: 0,
      lastExit: undefined,
      lastError: undefined,
      restartTimer: undefined,
      resetTimer: undefined,
      handle: undefined,
    });
  }

  const ctx: SupervisorContext = {
    clock: options.clock,
    logger: options.logger ?? noopLogger,
    spawnFn: options.spawn ?? spawnManaged,
    host: options.host,
    records,
    disposed: false,
  };

  return {
    start: () => startAll(ctx),
    getStatuses: () => [...ctx.records.values()].map(toStatus),
    getStatus: id => {
      const record = ctx.records.get(id);
      return record === undefined ? undefined : toStatus(record);
    },
    dispose: () => disposeSupervisor(ctx),
    getHandles: () => {
      const live = new Map<string, ManagedProcess>();
      for (const record of ctx.records.values()) {
        if (record.handle !== undefined) {
          live.set(record.config.id, record.handle);
        }
      }
      return live;
    },
  };
}

// ---------------------------------------------------------------------------
// Initial start (fails loudly; no retry)
// ---------------------------------------------------------------------------

async function startAll(ctx: SupervisorContext): Promise<void> {
  for (const record of ctx.records.values()) {
    if (ctx.disposed) {
      return;
    }
    let handle: ManagedProcess;
    try {
      handle = await performStartAttempt(ctx, record);
    } catch (error) {
      record.state = 'failed';
      record.lastError = describeError(error);
      throw error;
    }
    becomeReady(ctx, record, handle);
  }
}

// ---------------------------------------------------------------------------
// One start attempt: port check -> spawn -> readiness (shared by initial
// start and every restart attempt).
// ---------------------------------------------------------------------------

async function performStartAttempt(
  ctx: SupervisorContext,
  record: ProcessRecord
): Promise<ManagedProcess> {
  const config = record.config;
  record.state = 'starting';
  record.lastError = undefined;

  await checkPortsFree(ctx, config);

  const handle = ctx.spawnFn({
    id: config.id,
    command: config.command,
    args: config.args,
    cwd: config.cwd,
    env: config.env,
    logger: ctx.logger,
  });
  trackHandle(record, handle);

  await raceReadinessAgainstExit(ctx, config, handle);
  return handle;
}

/**
 * Records `handle` as `record`'s current live handle for `getHandles()`, the
 * instant `spawnFn` returns it — deliberately *not* gated on readiness. A
 * process still waiting on its readiness probe (or one whose readiness
 * timed out while the OS process is still alive) is still a real, running
 * process that `shutdownAll` must be able to reach; only a process whose
 * `exited` actually settles is no longer live. `exited` is raced elsewhere
 * for readiness purposes — this is an independent, permanent observer that
 * exists purely to keep `getHandles()` current, so it must attach its own
 * rejection handler rather than relying on another call site's.
 *
 * The identity check in `clearHandleIfCurrent` guards against an already-
 * superseded handle's `exited` settling out of order and wiping out a
 * newer attempt's handle — structurally this can't happen given attempts
 * run strictly sequentially per record, but see the module doc comment on
 * why this file treats "stale thing overwrites current thing" as a class of
 * bug worth guarding against even when believed impossible.
 */
function trackHandle(record: ProcessRecord, handle: ManagedProcess): void {
  record.handle = handle;
  const clear = (): void => clearHandleIfCurrent(record, handle);
  handle.exited.then(clear, clear);
}

function clearHandleIfCurrent(record: ProcessRecord, handle: ManagedProcess): void {
  if (record.handle === handle) {
    record.handle = undefined;
  }
}

async function checkPortsFree(ctx: SupervisorContext, config: ProcessConfig): Promise<void> {
  try {
    await assertPortsFree(config.requirePortsFree, ctx.host, ctx.logger);
  } catch (error) {
    throw new ProcessError(`process "${config.id}": ${describeError(error)}`, {
      processId: config.id,
      cause: error,
    });
  }
}

/**
 * Resolves once `config.readiness` is satisfied, or rejects — naming the
 * process — the instant the process exits first. Without this race, a
 * `ManagedProcess` whose `exited` rejects (a spawn failure) or resolves
 * (the process died before ever becoming ready) would otherwise only be
 * noticed via `readinessTimeoutMs`, or never noticed at all for probes that
 * do not depend on the process actually running (`none`, `delay`).
 *
 * `handle.exited.then(...)` attaches a reaction synchronously, so `exited`
 * is never left unobserved — see requirement: a spawn failure must never
 * become an unhandled rejection.
 */
async function raceReadinessAgainstExit(
  ctx: SupervisorContext,
  config: ProcessConfig,
  handle: ManagedProcess
): Promise<void> {
  const exitedBeforeReady = handle.exited.then(exit =>
    Promise.reject(
      new ProcessError(
        `process "${config.id}": exited (code=${exit.code}, signal=${exit.signal}) before it became ready`,
        { processId: config.id }
      )
    )
  );
  const readiness = waitForReadiness(config.readiness, {
    processId: config.id,
    timeoutMs: config.readinessTimeoutMs,
    clock: ctx.clock,
    logger: ctx.logger,
    lines: handle.lines,
  });

  await Promise.race([readiness, exitedBeforeReady]);
}

// ---------------------------------------------------------------------------
// Ready state: arm resetAfterMs, monitor for the eventual exit
// ---------------------------------------------------------------------------

function becomeReady(ctx: SupervisorContext, record: ProcessRecord, handle: ManagedProcess): void {
  record.state = 'ready';
  record.lastError = undefined;
  armResetTimer(ctx, record);
  void monitorProcess(ctx, record, handle);
}

function armResetTimer(ctx: SupervisorContext, record: ProcessRecord): void {
  record.resetTimer = ctx.clock.setTimeout(() => {
    record.resetTimer = undefined;
    record.restartCount = 0;
  }, record.config.restart.resetAfterMs);
}

function cancelResetTimer(ctx: SupervisorContext, record: ProcessRecord): void {
  if (record.resetTimer !== undefined) {
    ctx.clock.clearTimeout(record.resetTimer);
    record.resetTimer = undefined;
  }
}

function cancelRestartTimer(ctx: SupervisorContext, record: ProcessRecord): void {
  if (record.restartTimer !== undefined) {
    ctx.clock.clearTimeout(record.restartTimer);
    record.restartTimer = undefined;
  }
}

type ExitOutcome = { ok: true; value: ProcessExit } | { ok: false; error: unknown };

async function awaitExit(handle: ManagedProcess): Promise<ExitOutcome> {
  try {
    return { ok: true, value: await handle.exited };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Watches a running process to its eventual exit and applies the restart
 * policy. Cancels the `resetAfterMs` timer as the first step on every path —
 * see the module doc comment on why this must happen before anything else.
 */
async function monitorProcess(
  ctx: SupervisorContext,
  record: ProcessRecord,
  handle: ManagedProcess
): Promise<void> {
  const outcome = await awaitExit(handle);
  cancelResetTimer(ctx, record);
  // `trackHandle` already clears `record.handle` once `exited` settles —
  // nothing to do here on that front.

  if (!outcome.ok) {
    record.lastError = describeError(outcome.error);
    ctx.logger.error('process supervisor: running process ended unexpectedly', {
      processId: record.config.id,
      error: record.lastError,
    });
    handleExit(ctx, record, true);
    return;
  }

  record.lastExit = outcome.value;
  const crashed = outcome.value.code !== 0 || outcome.value.signal !== null;
  ctx.logger.info('process supervisor: process exited', {
    processId: record.config.id,
    code: outcome.value.code,
    signal: outcome.value.signal,
  });
  handleExit(ctx, record, crashed);
}

// ---------------------------------------------------------------------------
// Restart policy
// ---------------------------------------------------------------------------

function handleExit(ctx: SupervisorContext, record: ProcessRecord, crashed: boolean): void {
  if (ctx.disposed) {
    record.state = 'stopped';
    return;
  }
  const policy = record.config.restart.policy;
  const shouldRestart = policy === 'always' || (policy === 'onCrash' && crashed);
  if (!shouldRestart) {
    record.state = 'stopped';
    return;
  }
  scheduleRestart(ctx, record);
}

function computeBackoffMs(restart: ProcessConfig['restart'], attempt: number): number {
  const grown = restart.backoffMs * restart.backoffMultiplier ** (attempt - 1);
  return Math.min(grown, restart.maxBackoffMs);
}

/** Schedules the next restart attempt, or gives up permanently once `maxRestarts` is exhausted. */
function scheduleRestart(ctx: SupervisorContext, record: ProcessRecord): void {
  const restart = record.config.restart;
  if (record.restartCount >= restart.maxRestarts) {
    record.state = 'failed';
    record.lastError = `exceeded maxRestarts (${restart.maxRestarts})`;
    ctx.logger.error('process supervisor: giving up after exceeding maxRestarts', {
      processId: record.config.id,
      maxRestarts: restart.maxRestarts,
      restartCount: record.restartCount,
    });
    return;
  }

  record.restartCount += 1;
  const delayMs = computeBackoffMs(restart, record.restartCount);
  record.state = 'restarting';
  record.restartTimer = ctx.clock.setTimeout(() => {
    record.restartTimer = undefined;
    void runRestartAttempt(ctx, record);
  }, delayMs);
}

type StartOutcome = { ok: true; handle: ManagedProcess } | { ok: false; error: unknown };

async function tryStart(ctx: SupervisorContext, record: ProcessRecord): Promise<StartOutcome> {
  try {
    return { ok: true, handle: await performStartAttempt(ctx, record) };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Runs one restart attempt after its backoff delay has elapsed. Unlike the
 * initial `start()`, a failure here never throws: it is treated the same as
 * a crash — it consumes one restart attempt and re-enters `scheduleRestart`,
 * which either backs off again or (once `maxRestarts` is exhausted) gives up
 * permanently. This keeps "a restart attempt that can't spawn" and "a
 * process that crashes right after spawning" on the exact same, single,
 * bounded retry path instead of two.
 */
async function runRestartAttempt(ctx: SupervisorContext, record: ProcessRecord): Promise<void> {
  if (ctx.disposed) {
    record.state = 'stopped';
    return;
  }
  const attempt = await tryStart(ctx, record);
  if (ctx.disposed) {
    record.state = 'stopped';
    return;
  }
  if (!attempt.ok) {
    record.lastError = describeError(attempt.error);
    ctx.logger.warn('process supervisor: restart attempt failed to become ready', {
      processId: record.config.id,
      error: record.lastError,
    });
    scheduleRestart(ctx, record);
    return;
  }
  becomeReady(ctx, record, attempt.handle);
}

// ---------------------------------------------------------------------------
// Disposal
// ---------------------------------------------------------------------------

function disposeSupervisor(ctx: SupervisorContext): void {
  if (ctx.disposed) {
    return;
  }
  ctx.disposed = true;
  for (const record of ctx.records.values()) {
    cancelRestartTimer(ctx, record);
    cancelResetTimer(ctx, record);
    if (record.state === 'pending' || record.state === 'restarting') {
      record.state = 'stopped';
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
