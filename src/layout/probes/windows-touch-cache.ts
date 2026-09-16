import type { Clock } from '../../clock.js';

interface CacheEntry {
  readonly ids: readonly number[];
  readonly cachedAt: number;
}

export interface TouchProbeCache {
  isFresh(): boolean;
  getCached(): readonly number[];
  getOrRun(run: () => Promise<readonly number[]>): Promise<readonly number[]>;
  invalidate(): void;
}

class ProbeCache implements TouchProbeCache {
  private cached: CacheEntry | undefined;
  private inFlight: Promise<readonly number[]> | undefined;

  constructor(
    private readonly clock: Clock,
    private readonly cacheTtlMs: number
  ) {}

  isFresh(): boolean {
    return this.cached !== undefined && this.clock.now() - this.cached.cachedAt < this.cacheTtlMs;
  }

  getCached(): readonly number[] {
    return this.cached!.ids;
  }

  getOrRun(run: () => Promise<readonly number[]>): Promise<readonly number[]> {
    this.inFlight ??= run().then(
      ids => {
        this.cached = { ids, cachedAt: this.clock.now() };
        this.inFlight = undefined;
        return ids;
      },
      () => {
        this.inFlight = undefined;
        return [];
      }
    );
    return this.inFlight;
  }

  invalidate(): void {
    this.cached = undefined;
  }
}

export function createTouchProbeCache(clock: Clock, cacheTtlMs: number): TouchProbeCache {
  return new ProbeCache(clock, cacheTtlMs);
}
