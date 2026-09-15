/**
 * In-memory process spawning test helper for build/dev/start tests.
 */

import type { SpawnManagedOptions } from '../../process/spawn.js';
import type { ManagedProcess, ProcessExit, ProcessLineStream } from '../../process/types.js';
import type { SpawnFn } from '../../process/supervisor.js';
import type { TaskkillInvoker } from '../../process/shutdown.js';
import type { FakeClock } from '../../__testing__/fake-clock.js';

export interface ControllableProcess {
  readonly handle: ManagedProcess;
  readonly killed: NodeJS.Signals[];
  readonly options: SpawnManagedOptions;
  resolveExit(exit: ProcessExit): void;
  rejectExit(error: unknown): void;
}

export interface RecordingSpawnOptions {
  readonly autoExitOnKill?: boolean;
  readonly clock?: FakeClock;
}

export interface RecordingSpawn {
  readonly spawn: SpawnFn;
  readonly spawned: ControllableProcess[];
  get(id: string): ControllableProcess | undefined;
}

export function createRecordingSpawn(options: RecordingSpawnOptions = {}): RecordingSpawn {
  const { autoExitOnKill = false, clock } = options;
  const spawned: ControllableProcess[] = [];

  const spawn: SpawnFn = (opts: SpawnManagedOptions) => {
    let resolveFn!: (exit: ProcessExit) => void;
    let rejectFn!: (error: unknown) => void;
    const exited = new Promise<ProcessExit>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });
    const killed: NodeJS.Signals[] = [];
    const lines: ProcessLineStream = { onLine: () => () => undefined };
    const handle: ManagedProcess = {
      id: opts.id,
      pid: 1000 + spawned.length,
      lines,
      exited,
      kill: signal => {
        killed.push(signal ?? 'SIGTERM');
        if (autoExitOnKill) {
          resolveFn({ code: 0, signal: null });
        }
      },
    };
    const ctrl: ControllableProcess = {
      handle,
      killed,
      options: opts,
      resolveExit: exit => resolveFn(exit),
      rejectExit: error => rejectFn(error),
    };
    spawned.push(ctrl);
    if (clock) {
      queueMicrotask(() => {
        clock.advance(50);
      });
    }
    return handle;
  };

  return {
    spawn,
    spawned,
    get: (id: string) => spawned.find(s => s.handle.id === id),
  };
}

export function createRecordingTaskkill(getSpawned: () => ControllableProcess[]): {
  readonly taskkill: TaskkillInvoker;
  readonly calls: string[][];
} {
  const calls: string[][] = [];
  const taskkill: TaskkillInvoker = async args => {
    calls.push([...args]);
    const pidIndex = args.indexOf('/PID');
    if (pidIndex !== -1) {
      const pid = Number(args[pidIndex + 1]);
      const target = getSpawned().find(p => p.handle.pid === pid);
      target?.resolveExit({ code: 0, signal: null });
    }
  };
  return { taskkill, calls };
}
