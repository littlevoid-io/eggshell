import type { Clock, TimerHandle } from '../clock.js';
import type { Logger } from '../logging/logger.js';
import { noopLogger } from '../logging/logger.js';
import type { DisplaySnapshot } from './types.js';
import { createRateWindow, type RateWindow } from '../process/rate-window.js';
import { handleDisplaysChanged, beginDebounce } from './supervisor-intake.js';

export type SupervisorState = 'settled' | 'scheduled' | 'applying' | 'verifying' | 'givenUp';
export type GivenUpReason = 'topology' | 'rate';

export interface TopologySupervisorOptions {
  clock: Clock;
  apply: (displays: readonly DisplaySnapshot[]) => Promise<void> | void;
  verify: (displays: readonly DisplaySnapshot[]) => Promise<boolean> | boolean;
  debounceMs: number;
  maxAttemptsPerTopology: number;
  verifyDelayMs: number;
  giveUpAfterMs?: number;
  maxGlobalAttempts: number;
  globalRateWindowMs: number;
  logger?: Logger;
}

export interface TopologySupervisor {
  onDisplaysChanged(displays: readonly DisplaySnapshot[]): void;
  readonly state: SupervisorState;
  readonly attempts: number;
  readonly givenUpReason: GivenUpReason | undefined;
  dispose(): void;
}

export interface TopologyRecord {
  attempts: number;
  gaveUp: boolean;
  firstAttemptAt: number | undefined;
}

export interface SupervisorContext {
  readonly clock: Clock;
  readonly apply: TopologySupervisorOptions['apply'];
  readonly verify: TopologySupervisorOptions['verify'];
  readonly debounceMs: number;
  readonly maxAttemptsPerTopology: number;
  readonly verifyDelayMs: number;
  readonly giveUpAfterMs: number | undefined;
  readonly maxGlobalAttempts: number;
  readonly globalRateWindowMs: number;
  readonly logger: Logger;
  readonly scheduleDebounce: (displays: readonly DisplaySnapshot[], signature: string) => void;

  state: SupervisorState;
  givenUpReason: GivenUpReason | undefined;
  disposed: boolean;

  lastSettledSignature: string | undefined;
  activeSignature: string | undefined;

  readonly ledger: Map<string, TopologyRecord>;
  readonly rateWindow: RateWindow;

  pendingDisplays: readonly DisplaySnapshot[] | undefined;
  pendingSignature: string | undefined;

  scheduledTimer: TimerHandle | undefined;
  verifyTimer: TimerHandle | undefined;
}

function newRateWindow(options: TopologySupervisorOptions) {
  return createRateWindow(options.clock, options.globalRateWindowMs, options.maxGlobalAttempts);
}

function initContext(options: TopologySupervisorOptions): SupervisorContext {
  const ctx: SupervisorContext = {
    ...options,
    giveUpAfterMs: options.giveUpAfterMs,
    logger: options.logger ?? noopLogger,
    scheduleDebounce: (displays, signature) => beginDebounce(ctx, displays, signature),
    state: 'settled',
    givenUpReason: undefined,
    disposed: false,
    lastSettledSignature: undefined,
    activeSignature: undefined,
    ledger: new Map(),
    rateWindow: newRateWindow(options),
    pendingDisplays: undefined,
    pendingSignature: undefined,
    scheduledTimer: undefined,
    verifyTimer: undefined,
  };
  return ctx;
}

function activeAttempts(ctx: SupervisorContext): number {
  if (ctx.activeSignature === undefined) return 0;
  return ctx.ledger.get(ctx.activeSignature)?.attempts ?? 0;
}

export function createTopologySupervisor(options: TopologySupervisorOptions): TopologySupervisor {
  const ctx = initContext(options);
  return {
    onDisplaysChanged: displays => handleDisplaysChanged(ctx, displays),
    get state() {
      return ctx.state;
    },
    get attempts() {
      return activeAttempts(ctx);
    },
    get givenUpReason() {
      return ctx.givenUpReason;
    },
    dispose: () => disposeSupervisor(ctx),
  };
}

function disposeSupervisor(ctx: SupervisorContext): void {
  if (ctx.disposed) return;
  ctx.disposed = true;
  if (ctx.scheduledTimer !== undefined) {
    ctx.clock.clearTimeout(ctx.scheduledTimer);
    ctx.scheduledTimer = undefined;
  }
  if (ctx.verifyTimer !== undefined) {
    ctx.clock.clearTimeout(ctx.verifyTimer);
    ctx.verifyTimer = undefined;
  }
}
