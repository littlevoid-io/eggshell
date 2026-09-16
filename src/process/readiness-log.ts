import pTimeout, { TimeoutError } from 'p-timeout';
import type { Clock } from '../clock.js';
import { ProcessError } from '../errors.js';
import type { ProcessLineStream } from './types.js';
import { createClockTimers } from './clock-timers.js';

export class ReadinessSignalAbortedError extends Error {}

export function assertLinesStream(
  lines: ProcessLineStream | undefined,
  id: string
): ProcessLineStream {
  if (lines === undefined) {
    throw new ProcessError(
      `process "${id}": readiness probe "log" requires a "lines" stream in the ` +
        'readiness context, but none was provided. Without one this wait would hang forever.',
      { processId: id }
    );
  }
  return lines;
}

export function sleep(ms: number, clock: Clock, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ReadinessSignalAbortedError());
      return;
    }
    const handle = clock.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clock.clearTimeout(handle);
      reject(new ReadinessSignalAbortedError());
    };
    signal?.addEventListener('abort', onAbort);
  });
}

function subscribeLog(lines: ProcessLineStream, pattern: string, onFound: () => void): () => void {
  return lines.onLine(line => {
    if (line.text.includes(pattern)) onFound();
  });
}

function attachLogSubscription(
  lines: ProcessLineStream,
  pattern: string,
  cleanup: () => void,
  resolve: () => void
): () => void {
  return subscribeLog(lines, pattern, () => {
    cleanup();
    resolve();
  });
}

function executeWaitForLog(
  pattern: string,
  lines: ProcessLineStream,
  signal: AbortSignal | undefined,
  resolve: () => void,
  reject: (err: unknown) => void
): void {
  if (signal?.aborted) return reject(new ReadinessSignalAbortedError());
  let unsub = () => {};
  const cleanup = () => {
    signal?.removeEventListener('abort', onAbort);
    unsub();
  };
  const onAbort = () => {
    cleanup();
    reject(new ReadinessSignalAbortedError());
  };
  signal?.addEventListener('abort', onAbort);
  unsub = attachLogSubscription(lines, pattern, cleanup, resolve);
}

export function waitForLogLine(
  pattern: string,
  lines: ProcessLineStream,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    executeWaitForLog(pattern, lines, signal, resolve, reject);
  });
}

function handleDeadlineError(
  error: unknown,
  controller: AbortController,
  processId: string,
  probeKind: string,
  elapsedMs: number,
  timeoutMs: number
): never {
  const isTimeout = error instanceof TimeoutError;
  const isAborted = controller.signal.aborted || error instanceof ReadinessSignalAbortedError;
  if (!isTimeout && !isAborted) throw error;
  const reason = isTimeout ? 'timed out' : 'was aborted';
  throw new ProcessError(
    `process "${processId}": readiness probe "${probeKind}" ${reason} after ${elapsedMs}ms (timeout ${timeoutMs}ms)`,
    { processId, cause: error }
  );
}

function setupAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onAbort);
  return onAbort;
}

async function executeTaskWithDeadline(
  task: (signal: AbortSignal) => Promise<void>,
  signal: AbortSignal,
  timeoutMs: number,
  clock: Clock
): Promise<void> {
  const opts = { milliseconds: timeoutMs, customTimers: createClockTimers(clock) };
  await pTimeout(task(signal), opts);
}

export async function runWithDeadline(
  processId: string,
  probeKind: string,
  timeoutMs: number,
  clock: Clock,
  externalSignal: AbortSignal | undefined,
  task: (signal: AbortSignal) => Promise<void>
): Promise<void> {
  const startedAt = clock.now();
  const controller = new AbortController();
  const onAbort = setupAbort(externalSignal, controller);
  try {
    await executeTaskWithDeadline(task, controller.signal, timeoutMs, clock);
  } catch (error) {
    const elapsedMs = clock.now() - startedAt;
    handleDeadlineError(error, controller, processId, probeKind, elapsedMs, timeoutMs);
  } finally {
    externalSignal?.removeEventListener('abort', onAbort);
  }
}
