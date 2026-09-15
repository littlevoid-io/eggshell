/**
 * Graceful shutdown of supervised processes. Success means "nothing is
 * still running afterwards," not "the function returned" -- an orphaned
 * child holds a port, and a held port fails the *next* launch's port
 * pre-check.
 *
 * - Standalone function, not a ProcessSupervisor method: termination
 *   mechanics (signal, grace, force-kill, tree-kill) are a distinct concern
 *   from restart policy, kept decoupled so each is independently testable.
 *   A caller that owns both MUST call `supervisor.dispose()` before
 *   `shutdownAll()`, never the reverse or concurrently -- `dispose()` sets
 *   its `disposed` flag synchronously, so every exit this causes is seen as
 *   post-disposal and never triggers a respawn race.
 * - Windows has no true graceful signal: `kill('SIGTERM')` maps straight to
 *   `TerminateProcess` and does not touch descendants. Measured directly:
 *   `taskkill /PID <pid> /T` WITHOUT `/F` does nothing to a plain Node
 *   process and taskkill itself refuses to run it -- only `/T /F` actually
 *   sweeps the tree. There is no intermediate "ask nicely, tree-wide" stage
 *   to lose by escalating early; `graceMs` still buys a bounded wait for the
 *   OS to finish tearing down an already-forcefully-killed process, not
 *   cleanup time (that opportunity never existed on Windows).
 * - When `killTree` is on, `taskkill /PID <pid> /T /F` now runs at SIGNAL
 *   time, not only on escalation, closing a gap where a process that exited
 *   cleanly on its own still orphaned its own children. Safe because the
 *   pid was just confirmed alive (microtasks flushed, no exit observed)
 *   immediately before the call -- the same safety condition escalation
 *   always relied on. Does NOT reach a grandchild deliberately detached from
 *   the process tree (`DETACHED_PROCESS`, its own process group) --
 *   `taskkill /T` only walks Windows' own parent-pid tree. `killTree: false`
 *   (explicit opt-out, or the POSIX default) never tree-kills at all.
 * - `ChildProcess.kill()`'s return value is never consulted -- every kill is
 *   raced against `handle.exited` with our own clock-driven timeout instead.
 *   A handle whose `exited` already rejected (never actually spawned, e.g.
 *   ENOENT) is treated as already gone; no signal is sent.
 * - `graceMs` boundary is inclusive of force-kill: only an *observed* exit
 *   (the `exited` reaction has actually run) before the grace timer fires
 *   counts as graceful. No extra microtask turn is inserted to double-check
 *   for a same-tick exit once the deadline fires, so a `graceMs`-exact exit
 *   not yet observed still gets force-killed.
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
