import type { Outcome } from '../errors.js';
import { describeError } from '../errors.js';
import type { DisplaySnapshot } from './types.js';
import type { SupervisorContext, TopologyRecord } from './supervisor.js';

const MAX_TRACKED_TOPOLOGIES = 8;

function recordAttempt(ctx: SupervisorContext, signature: string): TopologyRecord {
  const existing = ctx.ledger.get(signature);
  const record = existing ?? { attempts: 0, gaveUp: false, firstAttemptAt: undefined };
  record.attempts += 1;
  record.firstAttemptAt ??= ctx.clock.now();
  ctx.ledger.delete(signature);
  ctx.ledger.set(signature, record);
  if (ctx.ledger.size > MAX_TRACKED_TOPOLOGIES) {
    const oldest = ctx.ledger.keys().next().value;
    if (oldest !== undefined) ctx.ledger.delete(oldest);
  }
  ctx.rateWindow.record();
  ctx.activeSignature = signature;
  ctx.state = 'applying';
  return record;
}

async function tryCall<T>(fn: () => T | Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

function warnThrew(
  ctx: SupervisorContext,
  phase: string,
  signature: string,
  record: TopologyRecord,
  error: unknown
): void {
  ctx.logger.warn(`topology supervisor: ${phase} threw`, {
    attempt: record.attempts,
    maxAttemptsPerTopology: ctx.maxAttemptsPerTopology,
    signature,
    error: describeError(error),
  });
}

async function executeApply(
  ctx: SupervisorContext,
  displays: readonly DisplaySnapshot[],
  signature: string,
  record: TopologyRecord
): Promise<boolean> {
  const applied = await tryCall(() => ctx.apply(displays));
  if (ctx.disposed) return false;
  if (applied.ok) return true;
  warnThrew(ctx, 'apply', signature, record, applied.error);
  handleFailedAttempt(ctx, signature, displays, record);
  return false;
}

function waitForVerifyDelay(ctx: SupervisorContext): Promise<void> {
  return new Promise(resolve => {
    ctx.verifyTimer = ctx.clock.setTimeout(() => {
      ctx.verifyTimer = undefined;
      resolve();
    }, ctx.verifyDelayMs);
  });
}

function handleVerifyOutcome(
  ctx: SupervisorContext,
  displays: readonly DisplaySnapshot[],
  signature: string,
  record: TopologyRecord,
  verified: Outcome<boolean>
): void {
  if (!verified.ok) {
    warnThrew(ctx, 'verify', signature, record, verified.error);
  } else if (verified.value) {
    ctx.lastSettledSignature = signature;
    finishCycleSuccessfully(ctx);
    return;
  }
  handleFailedAttempt(ctx, signature, displays, record);
}

async function executeVerify(
  ctx: SupervisorContext,
  displays: readonly DisplaySnapshot[],
  signature: string,
  record: TopologyRecord
): Promise<void> {
  ctx.state = 'verifying';
  await waitForVerifyDelay(ctx);
  if (ctx.disposed) return;
  const verified = await tryCall(() => ctx.verify(displays));
  if (!ctx.disposed) handleVerifyOutcome(ctx, displays, signature, record, verified);
}

export async function runAttempt(
  ctx: SupervisorContext,
  displays: readonly DisplaySnapshot[],
  signature: string
): Promise<void> {
  const record = recordAttempt(ctx, signature);
  if ((await executeApply(ctx, displays, signature, record)) && !ctx.disposed) {
    await executeVerify(ctx, displays, signature, record);
  }
}

function takePending(ctx: SupervisorContext) {
  const pending = { displays: ctx.pendingDisplays, signature: ctx.pendingSignature };
  ctx.pendingDisplays = undefined;
  ctx.pendingSignature = undefined;
  return pending;
}

function finishCycleSuccessfully(ctx: SupervisorContext): void {
  const { displays, signature } = takePending(ctx);
  if (signature !== undefined && signature !== ctx.lastSettledSignature) {
    ctx.scheduleDebounce(displays!, signature);
    return;
  }
  ctx.state = 'settled';
}

function hasExceededTopologyBudget(ctx: SupervisorContext, record: TopologyRecord): boolean {
  if (record.attempts >= ctx.maxAttemptsPerTopology) return true;
  if (ctx.giveUpAfterMs === undefined || record.firstAttemptAt === undefined) return false;
  return ctx.clock.now() - record.firstAttemptAt >= ctx.giveUpAfterMs;
}

function handleFailedAttempt(
  ctx: SupervisorContext,
  signature: string,
  displays: readonly DisplaySnapshot[],
  record: TopologyRecord
): void {
  if (hasExceededTopologyBudget(ctx, record)) {
    giveUpTopology(ctx, signature, record);
    return;
  }
  const pending = takePending(ctx);
  ctx.scheduleDebounce(pending.displays ?? displays, pending.signature ?? signature);
}

function giveUpTopology(ctx: SupervisorContext, signature: string, record: TopologyRecord): void {
  record.gaveUp = true;
  if (ctx.verifyTimer !== undefined) ctx.clock.clearTimeout(ctx.verifyTimer);
  ctx.verifyTimer = undefined;
  ctx.logger.error('topology supervisor: giving up on this topology after repeated failures', {
    attempts: record.attempts,
    maxAttemptsPerTopology: ctx.maxAttemptsPerTopology,
    signature,
  });
  const { displays, signature: nextSignature } = takePending(ctx);
  if (nextSignature !== undefined && ctx.ledger.get(nextSignature)?.gaveUp !== true) {
    ctx.scheduleDebounce(displays!, nextSignature);
    return;
  }
  ctx.state = 'givenUp';
  ctx.givenUpReason = 'topology';
}
