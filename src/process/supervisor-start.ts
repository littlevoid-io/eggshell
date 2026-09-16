import { describeError, ProcessError } from '../errors.js';
import type { ProcessConfig } from '../config/types.js';
import { assertPortsFree } from './port.js';
import { waitForReadiness } from './readiness.js';
import type { ManagedProcess } from './types.js';
import type { ProcessRecord, SupervisorContext } from './supervisor-types.js';

function clearHandleIfCurrent(record: ProcessRecord, handle: ManagedProcess): void {
  if (record.handle === handle) {
    record.handle = undefined;
  }
}

export function trackHandle(record: ProcessRecord, handle: ManagedProcess): void {
  record.handle = handle;
  const clear = (): void => clearHandleIfCurrent(record, handle);
  handle.exited.then(clear, clear);
}

async function checkPortsFree(ctx: SupervisorContext, config: ProcessConfig): Promise<void> {
  try {
    await assertPortsFree(config.requirePortsFree, ctx.host, ctx.logger);
  } catch (error) {
    throw new ProcessError(`process "${config.id}": ${describeError(error)}`, {
      processId: config.id,
      cause: error,
    });
  }
}

function waitForProcessExit(config: ProcessConfig, handle: ManagedProcess): Promise<never> {
  return handle.exited.then(exit =>
    Promise.reject(
      new ProcessError(
        `process "${config.id}": exited (code=${exit.code}, signal=${exit.signal}) before it became ready`,
        { processId: config.id }
      )
    )
  );
}

async function raceReadinessAgainstExit(
  ctx: SupervisorContext,
  config: ProcessConfig,
  handle: ManagedProcess
): Promise<void> {
  const exitedBeforeReady = waitForProcessExit(config, handle);
  const readiness = waitForReadiness(config.readiness, {
    processId: config.id,
    timeoutMs: config.readinessTimeoutMs,
    clock: ctx.clock,
    logger: ctx.logger,
    lines: handle.lines,
  });
  await Promise.race([readiness, exitedBeforeReady]);
}

export async function performStartAttempt(
  ctx: SupervisorContext,
  record: ProcessRecord
): Promise<ManagedProcess> {
  const config = record.config;
  record.state = 'starting';
  record.lastError = undefined;
  await checkPortsFree(ctx, config);
  const handle = ctx.spawnFn({
    id: config.id,
    command: config.command,
    args: config.args,
    cwd: config.cwd,
    env: config.env,
    logger: ctx.logger,
  });
  trackHandle(record, handle);
  await raceReadinessAgainstExit(ctx, config, handle);
  return handle;
}
