/**
 * Windows touch-display probe (T2.3, I10).
 *
 * This is the file whose predecessor equivalent froze an entire machine —
 * see ARCHITECTURE.md, "The lockup that justifies the layout design", cause
 * 3. That freeze had a precise shape: a synchronous, timeout-less
 * child-process call to a platform touch-detection probe, sitting inside the
 * shared layout-resolution path, whose cache was invalidated by every
 * display-changed event. Every piece of this file's design exists to close
 * one clause of that sentence:
 *
 *   - "synchronous"        -> `execFile` (async), never `exec`/`execSync`/
 *                             `execFileSync` (banned; see the module-level
 *                             `no-restricted-imports`/`no-restricted-syntax`
 *                             rules in eslint.config.mjs for the shell/exec
 *                             ones, and the "never `execFileSync`" rule is a
 *                             convention enforced here by review, since there
 *                             is no synchronous-execFile-specific lint rule).
 *   - "timeout-less"        -> `timeoutMs`, enforced by this module's own
 *                             clock-driven race (`raceWithTimeout`), not by
 *                             trusting the child to respect anything.
 *   - "sitting inside the shared layout-resolution path" -> it does not.
 *     `resolveLayout` (`src/layout/resolve.ts`) is pure and receives
 *     `touchDisplayIds` as injected data; nothing in that file imports this
 *     one. This probe lives at the I/O edge, one layer above.
 *   - "cache invalidated by every display-changed event" -> the cache here
 *     is time-based, not event-based, and this file exposes no hook a
 *     display-changed handler could wire into by accident (see `invalidate`
 *     below for the one you'd have to go out of your way to misuse).
 *
 * Windows display-to-touch-digitizer mapping, honestly: this probe detects
 * whether the system has touch-digitizer hardware at all, using PowerShell
 * over WMI/CIM (`Win32_PointingDevice`, `PointingType -eq 8` = "Touch
 * Screen" per the WMI enum). **There is no supported OS API, on Windows,
 * that links a specific HID touch digitizer instance to a specific
 * Electron/Chromium `Display.id`** — and this probe's `detect(signal)`
 * signature (matching `TouchProbe`) is not even given the current display
 * topology to correlate against in the first place. The numbers this probe
 * can produce are therefore WMI/CIM enumeration-order values, not verified
 * Electron display ids. Returning them as if they were real display ids
 * would risk placing a kiosk window on the wrong monitor with high
 * confidence and no visible error — worse than returning nothing. Treat any
 * non-empty result from this probe as experimental; see the doc comment on
 * `parseTouchDisplayIds` and the report for this task for the full
 * reasoning and recommendation.
 */

import { execFile } from 'node:child_process';
import { systemClock, type Clock } from '../../clock.js';
import { noopLogger, type Logger } from '../../logging/logger.js';
import type { TouchProbe } from './types.js';

/**
 * Injectable exec seam (I10). Tests supply a fake so no test ever runs a
 * real platform command — this is what makes the hang, timeout, and failure
 * paths testable at all; the predecessor's version, calling a shell-based
 * primitive directly with no seam, was untestable, which is why the bug
 * shipped and survived.
 *
 * Deliberately narrower than `execFile`'s own signature: just enough to run
 * one argv command and get its stdout back, or throw/reject on failure.
 * `signal` is threaded through explicitly (rather than folded into an
 * options bag) so a fake implementation cannot forget to accept it.
 */
export type ExecFn = (
  file: string,
  args: readonly string[],
  signal: AbortSignal
) => Promise<{ stdout: string }>;

export interface WindowsTouchProbeOptions {
  /** Per-attempt budget, enforced by this module regardless of what `exec` does. Default 5000ms. */
  timeoutMs?: number;
  logger?: Logger;
  /** Default: the real `execFile`. Override in tests. */
  exec?: ExecFn;
  clock?: Clock;
  /** How long a settled result (success or failure) is served from cache before a fresh probe runs. Default 60000ms. */
  cacheTtlMs?: number;
  /** Default: `process.platform`. Override in tests to exercise the non-Windows short circuit. */
  platform?: NodeJS.Platform;
}

export interface WindowsTouchProbe extends TouchProbe {
  /**
   * Forces the next `detect()` to re-run the probe instead of serving the
   * cached result.
   *
   * **MUST NEVER be called from an Electron `screen` display-changed
   * handler** (`display-added` / `display-removed` / `display-metrics-
   * changed`), nor from anything reachable from one. That exact wiring — a
   * probe cache invalidated by every display-changed event — is cause 3 of
   * the documented lockup in ARCHITECTURE.md: the invalidation cascaded with
   * the display-changed event's own retries and froze the process. This
   * method exists only for a deliberately out-of-band caller (a diagnostics
   * command, an operator action, a test) that wants a probe result sooner
   * than `cacheTtlMs` would otherwise allow.
   */
  invalidate(): void;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Time-based staleness, not event-driven invalidation — this is the
 * deliberate fix for cause 3. Touch-digitizer hardware essentially never
 * changes while a kiosk machine is running, and the supervisor upstream
 * (T2.4) already debounces/dedups display-changed events before anything
 * downstream reacts to them, so there is no plausible scenario where a
 * consumer needs sub-minute freshness here. 60 seconds is long enough that a
 * burst of resolves (e.g. several windows resolving in the same tick) never
 * spawns more than one extra PowerShell process per minute, and short enough
 * that a technician who plugs in a touch monitor and waits a moment sees it
 * picked up without restarting the app.
 */
const DEFAULT_CACHE_TTL_MS = 60_000;

const PROBE_COMMAND = 'powershell.exe';

/**
 * Counts touch-digitizer pointing devices (`PointingType -eq 8`, "Touch
 * Screen" in the `Win32_PointingDevice` WMI enum) and prints their 0-based
 * enumeration ordinals as a JSON array, e.g. `[0]` for one digitizer, `[]`
 * for none. `ConvertTo-Json` on Windows PowerShell 5.1 (the default on
 * Windows 10/11, as opposed to PowerShell 7's `-AsArray`) collapses a
 * single-element array to a bare scalar, so the parser on the JS side
 * (`parseTouchDisplayIds`) deliberately accepts a bare number as well as an
 * array, rather than relying on `-AsArray` and requiring PowerShell 7.
 */
const PROBE_SCRIPT =
  '$count = (Get-CimInstance -ClassName Win32_PointingDevice -ErrorAction Stop | ' +
  'Where-Object { $_.PointingType -eq 8 } | Measure-Object).Count; ' +
  'if ($count -eq 0) { "[]" } else { ConvertTo-Json -InputObject @(0..($count-1)) -Compress }';

const PROBE_ARGS = ['-NoProfile', '-NonInteractive', '-Command', PROBE_SCRIPT];

/**
 * The real `ExecFn`, backing `createWindowsTouchProbe` by default. Uses
 * `execFile` — never `exec`/`execSync` (shell-based, banned by I2's lint
 * rules) and never `execFileSync` (synchronous, which is precisely the
 * defect this file exists to not repeat) — with an argv array, so there is
 * no shell and nothing to quote or escape. `signal` is passed straight
 * through to `execFile`'s own `signal` option, which both rejects the
 * pending call and kills the child process when the combined signal built
 * in `runOnce` fires — this is the "make the abort actually kill the child"
 * requirement, satisfied by the platform primitive itself rather than by
 * bespoke process-tree bookkeeping here.
 */
const realExec: ExecFn = (file, args, signal) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { signal, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout: stdout.toString() });
      }
    );
  });

/**
 * Parses `stdout` into display ids, or returns `undefined` if it cannot be
 * read as a JSON number or a JSON array of numbers — `undefined` is the
 * caller's cue to log a warning and fall back to `[]`, distinct from a
 * successful-but-empty `[]` result (no touch digitizers found), which is not
 * a failure and never warns.
 */
function parseTouchDisplayIds(stdout: string): readonly number[] | undefined {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }

  const values = Array.isArray(parsed) ? parsed : [parsed];
  if (values.every(value => typeof value === 'number' && Number.isInteger(value))) {
    return values as number[];
  }
  return undefined;
}

type ExecOutcome = { kind: 'success'; stdout: string } | { kind: 'error'; error: unknown };

/** Wraps `exec(...)` so a synchronous throw and a rejected promise both become an `ExecOutcome`, never a thrown/rejected value the caller has to catch. */
function invokeExec(exec: ExecFn, signal: AbortSignal): Promise<ExecOutcome> {
  try {
    return exec(PROBE_COMMAND, PROBE_ARGS, signal).then(
      result => ({ kind: 'success' as const, stdout: result.stdout }),
      error => ({ kind: 'error' as const, error })
    );
  } catch (error) {
    return Promise.resolve({ kind: 'error', error });
  }
}

type RaceOutcome<T> = { timedOut: true } | { timedOut: false; value: T };

/**
 * Races `promise` (which, by construction at every call site in this file,
 * never rejects — see `invokeExec`) against `timeoutMs` on `clock`. This is
 * the enforcement of I10's "explicit timeout": it bounds wall-clock time
 * regardless of whether `promise` ever settles on its own, which is exactly
 * what makes the "fake exec that never settles" regression test possible —
 * a probe that only relied on the child eventually respecting its abort
 * signal would hang forever against a fake that ignores it, same as the
 * predecessor's bug. On timeout, `controller.abort()` is called so a real
 * child process is actually killed (see `realExec`'s doc comment); the
 * still-pending `promise` is deliberately left unawaited (`void`) rather
 * than blocking this function on it — its eventual settlement, if any, is
 * irrelevant once the deadline has passed.
 */
function raceWithTimeout<T>(
  promise: Promise<T>,
  clock: Clock,
  timeoutMs: number,
  controller: AbortController
): Promise<RaceOutcome<T>> {
  return new Promise(resolve => {
    let settled = false;

    const timer = clock.setTimeout(() => {
      if (settled) return;
      settled = true;
      controller.abort();
      resolve({ timedOut: true });
    }, timeoutMs);

    void promise.then(value => {
      if (settled) return;
      settled = true;
      clock.clearTimeout(timer);
      resolve({ timedOut: false, value });
    });
  });
}

/**
 * Creates a `TouchProbe` backed by a Windows-specific WMI query, with the
 * async/timeout/cache/join discipline described in the module doc comment.
 * See that comment and the task report for the honest limitation on what
 * the returned ids actually mean.
 */
export function createWindowsTouchProbe(options: WindowsTouchProbeOptions = {}): WindowsTouchProbe {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const logger = options.logger ?? noopLogger;
  const exec = options.exec ?? realExec;
  const clock = options.clock ?? systemClock;
  const platform = options.platform ?? process.platform;

  let cached: { ids: readonly number[]; cachedAt: number } | undefined;
  let inFlight: Promise<readonly number[]> | undefined;
  let warnedNonWindows = false;

  function isFresh(): boolean {
    return cached !== undefined && clock.now() - cached.cachedAt < cacheTtlMs;
  }

  /**
   * Runs exactly one probe attempt end to end and logs at most one `warn`
   * for it. Never rejects: every branch below resolves `[]` on failure, and
   * the `invokeExec`/`raceWithTimeout` machinery it calls into has already
   * turned a thrown error, a rejected promise, and a timeout into plain
   * return values rather than exceptions.
   */
  async function runOnce(signal: AbortSignal): Promise<readonly number[]> {
    const controller = new AbortController();
    const onCallerAbort = (): void => controller.abort();
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', onCallerAbort);
    }

    const raced = await raceWithTimeout(
      invokeExec(exec, controller.signal),
      clock,
      timeoutMs,
      controller
    );
    signal.removeEventListener('abort', onCallerAbort);

    if (raced.timedOut) {
      logger.warn('windows touch probe: timed out; treating as no touch displays', { timeoutMs });
      return [];
    }
    if (raced.value.kind === 'error') {
      logger.warn('windows touch probe: probe command failed; treating as no touch displays', {
        error:
          raced.value.error instanceof Error
            ? raced.value.error.message
            : String(raced.value.error),
      });
      return [];
    }

    const ids = parseTouchDisplayIds(raced.value.stdout);
    if (ids === undefined) {
      logger.warn(
        'windows touch probe: could not parse probe output; treating as no touch displays',
        { stdoutPreview: raced.value.stdout.slice(0, 200) }
      );
      return [];
    }
    return ids;
  }

  return {
    detect(signal) {
      if (platform !== 'win32') {
        if (!warnedNonWindows) {
          warnedNonWindows = true;
          logger.warn('windows touch probe: not running on win32; resolving no touch displays', {
            platform,
          });
        }
        return Promise.resolve([]);
      }

      if (isFresh()) {
        // `isFresh()` guarantees `cached` is defined.
        return Promise.resolve(cached!.ids);
      }

      // Join an in-flight probe rather than spawning a second child (I10):
      // a second concurrent `detect()` call returns this same promise
      // instead of starting another PowerShell process. Its own `signal` is
      // deliberately not wired into the shared attempt — aborting a second,
      // merely-joining caller must not cancel work the first caller (or any
      // other joiner) still needs.
      inFlight ??= runOnce(signal).then(
        ids => {
          cached = { ids, cachedAt: clock.now() };
          inFlight = undefined;
          return ids;
        },
        // `runOnce` is designed to never reject (see its doc comment); this
        // branch is a defensive backstop so `detect()` truly never rejects
        // even if that invariant is ever violated by a future change here.
        () => {
          inFlight = undefined;
          return [];
        }
      );
      return inFlight;
    },
    invalidate() {
      cached = undefined;
    },
  };
}
