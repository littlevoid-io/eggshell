import { noopLogger } from '../logging/logger.js';
import { shutdownOne } from './shutdown-one.js';
import type { ShutdownOptions, ShutdownResult, ShutdownTarget } from './shutdown-types.js';

export { DEFAULT_SIGNAL, FORCE_SIGNAL, defaultForceKill } from './shutdown-types.js';
export type {
  ForceKillFn,
  ShutdownOptions,
  ShutdownOutcome,
  ShutdownResult,
  ShutdownTarget,
} from './shutdown-types.js';

export async function shutdownAll(
  targets: readonly ShutdownTarget[],
  options: ShutdownOptions
): Promise<readonly ShutdownResult[]> {
  const logger = options.logger ?? noopLogger;
  const results: ShutdownResult[] = [];
  for (const target of [...targets].reverse()) {
    results.push(await shutdownOne(target, options, logger));
  }
  return results;
}
