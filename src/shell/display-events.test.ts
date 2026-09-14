import { describe, expect, it, vi } from 'vitest';
import type { Display, Screen } from 'electron';
import { createDisplayEventBridge } from './display-events.js';
import type { ManagedWindow } from './windows.js';
import type { Bounds } from '../layout/types.js';
import type { WindowConfig } from '../config/types.js';
import type { TouchProbe } from '../layout/probes/types.js';
import type { Logger, LogFields } from '../logging/logger.js';
import { createFakeClock, type FakeClock } from '../__testing__/fake-clock.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A fake Electron `Display` — matches `windows.test.ts`'s own `buildDisplay`. */
function buildDisplay(overrides: Partial<Display> = {}): Display {
  return {
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    scaleFactor: 1,
    rotation: 0,
    internal: false,
    label: 'Fake Display',
    touchSupport: 'unknown',
    colorDepth: 24,
    displayFrequency: 60,
    ...overrides,
  } as Display;
}

function buildWindowConfig(overrides: Partial<WindowConfig> = {}): WindowConfig {
  return {
    id: 'main',
    url: 'https://example.test/',
    target: { kind: 'primary' },
    kiosk: false,
    fullscreen: false,
    zoomFactor: 1,
    showWhenReady: true,
    required: false,
    fallback: 'primary',
    ...overrides,
  };
}

/**
 * A fake `BrowserWindow` implementing only what `applyPlacement`/`verify`
 * touch. `getBounds` reflects the last `setBounds` call plus an optional
 * fixed offset, which is what the tolerance tests use to simulate a
 * real-hardware DPI-rounding discrepancy.
 */
function buildFakeWindow(options: { boundsOffsetPx?: number } = {}) {
  let bounds: Bounds = { x: 0, y: 0, width: 0, height: 0 };
  const offset = options.boundsOffsetPx ?? 0;
  return {
    setKiosk: vi.fn(),
    setFullScreen: vi.fn(),
    setBounds: vi.fn((next: Bounds) => {
      bounds = next;
    }),
    getBounds: vi.fn(() => ({ ...bounds, x: bounds.x + offset })),
  };
}

type FakeWindow = ReturnType<typeof buildFakeWindow>;

function buildManagedWindow(id: string, window: FakeWindow): ManagedWindow {
  return { id, native: window as unknown as ManagedWindow['native'] };
}

/**
 * A fake `screen` implementing only `on`/`off`/`getAllDisplays`/
 * `getPrimaryDisplay`, plus test-driving helpers (`emit`, `setDisplays`,
 * `listenerCount`). `primary` is a fully independent `Display` object (not
 * derived from `displays`), so a test can simulate the OS reporting a
 * primary id that is not among the currently enumerated displays.
 */
function createFakeScreen(initialDisplays: Display[], initialPrimary?: Display) {
  const listeners = new Map<string, Set<() => void>>();
  let displays = initialDisplays;
  let primary = initialPrimary ?? initialDisplays[0]!;

  function listenersFor(event: string): Set<() => void> {
    let set = listeners.get(event);
    if (set === undefined) {
      set = new Set();
      listeners.set(event, set);
    }
    return set;
  }

  return {
    on(event: string, listener: () => void) {
      listenersFor(event).add(listener);
    },
    off(event: string, listener: () => void) {
      listenersFor(event).delete(listener);
    },
    emit(event: string) {
      for (const listener of listenersFor(event)) {
        listener();
      }
    },
    listenerCount(event: string): number {
      return listenersFor(event).size;
    },
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => primary,
    setDisplays(next: Display[], nextPrimary?: Display) {
      displays = next;
      primary = nextPrimary ?? next[0]!;
    },
  };
}

type FakeScreen = ReturnType<typeof createFakeScreen>;

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

/** Drains already-resolved promises — `apply`/`verify` are awaited internally even when synchronous. No real elapsed time involved. */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

/** Drives exactly one attempt (debounce -> apply -> verifyDelayMs -> verify) to completion. Mirrors `layout/supervisor.test.ts`'s own `driveOneAttempt`. */
async function settle(clock: FakeClock, debounceMs: number, verifyDelayMs: number): Promise<void> {
  clock.advance(debounceMs);
  await flushAsync();
  clock.advance(verifyDelayMs);
  await flushAsync();
}

/** Generous Tier 1/2 sizing so tests not specifically about the breakers never trip them. */
const GENEROUS_SUPERVISOR = {
  debounceMs: 10,
  verifyDelayMs: 5,
  maxAttemptsPerTopology: 3,
  maxGlobalAttempts: 1000,
  globalRateWindowMs: 1_000_000,
} as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createDisplayEventBridge', () => {
  it('feeds converted snapshots into the supervisor on a display-metrics-changed event', async () => {
    const clock = createFakeClock();
    const screen = createFakeScreen([buildDisplay({ id: 1 })]);
    const window = buildFakeWindow();
    const bridge = createDisplayEventBridge({
      screen: screen as unknown as Screen,
      clock,
      windows: [buildManagedWindow('main', window)],
      windowConfigs: [buildWindowConfig()],
      supervisor: GENEROUS_SUPERVISOR,
    });
    await settle(clock, GENEROUS_SUPERVISOR.debounceMs, GENEROUS_SUPERVISOR.verifyDelayMs);

    screen.setDisplays([buildDisplay({ id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } })]);
    screen.emit('display-metrics-changed');
    await settle(clock, GENEROUS_SUPERVISOR.debounceMs, GENEROUS_SUPERVISOR.verifyDelayMs);

    expect(window.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1000, height: 800 });
    bridge.dispose();
  });

  it('subscribes to all three screen events and each one reaches the supervisor', async () => {
    const clock = createFakeClock();
    const d1 = buildDisplay({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } });
    const screen: FakeScreen = createFakeScreen([d1]);
    const window = buildFakeWindow();
    const bridge = createDisplayEventBridge({
      screen: screen as unknown as Screen,
      clock,
      windows: [buildManagedWindow('main', window)],
      windowConfigs: [buildWindowConfig({ target: { kind: 'spanAll' } })],
      supervisor: GENEROUS_SUPERVISOR,
    });
    await settle(clock, GENEROUS_SUPERVISOR.debounceMs, GENEROUS_SUPERVISOR.verifyDelayMs);
    expect(window.setBounds).toHaveBeenCalledTimes(1);
    expect(window.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1920, height: 1080 });

    // display-metrics-changed
    const d1Narrow = buildDisplay({ id: 1, bounds: { x: 0, y: 0, width: 1000, height: 1080 } });
    screen.setDisplays([d1Narrow]);
    screen.emit('display-metrics-changed');
    await settle(clock, GENEROUS_SUPERVISOR.debounceMs, GENEROUS_SUPERVISOR.verifyDelayMs);
    expect(window.setBounds).toHaveBeenCalledTimes(2);
    expect(window.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1000, height: 1080 });

    // display-added
    const d2 = buildDisplay({ id: 2, bounds: { x: 1000, y: 0, width: 800, height: 600 } });
    screen.setDisplays([d1Narrow, d2]);
    screen.emit('display-added');
    await settle(clock, GENEROUS_SUPERVISOR.debounceMs, GENEROUS_SUPERVISOR.verifyDelayMs);
    expect(window.setBounds).toHaveBeenCalledTimes(3);
    expect(window.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1800, height: 1080 });

    // display-removed
    screen.setDisplays([d1Narrow]);
    screen.emit('display-removed');
    await settle(clock, GENEROUS_SUPERVISOR.debounceMs, GENEROUS_SUPERVISOR.verifyDelayMs);
    expect(window.setBounds).toHaveBeenCalledTimes(4);
    expect(window.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1000, height: 1080 });

    bridge.dispose();
  });

  it('dispose() removes every screen listener and leaves no pending fake-clock timers', () => {
    const clock = createFakeClock();
    const screen = createFakeScreen([buildDisplay({ id: 1 })]);
    const window = buildFakeWindow();
    const bridge = createDisplayEventBridge({
      screen: screen as unknown as Screen,
      clock,
      windows: [buildManagedWindow('main', window)],
      windowConfigs: [buildWindowConfig()],
      supervisor: GENEROUS_SUPERVISOR,
    });

    // Emit again before the initial cycle settles, so there is definitely a
    // pending timer for dispose() to clean up.
    screen.emit('display-metrics-changed');
    expect(clock.pendingCount).toBeGreaterThan(0);
    expect(screen.listenerCount('display-added')).toBe(1);
    expect(screen.listenerCount('display-removed')).toBe(1);
    expect(screen.listenerCount('display-metrics-changed')).toBe(1);

    bridge.dispose();

    expect(screen.listenerCount('display-added')).toBe(0);
    expect(screen.listenerCount('display-removed')).toBe(0);
    expect(screen.listenerCount('display-metrics-changed')).toBe(0);
    expect(clock.pendingCount).toBe(0);
  });

  it('apply resolves a layout and calls applyPlacement against the matching window for each placement', async () => {
    const clock = createFakeClock();
    const d1 = buildDisplay({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } });
    const d2 = buildDisplay({ id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 720 } });
    const screen = createFakeScreen([d1, d2]);
    const windowA = buildFakeWindow();
    const windowB = buildFakeWindow();
    const bridge = createDisplayEventBridge({
      screen: screen as unknown as Screen,
      clock,
      windows: [buildManagedWindow('a', windowA), buildManagedWindow('b', windowB)],
      windowConfigs: [
        buildWindowConfig({ id: 'a', target: { kind: 'index', index: 0 } }),
        buildWindowConfig({ id: 'b', target: { kind: 'index', index: 1 } }),
      ],
      supervisor: GENEROUS_SUPERVISOR,
    });

    await settle(clock, GENEROUS_SUPERVISOR.debounceMs, GENEROUS_SUPERVISOR.verifyDelayMs);

    expect(windowA.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(windowB.setBounds).toHaveBeenCalledWith({ x: 1920, y: 0, width: 1280, height: 720 });
    bridge.dispose();
  });

  it('logs an error-severity layout problem loudly and surfaces it rather than silently applying', async () => {
    const clock = createFakeClock();
    const { logger, entries } = createCapturingLogger();
    const screen = createFakeScreen([buildDisplay({ id: 1 })]);
    const window = buildFakeWindow();
    const debounceMs = 10;
    const maxAttemptsPerTopology = 2;
    const bridge = createDisplayEventBridge({
      screen: screen as unknown as Screen,
      clock,
      logger,
      windows: [buildManagedWindow('main', window)],
      windowConfigs: [buildWindowConfig({ target: { kind: 'index', index: 5 }, required: true })],
      supervisor: { ...GENEROUS_SUPERVISOR, debounceMs, maxAttemptsPerTopology },
    });

    for (let i = 0; i < maxAttemptsPerTopology; i++) {
      clock.advance(debounceMs);
      await flushAsync();
    }

    expect(window.setBounds).not.toHaveBeenCalled();
    const errorLogs = entries.filter(entry => entry.level === 'error');
    expect(
      errorLogs.some(
        entry =>
          entry.message.includes('layout problem') &&
          entry.fields?.['code'] === 'index-out-of-range'
      )
    ).toBe(true);
    expect(bridge.supervisorState).toBe('givenUp');
    bridge.dispose();
  });

  it('logs a warning-severity layout problem at warn and still applies the resulting placement', async () => {
    const clock = createFakeClock();
    const { logger, entries } = createCapturingLogger();
    const d1 = buildDisplay({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } });
    // No display in the enumerated list matches the reported primary id, so
    // resolveLayout falls back to the lowest id and warns `primary-unflagged`.
    const screen = createFakeScreen([d1], buildDisplay({ id: 999 }));
    const window = buildFakeWindow();
    const bridge = createDisplayEventBridge({
      screen: screen as unknown as Screen,
      clock,
      logger,
      windows: [buildManagedWindow('main', window)],
      windowConfigs: [buildWindowConfig({ target: { kind: 'primary' } })],
      supervisor: GENEROUS_SUPERVISOR,
    });

    await settle(clock, GENEROUS_SUPERVISOR.debounceMs, GENEROUS_SUPERVISOR.verifyDelayMs);

    expect(window.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1920, height: 1080 });
    const warnLogs = entries.filter(entry => entry.level === 'warn');
    expect(warnLogs.some(entry => entry.fields?.['code'] === 'primary-unflagged')).toBe(true);
    expect(entries.some(entry => entry.level === 'error')).toBe(false);
    bridge.dispose();
  });

  it('logs and skips a placement naming an unknown window id, without throwing into the event path', async () => {
    const clock = createFakeClock();
    const { logger, entries } = createCapturingLogger();
    const d1 = buildDisplay({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } });
    const d2 = buildDisplay({ id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 720 } });
    const screen = createFakeScreen([d1, d2]);
    const knownWindow = buildFakeWindow();
    const bridge = createDisplayEventBridge({
      screen: screen as unknown as Screen,
      clock,
      logger,
      // Deliberately no ManagedWindow for 'ghost'.
      windows: [buildManagedWindow('known', knownWindow)],
      windowConfigs: [
        buildWindowConfig({ id: 'known', target: { kind: 'index', index: 0 } }),
        buildWindowConfig({ id: 'ghost', target: { kind: 'index', index: 1 } }),
      ],
      supervisor: GENEROUS_SUPERVISOR,
    });

    await settle(clock, GENEROUS_SUPERVISOR.debounceMs, GENEROUS_SUPERVISOR.verifyDelayMs);

    expect(knownWindow.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(
      entries.some(entry => entry.level === 'error' && entry.fields?.['windowId'] === 'ghost')
    ).toBe(true);
    expect(entries.some(entry => entry.message.includes('apply threw'))).toBe(false);
    bridge.dispose();
  });

  it('verify returns true when actual bounds match intent and false when they do not', async () => {
    const matchClock = createFakeClock();
    const matchScreen = createFakeScreen([
      buildDisplay({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
    ]);
    const matchingWindow = buildFakeWindow();
    const matchingBridge = createDisplayEventBridge({
      screen: matchScreen as unknown as Screen,
      clock: matchClock,
      windows: [buildManagedWindow('main', matchingWindow)],
      windowConfigs: [buildWindowConfig()],
      supervisor: GENEROUS_SUPERVISOR,
    });
    await settle(matchClock, GENEROUS_SUPERVISOR.debounceMs, GENEROUS_SUPERVISOR.verifyDelayMs);
    expect(matchingBridge.supervisorState).toBe('settled');
    matchingBridge.dispose();

    const mismatchClock = createFakeClock();
    const mismatchScreen = createFakeScreen([
      buildDisplay({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
    ]);
    // getBounds never reflects setBounds — a permanent mismatch.
    const mismatchedWindow = buildFakeWindow({ boundsOffsetPx: 500 });
    const maxAttemptsPerTopology = 2;
    const mismatchBridge = createDisplayEventBridge({
      screen: mismatchScreen as unknown as Screen,
      clock: mismatchClock,
      windows: [buildManagedWindow('main', mismatchedWindow)],
      windowConfigs: [buildWindowConfig()],
      supervisor: { ...GENEROUS_SUPERVISOR, maxAttemptsPerTopology },
    });
    for (let i = 0; i < maxAttemptsPerTopology; i++) {
      await settle(
        mismatchClock,
        GENEROUS_SUPERVISOR.debounceMs,
        GENEROUS_SUPERVISOR.verifyDelayMs
      );
    }
    expect(mismatchBridge.supervisorState).toBe('givenUp');
    mismatchBridge.dispose();
  });

  it('verify tolerance (2px default): a 1px actual-bounds difference still verifies true', async () => {
    const clock = createFakeClock();
    const screen = createFakeScreen([
      buildDisplay({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
    ]);
    const window = buildFakeWindow({ boundsOffsetPx: 1 });
    const bridge = createDisplayEventBridge({
      screen: screen as unknown as Screen,
      clock,
      windows: [buildManagedWindow('main', window)],
      windowConfigs: [buildWindowConfig()],
      supervisor: GENEROUS_SUPERVISOR,
    });

    await settle(clock, GENEROUS_SUPERVISOR.debounceMs, GENEROUS_SUPERVISOR.verifyDelayMs);

    expect(bridge.supervisorState).toBe('settled');
    bridge.dispose();
  });

  it('verify tolerance (2px default): a 5px actual-bounds difference returns false and keeps retrying', async () => {
    const clock = createFakeClock();
    const screen = createFakeScreen([
      buildDisplay({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
    ]);
    const window = buildFakeWindow({ boundsOffsetPx: 5 });
    const maxAttemptsPerTopology = 2;
    const bridge = createDisplayEventBridge({
      screen: screen as unknown as Screen,
      clock,
      windows: [buildManagedWindow('main', window)],
      windowConfigs: [buildWindowConfig()],
      supervisor: { ...GENEROUS_SUPERVISOR, maxAttemptsPerTopology },
    });

    for (let i = 0; i < maxAttemptsPerTopology; i++) {
      await settle(clock, GENEROUS_SUPERVISOR.debounceMs, GENEROUS_SUPERVISOR.verifyDelayMs);
    }

    expect(bridge.supervisorState).toBe('givenUp');
    bridge.dispose();
  });

  it('the touch probe is NOT invoked from the display-event path (lockup regression test)', async () => {
    const clock = createFakeClock();
    const screen = createFakeScreen([buildDisplay({ id: 1 })]);
    const window = buildFakeWindow();
    const probe: TouchProbe = { detect: vi.fn(() => Promise.resolve([1])) };
    // Simulates T3.4 resolving the probe once, at startup, entirely outside
    // this module and outside the display-event path.
    const resolvedIds = await probe.detect(new AbortController().signal);
    expect(probe.detect).toHaveBeenCalledTimes(1);

    const bridge = createDisplayEventBridge({
      screen: screen as unknown as Screen,
      clock,
      windows: [buildManagedWindow('main', window)],
      windowConfigs: [buildWindowConfig()],
      getTouchDisplayIds: () => resolvedIds,
      supervisor: GENEROUS_SUPERVISOR,
    });

    await settle(clock, GENEROUS_SUPERVISOR.debounceMs, GENEROUS_SUPERVISOR.verifyDelayMs);
    screen.emit('display-metrics-changed');
    await settle(clock, GENEROUS_SUPERVISOR.debounceMs, GENEROUS_SUPERVISOR.verifyDelayMs);
    screen.emit('display-added');
    await settle(clock, GENEROUS_SUPERVISOR.debounceMs, GENEROUS_SUPERVISOR.verifyDelayMs);
    screen.emit('display-removed');
    await settle(clock, GENEROUS_SUPERVISOR.debounceMs, GENEROUS_SUPERVISOR.verifyDelayMs);

    expect(probe.detect).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });

  it('a burst of identical events results in one apply (dedup works end-to-end through this adapter)', async () => {
    const clock = createFakeClock();
    const debounceMs = 50;
    const screen = createFakeScreen([
      buildDisplay({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
    ]);
    const window = buildFakeWindow();
    const bridge = createDisplayEventBridge({
      screen: screen as unknown as Screen,
      clock,
      windows: [buildManagedWindow('main', window)],
      windowConfigs: [buildWindowConfig()],
      supervisor: { ...GENEROUS_SUPERVISOR, debounceMs },
    });
    await settle(clock, debounceMs, GENEROUS_SUPERVISOR.verifyDelayMs);
    window.setBounds.mockClear();

    screen.setDisplays([buildDisplay({ id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } })]);
    for (let i = 0; i < 5; i++) {
      screen.emit('display-metrics-changed');
    }
    await settle(clock, debounceMs, GENEROUS_SUPERVISOR.verifyDelayMs);

    expect(window.setBounds).toHaveBeenCalledTimes(1);
    expect(window.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1000, height: 800 });
    bridge.dispose();
  });
});
