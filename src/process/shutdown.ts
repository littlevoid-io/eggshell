/**
 * Graceful shutdown of supervised processes (T2.9, Requirement 9's other
 * half). Orphaned children hold ports; a port still held is what trips
 * T2.5's `assertPortsFree` on the *next* launch and turns a transient crash
 * or a power blip into a permanently dead installation. `shutdownAll`'s
 * success condition is therefore not "the function returned" — it is
 * "nothing is still running afterwards" — see the Windows caveats below for
 * where that guarantee genuinely holds and where it does not.
 *
 * ## Standalone function, not a `ProcessSupervisor` method
 *
 * `src/process/supervisor.ts`'s `dispose()` already documents the intended
 * seam: it cancels restart/reset bookkeeping and stops scheduling further
 * restarts, but deliberately does not kill any running child — "that is
 * T2.9's `shutdownAll`". This module is the other half of that seam, kept as
 * a plain function operating on `ManagedProcess` handles rather than a
 * supervisor method, for the same reason `spawn.ts` and `readiness.ts` are
 * separate from `supervisor.ts`: termination mechanics (signal, grace
 * period, force-kill, tree-kill) are a distinct concern from restart policy,
 * and keeping them decoupled means this file can be fully unit-tested (and
 * used standalone, e.g. by a future CLI shutdown path) without importing
 * `supervisor.ts` at all, and `supervisor.ts` never has to import this file.
 *
 * A caller that owns both a supervisor and its handles composes them
 * explicitly and in this order:
 *
 * ```ts
 * supervisor.dispose();               // disarm the restart policy FIRST
 * await shutdownAll(handles, opts);   // then actually kill what's running
 * ```
 *
 * Order matters: `dispose()` sets the supervisor's internal `disposed` flag
 * *synchronously*, so every exit `shutdownAll` subsequently causes is seen by
 * `handleExit` as post-disposal and short-circuits straight to `stopped`
 * instead of scheduling a restart. Calling them in the other order (or
 * concurrently without `dispose()` first) would race shutdown against the
 * supervisor's own restart backoff and could respawn a process this call was
 * trying to kill — the exact bug this module's test suite calls out
 * explicitly as "the subtlest bug available here".
 *
 * ## Windows realities — read before trusting any of this on POSIX terms
 *
 * 1. **`kill('SIGTERM')` does not kill descendants on Windows.** A supervised
 *    process that spawns its own children (a shell script, a dev server
 *    spawning a bundler) leaves grandchildren orphaned and still holding
 *    ports. Reaching the whole tree requires `taskkill /PID <pid> /T /F`.
 *    When `killTree` is enabled, this module issues exactly that **at signal
 *    time**, not only on escalation — see "the orphaned-grandchild gap" below
 *    for why, and for what this does and does not guarantee.
 * 2. **There is no true graceful signal on Windows, and `taskkill`'s
 *    non-forceful mode does not fill that gap either.** Node maps any signal
 *    passed to `ChildProcess.kill()` on Windows straight to `TerminateProcess`
 *    — the child cannot catch it, cannot flush anything, cannot run cleanup
 *    code. `taskkill /PID <pid> /T` *without* `/F` was measured directly (a
 *    Node parent with a Node grandchild bound to a fixed TCP port, killed
 *    with and without `/F`): it does not send anything a plain console-mode
 *    Node process reacts to — `taskkill` itself refuses, printing "This
 *    process can only be terminated forcefully (with /F option)", and both
 *    processes and the held port were still observed alive afterwards. Only
 *    `/T /F` actually swept the tree and freed the port. So there is no
 *    intermediate "ask nicely, tree-wide" stage available on Windows to lose
 *    by moving the force flag earlier — the classic "signal, wait,
 *    force-kill" two-step is kept for its *timing* value (see below), but do
 *    not read a Windows `exitedOnSignal` result as "the process cleaned up
 *    after itself" the way a POSIX SIGTERM handler might have.
 *
 *    **What `graceMs` actually buys on Windows, stated plainly:** not
 *    cleanup time — that opportunity never existed, at the process level or
 *    the tree level. What it buys is a bounded wait for the OS to actually
 *    finish tearing the (already forcefully signalled, and — when `killTree`
 *    is on — already tree-killed) process down and release its handles,
 *    before this module gives up on observing `exited` and retries the same
 *    forceful step as a safety net. For a `killTree` target specifically,
 *    both the signal-time step and the escalation step are equally forceful
 *    (`/T /F`); escalation is a *retry*, not a heavier hammer than what
 *    already ran. On POSIX, by contrast, `graceMs` is the classic meaningful
 *    window: SIGTERM is a real, catchable signal, and a well-behaved child
 *    can close sockets, flush files, and exit on its own before `SIGKILL`
 *    ever becomes necessary. A doc comment claiming Windows gets the same
 *    benefit would be a fiction; this one does not make that claim.
 * 3. **`ChildProcess.kill()` returns whether the signal was delivered, not
 *    whether the process exited.** Its boolean return is never consulted here
 *    — every kill is raced against `handle.exited` with our own
 *    clock-driven timeout instead.
 * 4. A handle whose `exited` has already rejected (`spawn.ts`'s ENOENT path —
 *    the process never actually started) is treated as already gone: no
 *    signal is ever sent to it.
 *
 * ## The orphaned-grandchild gap, and how far closing it actually goes
 *
 * Previously, `killTree`/`taskkill` was reached only on the force-kill
 * (escalation) path: a process that exited on its own within `graceMs`
 * (`exitedOnSignal`) was taken at face value, and any grandchildren it left
 * behind were never swept. That left a real gap — a supervised process that
 * spawns its own children and exits cleanly still orphans them, and an
 * orphan holding a port fails the *next* launch's port pre-check.
 *
 * This module now closes that gap for `killTree` targets by issuing
 * `taskkill /PID <pid> /T /F` **at signal time**, not only on escalation. The
 * safety reasoning that used to gate tree-kill to the escalation path is
 * fully preserved, not weakened: the danger was always taskkilling a pid
 * that had *already* exited and that Windows might since have recycled for
 * an unrelated process. That reasoning is about *when* the pid was last
 * confirmed alive, not about which shutdown stage happens to be running —
 * and at signal time, exactly like at escalation time, this module has just
 * finished flushing microtasks to check for an already-observed exit and
 * found none. Signal time is therefore just as safe a place to target that
 * pid as escalation time always was. If the process exits on its own within
 * `graceMs` afterwards, the outcome is still reported `exitedOnSignal` — the
 * *reporting* of a graceful self-exit is unchanged — but its tree has, unlike
 * before, already been swept.
 *
 * What this does **not** do: reach a grandchild that has been deliberately
 * detached from the tree `taskkill /T` walks (e.g. spawned with
 * `DETACHED_PROCESS` or its own new process group, breaking the recorded
 * parent-pid link). `taskkill /T` only ever walks Windows' own
 * parent-pid-based process tree; a process that has escaped that tree is
 * invisible to it regardless of which shutdown stage issues the call. Nor
 * does any `killTree: false` target (an explicit opt-out, or the POSIX
 * default) get tree-kill at all — on that path only the direct child is
 * ever signalled, at both stages, exactly as before. If a supervised process
 * spawns children that must not outlive it and that legitimately need to
 * escape the tree, that process remains responsible for them itself (or
 * needs a job object upstream of this module) — this module has no
 * dependency-free way to reach a process that Windows itself cannot
 * associate with the pid it was given.
 *
 * ## `graceMs` boundary semantics
 *
 * The grace period is checked by racing `handle.exited` against a
 * `clock.setTimeout(..., graceMs)`. If a process's exit is *observed* (its
 * `exited` promise's reaction has actually run) before the grace timer fires,
 * it wins and is reported `exitedOnSignal` — even if that observation happens
 * on the exact tick `graceMs` elapses. If the grace timer fires first,
 * force-kill proceeds, full stop, even if `exited` happens to resolve in that
 * same synchronous turn: this module does not insert an extra microtask turn
 * to double-check for a same-tick exit once the deadline timer has fired,
 * because doing so would make "how many pending microtasks happen to be
 * queued right now" part of the observable contract. Net effect: **the grace
 * deadline is inclusive of force-kill** — a `graceMs`-exact exit that has not
 * yet been observed when the timer fires still gets force-killed. This is
 * exercised directly by this module's boundary test.
 */

import { execFile } from 'node:child_process';
import type { Clock } from '../clock.js';
import { noopLogger, type Logger } from '../logging/logger.js';
import type { ManagedProcess, ProcessExit } from './types.js';
import { describeError } from '../errors.js';

const DEFAULT_SIGNAL: NodeJS.Signals = 'SIGTERM';

/**
 * Signal used for the escalation step when `killTree` is not in play.
 * `SIGKILL` is meaningful on POSIX (uncatchable, immediate); on Windows Node
 * accepts it too and maps it to the same forceful `TerminateProcess` any
 * other signal would (see the module doc comment on realities #2) — using it
 * uniformly avoids a platform branch that would not change behaviour anyway.
 */
const FORCE_SIGNAL: NodeJS.Signals = 'SIGKILL';

/** How many microtask turns to flush before deciding whether `exited` was *already* settled at call time. See `shutdownOne`'s use of `watchExit`. */
const ALREADY_SETTLED_FLUSH_TURNS = 2;

/**
 * Invokes `taskkill` with the given argv (e.g.
 * `['/PID', '1234', '/T', '/F']`). Injected so tests never spawn a real
 * process; production callers can rely on the default export
 * (`defaultTaskkillInvoker`) below, which really shells out.
 */
export type TaskkillInvoker = (args: readonly string[]) => Promise<void>;

/**
 * Real `taskkill` invocation. Uses `execFile` (an argv array, no shell) —
 * consistent with `spawn.ts`'s I2 treatment of every other child process this
 * package launches. A non-zero `taskkill` exit (e.g. "process not found",
 * because it already died) is treated as success: the goal state — nothing
 * running under that pid — holds either way. Only a failure to launch
 * `taskkill.exe` itself surfaces as a rejection (`error.code` is the string
 * errno `'ENOENT'` in that case, versus a numeric exit code when `taskkill`
 * ran but reported failure).
 */
const defaultTaskkillInvoker: TaskkillInvoker = args =>
  new Promise((resolve, reject) => {
    execFile('taskkill', [...args], error => {
      if (error !== null && typeof (error as NodeJS.ErrnoException).code === 'string') {
        reject(error);
        return;
      }
      resolve();
    });
  });

export type ShutdownOutcome = 'alreadyExited' | 'exitedOnSignal' | 'forceKilled' | 'failed';

export interface ShutdownResult {
  readonly id: string;
  readonly pid: number | undefined;
  readonly outcome: ShutdownOutcome;
}

export interface ShutdownTarget {
  readonly handle: ManagedProcess;
  /** Overrides `options.signal` for this process only. */
  readonly signal?: NodeJS.Signals;
  /** Overrides `options.graceMs` for this process only. */
  readonly graceMs?: number;
  /** Overrides `options.killTree` for this process only. */
  readonly killTree?: boolean;
  /**
   * Cancels any in-flight readiness wait tied to this process — e.g. an
   * `AbortController` a caller's own start logic races `waitForReadiness`
   * (`readiness.ts`) against — before the shutdown signal is sent. Without
   * this, a process still in its "starting, waiting for readiness" window
   * when shutdown begins would sit until its own `readinessTimeoutMs`
   * elapses, needlessly delaying convergence and holding the event loop
   * open. Optional: omit for a process with no readiness wait ever in
   * flight, or when none is wired up.
   */
  readonly abortReadiness?: () => void;
}

export interface ShutdownOptions {
  /** How long to wait for `exited` after the initial signal, and again after force-kill, before giving up on observing it. */
  readonly graceMs: number;
  readonly clock: Clock;
  readonly logger?: Logger;
  /** Signal sent first. Default `SIGTERM`. */
  readonly signal?: NodeJS.Signals;
  /**
   * Force-kill the whole process tree via `taskkill /PID <pid> /T /F`
   * instead of signalling only the direct child. Defaults to
   * `process.platform === 'win32'` — the only platform this module knows a
   * tree-kill mechanism for. Override explicitly (with `taskkill` injected)
   * to exercise this path deterministically in tests regardless of the host
   * OS running them.
   */
  readonly killTree?: boolean;
  /** Injected `taskkill` invoker. Defaults to `defaultTaskkillInvoker`. */
  readonly taskkill?: TaskkillInvoker;
}


type ExitOutcome = { readonly ok: true; readonly value: ProcessExit } | { readonly ok: false };

/**
 * Wraps `handle.exited` so its settlement can be *observed* (via `peek()`)
 * without ever leaving it unhandled — a rejected `exited` (spawn failure)
 * must never become an unhandled rejection just because this module chose
 * not to `await` it directly.
 */
function watchExit(handle: ManagedProcess): { readonly peek: () => ExitOutcome | undefined } {
  let settled: ExitOutcome | undefined;
  handle.exited.then(
    value => {
      settled = { ok: true, value };
    },
    () => {
      settled = { ok: false };
    }
  );
  return { peek: () => settled };
}

async function flushMicrotasks(turns: number): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

/**
 * Races a process's `exited` against a `graceMs` timer on `clock`. Whichever
 * settles first wins; the timer is cleared on an `exited` win so no timer is
 * ever left pending (verified by the fake-clock `pendingCount` test) — a
 * timer that wins the race is already removed from the fake clock's own
 * pending set the moment it fires, so nothing to clear on that side.
 */
function raceAgainstGrace(
  handle: ManagedProcess,
  clock: Clock,
  graceMs: number
): Promise<'exited' | 'timeout'> {
  return new Promise(resolve => {
    let settled = false;
    const timeoutHandle = clock.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve('timeout');
    }, graceMs);

    const onSettle = (): void => {
      if (settled) return;
      settled = true;
      clock.clearTimeout(timeoutHandle);
      resolve('exited');
    };
    handle.exited.then(onSettle, onSettle);
  });
}

/** Sends `signal`, swallowing (and logging) a synchronous throw — most commonly the process is already gone. Never throws. */
function trySignal(
  handle: ManagedProcess,
  id: string,
  signal: NodeJS.Signals,
  logger: Logger
): void {
  try {
    handle.kill(signal);
  } catch (error) {
    logger.warn('shutdown: sending signal threw; process may already be gone', {
      processId: id,
      signal,
      error: describeError(error),
    });
  }
}

/** Logs the shared "no pid to target" fallback warning used at both the signal-time and escalation tree-kill attempts. */
function logPidFallback(id: string, logger: Logger): void {
  logger.warn('shutdown: killTree requested but process has no pid; falling back to kill()', {
    processId: id,
  });
}

/**
 * Initial signal. On a `killTree` target with a live pid, this issues
 * `taskkill /PID <pid> /T /F` immediately instead of `handle.kill(signal)` —
 * see the module doc comment's "orphaned-grandchild gap" section for why
 * this runs at signal time now, and why that is exactly as safe as the
 * escalation path always was. Never throws: a failure to even issue the
 * tree-kill (e.g. `taskkill.exe` missing) is logged and swallowed, same as a
 * synchronous `handle.kill()` throw would be — the grace race afterwards,
 * and the escalation retry beyond it, are what actually determine the
 * outcome either way.
 */
async function signalOne(
  handle: ManagedProcess,
  id: string,
  signal: NodeJS.Signals,
  killTree: boolean,
  taskkill: TaskkillInvoker,
  logger: Logger
): Promise<void> {
  if (!killTree) {
    trySignal(handle, id, signal, logger);
    return;
  }
  if (handle.pid === undefined) {
    logPidFallback(id, logger);
    trySignal(handle, id, signal, logger);
    return;
  }
  try {
    await taskkill(['/PID', String(handle.pid), '/T', '/F']);
  } catch (error) {
    logger.warn('shutdown: signal-time tree-kill attempt failed', {
      processId: id,
      error: describeError(error),
    });
  }
}

/**
 * Force-kill escalation. Resolves once the kill/taskkill request has been
 * issued (not once the process has actually exited — the caller races
 * `exited` separately afterwards). Throws only if the force-kill request
 * itself could not even be issued (e.g. `taskkill.exe` missing). For a
 * `killTree` target this is a *retry* of the same `/T /F` already attempted
 * at signal time, not an escalation to something heavier — see the module
 * doc comment.
 */
async function forceKill(
  handle: ManagedProcess,
  id: string,
  killTree: boolean,
  taskkill: TaskkillInvoker,
  logger: Logger
): Promise<void> {
  if (!killTree) {
    handle.kill(FORCE_SIGNAL);
    return;
  }
  if (handle.pid === undefined) {
    logPidFallback(id, logger);
    handle.kill(FORCE_SIGNAL);
    return;
  }
  await taskkill(['/PID', String(handle.pid), '/T', '/F']);
}

async function shutdownOne(
  target: ShutdownTarget,
  options: ShutdownOptions,
  logger: Logger
): Promise<ShutdownResult> {
  const { handle } = target;
  const id = handle.id;

  try {
    target.abortReadiness?.();
  } catch (error) {
    logger.warn('shutdown: abortReadiness callback threw', {
      processId: id,
      error: describeError(error),
    });
  }

  const watch = watchExit(handle);
  // Give an already-settled `exited` (already exited, or a spawn failure
  // whose rejection fired before we ever got here) a few microtask turns to
  // be observed before treating this process as still running. See the
  // module doc comment's boundary-semantics section for why this is a fixed
  // microtask flush rather than a clock-driven race.
  await flushMicrotasks(ALREADY_SETTLED_FLUSH_TURNS);
  if (watch.peek() !== undefined) {
    return { id, pid: handle.pid, outcome: 'alreadyExited' };
  }

  const signal = target.signal ?? options.signal ?? DEFAULT_SIGNAL;
  const graceMs = target.graceMs ?? options.graceMs;
  const killTree = target.killTree ?? options.killTree ?? process.platform === 'win32';
  const taskkill = options.taskkill ?? defaultTaskkillInvoker;

  await signalOne(handle, id, signal, killTree, taskkill, logger);

  const afterSignal = await raceAgainstGrace(handle, options.clock, graceMs);
  if (afterSignal === 'exited') {
    return { id, pid: handle.pid, outcome: 'exitedOnSignal' };
  }

  try {
    await forceKill(handle, id, killTree, taskkill, logger);
  } catch (error) {
    logger.error('shutdown: force-kill attempt failed', {
      processId: id,
      error: describeError(error),
    });
    return { id, pid: handle.pid, outcome: 'failed' };
  }

  logger.warn('shutdown: process force-killed after grace period elapsed', {
    processId: id,
    graceMs,
    killTree,
  });

  // Bound the post-force-kill wait too — a process (or a test double) that
  // ignores even the force signal must never make this hang.
  await raceAgainstGrace(handle, options.clock, graceMs);
  return { id, pid: handle.pid, outcome: 'forceKilled' };
}

/**
 * Shuts down every supervised process in `targets`, in **reverse** of the
 * order given (dependents before dependencies), and always resolves — never
 * throws, never hangs, even if a process ignores every signal thrown at it.
 * Idempotent: a process already observed exited (by this call or an earlier
 * one) is reported `alreadyExited` and is never signalled again.
 *
 * Processed sequentially, not in parallel: "reverse start order" means a
 * dependency's shutdown does not even begin until its dependent's has fully
 * settled, not merely that its signal was sent first.
 */
export async function shutdownAll(
  targets: readonly ShutdownTarget[],
  options: ShutdownOptions
): Promise<readonly ShutdownResult[]> {
  const logger = options.logger ?? noopLogger;

  const results: ShutdownResult[] = [];
  for (const target of [...targets].reverse()) {
    results.push(await shutdownOne(target, options, logger));
  }
  return results;
}
