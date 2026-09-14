import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { WindowMonitor } from './monitor.js';

function createMockWindow(): {
  window: BrowserWindow;
  listeners: Map<string, (...args: unknown[]) => void>;
} {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const webContents = {
    on: (event: string, handler: (...args: unknown[]) => void) => {
      listeners.set(event, handler);
    },
    removeListener: (event: string) => {
      listeners.delete(event);
    },
  };
  const window = { webContents } as unknown as BrowserWindow;
  return { window, listeners };
}

describe('WindowMonitor (T4.4)', () => {
  it('notifies onCrash when render-process-gone is emitted', () => {
    const onCrash = vi.fn();
    const onError = vi.fn();
    const monitor = new WindowMonitor({ onCrash, onError });
    const { window, listeners } = createMockWindow();

    monitor.attach('win-1', window);

    const crashHandler = listeners.get('render-process-gone');
    expect(crashHandler).toBeDefined();

    crashHandler!({}, { reason: 'crashed', exitCode: 139 });

    expect(onCrash).toHaveBeenCalledWith(
      expect.objectContaining({
        windowId: 'win-1',
        reason: 'crashed',
        exitCode: 139,
      })
    );
  });

  it('notifies onError for warning and error console messages', () => {
    const onCrash = vi.fn();
    const onError = vi.fn();
    const monitor = new WindowMonitor({ onCrash, onError });
    const { window, listeners } = createMockWindow();

    monitor.attach('win-1', window);

    const consoleHandler = listeners.get('console-message');
    expect(consoleHandler).toBeDefined();

    consoleHandler!({ level: 'error', message: 'SyntaxError', lineNumber: 42, sourceId: 'app.js' });
    consoleHandler!({
      level: 'warning',
      message: 'DeprecationWarning',
      lineNumber: 10,
      sourceId: 'app.js',
    });
    consoleHandler!({ level: 'info', message: 'Regular log' });

    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ windowId: 'win-1', level: 'error', message: 'SyntaxError' })
    );
    expect(onError).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        windowId: 'win-1',
        level: 'warning',
        message: 'DeprecationWarning',
      })
    );
  });

  it('removes listeners upon detach', () => {
    const monitor = new WindowMonitor({ onCrash: vi.fn(), onError: vi.fn() });
    const { window, listeners } = createMockWindow();

    monitor.attach('win-1', window);
    expect(listeners.has('render-process-gone')).toBe(true);
    expect(listeners.has('console-message')).toBe(true);

    monitor.detach('win-1');
    expect(listeners.has('render-process-gone')).toBe(false);
    expect(listeners.has('console-message')).toBe(false);
  });
});
