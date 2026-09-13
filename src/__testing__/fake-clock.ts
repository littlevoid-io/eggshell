/**
 * A deterministic `Clock` (see `src/clock.ts`) for tests. Never shipped —
 * excluded from `tsconfig.build.json` — but still typechecked by the
 * project-wide `tsconfig.json`, which has no exclude, so it must stay
 * correct even though it never reaches `dist`.
 *
 * The supervisor (T2.4) reschedules itself from inside its own timer
 * callbacks (debounce -> apply -> verify -> retry). `advance()` therefore
 * must fire timers that get scheduled *during* the same `advance()` call, in
 * correct due-time order, rather than only the timers that existed when
 * `advance()` was called — otherwise a test could not observe a supervisor
 * reaching `givenUp` in one `advance()`.
 */

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

export function createFakeClock(): FakeClock {
  let currentTime = 0;
  let nextId = 1;
  const timers = new Map<number, ScheduledTimer>();

  const clock: FakeClock = {
    setTimeout(callback, ms) {
      const id = nextId++;
      timers.set(id, { id, dueAt: currentTime + Math.max(0, ms), callback });
      return { id };
    },
    clearTimeout(handle: TimerHandle) {
      timers.delete(handle.id);
    },
    now() {
      return currentTime;
    },
    advance(ms: number) {
      advanceTo(currentTime + ms);
    },
    runAllPending() {
      advanceTo(Infinity);
    },
    get pendingCount() {
      return timers.size;
    },
    get pendingDueTimes() {
      return [...timers.values()].map(timer => timer.dueAt).sort((a, b) => a - b);
    },
  };

  function popNextDueTimer(deadline: number): ScheduledTimer | undefined {
    let earliest: ScheduledTimer | undefined;
    for (const timer of timers.values()) {
      if (timer.dueAt > deadline) {
        continue;
      }
      if (earliest === undefined || timer.dueAt < earliest.dueAt || timer.id < earliest.id) {
        earliest = timer;
      }
    }
    if (earliest !== undefined) {
      timers.delete(earliest.id);
    }
    return earliest;
  }

  function advanceTo(deadline: number): void {
    for (let iterations = 0; iterations < MAX_TIMERS_PER_ADVANCE; iterations++) {
      const timer = popNextDueTimer(deadline);
      if (timer === undefined) {
        currentTime = deadline === Infinity ? currentTime : deadline;
        return;
      }
      currentTime = Math.max(currentTime, timer.dueAt);
      timer.callback();
    }
    throw new Error(
      `createFakeClock: exceeded ${MAX_TIMERS_PER_ADVANCE} timer firings in one advance() call. ` +
        'A timer callback is very likely rescheduling itself indefinitely (an infinite retry loop) ' +
        'rather than converging — this cap exists specifically to surface that as a test failure ' +
        'instead of hanging.'
    );
  }

  return clock;
}
