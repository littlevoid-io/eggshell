import type { DisplaySnapshot } from './types.js';
import { topologySignature } from './signature.js';
import type { SupervisorContext } from './supervisor.js';
import { runAttempt } from './supervisor-attempt.js';

export function cancelScheduledTimer(ctx: SupervisorContext): void {
  if (ctx.scheduledTimer !== undefined) {
    ctx.clock.clearTimeout(ctx.scheduledTimer);
    ctx.scheduledTimer = undefined;
  }
}

export function isBlocklisted(ctx: SupervisorContext, signature: string): boolean {
  return ctx.ledger.get(signature)?.gaveUp === true;
}

function isStillRateLimited(ctx: SupervisorContext, signature: string): boolean {
  if (ctx.rateWindow.isExceeded()) {
    ctx.logger.debug('topology supervisor: dropping event while rate-limited', { signature });
    return true;
  }
  ctx.givenUpReason = undefined;
  ctx.state = 'settled';
  return false;
}

function shouldDropIntake(ctx: SupervisorContext, signature: string): boolean {
  if (ctx.givenUpReason === 'rate' && isStillRateLimited(ctx, signature)) {
    return true;
  }
  if (isBlocklisted(ctx, signature)) {
    ctx.logger.debug('topology supervisor: dropping event for a topology already given up on', {
      signature,
    });
    return true;
  }
  if (ctx.state === 'settled' && signature === ctx.lastSettledSignature) {
    ctx.logger.debug('topology supervisor: dropping event matching last settled topology', {
      signature,
    });
    return true;
  }
  return false;
}

export function handleDisplaysChanged(
  ctx: SupervisorContext,
  displays: readonly DisplaySnapshot[]
): void {
  if (ctx.disposed) return;
  const signature = topologySignature(displays);
  if (shouldDropIntake(ctx, signature)) return;
  if (ctx.state === 'applying' || ctx.state === 'verifying') {
    ctx.pendingDisplays = displays;
    ctx.pendingSignature = signature;
    return;
  }
  beginDebounce(ctx, displays, signature);
}

export function beginDebounce(
  ctx: SupervisorContext,
  displays: readonly DisplaySnapshot[],
  signature: string
): void {
  ctx.pendingDisplays = displays;
  ctx.pendingSignature = signature;
  cancelScheduledTimer(ctx);
  ctx.state = 'scheduled';
  ctx.scheduledTimer = ctx.clock.setTimeout(() => startCycle(ctx), ctx.debounceMs);
}

function giveUpGlobalRate(ctx: SupervisorContext, signature: string): void {
  if (ctx.verifyTimer !== undefined) {
    ctx.clock.clearTimeout(ctx.verifyTimer);
    ctx.verifyTimer = undefined;
  }
  ctx.state = 'givenUp';
  ctx.givenUpReason = 'rate';
  ctx.pendingDisplays = undefined;
  ctx.pendingSignature = undefined;
  ctx.logger.error(
    'topology supervisor: giving up globally — attempts are arriving faster than the rate ceiling allows (the display topology may be flapping)',
    {
      maxGlobalAttempts: ctx.maxGlobalAttempts,
      globalRateWindowMs: ctx.globalRateWindowMs,
      signature,
    }
  );
}

function startCycle(ctx: SupervisorContext): void {
  ctx.scheduledTimer = undefined;
  const displays = ctx.pendingDisplays!;
  const signature = ctx.pendingSignature!;
  ctx.pendingDisplays = undefined;
  ctx.pendingSignature = undefined;

  if (ctx.rateWindow.isExceeded()) {
    giveUpGlobalRate(ctx, signature);
    return;
  }
  void runAttempt(ctx, displays, signature);
}
