/**
 * Process supervision and application lifecycle runner.
 */

import type { Clock } from '../clock.js';
import { systemClock } from '../clock.js';
import { createProcessSupervisor, type ProcessSupervisor, type SpawnFn } from '../process/supervisor.js';
import { shutdownAll, type ShutdownResult, type ShutdownOptions } from '../process/shutdown.js';
import { spawnManaged } from '../process/spawn.js';
import type { ManagedProcess, ProcessExit } from '../process/types.js';
import type { RunManagedAppOptions, StartHandle } from './types.js';

export type { StartHandle, RunManagedAppOptions };

/**
 * Short wait duration to allow Node's asynchronous libuv child_process spawn
 * failure events (such as ENOENT or EACCES) to surface via `exited` rejection
 * before returning the handle. In Node, OS-level spawn failures are delivered
 * asynchronously on the event loop, typically within 5-30ms. 50ms provides a
 * reliable window to capture immediate launch failures without adding
 * perceptible latency to startup.
 */
const SPAWN_SETTLE_MS = 50;

function toShutdownOptions(options: RunManagedAppOptions, clock: Clock): ShutdownOptions {
  return {
    graceMs: options.graceMs ?? 5000,
    clock,
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
    ...(options.taskkill !== undefined ? { taskkill: options.taskkill } : {}),
    ...(options.killTree !== undefined ? { killTree: options.killTree } : {}),
  };
}

async function cleanUpSupervisor(
  supervisor: ProcessSupervisor,
  options: RunManagedAppOptions,
  clock: Clock
): Promise<void> {
  supervisor.dispose();
  const handles = [...supervisor.getHandles().values()].map(handle => ({ handle }));
  if (handles.length > 0) {
    await shutdownAll(handles, toShutdownOptions(options, clock));
  }
}

async function performShutdown(
  supervisor: ProcessSupervisor,
  appProcess: ManagedProcess,
  options: RunManagedAppOptions,
  clock: Clock
): Promise<readonly ShutdownResult[]> {
  supervisor.dispose();
  const supervised = [...supervisor.getHandles().values()].map(handle => ({ handle }));
  const targets = [...supervised, { handle: appProcess }];
  return shutdownAll(targets, toShutdownOptions(options, clock));
}

function createExitedPromise(
  appProcess: ManagedProcess,
  stopFn: () => Promise<readonly ShutdownResult[]>
): Promise<ProcessExit> {
  return new Promise<ProcessExit>((resolve, reject) => {
    appProcess.exited
      .then(async exit => {
        try {
          await stopFn();
          resolve(exit);
        } catch (error) {
          reject(error);
        }
      })
      .catch(async error => {
        try {
          await stopFn();
        } catch {
          // ignore cleanup error on failure
        }
        reject(error);
      });
  });
}

class LifecycleCoordinator {
  private shutdownPromise: Promise<readonly ShutdownResult[]> | undefined;

  constructor(
    private readonly supervisor: ProcessSupervisor,
    private readonly appProcess: ManagedProcess,
    private readonly options: RunManagedAppOptions,
    private readonly clock: Clock
  ) {}

  stop = (): Promise<readonly ShutdownResult[]> => {
    if (!this.shutdownPromise) {
      this.shutdownPromise = performShutdown(this.supervisor, this.appProcess, this.options, this.clock);
    }
    return this.shutdownPromise;
  };
}

async function waitForImmediateSpawn(
  appProcess: ManagedProcess,
  clock: Clock
): Promise<void> {
  let spawnError: unknown;
  appProcess.exited.catch(error => { spawnError = error; });

  await new Promise<void>(resolve => {
    const timer = clock.setTimeout(resolve, SPAWN_SETTLE_MS);
    appProcess.exited.catch(() => {
      clock.clearTimeout(timer);
      resolve();
    });
  });

  if (spawnError) {
    throw spawnError;
  }
}

async function spawnAppProcess(
  spawnFn: SpawnFn,
  options: RunManagedAppOptions,
  clock: Clock
): Promise<ManagedProcess> {
  const appProcess = spawnFn({
    id: options.phase === 'dev' ? 'electron' : 'app',
    command: options.command,
    args: [...options.args],
    cwd: options.cwd,
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
  });

  await waitForImmediateSpawn(appProcess, clock);
  return appProcess;
}

async function startSupervisor(
  supervisor: ProcessSupervisor,
  options: RunManagedAppOptions,
  clock: Clock
): Promise<void> {
  try {
    await supervisor.start();
  } catch (error) {
    await cleanUpSupervisor(supervisor, options, clock);
    throw error;
  }
}

async function startManagedProcess(
  spawnFn: SpawnFn,
  supervisor: ProcessSupervisor,
  options: RunManagedAppOptions,
  clock: Clock
): Promise<ManagedProcess> {
  try {
    return await spawnAppProcess(spawnFn, options, clock);
  } catch (error) {
    await cleanUpSupervisor(supervisor, options, clock);
    throw error;
  }
}

export async function runManagedApp(options: RunManagedAppOptions): Promise<StartHandle> {
  const clock = options.clock ?? systemClock;
  const spawnFn = options.spawn ?? spawnManaged;
  const supervisor = createProcessSupervisor({
    configs: options.configs,
    phase: options.phase,
    clock,
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
    ...(options.spawn !== undefined ? { spawn: options.spawn } : {}),
  });

  await startSupervisor(supervisor, options, clock);
  const appProcess = await startManagedProcess(spawnFn, supervisor, options, clock);
  const coordinator = new LifecycleCoordinator(supervisor, appProcess, options, clock);
  return {
    process: appProcess,
    supervisor,
    stop: coordinator.stop,
    exited: createExitedPromise(appProcess, coordinator.stop),
  };
}
