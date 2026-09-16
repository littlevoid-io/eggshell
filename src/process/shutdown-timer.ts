import pTimeout, { TimeoutError } from 'p-timeout';
import type { Clock } from '../clock.js';
import { describeError } from '../errors.js';
import type { Logger } from '../logging/logger.js';
import type { ManagedProcess } from './types.js';
import { createClockTimers } from './clock-timers.js';

export function trySignal(
  handle: ManagedProcess,
  id: string,
  sig: NodeJS.Signals,
  log: Logger
): void {
  try {
    handle.kill(sig);
  } catch (error) {
    log.warn('shutdown: signal threw; process may be gone', {
      processId: id,
      error: describeError(error),
    });
  }
}

export async function raceAgainstGrace(
  handle: ManagedProcess,
  clock: Clock,
  graceMs: number
): Promise<'exited' | 'timeout'> {
  const waitExit = handle.exited.then(
    () => 'exited' as const,
    () => 'exited' as const
  );
  try {
    await pTimeout(waitExit, { milliseconds: graceMs, customTimers: createClockTimers(clock) });
    return 'exited';
  } catch (error) {
    if (error instanceof TimeoutError) return 'timeout';
    throw error;
  }
}

export async function isAlreadyExited(handle: ManagedProcess): Promise<boolean> {
  let settled = false;
  handle.exited.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  await Promise.resolve();
  await Promise.resolve();
  return settled;
}
