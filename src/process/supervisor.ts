import { noopLogger } from '../logging/logger.js';
import type { ProcessConfig } from '../config/types.js';
import { spawnManaged } from './spawn.js';
import type { ManagedProcess } from './types.js';
import type {
  ProcessRecord,
  ProcessStatus,
  ProcessSupervisor,
  ProcessSupervisorOptions,
  SupervisorContext,
  SupervisorPhase,
} from './supervisor-types.js';
import { cancelResetTimer, cancelRestartTimer } from './supervisor-restart.js';
import { startAll } from './supervisor-lifecycle.js';

export type {
  ProcessState,
  ProcessStatus,
  ProcessSupervisor,
  ProcessSupervisorOptions,
  SpawnFn,
  SupervisorPhase,
} from './supervisor-types.js';

function selectConfigs(
  configs: readonly ProcessConfig[],
  phase: SupervisorPhase
): readonly ProcessConfig[] {
  return configs.filter(config => config.phase === phase || config.phase === 'always');
}

function toStatus(record: ProcessRecord): ProcessStatus {
  return {
    id: record.config.id,
    state: record.state,
    restartCount: record.restartCount,
    lastExit: record.lastExit,
    lastError: record.lastError,
  };
}

function disposeSupervisor(ctx: SupervisorContext): void {
  if (ctx.disposed) return;
  ctx.disposed = true;
  for (const record of ctx.records.values()) {
    cancelRestartTimer(ctx, record);
    cancelResetTimer(ctx, record);
    if (record.state === 'pending' || record.state === 'restarting') {
      record.state = 'stopped';
    }
  }
}

function initRecords(
  configs: readonly ProcessConfig[],
  phase: SupervisorPhase
): Map<string, ProcessRecord> {
  const records = new Map<string, ProcessRecord>();
  for (const config of selectConfigs(configs, phase)) {
    records.set(config.id, {
      config,
      state: 'pending',
      restartCount: 0,
      lastExit: undefined,
      lastError: undefined,
      restartTimer: undefined,
      resetTimer: undefined,
      handle: undefined,
    });
  }
  return records;
}

function collectLiveHandles(
  records: ReadonlyMap<string, ProcessRecord>
): Map<string, ManagedProcess> {
  const live = new Map<string, ManagedProcess>();
  for (const record of records.values()) {
    if (record.handle !== undefined) {
      live.set(record.config.id, record.handle);
    }
  }
  return live;
}

export function createProcessSupervisor(options: ProcessSupervisorOptions): ProcessSupervisor {
  const ctx: SupervisorContext = {
    clock: options.clock,
    logger: options.logger ?? noopLogger,
    spawnFn: options.spawn ?? spawnManaged,
    host: options.host,
    records: initRecords(options.configs, options.phase),
    disposed: false,
  };

  return {
    start: () => startAll(ctx),
    getStatuses: () => [...ctx.records.values()].map(toStatus),
    getStatus: id => {
      const record = ctx.records.get(id);
      return record === undefined ? undefined : toStatus(record);
    },
    dispose: () => disposeSupervisor(ctx),
    getHandles: () => collectLiveHandles(ctx.records),
  };
}
