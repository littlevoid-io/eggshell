import { describe, it, expect, vi } from 'vitest';
import { createTopologySupervisor } from './supervisor.js';
import type { DisplaySnapshot } from './types.js';
import type { Logger, LogFields } from '../logging/logger.js';
import { createFakeClock, type FakeClock } from '../__testing__/fake-clock.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function buildDisplay(overrides: Partial<DisplaySnapshot> = {}): DisplaySnapshot {
  return {
    id: 1,
    primary: true,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    scaleFactor: 1,
    rotation: 0,
    internal: false,
    label: 'Display 1',
    touchSupport: 'unknown',
    colorDepth: 24,
    displayFrequency: 60,
    ...overrides,
  };
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

/**
 * Every test below sizes Tier 2 (the global rate ceiling) generously unless
 * it is specifically testing Tier 2, so the two circuit breakers can be
 * exercised independently.
 */
const UNBOUNDED_RATE_OPTIONS = { maxGlobalAttempts: 1000, globalRateWindowMs: 1_000_000 } as const;

/**
 * `apply`/`verify` are awaited internally even when synchronous (the
 * supervisor must handle both), which means each phase needs a microtask
 * flush before its result is observable. None of this depends on real
 * elapsed time — it drains already-resolved promises, it does not wait on a
 * timer.
 */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

/** Drives exactly one attempt (debounce/retry wait -> apply -> verifyDelayMs -> verify) to completion. */
async function driveOneAttempt(
  clock: FakeClock,
  debounceMs: number,
  verifyDelayMs: number
): Promise<void> {
  clock.advance(debounceMs);
  await flushAsync();
  clock.advance(verifyDelayMs);
  await flushAsync();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createTopologySupervisor', () => {
  it('triggers exactly one apply after debounceMs for a single new topology, not before', () => {
    const clock = createFakeClock();
    const apply = vi.fn(() => undefined);
    const verify = vi.fn(() => true);
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs: 100,
      maxAttemptsPerTopology: 3,
      verifyDelayMs: 10,
      ...UNBOUNDED_RATE_OPTIONS,
    });

    supervisor.onDisplaysChanged([buildDisplay()]);
    clock.advance(99);
    expect(apply).not.toHaveBeenCalled();

    clock.advance(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('does not fire at debounceMs - 1 but fires exactly one ms later', () => {
    const clock = createFakeClock();
    const apply = vi.fn(() => undefined);
    const verify = vi.fn(() => true);
    const debounceMs = 100;
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      maxAttemptsPerTopology: 3,
      verifyDelayMs: 10,
      ...UNBOUNDED_RATE_OPTIONS,
    });

    supervisor.onDisplaysChanged([buildDisplay()]);
    clock.advance(debounceMs - 1);
    expect(apply).not.toHaveBeenCalled();

    clock.advance(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst of 20 identical-signature events into exactly one apply (the recovery-cascade regression)', () => {
    const clock = createFakeClock();
    const apply = vi.fn(() => undefined);
    const verify = vi.fn(() => true);
    const debounceMs = 50;
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      maxAttemptsPerTopology: 3,
      verifyDelayMs: 10,
      ...UNBOUNDED_RATE_OPTIONS,
    });

    const displays = [buildDisplay()];
    for (let i = 0; i < 20; i++) {
      supervisor.onDisplaysChanged(displays);
    }

    clock.advance(debounceMs);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of 20 differing signatures into one apply per debounce window, using the latest displays', () => {
    const clock = createFakeClock();
    const apply = vi.fn(() => undefined);
    const verify = vi.fn(() => true);
    const debounceMs = 50;
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      maxAttemptsPerTopology: 3,
      verifyDelayMs: 10,
      ...UNBOUNDED_RATE_OPTIONS,
    });

    let latest!: DisplaySnapshot[];
    for (let i = 0; i < 20; i++) {
      latest = [buildDisplay({ label: `Display ${i}` })];
      supervisor.onDisplaysChanged(latest);
    }

    clock.advance(debounceMs);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(latest);
  });

  it('settles after a successful verify and drops a repeat event with the same signature', async () => {
    const clock = createFakeClock();
    const apply = vi.fn(() => undefined);
    const verify = vi.fn(() => true);
    const debounceMs = 10;
    const verifyDelayMs = 5;
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      maxAttemptsPerTopology: 3,
      verifyDelayMs,
      ...UNBOUNDED_RATE_OPTIONS,
    });
    const displays = [buildDisplay()];

    supervisor.onDisplaysChanged(displays);
    await driveOneAttempt(clock, debounceMs, verifyDelayMs);
    expect(supervisor.state).toBe('settled');
    expect(apply).toHaveBeenCalledTimes(1);

    supervisor.onDisplaysChanged(displays);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(clock.pendingCount).toBe(0);
  });

  it('triggers a new apply for a 1px workArea change after settling (dedup is not over-eager)', async () => {
    const clock = createFakeClock();
    const apply = vi.fn(() => undefined);
    const verify = vi.fn(() => true);
    const debounceMs = 10;
    const verifyDelayMs = 5;
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      maxAttemptsPerTopology: 3,
      verifyDelayMs,
      ...UNBOUNDED_RATE_OPTIONS,
    });

    supervisor.onDisplaysChanged([buildDisplay()]);
    await driveOneAttempt(clock, debounceMs, verifyDelayMs);
    expect(apply).toHaveBeenCalledTimes(1);

    const changed = [buildDisplay({ workArea: { x: 0, y: 0, width: 1920, height: 1039 } })];
    supervisor.onDisplaysChanged(changed);
    clock.advance(debounceMs);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenNthCalledWith(2, changed);
  });

  it('reaches givenUp (reason: topology) after exactly maxAttemptsPerTopology failed applies, logging error exactly once', async () => {
    const clock = createFakeClock();
    const { logger, entries } = createCapturingLogger();
    const apply = vi.fn(() => undefined);
    const verify = vi.fn(() => false);
    const maxAttemptsPerTopology = 3;
    const debounceMs = 50;
    const verifyDelayMs = 10;
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      maxAttemptsPerTopology,
      verifyDelayMs,
      ...UNBOUNDED_RATE_OPTIONS,
      logger,
    });

    supervisor.onDisplaysChanged([buildDisplay()]);
    for (let i = 0; i < maxAttemptsPerTopology; i++) {
      await driveOneAttempt(clock, debounceMs, verifyDelayMs);
    }

    expect(apply).toHaveBeenCalledTimes(maxAttemptsPerTopology);
    expect(supervisor.state).toBe('givenUp');
    expect(supervisor.givenUpReason).toBe('topology');
    expect(supervisor.attempts).toBe(maxAttemptsPerTopology);
    expect(entries.filter(e => e.level === 'error')).toHaveLength(1);
  });

  it('leaves zero timers pending on the fake clock after givenUp (the anti-cascade assertion)', async () => {
    const clock = createFakeClock();
    const apply = vi.fn(() => undefined);
    const verify = vi.fn(() => false);
    const maxAttemptsPerTopology = 3;
    const debounceMs = 50;
    const verifyDelayMs = 10;
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      maxAttemptsPerTopology,
      verifyDelayMs,
      ...UNBOUNDED_RATE_OPTIONS,
    });

    supervisor.onDisplaysChanged([buildDisplay()]);
    for (let i = 0; i < maxAttemptsPerTopology; i++) {
      await driveOneAttempt(clock, debounceMs, verifyDelayMs);
    }

    expect(supervisor.state).toBe('givenUp');
    expect(clock.pendingCount).toBe(0);
  });

  it('drops further same-signature events after a topology give-up; a new signature proceeds immediately with its own attempt count', async () => {
    const clock = createFakeClock();
    const apply = vi.fn(() => undefined);
    const verify = vi.fn(() => false);
    const maxAttemptsPerTopology = 3;
    const debounceMs = 10;
    const verifyDelayMs = 5;
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      maxAttemptsPerTopology,
      verifyDelayMs,
      ...UNBOUNDED_RATE_OPTIONS,
    });

    const displaysA = [buildDisplay({ id: 1 })];
    supervisor.onDisplaysChanged(displaysA);
    for (let i = 0; i < maxAttemptsPerTopology; i++) {
      await driveOneAttempt(clock, debounceMs, verifyDelayMs);
    }
    expect(supervisor.state).toBe('givenUp');
    apply.mockClear();

    supervisor.onDisplaysChanged(displaysA);
    clock.advance(debounceMs + verifyDelayMs + 10);
    await flushAsync();
    expect(apply).not.toHaveBeenCalled();
    expect(supervisor.state).toBe('givenUp');

    verify.mockImplementation(() => true);
    const displaysB = [buildDisplay({ id: 2 })];
    supervisor.onDisplaysChanged(displaysB);
    clock.advance(debounceMs);
    expect(supervisor.attempts).toBe(1); // B's own count, independent of A's exhausted ledger entry
    await flushAsync();
    clock.advance(verifyDelayMs);
    await flushAsync();

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(displaysB);
    expect(supervisor.state).toBe('settled');
  });

  it('keeps a given-up topology blocklisted even after a different topology is visited in between (per-signature stickiness)', async () => {
    const clock = createFakeClock();
    const displaysA = [buildDisplay({ id: 1 })];
    const displaysB = [buildDisplay({ id: 2 })];
    const apply = vi.fn(() => undefined);
    const verify = vi.fn((displays: readonly DisplaySnapshot[]) => displays !== displaysA);
    const maxAttemptsPerTopology = 2;
    const debounceMs = 10;
    const verifyDelayMs = 5;
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      maxAttemptsPerTopology,
      verifyDelayMs,
      ...UNBOUNDED_RATE_OPTIONS,
    });

    supervisor.onDisplaysChanged(displaysA);
    for (let i = 0; i < maxAttemptsPerTopology; i++) {
      await driveOneAttempt(clock, debounceMs, verifyDelayMs);
    }
    expect(supervisor.state).toBe('givenUp');
    expect(supervisor.givenUpReason).toBe('topology');
    apply.mockClear();

    // Visiting B succeeds fine — a different topology is not blocked by A's give-up.
    supervisor.onDisplaysChanged(displaysB);
    await driveOneAttempt(clock, debounceMs, verifyDelayMs);
    expect(supervisor.state).toBe('settled');
    expect(apply).toHaveBeenCalledWith(displaysB);
    apply.mockClear();

    // Returning to A must stay blocklisted — dropping leaves state untouched (still 'settled' from B).
    supervisor.onDisplaysChanged(displaysA);
    clock.advance(debounceMs + verifyDelayMs + 10);
    await flushAsync();
    expect(apply).not.toHaveBeenCalled();
    expect(supervisor.state).toBe('settled');
  });

  it('accumulates attempts per signature even when a different signature is interleaved between failures', async () => {
    const clock = createFakeClock();
    const displaysA = [buildDisplay({ id: 1 })];
    const displaysB = [buildDisplay({ id: 2 })];
    const apply = vi.fn((displays: readonly DisplaySnapshot[]): void => {
      void displays;
    });
    const verify = vi.fn((displays: readonly DisplaySnapshot[]) => displays !== displaysA);
    const maxAttemptsPerTopology = 3;
    const debounceMs = 10;
    const verifyDelayMs = 5;
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      maxAttemptsPerTopology,
      verifyDelayMs,
      ...UNBOUNDED_RATE_OPTIONS,
    });

    supervisor.onDisplaysChanged(displaysA);
    await driveOneAttempt(clock, debounceMs, verifyDelayMs); // A attempt #1, fails
    expect(supervisor.state).toBe('scheduled');

    supervisor.onDisplaysChanged(displaysB); // interleave B: succeeds, independent ledger entry
    await driveOneAttempt(clock, debounceMs, verifyDelayMs);
    expect(supervisor.state).toBe('settled');

    supervisor.onDisplaysChanged(displaysA);
    await driveOneAttempt(clock, debounceMs, verifyDelayMs); // A attempt #2, fails
    await driveOneAttempt(clock, debounceMs, verifyDelayMs); // A attempt #3, fails -> exceeds budget

    expect(supervisor.state).toBe('givenUp');
    expect(supervisor.givenUpReason).toBe('topology');
    const attemptsAgainstA = apply.mock.calls.filter(call => call[0] === displaysA).length;
    expect(attemptsAgainstA).toBe(maxAttemptsPerTopology);
  });

  it('enters givenUp (reason: topology) once giveUpAfterMs elapses mid-cycle, even though attempts < maxAttemptsPerTopology', async () => {
    const clock = createFakeClock();
    const { logger, entries } = createCapturingLogger();
    const apply = vi.fn(() => undefined);
    const verify = vi.fn(() => false);
    const debounceMs = 100;
    const verifyDelayMs = 50;
    const giveUpAfterMs = 200;
    const maxAttemptsPerTopology = 10;
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      maxAttemptsPerTopology,
      verifyDelayMs,
      giveUpAfterMs,
      ...UNBOUNDED_RATE_OPTIONS,
      logger,
    });

    supervisor.onDisplaysChanged([buildDisplay()]);
    await driveOneAttempt(clock, debounceMs, verifyDelayMs); // elapsed 150ms < 200ms
    expect(supervisor.state).toBe('scheduled');
    expect(supervisor.attempts).toBe(1);

    await driveOneAttempt(clock, debounceMs, verifyDelayMs); // elapsed 300ms >= 200ms
    expect(supervisor.state).toBe('givenUp');
    expect(supervisor.givenUpReason).toBe('topology');
    expect(supervisor.attempts).toBeLessThan(maxAttemptsPerTopology);
    expect(entries.filter(e => e.level === 'error')).toHaveLength(1);
  });

  it('does not start a concurrent cycle for an event during applying; processes it once the current cycle completes', async () => {
    const clock = createFakeClock();
    const displaysA = [buildDisplay({ id: 1 })];
    const displaysB = [buildDisplay({ id: 2 })];
    let concurrent = 0;
    let maxConcurrent = 0;
    const supervisorRef: { current?: ReturnType<typeof createTopologySupervisor> } = {};

    const apply = vi.fn(async (displays: readonly DisplaySnapshot[]) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      if (displays === displaysA) {
        // Fired synchronously while state is still 'applying'.
        supervisorRef.current?.onDisplaysChanged(displaysB);
      }
      await Promise.resolve();
      concurrent--;
    });
    const verify = vi.fn(() => true);
    const debounceMs = 10;
    const verifyDelayMs = 5;

    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      maxAttemptsPerTopology: 3,
      verifyDelayMs,
      ...UNBOUNDED_RATE_OPTIONS,
    });
    supervisorRef.current = supervisor;

    supervisor.onDisplaysChanged(displaysA);
    await driveOneAttempt(clock, debounceMs, verifyDelayMs);
    expect(supervisor.state).toBe('scheduled'); // cycle B was queued during cycle A

    await driveOneAttempt(clock, debounceMs, verifyDelayMs);
    expect(supervisor.state).toBe('settled');

    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenNthCalledWith(1, displaysA);
    expect(apply).toHaveBeenNthCalledWith(2, displaysB);
    expect(maxConcurrent).toBe(1);
  });

  it('acts on a mid-cycle revert to the prior settled topology once the current cycle completes', async () => {
    const clock = createFakeClock();
    const displaysA = [buildDisplay({ id: 1 })];
    const displaysB = [buildDisplay({ id: 2 })];
    const apply = vi.fn(() => undefined);
    const verify = vi.fn(() => true);
    const debounceMs = 10;
    const verifyDelayMs = 5;
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      maxAttemptsPerTopology: 3,
      verifyDelayMs,
      ...UNBOUNDED_RATE_OPTIONS,
    });

    supervisor.onDisplaysChanged(displaysA);
    await driveOneAttempt(clock, debounceMs, verifyDelayMs);
    expect(supervisor.state).toBe('settled');
    apply.mockClear();

    supervisor.onDisplaysChanged(displaysB);
    clock.advance(debounceMs); // apply(B) starts synchronously
    expect(apply).toHaveBeenCalledTimes(1);

    // A genuine hardware revert to the previously-settled topology (A) arrives
    // mid-'applying'. It must be recorded, not dropped, even though it
    // matches `lastSettledSignature` (which is still A at this instant).
    supervisor.onDisplaysChanged(displaysA);
    await flushAsync();
    clock.advance(verifyDelayMs);
    await flushAsync();

    // B's cycle settled; the queued revert to A differs from what was just
    // settled (B), so a fresh cycle for A starts immediately.
    expect(supervisor.state).toBe('scheduled');
    await driveOneAttempt(clock, debounceMs, verifyDelayMs);
    expect(supervisor.state).toBe('settled');

    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenNthCalledWith(1, displaysB);
    expect(apply).toHaveBeenNthCalledWith(2, displaysA);
  });

  it('does not re-apply when a mid-cycle event merely echoes the topology the cycle is about to settle on', async () => {
    const clock = createFakeClock();
    const displays = [buildDisplay()];
    const apply = vi.fn(() => undefined);
    const verify = vi.fn(() => true);
    const debounceMs = 10;
    const verifyDelayMs = 5;
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      maxAttemptsPerTopology: 3,
      verifyDelayMs,
      ...UNBOUNDED_RATE_OPTIONS,
    });

    supervisor.onDisplaysChanged(displays);
    clock.advance(debounceMs); // apply() starts synchronously
    expect(apply).toHaveBeenCalledTimes(1);

    supervisor.onDisplaysChanged(displays); // echo of the in-flight target, mid-'applying'
    await flushAsync();
    clock.advance(verifyDelayMs);
    await flushAsync();

    expect(supervisor.state).toBe('settled');
    expect(apply).toHaveBeenCalledTimes(1); // the echo did not trigger a second apply
    expect(clock.pendingCount).toBe(0);
  });

  it('treats a rejecting apply as a failed attempt, logs warn, and still reaches givenUp', async () => {
    const clock = createFakeClock();
    const { logger, entries } = createCapturingLogger();
    const apply = vi.fn(() => Promise.reject(new Error('apply boom')));
    const verify = vi.fn(() => true);
    const maxAttemptsPerTopology = 2;
    const debounceMs = 10;
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      maxAttemptsPerTopology,
      verifyDelayMs: 5,
      ...UNBOUNDED_RATE_OPTIONS,
      logger,
    });

    supervisor.onDisplaysChanged([buildDisplay()]);
    for (let i = 0; i < maxAttemptsPerTopology; i++) {
      clock.advance(debounceMs);
      await flushAsync();
    }

    expect(apply).toHaveBeenCalledTimes(maxAttemptsPerTopology);
    expect(verify).not.toHaveBeenCalled();
    expect(supervisor.state).toBe('givenUp');
    expect(supervisor.givenUpReason).toBe('topology');
    const warnLogs = entries.filter(e => e.level === 'warn');
    expect(warnLogs).toHaveLength(maxAttemptsPerTopology);
    expect(warnLogs[0]?.message).toMatch(/apply threw/i);
  });

  it('treats a synchronously-throwing verify identically to a failed verify', async () => {
    const clock = createFakeClock();
    const { logger, entries } = createCapturingLogger();
    const apply = vi.fn(() => undefined);
    const verify = vi.fn(() => {
      throw new Error('verify boom');
    });
    const maxAttemptsPerTopology = 2;
    const debounceMs = 10;
    const verifyDelayMs = 5;
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      maxAttemptsPerTopology,
      verifyDelayMs,
      ...UNBOUNDED_RATE_OPTIONS,
      logger,
    });

    supervisor.onDisplaysChanged([buildDisplay()]);
    for (let i = 0; i < maxAttemptsPerTopology; i++) {
      await driveOneAttempt(clock, debounceMs, verifyDelayMs);
    }

    expect(apply).toHaveBeenCalledTimes(maxAttemptsPerTopology);
    expect(supervisor.state).toBe('givenUp');
    const warnLogs = entries.filter(e => e.level === 'warn');
    expect(warnLogs).toHaveLength(maxAttemptsPerTopology);
    expect(warnLogs[0]?.message).toMatch(/verify threw/i);
  });

  it('dispose cancels pending timers, prevents further applies, and is idempotent', () => {
    const clock = createFakeClock();
    const apply = vi.fn(() => undefined);
    const verify = vi.fn(() => true);
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs: 50,
      maxAttemptsPerTopology: 3,
      verifyDelayMs: 10,
      ...UNBOUNDED_RATE_OPTIONS,
    });

    supervisor.onDisplaysChanged([buildDisplay()]);
    expect(clock.pendingCount).toBe(1);

    supervisor.dispose();
    expect(clock.pendingCount).toBe(0);

    clock.advance(1000);
    expect(apply).not.toHaveBeenCalled();

    supervisor.onDisplaysChanged([buildDisplay({ id: 2 })]);
    expect(clock.pendingCount).toBe(0);
    expect(apply).not.toHaveBeenCalled();

    expect(() => supervisor.dispose()).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Tier 2: global rolling-rate ceiling
  // -------------------------------------------------------------------------

  it('caps total apply calls under a persistent A/B flap via the global rate ceiling (the flap regression)', async () => {
    const clock = createFakeClock();
    const apply = vi.fn(() => undefined);
    const verify = vi.fn(() => false); // permanently failing
    const debounceMs = 10;
    const verifyDelayMs = 5;
    const maxAttemptsPerTopology = 100; // high enough that Tier 1 alone would never trip
    const maxGlobalAttempts = 6;
    const globalRateWindowMs = 100_000; // effectively unbounded for this test's timeframe
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      verifyDelayMs,
      maxAttemptsPerTopology,
      maxGlobalAttempts,
      globalRateWindowMs,
    });

    const displaysA = [buildDisplay({ id: 1 })];
    const displaysB = [buildDisplay({ id: 2 })];

    supervisor.onDisplaysChanged(displaysA);
    for (let i = 0; i < 20; i++) {
      clock.advance(debounceMs);
      await flushAsync();
      clock.advance(verifyDelayMs);
      await flushAsync();
      // Flap to the other topology right after each failed verify, before
      // the retry timer would otherwise fire with the same signature.
      supervisor.onDisplaysChanged(i % 2 === 0 ? displaysB : displaysA);
    }

    expect(apply).toHaveBeenCalledTimes(maxGlobalAttempts);
    expect(supervisor.state).toBe('givenUp');
    expect(supervisor.givenUpReason).toBe('rate');
    expect(clock.pendingCount).toBe(0);
  });

  it('trips the global ceiling even when every signature is distinct and none individually exhausts its per-topology budget', async () => {
    const clock = createFakeClock();
    const apply = vi.fn(() => undefined);
    const verify = vi.fn(() => true); // every attempt succeeds
    const debounceMs = 5;
    const verifyDelayMs = 5;
    const maxGlobalAttempts = 5;
    const globalRateWindowMs = 100_000;
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      verifyDelayMs,
      maxAttemptsPerTopology: 100,
      maxGlobalAttempts,
      globalRateWindowMs,
    });

    for (let i = 0; i < 6; i++) {
      supervisor.onDisplaysChanged([buildDisplay({ label: `Distinct ${i}` })]);
      clock.advance(debounceMs);
      await flushAsync();
      clock.advance(verifyDelayMs);
      await flushAsync();
    }

    expect(apply).toHaveBeenCalledTimes(maxGlobalAttempts);
    expect(supervisor.state).toBe('givenUp');
    expect(supervisor.givenUpReason).toBe('rate');
  });

  it('re-arms once the rolling window drains after real quiet following a rate trip', async () => {
    const clock = createFakeClock();
    const apply = vi.fn(() => undefined);
    const verify = vi.fn(() => true);
    const debounceMs = 5;
    const verifyDelayMs = 5;
    const maxGlobalAttempts = 3;
    const globalRateWindowMs = 1000;
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      verifyDelayMs,
      maxAttemptsPerTopology: 100,
      maxGlobalAttempts,
      globalRateWindowMs,
    });

    for (let i = 0; i < maxGlobalAttempts; i++) {
      supervisor.onDisplaysChanged([buildDisplay({ label: `D${i}` })]);
      await driveOneAttempt(clock, debounceMs, verifyDelayMs);
    }
    supervisor.onDisplaysChanged([buildDisplay({ label: 'blocked' })]);
    clock.advance(debounceMs);
    expect(supervisor.state).toBe('givenUp');
    expect(supervisor.givenUpReason).toBe('rate');
    apply.mockClear();

    // Real quiet: advance well past globalRateWindowMs with no events at all.
    clock.advance(globalRateWindowMs + 1);

    supervisor.onDisplaysChanged([buildDisplay({ label: 'after-quiet' })]);
    clock.advance(debounceMs);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(supervisor.givenUpReason).toBeUndefined();
  });

  it('stays rate-given-up while continued events keep the window full', async () => {
    const clock = createFakeClock();
    const apply = vi.fn(() => undefined);
    const verify = vi.fn(() => true);
    const debounceMs = 5;
    const verifyDelayMs = 5;
    const maxGlobalAttempts = 2;
    const globalRateWindowMs = 1000;
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      verifyDelayMs,
      maxAttemptsPerTopology: 100,
      maxGlobalAttempts,
      globalRateWindowMs,
    });

    for (let i = 0; i < maxGlobalAttempts; i++) {
      supervisor.onDisplaysChanged([buildDisplay({ label: `D${i}` })]);
      await driveOneAttempt(clock, debounceMs, verifyDelayMs);
    }
    supervisor.onDisplaysChanged([buildDisplay({ label: 'blocked-1' })]);
    clock.advance(debounceMs);
    expect(supervisor.state).toBe('givenUp');
    apply.mockClear();

    // A short pause — not enough to drain the window — then another event.
    clock.advance(1);
    supervisor.onDisplaysChanged([buildDisplay({ label: 'blocked-2' })]);
    expect(apply).not.toHaveBeenCalled();
    expect(supervisor.state).toBe('givenUp');
    expect(supervisor.givenUpReason).toBe('rate');
  });

  it('bounds total attempts via Tier 2 even when LRU eviction forgets an earlier given-up topology', async () => {
    const clock = createFakeClock();
    const apply = vi.fn(() => undefined);
    const verify = vi.fn(() => false); // everything fails
    const debounceMs = 5;
    const verifyDelayMs = 5;
    const maxAttemptsPerTopology = 1; // give up immediately after one failed attempt per signature
    const maxGlobalAttempts = 10;
    const globalRateWindowMs = 1_000_000; // never drains within this test
    const supervisor = createTopologySupervisor({
      clock,
      apply,
      verify,
      debounceMs,
      verifyDelayMs,
      maxAttemptsPerTopology,
      maxGlobalAttempts,
      globalRateWindowMs,
    });

    // 15 distinct signatures is more than the ledger's 8-entry bound, so
    // early given-up entries get evicted (forgotten) well before the loop
    // ends. Tier 2 must still cap total attempts regardless.
    for (let i = 0; i < 15; i++) {
      supervisor.onDisplaysChanged([buildDisplay({ label: `Distinct ${i}` })]);
      await driveOneAttempt(clock, debounceMs, verifyDelayMs);
    }

    expect(apply).toHaveBeenCalledTimes(maxGlobalAttempts);
    expect(supervisor.state).toBe('givenUp');
    expect(supervisor.givenUpReason).toBe('rate');
  });

  it('logs a distinguishable error message for each give-up reason and exposes it via givenUpReason', async () => {
    const clock1 = createFakeClock();
    const { logger: logger1, entries: entries1 } = createCapturingLogger();
    const apply1 = vi.fn(() => undefined);
    const verify1 = vi.fn(() => false);
    const maxAttemptsPerTopology = 2;
    const s1 = createTopologySupervisor({
      clock: clock1,
      apply: apply1,
      verify: verify1,
      debounceMs: 10,
      verifyDelayMs: 5,
      maxAttemptsPerTopology,
      ...UNBOUNDED_RATE_OPTIONS,
      logger: logger1,
    });
    s1.onDisplaysChanged([buildDisplay()]);
    for (let i = 0; i < maxAttemptsPerTopology; i++) {
      await driveOneAttempt(clock1, 10, 5);
    }
    expect(s1.givenUpReason).toBe('topology');
    const topologyErrorLogs = entries1.filter(e => e.level === 'error');
    expect(topologyErrorLogs).toHaveLength(1);

    const clock2 = createFakeClock();
    const { logger: logger2, entries: entries2 } = createCapturingLogger();
    const apply2 = vi.fn(() => undefined);
    const verify2 = vi.fn(() => true);
    const maxGlobalAttempts = 2;
    const s2 = createTopologySupervisor({
      clock: clock2,
      apply: apply2,
      verify: verify2,
      debounceMs: 5,
      verifyDelayMs: 5,
      maxAttemptsPerTopology: 100,
      maxGlobalAttempts,
      globalRateWindowMs: 1000,
      logger: logger2,
    });
    for (let i = 0; i < maxGlobalAttempts; i++) {
      s2.onDisplaysChanged([buildDisplay({ label: `D${i}` })]);
      await driveOneAttempt(clock2, 5, 5);
    }
    s2.onDisplaysChanged([buildDisplay({ label: 'blocked' })]);
    clock2.advance(5);
    expect(s2.givenUpReason).toBe('rate');
    const rateErrorLogs = entries2.filter(e => e.level === 'error');
    expect(rateErrorLogs).toHaveLength(1);

    expect(topologyErrorLogs[0]?.message).not.toBe(rateErrorLogs[0]?.message);
  });
});
