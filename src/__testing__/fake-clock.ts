import type { Clock, TimerHandle } from '../clock.js';

interface ScheduledTimer {
  readonly id: number;
  readonly dueAt: number;
  readonly callback: () => void;
}

export interface FakeClock extends Clock {
  /**
   * Fires every timer due at or before `now() + ms`, in due-time order
   * (ties broken by scheduling order), then sets `now()` to `now() + ms`.
   * Timers scheduled by a firing callback are picked up in the same call if
   * their due time falls within the advanced span.
   */
  advance(ms: number): void;
  /** Fires every currently- and newly-scheduled timer, however far out. */
  runAllPending(): void;
  readonly pendingCount: number;
  readonly pendingDueTimes: readonly number[];
}

const MAX_TIMERS_PER_ADVANCE = 10_000;

interface FakeClockState {
  currentTime: number;
  nextId: number;
  readonly timers: Map<number, ScheduledTimer>;
}

function popNextDueTimer(state: FakeClockState, deadline: number): ScheduledTimer | undefined {
  let earliest: ScheduledTimer | undefined;
  for (const timer of state.timers.values()) {
    if (timer.dueAt > deadline) {
      continue;
    }
    if (earliest === undefined || timer.dueAt < earliest.dueAt || timer.id < earliest.id) {
      earliest = timer;
    }
  }
  if (earliest !== undefined) {
    state.timers.delete(earliest.id);
  }
  return earliest;
}

function advanceTo(state: FakeClockState, deadline: number): void {
  for (let iterations = 0; iterations < MAX_TIMERS_PER_ADVANCE; iterations++) {
    const timer = popNextDueTimer(state, deadline);
    if (timer === undefined) {
      state.currentTime = deadline === Infinity ? state.currentTime : deadline;
      return;
    }
    state.currentTime = Math.max(state.currentTime, timer.dueAt);
    timer.callback();
  }
  throw new Error(
    `createFakeClock: exceeded ${MAX_TIMERS_PER_ADVANCE} timer firings in one advance() call. ` +
      'A timer callback is very likely rescheduling itself indefinitely (an infinite retry loop) ' +
      'rather than converging — this cap exists specifically to surface that as a test failure ' +
      'instead of hanging.'
  );
}

function scheduleTimer(state: FakeClockState, callback: () => void, ms: number): TimerHandle {
  const id = state.nextId++;
  state.timers.set(id, { id, dueAt: state.currentTime + Math.max(0, ms), callback });
  return { id };
}

function dueTimes(timers: Map<number, ScheduledTimer>): readonly number[] {
  return [...timers.values()].map(timer => timer.dueAt).sort((a, b) => a - b);
}

export function createFakeClock(): FakeClock {
  const state: FakeClockState = { currentTime: 0, nextId: 1, timers: new Map() };
  return {
    setTimeout: (callback, ms) => scheduleTimer(state, callback, ms),
    clearTimeout: (handle: TimerHandle) => {
      state.timers.delete(handle.id);
    },
    now: () => state.currentTime,
    advance: (ms: number) => advanceTo(state, state.currentTime + ms),
    runAllPending: () => advanceTo(state, Infinity),
    get pendingCount() {
      return state.timers.size;
    },
    get pendingDueTimes() {
      return dueTimes(state.timers);
    },
  };
}
