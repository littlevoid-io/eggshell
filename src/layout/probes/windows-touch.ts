import { systemClock, type Clock } from '../../clock.js';
import { noopLogger, type Logger } from '../../logging/logger.js';
import type { TouchProbe } from './types.js';
import { createTouchProbeCache, type TouchProbeCache } from './windows-touch-cache.js';
import { executeProbe, realExec, type ExecFn } from './windows-touch-exec.js';

export type { ExecFn };

export interface WindowsTouchProbeOptions {
  timeoutMs?: number;
  logger?: Logger;
  exec?: ExecFn;
  clock?: Clock;
  cacheTtlMs?: number;
  platform?: NodeJS.Platform;
}

export interface WindowsTouchProbe extends TouchProbe {
  invalidate(): void;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 60_000;

class WindowsTouchProbeInstance implements WindowsTouchProbe {
  private warnedNonWindows = false;

  constructor(
    private readonly cache: TouchProbeCache,
    private readonly exec: ExecFn,
    private readonly clock: Clock,
    private readonly timeoutMs: number,
    private readonly logger: Logger,
    private readonly platform: string
  ) {}

  detect(signal: AbortSignal): Promise<readonly number[]> {
    if (this.platform !== 'win32') {
      if (!this.warnedNonWindows) {
        this.warnedNonWindows = true;
        this.logger.warn('windows touch probe: not running on win32; resolving no touch displays', {
          platform: this.platform,
        });
      }
      return Promise.resolve([]);
    }
    if (this.cache.isFresh()) {
      return Promise.resolve(this.cache.getCached());
    }
    return this.cache.getOrRun(() =>
      executeProbe(this.exec, this.clock, this.timeoutMs, signal, this.logger)
    );
  }

  invalidate(): void {
    this.cache.invalidate();
  }
}

export function createWindowsTouchProbe(options: WindowsTouchProbeOptions = {}): WindowsTouchProbe {
  const clock = options.clock ?? systemClock;
  const cache = createTouchProbeCache(clock, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
  return new WindowsTouchProbeInstance(
    cache,
    options.exec ?? realExec,
    clock,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    options.logger ?? noopLogger,
    options.platform ?? process.platform
  );
}
