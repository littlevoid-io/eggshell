import fkill from 'fkill';
import type { Clock } from '../clock.js';
import type { Logger } from '../logging/logger.js';
import type { ManagedProcess } from './types.js';

export const DEFAULT_SIGNAL: NodeJS.Signals = 'SIGTERM';
export const FORCE_SIGNAL: NodeJS.Signals = 'SIGKILL';

export type ShutdownOutcome = 'alreadyExited' | 'exitedOnSignal' | 'forceKilled' | 'failed';

export interface ShutdownResult {
  readonly id: string;
  readonly pid: number | undefined;
  readonly outcome: ShutdownOutcome;
}

export type ForceKillFn = (pid: number) => Promise<void>;

export const defaultForceKill: ForceKillFn = async (pid: number): Promise<void> => {
  await fkill(pid, { tree: true, force: true, silent: true });
};

export interface ShutdownTarget {
  readonly handle: ManagedProcess;
  readonly signal?: NodeJS.Signals;
  readonly graceMs?: number;
  readonly killTree?: boolean;
  readonly abortReadiness?: () => void;
}

export interface ShutdownOptions {
  readonly graceMs: number;
  readonly clock: Clock;
  readonly logger?: Logger;
  readonly signal?: NodeJS.Signals;
  readonly killTree?: boolean;
  readonly forceKill?: ForceKillFn;
}
