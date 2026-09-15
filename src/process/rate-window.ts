import type { Clock } from '../clock.js';

export interface RateWindow {
  /** Records one event now, then prunes anything older than windowMs. */
  record(): void;
  /** Prunes, then reports whether the number of events still in the window is >= maxAttempts. */
  isExceeded(): boolean;
  /** Prunes only (no new event), for call sites that need to re-check without recording. */
  prune(): void;
  readonly size: number;
}

class RollingRateWindow implements RateWindow {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly windowMs: number,
    private readonly maxAttempts: number
  ) {}

  prune(): void {
    const cutoff = this.clock.now() - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0]! < cutoff) {
      this.timestamps.shift();
    }
  }

  record(): void {
    this.timestamps.push(this.clock.now());
    this.prune();
  }

  isExceeded(): boolean {
    this.prune();
    return this.timestamps.length >= this.maxAttempts;
  }

  get size(): number {
    this.prune();
    return this.timestamps.length;
  }
}

export function createRateWindow(
  clock: Clock,
  windowMs: number,
  maxAttempts: number
): RateWindow {
  return new RollingRateWindow(clock, windowMs, maxAttempts);
}
