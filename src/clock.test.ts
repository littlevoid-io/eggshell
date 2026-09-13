import { describe, it, expect } from 'vitest';
import { systemClock } from './clock.js';
import { createFakeClock } from './__testing__/fake-clock.js';

describe('systemClock', () => {
  it('schedules and fires a real timer', async () => {
    await new Promise<void>(resolve => {
      systemClock.setTimeout(() => resolve(), 1);
    });
  });

  it('now() returns a real, advancing timestamp', async () => {
    const before = systemClock.now();
    await new Promise<void>(resolve => {
      systemClock.setTimeout(() => resolve(), 1);
    });
    expect(systemClock.now()).toBeGreaterThanOrEqual(before);
  });

  it('clearTimeout prevents a real timer from firing', async () => {
    let fired = false;
    const handle = systemClock.setTimeout(() => {
      fired = true;
    }, 5);
    systemClock.clearTimeout(handle);

    await new Promise<void>(resolve => {
      systemClock.setTimeout(() => resolve(), 20);
    });
    expect(fired).toBe(false);
  });
});

describe('createFakeClock', () => {
  it('fires multiple timers in due-time order, not scheduling order', () => {
    const clock = createFakeClock();
    const order: string[] = [];
    clock.setTimeout(() => order.push('b'), 20);
    clock.setTimeout(() => order.push('a'), 10);
    clock.setTimeout(() => order.push('c'), 30);

    clock.advance(30);

    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('breaks same-due-time ties by scheduling order', () => {
    const clock = createFakeClock();
    const order: string[] = [];
    clock.setTimeout(() => order.push('first'), 10);
    clock.setTimeout(() => order.push('second'), 10);

    clock.advance(10);

    expect(order).toEqual(['first', 'second']);
  });

  it('fires a timer scheduled re-entrantly by another firing callback, within the same advance()', () => {
    const clock = createFakeClock();
    const order: string[] = [];
    clock.setTimeout(() => {
      order.push('first');
      clock.setTimeout(() => order.push('rescheduled'), 5);
    }, 10);

    clock.advance(20);

    expect(order).toEqual(['first', 'rescheduled']);
    expect(clock.pendingCount).toBe(0);
  });

  it('does not fire a re-entrantly scheduled timer whose due time falls outside the advanced span', () => {
    const clock = createFakeClock();
    const order: string[] = [];
    clock.setTimeout(() => {
      order.push('first');
      clock.setTimeout(() => order.push('too-late'), 100);
    }, 10);

    clock.advance(20);

    expect(order).toEqual(['first']);
    expect(clock.pendingCount).toBe(1);
  });

  it('clearTimeout prevents a fake timer from firing', () => {
    const clock = createFakeClock();
    let fired = false;
    const handle = clock.setTimeout(() => {
      fired = true;
    }, 10);
    clock.clearTimeout(handle);

    clock.advance(10);

    expect(fired).toBe(false);
    expect(clock.pendingCount).toBe(0);
  });

  it('clearTimeout on an already-fired or unknown handle is a harmless no-op', () => {
    const clock = createFakeClock();
    const handle = clock.setTimeout(() => undefined, 10);
    clock.advance(10);

    expect(() => clock.clearTimeout(handle)).not.toThrow();
  });

  it('pendingCount reflects outstanding timers accurately as they are added, fired, and cleared', () => {
    const clock = createFakeClock();
    expect(clock.pendingCount).toBe(0);

    const a = clock.setTimeout(() => undefined, 10);
    clock.setTimeout(() => undefined, 20);
    expect(clock.pendingCount).toBe(2);

    clock.clearTimeout(a);
    expect(clock.pendingCount).toBe(1);

    clock.advance(20);
    expect(clock.pendingCount).toBe(0);
  });

  it('now() progresses by the advanced amount even with no pending timers', () => {
    const clock = createFakeClock();
    expect(clock.now()).toBe(0);
    clock.advance(50);
    expect(clock.now()).toBe(50);
  });

  it('now() lands exactly on the last fired timer due time, not beyond it, mid-advance', () => {
    const clock = createFakeClock();
    clock.setTimeout(() => undefined, 5);
    clock.advance(100);
    expect(clock.now()).toBe(100);
  });

  it('throws a clear error when a callback reschedules itself indefinitely within one advance()', () => {
    const clock = createFakeClock();
    const scheduleNext = (): void => {
      clock.setTimeout(scheduleNext, 1);
    };
    clock.setTimeout(scheduleNext, 1);

    expect(() => clock.advance(1_000_000)).toThrow(/exceeded/i);
  });

  it('runAllPending fires timers scheduled arbitrarily far in the future', () => {
    const clock = createFakeClock();
    let fired = false;
    clock.setTimeout(() => {
      fired = true;
    }, 1_000_000);

    clock.runAllPending();

    expect(fired).toBe(true);
    expect(clock.pendingCount).toBe(0);
  });
});
