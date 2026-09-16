import type { Clock, TimerHandle } from '../../clock.js';

export interface TimerControl {
  readonly cancel: () => void;
}

export function startTimer(clock: Clock, intervalMs: number, onTick: () => void): TimerControl {
  let active = true;
  let handle: TimerHandle | undefined;
  const schedule = () => {
    if (!active) return;
    handle = clock.setTimeout(() => {
      if (!active) return;
      onTick();
      schedule();
    }, intervalMs);
  };
  schedule();
  return {
    cancel: () => {
      active = false;
      if (handle !== undefined) clock.clearTimeout(handle);
    },
  };
}
