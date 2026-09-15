/**
 * Shared types for build, dev, and production runners.
 */

import type { Clock } from '../clock.js';
import type { Logger } from '../logging/logger.js';
import type { ProcessConfig, ShellConfig } from '../config/types.js';
import type { ShellRoots } from '../paths/roots.js';
import type { ProcessSupervisor, SupervisorPhase, SpawnFn } from '../process/supervisor.js';
import type { ShutdownResult, TaskkillInvoker } from '../process/shutdown.js';
import type { ManagedProcess, ProcessExit } from '../process/types.js';
import type { LaunchManifest } from './manifest.js';

export interface StartHandle {
  readonly process: ManagedProcess;
  readonly supervisor: ProcessSupervisor;
  readonly stop: () => Promise<readonly ShutdownResult[]>;
  readonly exited: Promise<ProcessExit>;
}

export interface RunManagedAppOptions {
  readonly phase: SupervisorPhase;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly configs: readonly ProcessConfig[];
  readonly clock?: Clock | undefined;
  readonly logger?: Logger | undefined;
  readonly spawn?: SpawnFn | undefined;
  readonly taskkill?: TaskkillInvoker | undefined;
  readonly killTree?: boolean | undefined;
  readonly graceMs?: number | undefined;
}

export interface DevOptions {
  readonly roots: ShellRoots;
  readonly entryPath: string;
  readonly config?: ShellConfig | undefined;
  readonly processes?: readonly ProcessConfig[] | undefined;
  readonly electronBinary?: string | undefined;
  readonly electronArgs?: readonly string[] | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly clock?: Clock | undefined;
  readonly logger?: Logger | undefined;
  readonly spawn?: SpawnFn | undefined;
  readonly taskkill?: TaskkillInvoker | undefined;
  readonly killTree?: boolean | undefined;
  readonly graceMs?: number | undefined;
  readonly skipFileCheck?: boolean | undefined;
}

export interface ProductionOptions {
  readonly executablePath?: string | undefined;
  readonly manifestPath?: string | undefined;
  readonly manifest?: LaunchManifest | undefined;
  readonly args?: readonly string[] | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly roots?: ShellRoots | undefined;
  readonly config?: ShellConfig | undefined;
  readonly processes?: readonly ProcessConfig[] | undefined;
  readonly clock?: Clock | undefined;
  readonly logger?: Logger | undefined;
  readonly spawn?: SpawnFn | undefined;
  readonly taskkill?: TaskkillInvoker | undefined;
  readonly killTree?: boolean | undefined;
  readonly graceMs?: number | undefined;
  readonly skipFileCheck?: boolean | undefined;
}
