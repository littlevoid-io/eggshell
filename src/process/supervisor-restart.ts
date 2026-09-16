import { describeError } from '../errors.js';
import { computeBackoffMs } from './backoff.js';
import type { ManagedProcess } from './types.js';
import type { ProcessRecord, SupervisorContext } from './supervisor-types.js';

export function armResetTimer(ctx: SupervisorContext, record: ProcessRecord): void {
  record.resetTimer = ctx.clock.setTimeout(() => {
    record.resetTimer = undefined;
    record.restartCount = 0;
  }, record.config.restart.resetAfterMs);
}

export function cancelResetTimer(ctx: SupervisorContext, record: ProcessRecord): void {
  if (record.resetTimer !== undefined) {
    ctx.clock.clearTimeout(record.resetTimer);
    record.resetTimer = undefined;
  }
}

export function cancelRestartTimer(ctx: SupervisorContext, record: ProcessRecord): void {
  if (record.restartTimer !== undefined) {
    ctx.clock.clearTimeout(record.restartTimer);
    record.restartTimer = undefined;
  }
}

function checkMaxRestarts(ctx: SupervisorContext, record: ProcessRecord): boolean {
  const restart = record.config.restart;
  if (record.restartCount < restart.maxRestarts) {
    return false;
  }
  record.state = 'failed';
  record.lastError = `exceeded maxRestarts (${restart.maxRestarts})`;
  ctx.logger.error('process supervisor: giving up after exceeding maxRestarts', {
    processId: record.config.id,
    maxRestarts: restart.maxRestarts,
    restartCount: record.restartCount,
  });
  return true;
}

export function scheduleRestart(
  ctx: SupervisorContext,
  record: ProcessRecord,
  onAttempt: () => void
): void {
  if (checkMaxRestarts(ctx, record)) {
    return;
  }
  record.restartCount += 1;
  const delayMs = computeBackoffMs(record.config.restart, record.restartCount);
  record.state = 'restarting';
  record.restartTimer = ctx.clock.setTimeout(() => {
    record.restartTimer = undefined;
    onAttempt();
  }, delayMs);
}

export function handleExit(
  ctx: SupervisorContext,
  record: ProcessRecord,
  crashed: boolean,
  onRestart: () => void
): void {
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
  onRestart();
}

function handleRestartError(
  ctx: SupervisorContext,
  record: ProcessRecord,
  error: unknown,
  onRetry: () => void
): void {
  record.lastError = describeError(error);
  ctx.logger.warn('process supervisor: restart attempt failed to become ready', {
    processId: record.config.id,
    error: record.lastError,
  });
  onRetry();
}

function onRestartSettled(ctx: SupervisorContext, record: ProcessRecord, action: () => void): void {
  if (ctx.disposed) {
    record.state = 'stopped';
  } else {
    action();
  }
}

export async function runRestartAttempt(
  ctx: SupervisorContext,
  record: ProcessRecord,
  startFn: () => Promise<ManagedProcess>,
  onReady: (handle: ManagedProcess) => void,
  onRetry: () => void
): Promise<void> {
  if (ctx.disposed) {
    record.state = 'stopped';
    return;
  }
  try {
    const handle = await startFn();
    onRestartSettled(ctx, record, () => onReady(handle));
  } catch (error) {
    onRestartSettled(ctx, record, () => handleRestartError(ctx, record, error, onRetry));
  }
}
