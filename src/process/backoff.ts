/**
 * Exponential backoff calculation for retry attempts.
 */

export interface BackoffConfig {
  backoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
}

export function computeBackoffMs(config: BackoffConfig, attempt: number): number {
  const grown = config.backoffMs * config.backoffMultiplier ** (attempt - 1);
  return Math.min(grown, config.maxBackoffMs);
}
