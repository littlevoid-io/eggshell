import { systemClock } from '../clock.js';
import type { ResolvedApp } from '../config/resolved.js';
import { createChildLogger, type Logger } from '../logging/logger.js';
import { shutdownAll } from '../process/shutdown.js';
import { spawnManaged, type SpawnManagedOptions } from '../process/spawn.js';
import type { ManagedProcess } from '../process/types.js';
import {
  createProcessSupervisor,
  type ProcessStatus,
  type ProcessSupervisor,
} from '../process/supervisor.js';

export interface ProductionProcesses {
  statuses(): readonly ProcessStatus[];
  stop(): Promise<void>;
}

const NONE: ProductionProcesses = { statuses: () => [], stop: async () => undefined };

/** Child output lands in the shell log under `process:<id>`; stderr at warn. */
function spawnIntoLog(options: SpawnManagedOptions, logger: Logger): ManagedProcess {
  const handle = spawnManaged(options);
  const child = createChildLogger(logger, `process:${options.id}`);
  handle.lines.onLine(line => child[line.stream === 'stderr' ? 'warn' : 'info'](line.text));
  return handle;
}

/**
 * A packaged app has no CLI in front of it, so the shell itself supervises the
 * production-phase processes and waits for their readiness before windows open.
 */
export async function startProductionProcesses(
  resolved: ResolvedApp,
  packaged: boolean,
  logger: Logger
): Promise<ProductionProcesses> {
  if (!packaged || resolved.config.processes.length === 0) return NONE;
  const supervisor = createProcessSupervisor({
    configs: resolved.config.processes,
    phase: 'production',
    clock: systemClock,
    logger: createChildLogger(logger, 'process'),
    spawn: options => spawnIntoLog(options, logger),
  });
  await supervisor.start();
  return { statuses: () => supervisor.getStatuses(), stop: () => stopAll(supervisor, logger) };
}

async function stopAll(supervisor: ProcessSupervisor, logger: Logger): Promise<void> {
  supervisor.dispose();
  const targets = [...supervisor.getHandles().values()].map(handle => ({ handle }));
  await shutdownAll(targets, { graceMs: 5000, clock: systemClock, logger });
}
