import type { Clock, TimerHandle } from '../clock.js';
import type { Logger } from '../logging/logger.js';
import type { ProcessConfig } from '../config/types.js';
import type { SpawnManagedOptions } from './spawn.js';
import type { ManagedProcess, ProcessExit } from './types.js';

export type SupervisorPhase = 'dev' | 'production';

export type ProcessState = 'pending' | 'starting' | 'ready' | 'restarting' | 'stopped' | 'failed';

export interface ProcessStatus {
  readonly id: string;
  readonly state: ProcessState;
  readonly restartCount: number;
  readonly lastExit: ProcessExit | undefined;
  readonly lastError: string | undefined;
}

export type SpawnFn = (options: SpawnManagedOptions) => ManagedProcess;

export interface ProcessSupervisorOptions {
  readonly configs: readonly ProcessConfig[];
  readonly phase: SupervisorPhase;
  readonly clock: Clock;
  readonly logger?: Logger;
  readonly spawn?: SpawnFn;
  readonly host?: string;
}

export interface ProcessSupervisor {
  start(): Promise<void>;
  readonly getStatuses: () => readonly ProcessStatus[];
  readonly getStatus: (id: string) => ProcessStatus | undefined;
  dispose(): void;
  getHandles(): ReadonlyMap<string, ManagedProcess>;
}

export interface ProcessRecord {
  readonly config: ProcessConfig;
  state: ProcessState;
  restartCount: number;
  lastExit: ProcessExit | undefined;
  lastError: string | undefined;
  restartTimer: TimerHandle | undefined;
  resetTimer: TimerHandle | undefined;
  handle: ManagedProcess | undefined;
}

export interface SupervisorContext {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly spawnFn: SpawnFn;
  readonly host: string | undefined;
  readonly records: ReadonlyMap<string, ProcessRecord>;
  disposed: boolean;
}
