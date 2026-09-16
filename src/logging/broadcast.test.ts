import { describe, expect, it, vi } from 'vitest';
import { createLogBroadcast } from './broadcast.js';

describe('createLogBroadcast', () => {
  it('evicts the oldest lines when exceeding the limit', () => {
    const broadcast = createLogBroadcast(3);
    broadcast.write('line 1\n');
    broadcast.write('line 2\n');
    broadcast.write('line 3\n');
    expect(broadcast.recent()).toEqual(['line 1', 'line 2', 'line 3']);

    broadcast.write('line 4\n');
    expect(broadcast.recent()).toEqual(['line 2', 'line 3', 'line 4']);

    broadcast.write('line 5\nline 6\n');
    expect(broadcast.recent()).toEqual(['line 4', 'line 5', 'line 6']);
  });

  it('delivers lines to subscribers and stops after unsubscribe', () => {
    const broadcast = createLogBroadcast(5);
    const listener = vi.fn();
    const unsubscribe = broadcast.subscribe(listener);

    broadcast.write('first\n');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('first');

    unsubscribe();
    broadcast.write('second\n');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('splits multi-line chunks, ignores empty lines, and notifies subscribers per line', () => {
    const broadcast = createLogBroadcast(10);
    const listener = vi.fn();
    broadcast.subscribe(listener);

    broadcast.write('alpha\n\nbeta\r\ngamma\n\n');
    expect(broadcast.recent()).toEqual(['alpha', 'beta', 'gamma']);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenNthCalledWith(1, 'alpha');
    expect(listener).toHaveBeenNthCalledWith(2, 'beta');
    expect(listener).toHaveBeenNthCalledWith(3, 'gamma');
  });
});
