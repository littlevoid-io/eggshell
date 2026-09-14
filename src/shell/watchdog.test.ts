import { describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import { createWatchdog } from './watchdog.js';
import type { Logger, LogFields } from '../logging/logger.js';
import { createFakeClock } from '../__testing__/fake-clock.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A fake `WebContents` implementing only `on`/`off`, plus `emit`/`listenerCount`
 * for tests to drive it and assert on `dispose()`'s cleanup. Electron cannot
 * run inside vitest, so every test here exercises this fake, never a real
 * `WebContents` — matches `windows.test.ts`'s established pattern (fakes cast
 * `as never` at the call site).
 */
function createFakeWebContents() {
  const listeners = new Map<string, Set<(...args: never[]) => void>>();

  function listenersFor(event: string): Set<(...args: never[]) => void> {
    let set = listeners.get(event);
    if (set === undefined) {
      set = new Set();
      listeners.set(event, set);
    }
    return set;
  }

  return {
    on(event: string, listener: (...args: never[]) => void) {
      listenersFor(event).add(listener);
    },
    off(event: string, listener: (...args: never[]) => void) {
      listenersFor(event).delete(listener);
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listenersFor(event)) {
        (listener as (...a: unknown[]) => void)(...args);
      }
    },
    listenerCount(event: string): number {
      return listenersFor(event).size;
    },
  };
}

type FakeWebContents = ReturnType<typeof createFakeWebContents>;

function emitRenderProcessGone(fake: FakeWebContents, reason: string, exitCode = 1): void {
  fake.emit('render-process-gone', {}, { reason, exitCode });
}

function emitUnresponsive(fake: FakeWebContents): void {
  fake.emit('unresponsive');
}

function emitResponsive(fake: FakeWebContents): void {
  fake.emit('responsive');
}

function emitDidFailLoad(fake: FakeWebContents, errorCode: number, isMainFrame = true): void {
  fake.emit('did-fail-load', {}, errorCode, 'description', 'https://example.test', isMainFrame);
}

interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  fields: LogFields | undefined;
}

function createCapturingLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const record =
    (level: LogEntry['level']) =>
    (message: string, fields?: LogFields): void => {
      entries.push({ level, message, fields });
    };
  return {
    logger: {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    },
    entries,
  };
}

/** Drains already-resolved promises (the reload callback is always awaited, even when synchronous). No real elapsed time involved. */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

/** Generous Tier 2 sizing so tests not specifically about the global ceiling never trip it. */
const UNBOUNDED_GLOBAL = { maxGlobalReloads: 1000, globalRateWindowMs: 1_000_000 } as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createWatchdog', () => {
  it('reloads after the backoff delay when render-process-gone fires with reason "crashed"', async () => {
    const clock = createFakeClock();
    const reload = vi.fn(() => undefined);
    const watchdog = createWatchdog({
      clock,
      reload,
      backoffMs: 1000,
      maxReloadsPerWindow: 5,
      ...UNBOUNDED_GLOBAL,
    });
    const fake = createFakeWebContents();
    watchdog.attach('main', fake as unknown as WebContents);

    emitRenderProcessGone(fake, 'crashed');
    await flushAsync();
    expect(reload).not.toHaveBeenCalled();

    clock.advance(999);
    await flushAsync();
    expect(reload).not.toHaveBeenCalled();

    clock.advance(1);
    await flushAsync();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith('main', 'render-process-gone:crashed');
  });

  it('shutdown race: "killed" while disarmed (already scheduled or freshly emitted) never reloads', async () => {
    const clock = createFakeClock();
    const reload = vi.fn(() => undefined);
    const watchdog = createWatchdog({
      clock,
      reload,
      backoffMs: 1000,
      maxReloadsPerWindow: 5,
      ...UNBOUNDED_GLOBAL,
    });
    const fake = createFakeWebContents();
    watchdog.attach('main', fake as unknown as WebContents);

    // A reload has already been scheduled (backoff pending) when shutdown
    // begins and calls disarm() — this is the exact race the module doc
    // calls out: disarm() must stop the pending timer from resurrecting a
    // window shutdown is tearing down.
    emitRenderProcessGone(fake, 'killed');
    await flushAsync();
    watchdog.disarm();
    clock.advance(1000);
    await flushAsync();
    expect(reload).not.toHaveBeenCalled();

    // A fresh "killed" arriving after disarm must also never schedule anything.
    emitRenderProcessGone(fake, 'killed');
    await flushAsync();
    clock.runAllPending();
    await flushAsync();
    expect(reload).not.toHaveBeenCalled();
    expect(clock.pendingCount).toBe(0);
  });

  it('unresponsive followed by responsive within the grace period does not reload', async () => {
    const clock = createFakeClock();
    const reload = vi.fn(() => undefined);
    const watchdog = createWatchdog({
      clock,
      reload,
      unresponsiveGraceMs: 8000,
      ...UNBOUNDED_GLOBAL,
    });
    const fake = createFakeWebContents();
    watchdog.attach('main', fake as unknown as WebContents);

    emitUnresponsive(fake);
    expect(watchdog.getStatus('main')?.state).toBe('unresponsive');

    clock.advance(7999);
    emitResponsive(fake);
    expect(watchdog.getStatus('main')?.state).toBe('healthy');

    clock.advance(1);
    await flushAsync();
    expect(reload).not.toHaveBeenCalled();
    expect(clock.pendingCount).toBe(0);
  });

  it('unresponsive with no recovery within the grace period reloads', async () => {
    const clock = createFakeClock();
    const reload = vi.fn(() => undefined);
    const watchdog = createWatchdog({
      clock,
      reload,
      unresponsiveGraceMs: 8000,
      backoffMs: 500,
      ...UNBOUNDED_GLOBAL,
    });
    const fake = createFakeWebContents();
    watchdog.attach('main', fake as unknown as WebContents);

    emitUnresponsive(fake);
    clock.advance(8000);
    await flushAsync();
    expect(reload).not.toHaveBeenCalled(); // grace expired -> now backing off, not yet reloaded
    expect(watchdog.getStatus('main')?.state).toBe('scheduled');

    clock.advance(500);
    await flushAsync();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith('main', 'unresponsive-timeout');
  });

  it('did-fail-load with errorCode -3 (ERR_ABORTED) does not reload', async () => {
    const clock = createFakeClock();
    const reload = vi.fn(() => undefined);
    const watchdog = createWatchdog({ clock, reload, ...UNBOUNDED_GLOBAL });
    const fake = createFakeWebContents();
    watchdog.attach('main', fake as unknown as WebContents);

    emitDidFailLoad(fake, -3, true);
    clock.runAllPending();
    await flushAsync();

    expect(reload).not.toHaveBeenCalled();
    expect(watchdog.getStatus('main')?.state).toBe('healthy');
  });

  it('did-fail-load on a sub-frame logs a warning but does not reload the whole window', async () => {
    const clock = createFakeClock();
    const reload = vi.fn(() => undefined);
    const { logger, entries } = createCapturingLogger();
    const watchdog = createWatchdog({ clock, reload, logger, ...UNBOUNDED_GLOBAL });
    const fake = createFakeWebContents();
    watchdog.attach('main', fake as unknown as WebContents);

    emitDidFailLoad(fake, -6, false);
    clock.runAllPending();
    await flushAsync();

    expect(reload).not.toHaveBeenCalled();
    expect(watchdog.getStatus('main')?.state).toBe('healthy');
    expect(
      entries.some(entry => entry.level === 'warn' && entry.message.includes('sub-frame'))
    ).toBe(true);
  });

  it('backoff sequence matches expectation exactly, including the cap', async () => {
    const clock = createFakeClock();
    const callTimes: number[] = [];
    const reload = vi.fn(() => {
      callTimes.push(clock.now());
      throw new Error('reload failed');
    });
    const watchdog = createWatchdog({
      clock,
      reload,
      backoffMs: 100,
      backoffMultiplier: 3,
      maxBackoffMs: 1000,
      maxReloadsPerWindow: 4,
      ...UNBOUNDED_GLOBAL,
    });
    const fake = createFakeWebContents();
    watchdog.attach('main', fake as unknown as WebContents);

    emitRenderProcessGone(fake, 'crashed');
    // Each attempt's next timer is only armed after an `await` inside
    // `runAttempt` resolves, one microtask hop after the fake clock's
    // synchronous `runAllPending()` loop already finished looking for due
    // timers — so each attempt needs its own runAllPending()/flush pair.
    for (let i = 0; i < 4; i++) {
      clock.runAllPending();
      await flushAsync();
    }

    // attempt 1: 100 -> attempt 2: 300 -> attempt 3: 900 -> attempt 4: capped at 1000 (not 2700)
    expect(callTimes).toEqual([100, 400, 1300, 2300]);
    expect(watchdog.getStatus('main')?.state).toBe('failed');
    expect(watchdog.getStatus('main')?.reloadCount).toBe(4);
  });

  it('per-window budgets are independent: one window exhausting its budget does not affect another', async () => {
    const clock = createFakeClock();
    const reloadA = vi.fn((windowId: string) => {
      throw new Error(`${windowId} always fails`);
    });
    const reloadB = vi.fn((windowId: string): void => {
      expect(windowId).toBe('b');
    });
    const reload = vi.fn((windowId: string) =>
      windowId === 'a' ? reloadA(windowId) : reloadB(windowId)
    );
    const watchdog = createWatchdog({
      clock,
      reload,
      backoffMs: 10,
      maxReloadsPerWindow: 2,
      ...UNBOUNDED_GLOBAL,
    });
    const fakeA = createFakeWebContents();
    const fakeB = createFakeWebContents();
    watchdog.attach('a', fakeA as unknown as WebContents);
    watchdog.attach('b', fakeB as unknown as WebContents);

    emitRenderProcessGone(fakeA, 'crashed');
    clock.runAllPending();
    await flushAsync();
    clock.runAllPending();
    await flushAsync();

    expect(watchdog.getStatus('a')?.state).toBe('failed');
    expect(reloadA).toHaveBeenCalledTimes(2);

    // b is untouched by a's exhaustion and still recovers normally.
    emitRenderProcessGone(fakeB, 'crashed');
    clock.advance(10);
    await flushAsync();
    expect(reloadB).toHaveBeenCalledTimes(1);
    expect(watchdog.getStatus('b')?.state).toBe('healthy');
  });

  it('exhaustion stops permanently, logs once at error, sets a terminal state, and leaves no pending timers', async () => {
    const clock = createFakeClock();
    const { logger, entries } = createCapturingLogger();
    const reload = vi.fn(() => {
      throw new Error('always fails');
    });
    const watchdog = createWatchdog({
      clock,
      reload,
      logger,
      backoffMs: 10,
      maxReloadsPerWindow: 1,
      ...UNBOUNDED_GLOBAL,
    });
    const fake = createFakeWebContents();
    watchdog.attach('main', fake as unknown as WebContents);

    emitRenderProcessGone(fake, 'crashed');
    clock.runAllPending();
    await flushAsync();

    expect(watchdog.getStatus('main')?.state).toBe('failed');
    expect(clock.pendingCount).toBe(0);
    const errorEntries = entries.filter(entry => entry.level === 'error');
    expect(errorEntries).toHaveLength(1);
    expect(errorEntries[0]!.message).toContain('giving up reloading window');

    // A further event while still within the quiet period stays blocklisted and adds no timers.
    emitRenderProcessGone(fake, 'crashed');
    await flushAsync();
    expect(clock.pendingCount).toBe(0);
    expect(entries.filter(entry => entry.level === 'error')).toHaveLength(1);
  });

  it('the global rolling ceiling trips even when no single window exhausts its own budget', async () => {
    const clock = createFakeClock();
    const { logger, entries } = createCapturingLogger();
    const reload = vi.fn(() => undefined);
    const watchdog = createWatchdog({
      clock,
      reload,
      logger,
      backoffMs: 10,
      maxReloadsPerWindow: 10,
      maxGlobalReloads: 3,
      globalRateWindowMs: 1_000_000,
    });
    const fakes = ['a', 'b', 'c'].map(id => {
      const fake = createFakeWebContents();
      watchdog.attach(id, fake as unknown as WebContents);
      return { id, fake };
    });

    // Three windows each get exactly one successful reload attempt, consuming
    // the entire Tier 2 budget (3) without any single window coming close to
    // its own generous per-window budget (10).
    for (const { fake } of fakes) {
      emitRenderProcessGone(fake, 'crashed');
      clock.advance(10);
      await flushAsync();
    }
    expect(reload).toHaveBeenCalledTimes(3);
    expect(watchdog.globallyRateLimited).toBe(false);

    // A fourth attempt (window "a" crashing again) is suspended by Tier 2,
    // even though "a" itself has only made one attempt so far. This is its
    // second attempt, so the backoff (default multiplier 2) has grown to 20ms.
    emitRenderProcessGone(fakes[0]!.fake, 'crashed');
    clock.advance(20);
    await flushAsync();

    expect(reload).toHaveBeenCalledTimes(3);
    expect(watchdog.globallyRateLimited).toBe(true);
    expect(watchdog.getStatus('a')?.state).toBe('suspended');
    expect(watchdog.getStatus('a')?.reloadCount).toBe(1); // the suspended attempt never counted
    const errorEntries = entries.filter(entry => entry.level === 'error');
    expect(errorEntries).toHaveLength(1);
    expect(errorEntries[0]!.message).toContain('giving up globally');
  });

  it('self-healing: a window given up on regains eligibility after a genuinely quiet period', async () => {
    const clock = createFakeClock();
    const reloadCalls: string[] = [];
    let shouldFail = true;
    const reload = vi.fn((windowId: string, reason: string) => {
      reloadCalls.push(reason);
      if (shouldFail) {
        throw new Error('failing for now');
      }
    });
    const watchdog = createWatchdog({
      clock,
      reload,
      backoffMs: 10,
      maxReloadsPerWindow: 1,
      healthyResetMs: 500,
      ...UNBOUNDED_GLOBAL,
    });
    const fake = createFakeWebContents();
    watchdog.attach('main', fake as unknown as WebContents);

    emitRenderProcessGone(fake, 'crashed');
    clock.runAllPending();
    await flushAsync();
    expect(watchdog.getStatus('main')?.state).toBe('failed');

    // Just short of the quiet period: still blocklisted, no new attempt.
    clock.advance(499);
    emitRenderProcessGone(fake, 'crashed');
    await flushAsync();
    expect(watchdog.getStatus('main')?.state).toBe('failed');
    expect(reloadCalls).toHaveLength(1);

    // One more ms crosses the threshold: eligibility restored, and this
    // crash is handled as a fresh attempt (through the normal backoff).
    clock.advance(1);
    shouldFail = false;
    emitRenderProcessGone(fake, 'crashed');
    expect(watchdog.getStatus('main')?.state).toBe('scheduled');
    clock.advance(10);
    await flushAsync();

    expect(reloadCalls).toHaveLength(2);
    expect(watchdog.getStatus('main')?.state).toBe('healthy');
    expect(watchdog.getStatus('main')?.reloadCount).toBe(1);
  });

  it('dispose() detaches listeners, cancels pending timers, and is idempotent', async () => {
    const clock = createFakeClock();
    const reload = vi.fn(() => undefined);
    const watchdog = createWatchdog({ clock, reload, backoffMs: 1000, ...UNBOUNDED_GLOBAL });
    const fakeA = createFakeWebContents();
    const fakeB = createFakeWebContents();
    watchdog.attach('a', fakeA as unknown as WebContents);
    watchdog.attach('b', fakeB as unknown as WebContents);

    // Leave a reload scheduled (a pending timer) at dispose time.
    emitRenderProcessGone(fakeA, 'crashed');
    await flushAsync();
    expect(clock.pendingCount).toBeGreaterThan(0);

    watchdog.dispose();

    expect(clock.pendingCount).toBe(0);
    for (const event of ['render-process-gone', 'unresponsive', 'responsive', 'did-fail-load']) {
      expect(fakeA.listenerCount(event)).toBe(0);
      expect(fakeB.listenerCount(event)).toBe(0);
    }

    // Idempotent: calling again does not throw and changes nothing further.
    expect(() => watchdog.dispose()).not.toThrow();
    expect(clock.pendingCount).toBe(0);

    // Events after dispose are inert (armed was also cleared).
    emitRenderProcessGone(fakeA, 'crashed');
    clock.runAllPending();
    await flushAsync();
    expect(reload).not.toHaveBeenCalled();
  });
});
