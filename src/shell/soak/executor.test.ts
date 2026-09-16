import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { ManagedWindow } from '../windows/create.js';
import { buildSoakState, executeSoakStep } from './executor.js';
import { ActionGenerator } from './generator.js';
import { Mulberry32Generator } from './prng.js';
import { ReportCollector } from './reporter.js';
import type { ClickDetails, MoveDetails } from './types.js';

function createMockWindow(
  id: string,
  bounds = { x: 0, y: 0, width: 800, height: 600 }
): {
  managed: ManagedWindow;
  executeMock: ReturnType<typeof vi.fn>;
} {
  const executeMock = vi.fn().mockResolvedValue(undefined);
  const webContents = { executeJavaScript: executeMock, on: vi.fn(), removeListener: vi.fn() };
  const window = {
    webContents,
    getContentBounds: vi.fn().mockReturnValue(bounds),
    isDestroyed: vi.fn().mockReturnValue(false),
  } as unknown as BrowserWindow;
  return { managed: { id, window }, executeMock };
}

describe('executor', () => {
  it('returns targetIndex unchanged when windows is empty', () => {
    const generator = new ActionGenerator({ random: new Mulberry32Generator(42) });
    const collector = new ReportCollector(42);
    const nextIndex = executeSoakStep([], generator, collector, null, undefined, 2);
    expect(nextIndex).toBe(2);
  });

  it('skips destroyed window and moves to next index', () => {
    const { managed: win1 } = createMockWindow('win-1');
    const { managed: win2 } = createMockWindow('win-2');
    (win1.window.isDestroyed as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const generator = new ActionGenerator({ random: new Mulberry32Generator(42) });
    const collector = new ReportCollector(42);
    const nextIndex = executeSoakStep([win1, win2], generator, collector, null, undefined, 0);

    expect(nextIndex).toBe(1);
    expect(collector.getActionCount()).toBe(0);
  });

  it('generates coordinates constrained by target window getContentBounds', () => {
    const { managed: win } = createMockWindow('win-small', {
      x: 50,
      y: 50,
      width: 500,
      height: 300,
    });
    const generator = new ActionGenerator({
      random: new Mulberry32Generator(42),
      actionTypes: ['click', 'move'],
    });
    const collector = new ReportCollector(42);

    for (let i = 0; i < 30; i++) {
      executeSoakStep([win], generator, collector, null, undefined, 0);
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
    const { managed: win1 } = createMockWindow('win-1', { x: 0, y: 0, width: 800, height: 600 });
    const { managed: win2 } = createMockWindow('win-2', { x: 0, y: 0, width: 1024, height: 768 });
    const { managed: win3 } = createMockWindow('win-3', { x: 0, y: 0, width: 640, height: 480 });
    const windows = [win1, win2, win3];
    const generator = new ActionGenerator({
      random: new Mulberry32Generator(123),
      actionTypes: ['click'],
    });
    const collector = new ReportCollector(123);

    let targetIndex = 0;
    for (let i = 0; i < 6; i++) {
      targetIndex = executeSoakStep(windows, generator, collector, null, undefined, targetIndex);
    }

    const targetOrder = collector.getReport().actions.map(a => a.windowId);
    expect(targetOrder).toEqual(['win-1', 'win-2', 'win-3', 'win-1', 'win-2', 'win-3']);
  });

  it('dispatches script to webContents of each rotated target window', () => {
    const { managed: win1, executeMock: exec1 } = createMockWindow('win-1');
    const { managed: win2, executeMock: exec2 } = createMockWindow('win-2');
    const windows = [win1, win2];
    const generator = new ActionGenerator({ random: new Mulberry32Generator(9) });
    const collector = new ReportCollector(9);

    const nextIndex1 = executeSoakStep(windows, generator, collector, null, undefined, 0);
    expect(nextIndex1).toBe(1);
    expect(exec1).toHaveBeenCalledTimes(1);
    expect(exec2).not.toHaveBeenCalled();

    const nextIndex2 = executeSoakStep(windows, generator, collector, null, undefined, nextIndex1);
    expect(nextIndex2).toBe(0);
    expect(exec1).toHaveBeenCalledTimes(1);
    expect(exec2).toHaveBeenCalledTimes(1);
  });

  it('builds state correctly with collector and running status', () => {
    const collector = new ReportCollector(123);
    const state = buildSoakState(collector, true, 123);
    expect(state).toEqual({
      running: true,
      seed: 123,
      actionCount: 0,
      crashCount: 0,
      errorCount: 0,
    });
  });
});
