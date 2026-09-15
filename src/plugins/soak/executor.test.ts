import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { ShellContext, WindowHandle, WindowRegistry } from '../../plugin-api/types.js';
import { noopLogger } from '../../logging/logger.js';
import { executeFuzzStep, findTargetWindows } from './executor.js';
import { ActionGenerator } from './generator.js';
import { Mulberry32Generator } from './prng.js';
import { ReportCollector } from './reporter.js';
import type { ClickDetails, MoveDetails, SoakConfig } from './types.js';

function createMockHandle(
  id: string,
  bounds = { x: 0, y: 0, width: 800, height: 600 }
): {
  handle: WindowHandle<BrowserWindow>;
  executeMock: ReturnType<typeof vi.fn>;
} {
  const executeMock = vi.fn().mockResolvedValue(undefined);
  const webContents = { executeJavaScript: executeMock, on: vi.fn(), removeListener: vi.fn() };
  const window = {
    webContents,
    getContentBounds: vi.fn().mockReturnValue(bounds),
  } as unknown as BrowserWindow;
  return { handle: { id, native: window }, executeMock };
}

function createMockContext(
  windows: readonly WindowHandle<BrowserWindow>[]
): ShellContext<BrowserWindow> {
  const windowRegistry: WindowRegistry<BrowserWindow> = {
    get: id => windows.find(w => w.id === id),
    list: () => windows,
  };
  return {
    windows: windowRegistry,
    views: {
      createOverlay: () => ({ show: () => {}, hide: () => {}, destroy: () => {} }),
    },
    ipc: { handle: vi.fn() },
    commands: { register: vi.fn() },
    status: { publish: vi.fn(), read: vi.fn() },
    logger: noopLogger,
    roots: { packageRoot: '', projectRoot: '', userDataRoot: '' },
    config: {},
    signal: new AbortController().signal,
  };
}

describe('executor (T7.4)', () => {
  const baseConfig: SoakConfig = {
    enabled: true,
    intervalMs: 100,
    actionTypes: ['click', 'move'],
  };

  it('findTargetWindows respects targetWindowIds and filters handles with native', () => {
    const { handle: win1 } = createMockHandle('win-1');
    const { handle: win2 } = createMockHandle('win-2');
    const detachedHandle: WindowHandle<BrowserWindow> = { id: 'win-detached' };
    const context = createMockContext([win1, win2, detachedHandle]);

    const all = findTargetWindows(context, baseConfig);
    expect(all.map(h => h.id)).toEqual(['win-1', 'win-2']);

    const filtered = findTargetWindows(context, { ...baseConfig, targetWindowIds: ['win-2'] });
    expect(filtered.map(h => h.id)).toEqual(['win-2']);
  });

  it('generates coordinates constrained by target window getContentBounds', () => {
    const { handle: win } = createMockHandle('win-small', { x: 50, y: 50, width: 500, height: 300 });
    const context = createMockContext([win]);
    const generator = new ActionGenerator({
      random: new Mulberry32Generator(42),
      actionTypes: ['click', 'move'],
    });
    const collector = new ReportCollector(42);

    for (let i = 0; i < 30; i++) {
      executeFuzzStep(context, baseConfig, generator, collector, null, 0);
    }

    const report = collector.getReport();
    expect(report.actions).toHaveLength(30);
    for (const action of report.actions) {
      expect(action.windowId).toBe('win-small');
      const details = action.details as ClickDetails | MoveDetails;
      expect(details.x).toBeGreaterThanOrEqual(0);
      expect(details.x).toBeLessThanOrEqual(500);
      expect(details.y).toBeGreaterThanOrEqual(0);
      expect(details.y).toBeLessThanOrEqual(300);
    }
  });

  it('rotates round-robin across multiple target windows over successive steps', () => {
    const { handle: win1 } = createMockHandle('win-1', { x: 0, y: 0, width: 800, height: 600 });
    const { handle: win2 } = createMockHandle('win-2', { x: 0, y: 0, width: 1024, height: 768 });
    const { handle: win3 } = createMockHandle('win-3', { x: 0, y: 0, width: 640, height: 480 });
    const context = createMockContext([win1, win2, win3]);
    const generator = new ActionGenerator({
      random: new Mulberry32Generator(123),
      actionTypes: ['click'],
    });
    const collector = new ReportCollector(123);

    let targetIndex = 0;
    for (let i = 0; i < 6; i++) {
      targetIndex = executeFuzzStep(context, baseConfig, generator, collector, null, targetIndex);
    }

    const targetOrder = collector.getReport().actions.map(a => a.windowId);
    expect(targetOrder).toEqual(['win-1', 'win-2', 'win-3', 'win-1', 'win-2', 'win-3']);
  });

  it('dispatches script to webContents of each rotated target window', () => {
    const { handle: win1, executeMock: exec1 } = createMockHandle('win-1');
    const { handle: win2, executeMock: exec2 } = createMockHandle('win-2');
    const context = createMockContext([win1, win2]);
    const generator = new ActionGenerator({ random: new Mulberry32Generator(9) });
    const collector = new ReportCollector(9);

    const nextIndex1 = executeFuzzStep(context, baseConfig, generator, collector, null, 0);
    expect(nextIndex1).toBe(1);
    expect(exec1).toHaveBeenCalledTimes(1);
    expect(exec2).not.toHaveBeenCalled();

    const nextIndex2 = executeFuzzStep(context, baseConfig, generator, collector, null, nextIndex1);
    expect(nextIndex2).toBe(0);
    expect(exec1).toHaveBeenCalledTimes(1);
    expect(exec2).toHaveBeenCalledTimes(1);
  });
});
