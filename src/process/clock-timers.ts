import type { Clock, TimerHandle } from '../clock.js';

export interface ClockTimers {
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
}

export function createClockTimers(clock: Clock): ClockTimers {
  const timers = new Map<number, TimerHandle>();
  let count = 1;
  const customSetTimeout = (callback: () => void, ms?: number) => {
    const id = count++;
    timers.set(id, clock.setTimeout(callback, ms ?? 0));
    return id as unknown as ReturnType<typeof globalThis.setTimeout>;
  };
  const customClearTimeout = (timerId?: ReturnType<typeof globalThis.setTimeout>) => {
    const handle = timerId !== undefined ? timers.get(timerId as unknown as number) : undefined;
    if (handle !== undefined) clock.clearTimeout(handle);
  };
  return {
    setTimeout: customSetTimeout as unknown as typeof globalThis.setTimeout,
    clearTimeout: customClearTimeout as unknown as typeof globalThis.clearTimeout,
  };
}
