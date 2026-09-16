import { describe, it, expect } from 'vitest';
import { createFakeClock } from '../__testing__/fake-clock.js';
import { ProcessError } from '../errors.js';
import type { Logger, LogFields, LogLevel } from '../logging/logger.js';
import type { ManagedProcess, ProcessExit } from './types.js';
import { shutdownAll, type ForceKillFn } from './shutdown.js';
import { waitForReadiness } from './readiness.js';
import { createProcessSupervisor, type SpawnFn } from './supervisor.js';
import type { ProcessConfig } from '../config/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A `ManagedProcess` whose `exited` promise a test settles on demand — no real child process. */
interface ControllableProcess {
  readonly handle: ManagedProcess;
  readonly killedSignals: NodeJS.Signals[];
  resolveExit(exit: ProcessExit): void;
}

/** `pid` has no default: a test asserting `killTree`'s pid-undefined fallback must be able to pass `undefined` explicitly. */
function createControllableProcess(
  id: string,
  pid: number | undefined,
  onKill?: () => void
): ControllableProcess {
  let resolveFn!: (exit: ProcessExit) => void;
  const exited = new Promise<ProcessExit>(resolve => {
    resolveFn = resolve;
  });
  const killedSignals: NodeJS.Signals[] = [];
  return {
    handle: {
      id,
      pid,
      lines: { onLine: () => () => undefined },
      exited,
      kill: signal => {
        onKill?.();
        killedSignals.push(signal ?? 'SIGTERM');
      },
    },
    killedSignals,
    resolveExit: exit => resolveFn(exit),
  };
}

interface RecordedLogCall {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: LogFields | undefined;
}

function createRecordingLogger(): { logger: Logger; calls: RecordedLogCall[] } {
  const calls: RecordedLogCall[] = [];
  const record =
    (level: LogLevel) =>
    (message: string, fields?: LogFields): void => {
      calls.push({ level, message, fields });
    };
  return {
    logger: {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    },
    calls,
  };
}

/** Drains already-resolved microtasks (promise chains through `exited`) without touching the fake clock. */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

const CLEAN_EXIT: ProcessExit = { code: 0, signal: null };

function buildConfig(overrides: Partial<ProcessConfig> = {}): ProcessConfig {
  return {
    id: 'proc',
    command: 'node',
    args: [],
    phase: 'always',
    readiness: { kind: 'none' },
    readinessTimeoutMs: 5000,
    requirePortsFree: [],
    restart: {
      policy: 'never',
      maxRestarts: 5,
      backoffMs: 100,
      backoffMultiplier: 2,
      maxBackoffMs: 1000,
      resetAfterMs: 10_000,
    },
    shutdown: { signal: 'SIGTERM', graceMs: 5000 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('shutdownAll', () => {
  it('resolves before graceMs and reports exitedOnSignal when a process exits on the signal', async () => {
    const clock = createFakeClock();
    const proc = createControllableProcess('a', 111);

    const resultPromise = shutdownAll([{ handle: proc.handle }], {
      graceMs: 5000,
      clock,
      killTree: false,
    });
    await flushAsync();
    expect(proc.killedSignals).toEqual(['SIGTERM']);

    proc.resolveExit(CLEAN_EXIT);
    const results = await resultPromise;

    expect(results).toEqual([{ id: 'a', pid: 111, outcome: 'exitedOnSignal' }]);
    expect(clock.pendingCount).toBe(0);
  });

  it('force-kills a process that ignores the signal after graceMs, still resolves, and logs one warn', async () => {
    const clock = createFakeClock();
    const proc = createControllableProcess('a', 111);
    const { logger, calls } = createRecordingLogger();

    const resultPromise = shutdownAll([{ handle: proc.handle }], {
      graceMs: 1000,
      clock,
      logger,
      killTree: false,
    });
    await flushAsync();
    clock.advance(1000); // grace elapses; process never exits
    await flushAsync();
    clock.advance(1000); // post-force-kill bounded wait also elapses; process still never exits

    const results = await resultPromise;

    expect(results).toEqual([{ id: 'a', pid: 111, outcome: 'forceKilled' }]);
    expect(proc.killedSignals).toEqual(['SIGTERM', 'SIGKILL']);
    const forceKillWarns = calls.filter(
      call => call.level === 'warn' && call.message.includes('force-killed')
    );
    expect(forceKillWarns).toHaveLength(1);
    expect(clock.pendingCount).toBe(0);
  });

  it('is idempotent: calling shutdownAll twice does not throw and never re-signals', async () => {
    const clock = createFakeClock();
    const proc = createControllableProcess('a', 111);
    const target = { handle: proc.handle };

    const firstPromise = shutdownAll([target], { graceMs: 1000, clock, killTree: false });
    await flushAsync();
    proc.resolveExit(CLEAN_EXIT);
    const first = await firstPromise;
    expect(first).toEqual([{ id: 'a', pid: 111, outcome: 'exitedOnSignal' }]);
    expect(proc.killedSignals).toEqual(['SIGTERM']);

    const second = await shutdownAll([target], { graceMs: 1000, clock, killTree: false });

    expect(second).toEqual([{ id: 'a', pid: 111, outcome: 'alreadyExited' }]);
    expect(proc.killedSignals).toEqual(['SIGTERM']);
    expect(clock.pendingCount).toBe(0);
  });

  it('shuts down three processes in exactly reverse start order', async () => {
    const clock = createFakeClock();
    const order: string[] = [];
    const a = createControllableProcess('a', 1, () => order.push('a'));
    const b = createControllableProcess('b', 2, () => order.push('b'));
    const c = createControllableProcess('c', 3, () => order.push('c'));

    const resultPromise = shutdownAll(
      [{ handle: a.handle }, { handle: b.handle }, { handle: c.handle }],
      { graceMs: 1000, clock, killTree: false }
    );

    await flushAsync();
    expect(order).toEqual(['c']);
    c.resolveExit(CLEAN_EXIT);
    await flushAsync();
    expect(order).toEqual(['c', 'b']);
    b.resolveExit(CLEAN_EXIT);
    await flushAsync();
    expect(order).toEqual(['c', 'b', 'a']);
    a.resolveExit(CLEAN_EXIT);

    const results = await resultPromise;
    expect(results.map(result => result.id)).toEqual(['c', 'b', 'a']);
    expect(clock.pendingCount).toBe(0);
  });

  it('resolves an already-exited process immediately and never signals it', async () => {
    const clock = createFakeClock();
    const proc = createControllableProcess('a', 111);
    proc.resolveExit(CLEAN_EXIT);

    const results = await shutdownAll([{ handle: proc.handle }], {
      graceMs: 1000,
      clock,
      killTree: false,
    });

    expect(results).toEqual([{ id: 'a', pid: 111, outcome: 'alreadyExited' }]);
    expect(proc.killedSignals).toEqual([]);
    expect(clock.pendingCount).toBe(0);
  });

  it('treats a handle whose exited rejected (spawn failure) as already gone, never awaiting it', async () => {
    const clock = createFakeClock();
    const handle: ManagedProcess = {
      id: 'spawn-failed',
      pid: undefined,
      lines: { onLine: () => () => undefined },
      exited: Promise.reject(new ProcessError('boom', { processId: 'spawn-failed' })),
      kill: () => {
        throw new Error('kill() should never be called on a handle that never started');
      },
    };

    const results = await shutdownAll([{ handle }], { graceMs: 1000, clock, killTree: false });

    expect(results).toEqual([{ id: 'spawn-failed', pid: undefined, outcome: 'alreadyExited' }]);
    expect(clock.pendingCount).toBe(0);
  });

  it('killTree issues forceKill(pid) on escalation after graceMs elapses', async () => {
    const clock = createFakeClock();
    const proc = createControllableProcess('a', 4242);
    const forceKillCalls: number[] = [];
    const forceKill: ForceKillFn = pid => {
      forceKillCalls.push(pid);
      return Promise.resolve();
    };

    const resultPromise = shutdownAll([{ handle: proc.handle }], {
      graceMs: 1000,
      clock,
      killTree: true,
      forceKill,
    });
    await flushAsync();

    // Signal sent first, forceKill not yet called
    expect(proc.killedSignals).toEqual(['SIGTERM']);
    expect(forceKillCalls).toEqual([]);

    clock.advance(1000); // grace period elapses
    await flushAsync();
    expect(forceKillCalls).toEqual([4242]);

    proc.resolveExit(CLEAN_EXIT);
    const results = await resultPromise;

    expect(results).toEqual([{ id: 'a', pid: 4242, outcome: 'forceKilled' }]);
    expect(clock.pendingCount).toBe(0);
  });

  it('a process that exits on its own within graceMs never triggers forceKill', async () => {
    const clock = createFakeClock();
    const proc = createControllableProcess('parent', 9001);
    const forceKillCalls: number[] = [];
    const forceKill: ForceKillFn = pid => {
      forceKillCalls.push(pid);
      return Promise.resolve();
    };

    const resultPromise = shutdownAll([{ handle: proc.handle }], {
      graceMs: 5000,
      clock,
      killTree: true,
      forceKill,
    });
    await flushAsync();
    expect(proc.killedSignals).toEqual(['SIGTERM']);
    expect(forceKillCalls).toEqual([]);

    // The parent now exits on its own, well inside graceMs.
    proc.resolveExit(CLEAN_EXIT);
    const results = await resultPromise;

    expect(results).toEqual([{ id: 'parent', pid: 9001, outcome: 'exitedOnSignal' }]);
    expect(forceKillCalls).toHaveLength(0);
    expect(clock.pendingCount).toBe(0);
  });

  it('falls back to handle.kill() and logs, without throwing, when killTree is enabled but pid is undefined', async () => {
    const clock = createFakeClock();
    const proc = createControllableProcess('a', undefined);
    const { logger, calls } = createRecordingLogger();
    const forceKillCalls: number[] = [];
    const forceKill: ForceKillFn = pid => {
      forceKillCalls.push(pid);
      return Promise.resolve();
    };

    const resultPromise = shutdownAll([{ handle: proc.handle }], {
      graceMs: 1000,
      clock,
      logger,
      killTree: true,
      forceKill,
    });
    await flushAsync();
    expect(proc.killedSignals).toEqual(['SIGTERM']);

    clock.advance(1000);
    await flushAsync();
    proc.resolveExit(CLEAN_EXIT);

    const results = await resultPromise;

    expect(results).toEqual([{ id: 'a', pid: undefined, outcome: 'forceKilled' }]);
    expect(forceKillCalls).toEqual([]);
    expect(proc.killedSignals).toEqual(['SIGTERM', 'SIGKILL']);
    const fallbackWarns = calls.filter(
      call => call.level === 'warn' && call.message.includes('falling back to kill()')
    );
    expect(fallbackWarns).toHaveLength(1);
    expect(clock.pendingCount).toBe(0);
  });

  it('killTree: false never invokes forceKill, even through a full escalation (the POSIX-shaped path)', async () => {
    const clock = createFakeClock();
    const proc = createControllableProcess('a', 111);
    const forceKillCalls: number[] = [];
    const forceKill: ForceKillFn = pid => {
      forceKillCalls.push(pid);
      return Promise.resolve();
    };

    const resultPromise = shutdownAll([{ handle: proc.handle }], {
      graceMs: 1000,
      clock,
      killTree: false,
      forceKill,
    });
    await flushAsync();
    clock.advance(1000); // grace elapses; process never exits -> escalate
    await flushAsync();
    clock.advance(1000); // post-force-kill bounded wait also elapses

    const results = await resultPromise;

    expect(results).toEqual([{ id: 'a', pid: 111, outcome: 'forceKilled' }]);
    expect(proc.killedSignals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(forceKillCalls).toEqual([]);
    expect(clock.pendingCount).toBe(0);
  });

  it('a deliberate shutdown does not trigger the restart policy (zero respawns during and after)', async () => {
    const clock = createFakeClock();
    const configs: ProcessConfig[] = [
      buildConfig({
        id: 'a',
        restart: {
          policy: 'always',
          maxRestarts: 10,
          backoffMs: 100,
          backoffMultiplier: 2,
          maxBackoffMs: 1000,
          resetAfterMs: 10_000,
        },
      }),
    ];

    const spawnCounts = new Map<string, number>();
    const controllables = new Map<string, ControllableProcess>();
    const spawn: SpawnFn = options => {
      spawnCounts.set(options.id, (spawnCounts.get(options.id) ?? 0) + 1);
      const controllable = createControllableProcess(options.id, 111);
      controllables.set(options.id, controllable);
      return controllable.handle;
    };

    const supervisor = createProcessSupervisor({ configs, phase: 'production', clock, spawn });
    await supervisor.start();
    expect(spawnCounts.get('a')).toBe(1);

    // Deliberate shutdown: disarm the restart policy FIRST, then kill.
    supervisor.dispose();
    const handle = controllables.get('a');
    if (handle === undefined) {
      throw new Error('process "a" was never spawned');
    }
    const shutdownPromise = shutdownAll([{ handle: handle.handle }], {
      graceMs: 1000,
      clock,
      killTree: false,
    });
    await flushAsync();
    // A crash-shaped exit — under an armed 'always' restart policy this
    // would normally schedule a restart.
    handle.resolveExit({ code: 1, signal: null });
    await shutdownPromise;

    // Let any restart backoff that might have been (wrongly) scheduled run
    // to completion.
    await flushAsync();
    clock.runAllPending();
    await flushAsync();

    expect(spawnCounts.get('a')).toBe(1);
    expect(supervisor.getStatus('a')?.state).toBe('stopped');
  });

  it('leaves no pending fake-clock timers after a mixed exitedOnSignal/forceKilled run', async () => {
    const clock = createFakeClock();
    const graceful = createControllableProcess('graceful', 111);
    const stubborn = createControllableProcess('stubborn', 222);

    const resultPromise = shutdownAll([{ handle: graceful.handle }, { handle: stubborn.handle }], {
      graceMs: 500,
      clock,
      killTree: false,
    });

    await flushAsync(); // 'stubborn' is signalled first (reverse order)
    clock.advance(500); // 'stubborn' ignores it -> force-kill
    await flushAsync();
    clock.advance(500); // 'stubborn' ignores the force-kill too
    await flushAsync(); // 'graceful' is now signalled
    graceful.resolveExit(CLEAN_EXIT);

    const results = await resultPromise;

    expect(results.map(result => result.outcome)).toEqual(['forceKilled', 'exitedOnSignal']);
    expect(clock.pendingCount).toBe(0);
  });

  it('aborts an in-flight readiness wait as part of shutdown', async () => {
    const clock = createFakeClock();
    const controller = new AbortController();
    const readinessRejection = waitForReadiness(
      { kind: 'delay', ms: 999_999 },
      { processId: 'a', timeoutMs: 999_999, clock, signal: controller.signal }
    ).catch((error: unknown) => error);

    const proc = createControllableProcess('a', 111);
    const resultPromise = shutdownAll(
      [{ handle: proc.handle, abortReadiness: () => controller.abort() }],
      { graceMs: 1000, clock, killTree: false }
    );
    await flushAsync();
    proc.resolveExit(CLEAN_EXIT);
    await resultPromise;

    const error = await readinessRejection;
    expect(error).toBeInstanceOf(ProcessError);
    expect((error as Error).message).toMatch(/aborted/);
    expect(clock.pendingCount).toBe(0);
  });

  it('a process exiting exactly at the graceMs boundary is force-killed (force-kill wins ties)', async () => {
    const clock = createFakeClock();
    const proc = createControllableProcess('a', 111);

    const resultPromise = shutdownAll([{ handle: proc.handle }], {
      graceMs: 1000,
      clock,
      killTree: false,
    });
    await flushAsync();
    expect(clock.pendingDueTimes).toEqual([1000]);

    // Resolve the exit and advance the clock to precisely graceMs back to
    // back, with no intervening microtask flush: the exit has not yet been
    // *observed* (its `.then` reaction has not run) when the deadline timer
    // fires synchronously inside `advance()`, so force-kill wins the tie —
    // see shutdown.ts's documented boundary semantics.
    proc.resolveExit(CLEAN_EXIT);
    clock.advance(1000);

    const results = await resultPromise;

    expect(results).toEqual([{ id: 'a', pid: 111, outcome: 'forceKilled' }]);
    expect(clock.pendingCount).toBe(0);
  });
});
