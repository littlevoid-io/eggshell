import { execFile } from 'node:child_process';
import pTimeout from 'p-timeout';
import type { Clock, TimerHandle } from '../../clock.js';
import type { Logger } from '../../logging/logger.js';

export type ExecFn = (
  file: string,
  args: readonly string[],
  signal: AbortSignal
) => Promise<{ stdout: string }>;

type ExecOutcome = { kind: 'success'; stdout: string } | { kind: 'error'; error: unknown };
type RacedOutcome = ExecOutcome | { kind: 'timeout' };

const PROBE_COMMAND = 'powershell.exe';

const PROBE_SCRIPT =
  '$count = (Get-CimInstance -ClassName Win32_PointingDevice -ErrorAction Stop | ' +
  'Where-Object { $_.PointingType -eq 8 } | Measure-Object).Count; ' +
  'if ($count -eq 0) { "[]" } else { ConvertTo-Json -InputObject @(0..($count-1)) -Compress }';

const PROBE_ARGS = ['-NoProfile', '-NonInteractive', '-Command', PROBE_SCRIPT];

export const realExec: ExecFn = (file, args, signal) =>
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

function parseTouchDisplayIds(stdout: string): readonly number[] | undefined {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return [];
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

function createCustomTimers(clock: Clock) {
  const timers = new Map<number, TimerHandle>();
  let nextId = 1;
  return {
    setTimeout: ((callback: () => void, ms?: number) => {
      const id = nextId++;
      timers.set(id, clock.setTimeout(callback, ms ?? 0));
      return id;
    }) as unknown as typeof globalThis.setTimeout,
    clearTimeout: ((id?: unknown) => {
      if (typeof id === 'number') {
        const handle = timers.get(id);
        if (handle !== undefined) {
          clock.clearTimeout(handle);
          timers.delete(id);
        }
      }
    }) as unknown as typeof globalThis.clearTimeout,
  };
}

function linkCallerSignal(signal: AbortSignal, controller: AbortController): () => void {
  const onAbort = (): void => controller.abort();
  if (signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener('abort', onAbort);
  }
  return () => signal.removeEventListener('abort', onAbort);
}

function handleExecFailure(
  raced: { kind: 'timeout' } | { kind: 'error'; error: unknown },
  timeoutMs: number,
  logger: Logger
): readonly number[] {
  if (raced.kind === 'timeout') {
    logger.warn('windows touch probe: timed out; treating as no touch displays', { timeoutMs });
    return [];
  }
  const error = raced.error instanceof Error ? raced.error.message : String(raced.error);
  logger.warn('windows touch probe: probe command failed; treating as no touch displays', {
    error,
  });
  return [];
}

function handleExecSuccess(stdout: string, logger: Logger): readonly number[] {
  const ids = parseTouchDisplayIds(stdout);
  if (ids === undefined) {
    logger.warn(
      'windows touch probe: could not parse probe output; treating as no touch displays',
      { stdoutPreview: stdout.slice(0, 200) }
    );
    return [];
  }
  return ids;
}

function timedExec(
  exec: ExecFn,
  controller: AbortController,
  clock: Clock,
  timeoutMs: number
): Promise<RacedOutcome> {
  return pTimeout(invokeExec(exec, controller.signal), {
    milliseconds: timeoutMs,
    fallback: () => {
      controller.abort();
      return { kind: 'timeout' as const };
    },
    customTimers: createCustomTimers(clock),
  }) as Promise<RacedOutcome>;
}

export async function executeProbe(
  exec: ExecFn,
  clock: Clock,
  timeoutMs: number,
  signal: AbortSignal,
  logger: Logger
): Promise<readonly number[]> {
  const controller = new AbortController();
  const cleanup = linkCallerSignal(signal, controller);
  const raced = await timedExec(exec, controller, clock, timeoutMs);
  cleanup();
  if (raced.kind === 'timeout' || raced.kind === 'error') {
    return handleExecFailure(raced, timeoutMs, logger);
  }
  return handleExecSuccess(raced.stdout, logger);
}
