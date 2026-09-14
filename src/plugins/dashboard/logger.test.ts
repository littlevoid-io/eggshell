import { describe, expect, it, vi } from 'vitest';
import { DashboardLogStore } from './logger.js';
import type { LogEntry } from './types.js';

describe('DashboardLogStore (T4.2)', () => {
  it('stores log entries and retrieves them in order', () => {
    const store = new DashboardLogStore();
    store.addEntry('info', 'First log message');
    store.addEntry('warn', 'Second log message');

    const logs = store.getLogs();
    expect(logs.length).toBe(2);
    expect(logs[0]?.id).toBe(1);
    expect(logs[0]?.type).toBe('info');
    expect(logs[0]?.message).toBe('First log message');
    expect(logs[1]?.id).toBe(2);
    expect(logs[1]?.type).toBe('warn');
  });

  it('notifies registered listeners when an entry is added', () => {
    const store = new DashboardLogStore();
    const listener = vi.fn();
    const unsubscribe = store.addListener(listener);

    store.addEntry('error', 'Something failed');
    expect(listener).toHaveBeenCalledTimes(1);
    const entry = listener.mock.calls[0]?.[0] as LogEntry;
    expect(entry.type).toBe('error');
    expect(entry.message).toBe('Something failed');

    unsubscribe();
    store.addEntry('info', 'Another message');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('caps buffer at 100 entries', () => {
    const store = new DashboardLogStore();
    for (let i = 1; i <= 105; i++) {
      store.addEntry('info', `Message ${i}`);
    }

    const logs = store.getLogs();
    expect(logs.length).toBe(100);
    expect(logs[0]?.id).toBe(6);
    expect(logs[logs.length - 1]?.id).toBe(105);
  });

  it('clears buffer when requested', () => {
    const store = new DashboardLogStore();
    store.addEntry('info', 'Hello');
    expect(store.getLogs().length).toBe(1);

    store.clear();
    expect(store.getLogs().length).toBe(0);
  });
});
