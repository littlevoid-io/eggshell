import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { createProcessSupervisor, type ProcessStatus, type SpawnFn } from './supervisor.js';
import { ProcessError } from '../errors.js';
import { createFakeClock } from '../__testing__/fake-clock.js';
import type { ProcessConfig } from '../config/types.js';
import type { ManagedProcess, ProcessExit, ProcessLineStream } from './types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

/** A hand-built, never-emitting `ProcessLineStream` for configs that don't use a `log` probe. */
function createSilentLineStream(): ProcessLineStream {
  return { onLine: () => () => undefined };
}

/** A `ManagedProcess` whose `exited` promise a test settles on demand — no real child process. */
interface ControllableProcess {
  readonly handle: ManagedProcess;
  readonly killed: NodeJS.Signals[];
  resolveExit(exit: ProcessExit): void;
  rejectExit(error: unknown): void;
}

function createControllableProcess(
  id: string,
  lines: ProcessLineStream = createSilentLineStream()
): ControllableProcess {
  let resolveFn!: (exit: ProcessExit) => void;
  let rejectFn!: (error: unknown) => void;
  const exited = new Promise<ProcessExit>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  const killed: NodeJS.Signals[] = [];
  return {
    handle: {
      id,
      pid: 4242,
      lines,
      exited,
      kill: signal => killed.push(signal ?? 'SIGTERM'),
    },
    killed,
    resolveExit: exit => resolveFn(exit),
    rejectExit: error => rejectFn(error),
  };
}

/**
 * Records every spawn call (order + options) and creates a fresh
 * `ControllableProcess` per call — a restart must get a brand-new `exited`
 * promise, never the previous attempt's already-settled one.
 */
function createRecordingSpawn(): {
  spawn: SpawnFn;
  startOrder: string[];
  spawnedById: Map<string, ControllableProcess[]>;
} {
  const startOrder: string[] = [];
  const spawnedById = new Map<string, ControllableProcess[]>();
  const spawn: SpawnFn = options => {
    startOrder.push(options.id);
    const controllable = createControllableProcess(options.id);
    const list = spawnedById.get(options.id) ?? [];
    list.push(controllable);
    spawnedById.set(options.id, list);
    return controllable.handle;
  };
  return { spawn, startOrder, spawnedById };
}

function latest(spawnedById: Map<string, ControllableProcess[]>, id: string): ControllableProcess {
  const list = spawnedById.get(id);
  const process = list?.at(-1);
  if (process === undefined) {
    throw new Error(`no process spawned for ${id}`);
  }
  return process;
}

function countFor(spawnedById: Map<string, ControllableProcess[]>, id: string): number {
  return spawnedById.get(id)?.length ?? 0;
}

function statusOf(statuses: readonly ProcessStatus[], id: string): ProcessStatus {
  const status = statuses.find(candidate => candidate.id === id);
  if (status === undefined) {
    throw new Error(`no status for ${id}`);
  }
  return status;
}

/** Drains already-resolved microtasks (promise chains through `exited`/readiness) without touching the fake clock. */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

const CLEAN_EXIT: ProcessExit = { code: 0, signal: null };
const CRASH_EXIT: ProcessExit = { code: 1, signal: null };

// ---------------------------------------------------------------------------
// Real-port fixtures (assertPortsFree binds a real socket; no fake timers or
// real child processes are involved in this)
// ---------------------------------------------------------------------------

const HOST = '127.0.0.1';
let openServers: net.Server[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.map(
      server =>
        new Promise<void>(resolve => {
          if (!server.listening) {
            resolve();
            return;
          }
          server.close(() => resolve());
        })
    )
  );
  openServers = [];
});

async function listenOnEphemeralPort(): Promise<net.Server> {
  const server = net.createServer();
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, () => resolve());
  });
  return server;
}

function portOf(server: net.Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected a bound TCP server with a numeric port');
  }
  return address.port;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createProcessSupervisor', () => {
  it('starts two processes and both report ready status', async () => {
    const clock = createFakeClock();
    const { spawn, startOrder } = createRecordingSpawn();
    const supervisor = createProcessSupervisor({
      configs: [buildConfig({ id: 'a' }), buildConfig({ id: 'b' })],
      phase: 'production',
      clock,
      spawn,
    });

    await supervisor.start();

    expect(startOrder).toEqual(['a', 'b']);
    const statuses = supervisor.getStatuses();
    expect(statusOf(statuses, 'a').state).toBe('ready');
    expect(statusOf(statuses, 'b').state).toBe('ready');
  });

  it('phase filtering: a production run starts production+always, not dev', async () => {
    const clock = createFakeClock();
    const { spawn, startOrder } = createRecordingSpawn();
    const supervisor = createProcessSupervisor({
      configs: [
        buildConfig({ id: 'devOnly', phase: 'dev' }),
        buildConfig({ id: 'prodOnly', phase: 'production' }),
        buildConfig({ id: 'shared', phase: 'always' }),
      ],
      phase: 'production',
      clock,
      spawn,
    });

    await supervisor.start();

    expect(startOrder).toEqual(['prodOnly', 'shared']);
    expect(supervisor.getStatus('devOnly')).toBeUndefined();
  });

  it('phase filtering: a dev run starts dev+always, not production', async () => {
    const clock = createFakeClock();
    const { spawn, startOrder } = createRecordingSpawn();
    const supervisor = createProcessSupervisor({
      configs: [
        buildConfig({ id: 'devOnly', phase: 'dev' }),
        buildConfig({ id: 'prodOnly', phase: 'production' }),
        buildConfig({ id: 'shared', phase: 'always' }),
      ],
      phase: 'dev',
      clock,
      spawn,
    });

    await supervisor.start();

    expect(startOrder).toEqual(['devOnly', 'shared']);
    expect(supervisor.getStatus('prodOnly')).toBeUndefined();
  });

  it('starts processes in config order', async () => {
    const clock = createFakeClock();
    const { spawn, startOrder } = createRecordingSpawn();
    const supervisor = createProcessSupervisor({
      configs: [
        buildConfig({ id: 'third' }),
        buildConfig({ id: 'first' }),
        buildConfig({ id: 'second' }),
      ],
      phase: 'production',
      clock,
      spawn,
    });

    await supervisor.start();

    expect(startOrder).toEqual(['third', 'first', 'second']);
  });

  it('a port conflict before spawn fails naming the process id and does not spawn it', async () => {
    const server = await listenOnEphemeralPort();
    const port = portOf(server);
    const clock = createFakeClock();
    const { spawn, startOrder } = createRecordingSpawn();
    const supervisor = createProcessSupervisor({
      configs: [buildConfig({ id: 'blocked', requirePortsFree: [port] })],
      phase: 'production',
      clock,
      spawn,
    });

    await expect(supervisor.start()).rejects.toThrow(/"blocked"/);
    await expect(supervisor.start()).rejects.toBeInstanceOf(ProcessError);
    expect(startOrder).toEqual([]);
    expect(supervisor.getStatus('blocked')?.state).toBe('failed');
  });

  it('a readiness timeout fails naming the process id', async () => {
    const clock = createFakeClock();
    const { spawn } = createRecordingSpawn();
    const supervisor = createProcessSupervisor({
      configs: [
        buildConfig({
          id: 'slow',
          readiness: { kind: 'log', pattern: 'READY' },
          readinessTimeoutMs: 1000,
        }),
      ],
      phase: 'production',
      clock,
      spawn,
    });

    const startPromise = supervisor.start();
    const assertion = expect(startPromise).rejects.toThrow(/"slow"/);
    // Let the port-check/spawn microtask chain run far enough that
    // `waitForReadiness` has actually registered its timeout timer on the
    // fake clock before advancing it — advancing too early would find no
    // pending timer and silently do nothing.
    await flushAsync();
    clock.advance(1000);
    await flushAsync();
    await assertion;
    expect(supervisor.getStatus('slow')?.state).toBe('failed');
  });

  it('policy "never" does not restart after a crash', async () => {
    const clock = createFakeClock();
    const { spawn, spawnedById } = createRecordingSpawn();
    const supervisor = createProcessSupervisor({
      configs: [buildConfig({ id: 'p', restart: { ...buildConfig().restart, policy: 'never' } })],
      phase: 'production',
      clock,
      spawn,
    });
    await supervisor.start();

    latest(spawnedById, 'p').resolveExit(CRASH_EXIT);
    await flushAsync();

    expect(supervisor.getStatus('p')?.state).toBe('stopped');
    expect(countFor(spawnedById, 'p')).toBe(1);
    expect(clock.pendingCount).toBe(0);
  });

  it('policy "onCrash" restarts on a non-zero exit but not on a clean exit 0', async () => {
    const clock = createFakeClock();
    const { spawn, spawnedById } = createRecordingSpawn();
    const config = buildConfig({
      id: 'p',
      restart: { ...buildConfig().restart, policy: 'onCrash', backoffMs: 50 },
    });
    const supervisor = createProcessSupervisor({
      configs: [config],
      phase: 'production',
      clock,
      spawn,
    });
    await supervisor.start();

    latest(spawnedById, 'p').resolveExit(CRASH_EXIT);
    await flushAsync();
    expect(supervisor.getStatus('p')?.state).toBe('restarting');

    await clock.advance(50);
    await flushAsync();
    expect(countFor(spawnedById, 'p')).toBe(2);
    expect(supervisor.getStatus('p')?.state).toBe('ready');

    latest(spawnedById, 'p').resolveExit(CLEAN_EXIT);
    await flushAsync();
    expect(supervisor.getStatus('p')?.state).toBe('stopped');
    expect(countFor(spawnedById, 'p')).toBe(2);
    expect(clock.pendingCount).toBe(0);
  });

  it('policy "always" restarts even on a clean exit 0', async () => {
    const clock = createFakeClock();
    const { spawn, spawnedById } = createRecordingSpawn();
    const config = buildConfig({
      id: 'p',
      restart: { ...buildConfig().restart, policy: 'always', backoffMs: 50 },
    });
    const supervisor = createProcessSupervisor({
      configs: [config],
      phase: 'production',
      clock,
      spawn,
    });
    await supervisor.start();

    latest(spawnedById, 'p').resolveExit(CLEAN_EXIT);
    await flushAsync();
    expect(supervisor.getStatus('p')?.state).toBe('restarting');

    await clock.advance(50);
    await flushAsync();
    expect(countFor(spawnedById, 'p')).toBe(2);
    expect(supervisor.getStatus('p')?.state).toBe('ready');
  });

  it('backoff sequence matches expectation exactly, including the maxBackoffMs cap', async () => {
    const clock = createFakeClock();
    const { spawn, spawnedById } = createRecordingSpawn();
    const config = buildConfig({
      id: 'p',
      restart: {
        policy: 'always',
        maxRestarts: 10,
        backoffMs: 100,
        backoffMultiplier: 2,
        maxBackoffMs: 350,
        resetAfterMs: 1_000_000,
      },
    });
    const supervisor = createProcessSupervisor({
      configs: [config],
      phase: 'production',
      clock,
      spawn,
    });
    await supervisor.start();

    // Expected delays: 100, 200, 350 (capped from 400), 350 (capped from 800).
    const expectedDelays = [100, 200, 350, 350];
    for (const [index, delay] of expectedDelays.entries()) {
      latest(spawnedById, 'p').resolveExit(CRASH_EXIT);
      await flushAsync();
      expect(clock.pendingDueTimes).toEqual([clock.now() + delay]);

      await clock.advance(delay - 1);
      await flushAsync();
      expect(countFor(spawnedById, 'p')).toBe(index + 1); // still the pre-restart count

      await clock.advance(1);
      await flushAsync();
      expect(countFor(spawnedById, 'p')).toBe(index + 2);
    }
  });

  it('exhausting maxRestarts stops permanently, logs once at error, and leaves no pending timers', async () => {
    const clock = createFakeClock();
    const { spawn, spawnedById } = createRecordingSpawn();
    const errors: string[] = [];
    const config = buildConfig({
      id: 'p',
      restart: {
        policy: 'always',
        maxRestarts: 2,
        backoffMs: 10,
        backoffMultiplier: 1,
        maxBackoffMs: 10,
        resetAfterMs: 1_000_000,
      },
    });
    const supervisor = createProcessSupervisor({
      configs: [config],
      phase: 'production',
      clock,
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: message => errors.push(message),
      },
      spawn,
    });
    await supervisor.start();

    latest(spawnedById, 'p').resolveExit(CRASH_EXIT);
    await flushAsync();
    await clock.advance(10);
    await flushAsync();
    expect(supervisor.getStatus('p')?.state).toBe('ready');

    latest(spawnedById, 'p').resolveExit(CRASH_EXIT);
    await flushAsync();
    await clock.advance(10);
    await flushAsync();
    expect(supervisor.getStatus('p')?.state).toBe('ready');
    expect(countFor(spawnedById, 'p')).toBe(3);

    latest(spawnedById, 'p').resolveExit(CRASH_EXIT);
    await flushAsync();

    expect(supervisor.getStatus('p')?.state).toBe('failed');
    expect(countFor(spawnedById, 'p')).toBe(3);
    expect(clock.pendingCount).toBe(0);
    expect(errors.filter(message => message.includes('maxRestarts'))).toHaveLength(1);
  });

  it('resetAfterMs clears the counter after a healthy run, so a later crash starts from restart 1 again', async () => {
    const clock = createFakeClock();
    const { spawn, spawnedById } = createRecordingSpawn();
    const config = buildConfig({
      id: 'p',
      restart: {
        policy: 'always',
        maxRestarts: 2,
        backoffMs: 100,
        backoffMultiplier: 2,
        maxBackoffMs: 10_000,
        resetAfterMs: 5_000,
      },
    });
    const supervisor = createProcessSupervisor({
      configs: [config],
      phase: 'production',
      clock,
      spawn,
    });
    await supervisor.start();

    // First restart: consumes budget 1/2, delay 100ms.
    latest(spawnedById, 'p').resolveExit(CRASH_EXIT);
    await flushAsync();
    await clock.advance(100);
    await flushAsync();
    expect(supervisor.getStatus('p')?.state).toBe('ready');
    expect(supervisor.getStatus('p')?.restartCount).toBe(1);

    // Stay ready past resetAfterMs: the counter clears back to 0.
    await clock.advance(5_000);
    await flushAsync();
    expect(supervisor.getStatus('p')?.restartCount).toBe(0);

    // A later crash restarts from delay 100ms again (attempt 1), not 200ms (attempt 2).
    latest(spawnedById, 'p').resolveExit(CRASH_EXIT);
    await flushAsync();
    expect(clock.pendingDueTimes).toEqual([clock.now() + 100]);
    expect(supervisor.getStatus('p')?.restartCount).toBe(1);
  });

  it('a resetAfterMs timer from an earlier ready period never leaks into a later rapid crash loop', async () => {
    const clock = createFakeClock();
    const { spawn, spawnedById } = createRecordingSpawn();
    const config = buildConfig({
      id: 'p',
      restart: {
        policy: 'always',
        maxRestarts: 2,
        backoffMs: 10,
        backoffMultiplier: 1,
        maxBackoffMs: 10,
        // Deliberately much longer than the whole rapid-crash sequence below:
        // if the reset timer armed on the FIRST ready were not cancelled on
        // exit, it would still be scheduled to fire mid-loop and wrongly
        // clear restartCount, letting the process restart forever instead of
        // exhausting maxRestarts.
        resetAfterMs: 1_000_000,
      },
    });
    const supervisor = createProcessSupervisor({
      configs: [config],
      phase: 'production',
      clock,
      spawn,
    });
    await supervisor.start();

    // Exactly one resetAfterMs timer is pending while ready.
    expect(clock.pendingCount).toBe(1);

    latest(spawnedById, 'p').resolveExit(CRASH_EXIT);
    await flushAsync();
    // The stale reset timer must be gone the instant the process exits —
    // only the backoff timer remains.
    expect(clock.pendingCount).toBe(1);
    expect(clock.pendingDueTimes).toEqual([clock.now() + 10]);

    await clock.advance(10);
    await flushAsync();
    latest(spawnedById, 'p').resolveExit(CRASH_EXIT);
    await flushAsync();
    await clock.advance(10);
    await flushAsync();
    latest(spawnedById, 'p').resolveExit(CRASH_EXIT);
    await flushAsync();

    // maxRestarts (2) is exhausted by genuinely rapid crashes; the far-future
    // stale timer never got a chance to reset the counter.
    expect(supervisor.getStatus('p')?.state).toBe('failed');
    expect(clock.pendingCount).toBe(0);
  });

  it('resetAfterMs: a slow flap that always stays ready just over resetAfterMs keeps restarting forever, by design', async () => {
    const clock = createFakeClock();
    const { spawn, spawnedById } = createRecordingSpawn();
    const config = buildConfig({
      id: 'p',
      restart: {
        policy: 'always',
        maxRestarts: 2,
        backoffMs: 10,
        backoffMultiplier: 1,
        maxBackoffMs: 10,
        resetAfterMs: 1000,
      },
    });
    const supervisor = createProcessSupervisor({
      configs: [config],
      phase: 'production',
      clock,
      spawn,
    });
    await supervisor.start();

    // Repeat the cycle many more times than maxRestarts would ever allow
    // without a reset, proving the reset (not a missed cap) is what's
    // keeping this alive.
    for (let cycle = 0; cycle < 6; cycle++) {
      // Stay ready for just over resetAfterMs before crashing again.
      await clock.advance(1001);
      await flushAsync();
      expect(supervisor.getStatus('p')?.restartCount).toBe(0);

      latest(spawnedById, 'p').resolveExit(CRASH_EXIT);
      await flushAsync();
      await clock.advance(10);
      await flushAsync();
      expect(supervisor.getStatus('p')?.state).toBe('ready');
    }

    expect(countFor(spawnedById, 'p')).toBe(7);
    expect(supervisor.getStatus('p')?.state).toBe('ready');
  });

  it('restart budgets are per process: one exhausting its budget does not affect another', async () => {
    const clock = createFakeClock();
    const { spawn, spawnedById } = createRecordingSpawn();
    const flappy = buildConfig({
      id: 'flappy',
      restart: {
        policy: 'always',
        maxRestarts: 1,
        backoffMs: 10,
        backoffMultiplier: 1,
        maxBackoffMs: 10,
        resetAfterMs: 1_000_000,
      },
    });
    const steady = buildConfig({
      id: 'steady',
      restart: { ...buildConfig().restart, policy: 'onCrash' },
    });
    const supervisor = createProcessSupervisor({
      configs: [flappy, steady],
      phase: 'production',
      clock,
      spawn,
    });
    await supervisor.start();

    latest(spawnedById, 'flappy').resolveExit(CRASH_EXIT);
    await flushAsync();
    await clock.advance(10);
    await flushAsync();
    latest(spawnedById, 'flappy').resolveExit(CRASH_EXIT);
    await flushAsync();

    expect(supervisor.getStatus('flappy')?.state).toBe('failed');
    expect(supervisor.getStatus('steady')?.state).toBe('ready');
    expect(supervisor.getStatus('steady')?.restartCount).toBe(0);
    expect(countFor(spawnedById, 'steady')).toBe(1);
  });

  it('a spawn failure (rejected exited) is handled as a failed start, not an unhandled rejection', async () => {
    const clock = createFakeClock();
    const { spawn, spawnedById } = createRecordingSpawn();
    const config = buildConfig({ id: 'p', readiness: { kind: 'log', pattern: 'READY' } });
    const supervisor = createProcessSupervisor({
      configs: [config],
      phase: 'production',
      clock,
      spawn,
    });

    const startPromise = supervisor.start();
    await flushAsync();
    latest(spawnedById, 'p').rejectExit(
      new ProcessError('process "p": failed to spawn "node": ENOENT')
    );

    await expect(startPromise).rejects.toThrow(/failed to spawn/);
    expect(supervisor.getStatus('p')?.state).toBe('failed');
  });

  it('stopping/disposing the supervisor cancels pending restart timers and is idempotent', async () => {
    const clock = createFakeClock();
    const { spawn, spawnedById } = createRecordingSpawn();
    const config = buildConfig({
      id: 'p',
      restart: { ...buildConfig().restart, policy: 'always', backoffMs: 500 },
    });
    const supervisor = createProcessSupervisor({
      configs: [config],
      phase: 'production',
      clock,
      spawn,
    });
    await supervisor.start();

    latest(spawnedById, 'p').resolveExit(CLEAN_EXIT);
    await flushAsync();
    expect(supervisor.getStatus('p')?.state).toBe('restarting');
    expect(clock.pendingCount).toBeGreaterThan(0);

    supervisor.dispose();
    expect(clock.pendingCount).toBe(0);
    expect(supervisor.getStatus('p')?.state).toBe('stopped');

    // Idempotent: a second call does nothing and does not throw.
    expect(() => supervisor.dispose()).not.toThrow();
    expect(clock.pendingCount).toBe(0);

    // Advancing the clock past where the cancelled restart would have fired
    // must not spawn again.
    await clock.advance(10_000);
    await flushAsync();
    expect(countFor(spawnedById, 'p')).toBe(1);
  });

  // -------------------------------------------------------------------------
  // getHandles() -- the T2.8/T2.9 composition seam.
  // -------------------------------------------------------------------------

  it('getHandles() returns the live handle for each running process, keyed by id', async () => {
    const clock = createFakeClock();
    const { spawn, spawnedById } = createRecordingSpawn();
    const supervisor = createProcessSupervisor({
      configs: [buildConfig({ id: 'a' }), buildConfig({ id: 'b' })],
      phase: 'production',
      clock,
      spawn,
    });
    await supervisor.start();

    const handles = supervisor.getHandles();

    expect(handles.size).toBe(2);
    expect(handles.get('a')).toBe(latest(spawnedById, 'a').handle);
    expect(handles.get('b')).toBe(latest(spawnedById, 'b').handle);
  });

  it('getHandles() reflects the replacement handle after a restart, never the original', async () => {
    const clock = createFakeClock();
    const { spawn, spawnedById } = createRecordingSpawn();
    const config = buildConfig({
      id: 'p',
      restart: { ...buildConfig().restart, policy: 'onCrash', backoffMs: 50 },
    });
    const supervisor = createProcessSupervisor({
      configs: [config],
      phase: 'production',
      clock,
      spawn,
    });
    await supervisor.start();
    const originalHandle = supervisor.getHandles().get('p');

    latest(spawnedById, 'p').resolveExit(CRASH_EXIT);
    await flushAsync();
    await clock.advance(50);
    await flushAsync();
    expect(supervisor.getStatus('p')?.state).toBe('ready');

    const replacementHandle = supervisor.getHandles().get('p');
    expect(replacementHandle).toBeDefined();
    expect(replacementHandle).not.toBe(originalHandle);
    expect(replacementHandle).toBe(latest(spawnedById, 'p').handle);
  });

  it('getHandles() exposes the handle for a process still waiting on its readiness probe', async () => {
    const clock = createFakeClock();
    const { spawn, spawnedById } = createRecordingSpawn();
    const supervisor = createProcessSupervisor({
      configs: [buildConfig({ id: 'p', readiness: { kind: 'log', pattern: 'READY' } })],
      phase: 'production',
      clock,
      spawn,
    });

    const startPromise = supervisor.start();
    await flushAsync();

    // start() is still pending -- the process never announced readiness --
    // but the real OS process is running and must stay reachable by
    // shutdownAll for exactly that reason.
    expect(supervisor.getHandles().get('p')).toBe(latest(spawnedById, 'p').handle);

    // Settle the attempt so the test leaves no dangling promise.
    latest(spawnedById, 'p').resolveExit(CRASH_EXIT);
    await expect(startPromise).rejects.toThrow();
  });

  it('getHandles() still exposes the handle after a readiness timeout -- the process may still be running', async () => {
    const clock = createFakeClock();
    const { spawn, spawnedById } = createRecordingSpawn();
    const supervisor = createProcessSupervisor({
      configs: [
        buildConfig({
          id: 'slow',
          readiness: { kind: 'log', pattern: 'READY' },
          readinessTimeoutMs: 1000,
        }),
      ],
      phase: 'production',
      clock,
      spawn,
    });

    const startPromise = supervisor.start();
    const assertion = expect(startPromise).rejects.toThrow(/"slow"/);
    await flushAsync();
    clock.advance(1000);
    await flushAsync();
    await assertion;

    expect(supervisor.getStatus('slow')?.state).toBe('failed');
    expect(supervisor.getHandles().get('slow')).toBe(latest(spawnedById, 'slow').handle);
  });

  it('getHandles() omits a process that never successfully spawned', async () => {
    const clock = createFakeClock();
    const { spawn, spawnedById } = createRecordingSpawn();
    const config = buildConfig({ id: 'p', readiness: { kind: 'log', pattern: 'READY' } });
    const supervisor = createProcessSupervisor({
      configs: [config],
      phase: 'production',
      clock,
      spawn,
    });

    const startPromise = supervisor.start();
    await flushAsync();
    latest(spawnedById, 'p').rejectExit(
      new ProcessError('process "p": failed to spawn "node": ENOENT')
    );
    await expect(startPromise).rejects.toThrow(/failed to spawn/);

    expect(supervisor.getHandles().has('p')).toBe(false);
  });

  it('getHandles() omits a stopped process', async () => {
    const clock = createFakeClock();
    const { spawn, spawnedById } = createRecordingSpawn();
    const supervisor = createProcessSupervisor({
      configs: [buildConfig({ id: 'p', restart: { ...buildConfig().restart, policy: 'never' } })],
      phase: 'production',
      clock,
      spawn,
    });
    await supervisor.start();
    expect(supervisor.getHandles().has('p')).toBe(true);

    latest(spawnedById, 'p').resolveExit(CRASH_EXIT);
    await flushAsync();
    expect(supervisor.getStatus('p')?.state).toBe('stopped');

    expect(supervisor.getHandles().has('p')).toBe(false);
  });
});
