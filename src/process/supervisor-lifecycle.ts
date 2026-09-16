import { describeError, type Outcome } from '../errors.js';
import type { ManagedProcess, ProcessExit } from './types.js';
import type { ProcessRecord, SupervisorContext } from './supervisor-types.js';
import {
  armResetTimer,
  cancelResetTimer,
  handleExit,
  runRestartAttempt,
  scheduleRestart,
} from './supervisor-restart.js';
import { performStartAttempt } from './supervisor-start.js';

export function triggerRestart(ctx: SupervisorContext, record: ProcessRecord): void {
  scheduleRestart(ctx, record, () => {
    void runRestartAttempt(
      ctx,
      record,
      () => performStartAttempt(ctx, record),
      handle => becomeReady(ctx, record, handle),
      () => triggerRestart(ctx, record)
    );
  });
}

async function awaitExit(handle: ManagedProcess): Promise<Outcome<ProcessExit>> {
  try {
    return { ok: true, value: await handle.exited };
  } catch (error) {
    return { ok: false, error };
  }
}

function logProcessExit(
  ctx: SupervisorContext,
  id: string,
  outcome: Outcome<ProcessExit>
): boolean {
  if (!outcome.ok) {
    ctx.logger.error('process supervisor: running process ended unexpectedly', {
      processId: id,
      error: describeError(outcome.error),
    });
    return true;
  }
  const { code, signal } = outcome.value;
  ctx.logger.info('process supervisor: process exited', { processId: id, code, signal });
  return code !== 0 || signal !== null;
}

export async function monitorProcess(
  ctx: SupervisorContext,
  record: ProcessRecord,
  handle: ManagedProcess
): Promise<void> {
  const outcome = await awaitExit(handle);
  cancelResetTimer(ctx, record);
  if (!outcome.ok) {
    record.lastError = describeError(outcome.error);
  } else {
    record.lastExit = outcome.value;
  }
  const crashed = logProcessExit(ctx, record.config.id, outcome);
  handleExit(ctx, record, crashed, () => triggerRestart(ctx, record));
}

export function becomeReady(
  ctx: SupervisorContext,
  record: ProcessRecord,
  handle: ManagedProcess
): void {
  record.state = 'ready';
  record.lastError = undefined;
  armResetTimer(ctx, record);
  void monitorProcess(ctx, record, handle);
}

export async function startAll(ctx: SupervisorContext): Promise<void> {
  for (const record of ctx.records.values()) {
    if (ctx.disposed) return;
    try {
      const handle = await performStartAttempt(ctx, record);
      becomeReady(ctx, record, handle);
    } catch (error) {
      record.state = 'failed';
      record.lastError = describeError(error);
      throw error;
    }
  }
}
