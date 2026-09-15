import { describe, it, expect } from 'vitest';
import { createRateWindow } from './rate-window.js';
import { createFakeClock } from '../__testing__/fake-clock.js';

describe('createRateWindow', () => {
  it('starts empty with size 0 and not exceeded', () => {
    const clock = createFakeClock();
    const window = createRateWindow(clock, 1000, 3);

    expect(window.size).toBe(0);
    expect(window.isExceeded()).toBe(false);
  });

  it('records events and reports exceeded when maxAttempts reached', () => {
    const clock = createFakeClock();
    const window = createRateWindow(clock, 1000, 3);

    window.record();
    expect(window.size).toBe(1);
    expect(window.isExceeded()).toBe(false);

    window.record();
    expect(window.size).toBe(2);
    expect(window.isExceeded()).toBe(false);

    window.record();
    expect(window.size).toBe(3);
    expect(window.isExceeded()).toBe(true);
  });

  it('prunes entries older than windowMs as time advances', () => {
    const clock = createFakeClock();
    const window = createRateWindow(clock, 1000, 2);

    window.record(); // t = 0
    clock.advance(500);
    window.record(); // t = 500
    expect(window.size).toBe(2);
    expect(window.isExceeded()).toBe(true);

    // Advance to 1001: first entry (t=0) is older than 1001 - 1000 = 1, so it drops
    clock.advance(501);
    expect(window.size).toBe(1);
    expect(window.isExceeded()).toBe(false);

    // Advance to 1501: second entry (t=500) drops
    clock.advance(500);
    expect(window.size).toBe(0);
    expect(window.isExceeded()).toBe(false);
  });

  it('supports prune without recording new events', () => {
    const clock = createFakeClock();
    const window = createRateWindow(clock, 1000, 2);

    window.record();
    clock.advance(1500);
    window.prune();

    expect(window.size).toBe(0);
    expect(window.isExceeded()).toBe(false);
  });
});
