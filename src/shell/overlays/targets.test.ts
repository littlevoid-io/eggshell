import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { Logger } from '../../logging/logger.js';
import type { ManagedWindow } from '../windows/create.js';
import { selectOverlayWindows } from './targets.js';

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createMockWindow(id: string): ManagedWindow {
  return { id, window: {} as BrowserWindow };
}

describe('selectOverlayWindows', () => {
  it('returns all windows when ids is undefined', () => {
    const windows = [createMockWindow('main'), createMockWindow('secondary')];
    const logger = createMockLogger();
    const result = selectOverlayWindows(windows, undefined, logger);
    expect(result).toEqual(windows);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('selects windows matching given ids', () => {
    const main = createMockWindow('main');
    const secondary = createMockWindow('secondary');
    const logger = createMockLogger();
    const result = selectOverlayWindows([main, secondary], ['secondary'], logger);
    expect(result).toEqual([secondary]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns and skips unknown window ids', () => {
    const main = createMockWindow('main');
    const logger = createMockLogger();
    const result = selectOverlayWindows([main], ['main', 'unknown'], logger);
    expect(result).toEqual([main]);
    expect(logger.warn).toHaveBeenCalledWith('Overlay window id "unknown" not found', {
      windowId: 'unknown',
    });
  });
});
