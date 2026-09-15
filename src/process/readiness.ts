/**
 * Readiness probes (T2.7).
 *
 * A supervised process (T2.8) is not usable the instant it is spawned — most
 * real servers need time to bind a port, finish loading, or print a
 * ready-marker. `waitForReadiness` turns the `readiness` probe configured on
 * a `ProcessConfig` (see `config/schema.ts`'s `readinessSchema`) into a
 * `Promise<void>` that resolves once the process has demonstrated it is
 * actually ready, or rejects with an actionable `ProcessError` if it never
 * does within the configured timeout.
 *
 * All five probe kinds share one deadline/abort wrapper
 * (`runWithDeadline`) so every exit path — success, timeout, or an external
 * `AbortSignal` firing (T2.9's shutdown aborts in-flight readiness waits) —
 * clears its timers and tears down its socket/subscription exactly once.
 */

import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { systemClock, type Clock } from '../clock.js';
import { ProcessError } from '../errors.js';
import { noopLogger, type Logger } from '../logging/logger.js';
import type { ProcessConfig } from '../config/types.js';
import type { ProcessLine, ProcessLineStream } from './types.js';

/** The `readiness` union already validated by `config/schema.ts` — reused, not redefined. */
export type ReadinessProbe = ProcessConfig['readiness'];

export type ProbeTcpFn = (port: number, signal: AbortSignal) => Promise<boolean>;
export type ProbeHttpFn = (
  url: string,
  expectStatus: number | undefined,
  signal: AbortSignal
) => Promise<boolean>;

export interface ReadinessContext {
  readonly processId: string;
  readonly timeoutMs: number;
  /** Aborting rejects the wait promptly — see `runWithDeadline`'s doc comment. */
  readonly signal?: AbortSignal;
  readonly clock?: Clock;
  readonly logger?: Logger;
  /** Required for the `log` probe; ignored by every other kind. */
  readonly lines?: ProcessLineStream;
  readonly probeTcp?: ProbeTcpFn;
  readonly probeHttp?: ProbeHttpFn;
}

const DEFAULT_HOST = '127.0.0.1';

/**
 * Poll backoff for the `tcp`/`http` probes: start at 50ms (fast enough that a
 * process which is already listening is confirmed almost immediately), double
 * each attempt, capped at 500ms (so a slow-starting process is still checked
 * often enough to report readiness promptly without spinning the event loop).
 */
const INITIAL_POLL_DELAY_MS = 50;
const MAX_POLL_DELAY_MS = 500;
const POLL_BACKOFF_MULTIPLIER = 2;

/**
 * Internal marker thrown by a probe task when it stops because
 * `runWithDeadline`'s combined signal fired (timeout or external abort), as
 * opposed to a genuine probe failure (e.g. a malformed `http` URL). Never
 * exposed outside this module — callers only ever see a `ProcessError` or the
 * original fatal error.
 */
class ReadinessSignalAbortedError extends Error {}

/**
 * Runs one probe `task` under a combined deadline: `timeoutMs` (measured on
 * `clock`) plus `externalSignal` (T2.9's shutdown wiring). `task` receives
 * the combined `AbortSignal` and MUST react to it by tearing down its own
 * socket/timer/subscription and rejecting with `ReadinessSignalAbortedError`
 * — this wrapper only decides what a stop means, it does not itself know how
 * to cancel a given probe's I/O.
 *
 * Abort semantics: an aborted wait REJECTS (never resolves) with a
 * `ProcessError`, distinguishing "timed out" from "aborted" in the message,
 * both naming `processId`, `probeKind`, and the elapsed time — the same
 * treatment as a timeout, since both mean "readiness was never confirmed".
 *
 * `finally` guarantees the deadline timer and the external-abort listener are
 * removed on every exit path, so a settled wait never leaves a dangling timer
 * behind (verified by the fake-clock `pendingCount` tests).
 */
async function runWithDeadline(
  processId: string,
  probeKind: string,
  timeoutMs: number,
  clock: Clock,
  externalSignal: AbortSignal | undefined,
  task: (signal: AbortSignal) => Promise<void>
): Promise<void> {
  const startedAt = clock.now();
  const combinedController = new AbortController();
  let timedOut = false;

  const onExternalAbort = (): void => combinedController.abort();
  if (externalSignal?.aborted === true) {
    combinedController.abort();
  } else {
    externalSignal?.addEventListener('abort', onExternalAbort);
  }

  const timeoutHandle = clock.setTimeout(() => {
    timedOut = true;
    combinedController.abort();
  }, timeoutMs);

  try {
    await task(combinedController.signal);
  } catch (error) {
    if (!(error instanceof ReadinessSignalAbortedError) && !combinedController.signal.aborted) {
      throw error;
    }
    const elapsedMs = clock.now() - startedAt;
    const reason = timedOut ? 'timed out' : 'was aborted';
    throw new ProcessError(
      `process "${processId}": readiness probe "${probeKind}" ${reason} after ${elapsedMs}ms ` +
        `(timeout ${timeoutMs}ms)`,
      { processId, cause: error }
    );
  } finally {
    clock.clearTimeout(timeoutHandle);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

/** Sleeps `ms` on `clock`, rejecting promptly if `signal` fires first. Always clears its timer. */
function sleep(ms: number, clock: Clock, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ReadinessSignalAbortedError());
      return;
    }
    const handle = clock.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clock.clearTimeout(handle);
      reject(new ReadinessSignalAbortedError());
    };
    signal.addEventListener('abort', onAbort);
  });
}

/**
 * Polls `attempt` with growing backoff until it reports readiness (`true`) or
 * `signal` fires. `attempt` itself decides what a single check means (connect
 * a socket, issue one HTTP GET) and must resolve `false` — never throw — for
 * an ordinary "not ready yet" outcome; a thrown error here is fatal and
 * skips the rest of the poll loop.
 */
async function pollUntilReady(
  attempt: (signal: AbortSignal) => Promise<boolean>,
  clock: Clock,
  signal: AbortSignal
): Promise<void> {
  let delayMs = INITIAL_POLL_DELAY_MS;
  for (;;) {
    if (signal.aborted) {
      throw new ReadinessSignalAbortedError();
    }
    const ready = await attempt(signal);
    if (ready) {
      return;
    }
    await sleep(delayMs, clock, signal);
    delayMs = Math.min(delayMs * POLL_BACKOFF_MULTIPLIER, MAX_POLL_DELAY_MS);
  }
}

/**
 * One `tcp` probe attempt: connects to `port` on `127.0.0.1` and resolves
 * `true` if a connection succeeds, `false` for any connect error (most
 * commonly `ECONNREFUSED`, meaning nothing is listening yet — this is the
 * inverse of `port.ts`'s `isPortFree`, which binds instead of connects).
 * Always closes the probe socket, on every outcome including abort.
 */
function probeTcpOnce(port: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ReadinessSignalAbortedError());
      return;
    }
    const socket = net.createConnection({ port, host: DEFAULT_HOST });
    let settled = false;

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      signal.removeEventListener('abort', onAbort);
      reject(new ReadinessSignalAbortedError());
    };
    signal.addEventListener('abort', onAbort);

    socket.once('connect', () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * One `http` probe attempt: GETs `url` and resolves `true` if the response
 * status matches (`expectStatus` exactly, or any 2xx by default), `false` for
 * a connection error (most commonly `ECONNREFUSED` while the server is still
 * starting). Uses `node:http`/`node:https` rather than `fetch`: this module
 * needs to destroy an in-flight request/response the instant the combined
 * signal fires, and needs a reliable, synchronous "close this socket now"
 * primitive (`request.destroy()` / `response.destroy()`) rather than
 * threading an `AbortSignal` through `fetch` and separately draining/
 * cancelling its body stream — plus every other I/O module in this package
 * (`spawn.ts`, `port.ts`) already uses raw `node:` modules for the same kind
 * of fine-grained socket control.
 */
function probeHttpOnce(
  url: string,
  expectStatus: number | undefined,
  signal: AbortSignal
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ReadinessSignalAbortedError());
      return;
    }
    const client = url.startsWith('https:') ? https : http;
    let settled = false;

    const request = client.get(url, response => {
      if (settled) {
        response.destroy();
        return;
      }
      settled = true;
      signal.removeEventListener('abort', onAbort);
      response.resume();
      response.destroy();
      const status = response.statusCode ?? 0;
      const ready =
        expectStatus !== undefined ? status === expectStatus : status >= 200 && status < 300;
      resolve(ready);
    });

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      request.destroy();
      reject(new ReadinessSignalAbortedError());
    };
    signal.addEventListener('abort', onAbort);

    request.once('error', () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(false);
    });
  });
}

/**
 * Resolves on the first line whose text contains `pattern` as a **literal
 * substring** — the config schema deliberately types `pattern` as a plain
 * string, not a RegExp, so config stays JSON-serializable and a user-supplied
 * pattern can never throw on invalid regex syntax or blow up with
 * catastrophic backtracking.
 *
 * Subscribes via `ProcessLineStream.onLine`, which replays
 * `LINE_REPLAY_BUFFER_SIZE` recent lines to a new subscriber (see
 * `types.ts`) — that bounded replay buffer, populated by `spawn.ts`, is what
 * makes it safe to start this wait *after* the process has already printed
 * its ready line; without it, a probe wired up one tick late would hang
 * forever.
 */
function waitForLogLine(
  pattern: string,
  lines: ProcessLineStream,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    // A mutable holder, not a plain `let`, so `finish` can read whatever
    // `subscription.unsubscribe` currently holds without `prefer-const`
    // complaining that a `let` assigned exactly once should be a `const`.
    const subscription: { unsubscribe: (() => void) | undefined } = { unsubscribe: undefined };
    let settled = false;

    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      subscription.unsubscribe?.();
      settle();
    };

    const onAbort = (): void => finish(() => reject(new ReadinessSignalAbortedError()));

    if (signal.aborted) {
      finish(() => reject(new ReadinessSignalAbortedError()));
      return;
    }
    signal.addEventListener('abort', onAbort);

    const onLine = (line: ProcessLine): void => {
      if (line.text.includes(pattern)) {
        finish(resolve);
      }
    };
    subscription.unsubscribe = lines.onLine(onLine);
    // `onLine` may have replayed a buffered match synchronously above, before
    // `subscription.unsubscribe` was assigned (finish's `unsubscribe?.()` was
    // a no-op at that point) — unsubscribe now so a matched wait never leaves
    // its listener registered forever.
    if (settled) {
      subscription.unsubscribe();
    }
  });
}

/**
 * Waits for a supervised process to satisfy its configured readiness
 * `probe`. See the module doc comment for the shared deadline/abort
 * behaviour and each probe-kind function above for per-kind behaviour.
 */
export async function waitForReadiness(
  probe: ReadinessProbe,
  context: ReadinessContext
): Promise<void> {
  const clock = context.clock ?? systemClock;
  const logger = context.logger ?? noopLogger;
  const { processId, timeoutMs, signal, lines } = context;

  logger.debug('readiness: waiting', { processId, kind: probe.kind, timeoutMs });

  switch (probe.kind) {
    case 'none':
      return;

    case 'delay':
      await runWithDeadline(processId, probe.kind, timeoutMs, clock, signal, combinedSignal =>
        sleep(probe.ms, clock, combinedSignal)
      );
      return;

    case 'tcp':
      await runWithDeadline(processId, probe.kind, timeoutMs, clock, signal, combinedSignal =>
        pollUntilReady(
          abortable => (context.probeTcp ?? probeTcpOnce)(probe.port, abortable),
          clock,
          combinedSignal
        )
      );
      return;

    case 'http':
      await runWithDeadline(processId, probe.kind, timeoutMs, clock, signal, combinedSignal =>
        pollUntilReady(
          abortable =>
            (context.probeHttp ?? probeHttpOnce)(probe.url, probe.expectStatus, abortable),
          clock,
          combinedSignal
        )
      );
      return;

    case 'log': {
      if (lines === undefined) {
        throw new ProcessError(
          `process "${processId}": readiness probe "log" requires a "lines" stream in the ` +
            'readiness context, but none was provided. Without one this wait would hang forever.',
          { processId }
        );
      }
      await runWithDeadline(processId, probe.kind, timeoutMs, clock, signal, combinedSignal =>
        waitForLogLine(probe.pattern, lines, combinedSignal)
      );
      return;
    }

    default: {
      const exhaustive: never = probe;
      throw new ProcessError(
        `process "${processId}": unsupported readiness probe kind ${JSON.stringify(exhaustive)}`,
        { processId }
      );
    }
  }
}
