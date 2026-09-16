import { describeError } from '../errors.js';
import type { Logger } from '../logging/logger.js';
import type { ManagedProcess } from './types.js';
import {
  DEFAULT_SIGNAL,
  FORCE_SIGNAL,
  defaultForceKill,
  type ForceKillFn,
  type ShutdownOptions,
  type ShutdownResult,
  type ShutdownTarget,
} from './shutdown-types.js';
import { isAlreadyExited, raceAgainstGrace, trySignal } from './shutdown-timer.js';

function tryAbortReadiness(target: ShutdownTarget, id: string, logger: Logger): void {
  try {
    target.abortReadiness?.();
  } catch (error) {
    logger.warn('shutdown: abortReadiness threw', { processId: id, error: describeError(error) });
  }
}

async function forceKillPid(
  handle: ManagedProcess,
  id: string,
  forceKill: ForceKillFn,
  logger: Logger
): Promise<void> {
  if (handle.pid === undefined) {
    logger.warn('shutdown: killTree requested but process has no pid; falling back to kill()', {
      processId: id,
    });
    handle.kill(FORCE_SIGNAL);
    return;
  }
  await forceKill(handle.pid);
}

async function forceKillTarget(
  handle: ManagedProcess,
  id: string,
  killTree: boolean,
  forceKill: ForceKillFn,
  logger: Logger
): Promise<void> {
  if (!killTree) {
    handle.kill(FORCE_SIGNAL);
    return;
  }
  await forceKillPid(handle, id, forceKill, logger);
}

async function executeForceKill(
  handle: ManagedProcess,
  id: string,
  killTree: boolean,
  forceKill: ForceKillFn,
  logger: Logger
): Promise<boolean> {
  try {
    await forceKillTarget(handle, id, killTree, forceKill, logger);
    return true;
  } catch (error) {
    logger.error('shutdown: force-kill attempt failed', {
      processId: id,
      error: describeError(error),
    });
    return false;
  }
}

async function performGracefulAttempt(
  target: ShutdownTarget,
  options: ShutdownOptions,
  logger: Logger
): Promise<boolean> {
  const signal = target.signal ?? options.signal ?? DEFAULT_SIGNAL;
  const graceMs = target.graceMs ?? options.graceMs;
  trySignal(target.handle, target.handle.id, signal, logger);
  return (await raceAgainstGrace(target.handle, options.clock, graceMs)) === 'exited';
}

async function performForceKillAttempt(
  target: ShutdownTarget,
  options: ShutdownOptions,
  logger: Logger
): Promise<ShutdownResult> {
  const { handle } = target;
  const graceMs = target.graceMs ?? options.graceMs;
  const killTree = target.killTree ?? options.killTree ?? process.platform === 'win32';
  const forceKill = options.forceKill ?? defaultForceKill;

  const killed = await executeForceKill(handle, handle.id, killTree, forceKill, logger);
  if (!killed) return { id: handle.id, pid: handle.pid, outcome: 'failed' };

  logger.warn('shutdown: process force-killed after grace period elapsed', {
    processId: handle.id,
    graceMs,
    killTree,
  });
  await raceAgainstGrace(handle, options.clock, graceMs);
  return { id: handle.id, pid: handle.pid, outcome: 'forceKilled' };
}

export async function shutdownOne(
  target: ShutdownTarget,
  options: ShutdownOptions,
  logger: Logger
): Promise<ShutdownResult> {
  const { handle } = target;
  const id = handle.id;
  tryAbortReadiness(target, id, logger);
  if (await isAlreadyExited(handle)) {
    return { id, pid: handle.pid, outcome: 'alreadyExited' };
  }
  if (await performGracefulAttempt(target, options, logger)) {
    return { id, pid: handle.pid, outcome: 'exitedOnSignal' };
  }
  return performForceKillAttempt(target, options, logger);
}
