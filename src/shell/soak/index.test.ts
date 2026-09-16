import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { createFakeClock } from '../../__testing__/fake-clock.js';
import type { ResolvedApp } from '../../config/resolved.js';
import type { SoakConfig } from '../../config/types.js';
import { LaunchError } from '../../errors.js';
import type { Logger } from '../../logging/logger.js';
import type { IpcRouter } from '../ipc.js';
import type { ManagedWindow } from '../windows/create.js';
import { startSoak } from './index.js';
import { MemoryReportWriter } from './reporter.js';

function createMockWindow(id: string) {
  const executeMock = vi.fn().mockResolvedValue(undefined);
  const webContents = { executeJavaScript: executeMock, on: vi.fn(), removeListener: vi.fn() };
  const window = {
    webContents,
    getContentBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 800, height: 600 }),
    isDestroyed: vi.fn().mockReturnValue(false),
  } as unknown as BrowserWindow;
  return { managed: { id, window } as ManagedWindow, executeMock };
}

function createMockRouter(): IpcRouter {
  const handlers = new Map<string, unknown>();
  return {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    attach: vi.fn(),
    channels: () => Array.from(handlers.keys()),
  };
}

function createMockLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const mockResolved = {
  userData: 'C:/fake-userdata',
  appDir: 'C:/fake-appdir',
  isDev: true,
} as unknown as ResolvedApp;

const baseConfig: SoakConfig = {
  enabled: true,
  intervalMs: 100,
  actions: ['click', 'move'],
  reportPath: 'soak-report.json',
};

describe('startSoak', () => {
  it('throws LaunchError when isPackaged is true', () => {
    const router = createMockRouter();
    const logger = createMockLogger();
    expect(() =>
      startSoak({
        config: baseConfig,
        windows: [],
        resolved: mockResolved,
        router,
        logger,
        isPackaged: true,
      })
    ).toThrow(LaunchError);
  });

  it('runs nothing and returns no-op runner when disabled', async () => {
    const router = createMockRouter();
    const logger = createMockLogger();
    const runner = startSoak({
      config: { ...baseConfig, enabled: false },
      windows: [],
      resolved: mockResolved,
      router,
      logger,
      isPackaged: false,
    });

    expect(runner.state.running).toBe(false);
    expect(router.handle).toHaveBeenCalledWith('soak:status', expect.any(Function));
    await expect(runner.stop()).resolves.toBeUndefined();
  });

  it('executes steps on fake windows and writes report to injected writer', async () => {
    const clock = createFakeClock();
    const router = createMockRouter();
    const logger = createMockLogger();
    const writer = new MemoryReportWriter();
    const { managed: win1, executeMock: exec1 } = createMockWindow('w1');
    const { managed: win2, executeMock: exec2 } = createMockWindow('w2');

    const runner = startSoak({
      config: baseConfig,
      windows: [win1, win2],
      resolved: mockResolved,
      router,
      logger,
      isPackaged: false,
      clock,
      reportWriter: writer,
    });

    expect(runner.state.running).toBe(true);
    expect(runner.state.actionCount).toBe(0);

    clock.advance(100);
    expect(exec1).toHaveBeenCalledTimes(1);
    expect(exec2).toHaveBeenCalledTimes(0);
    expect(runner.state.actionCount).toBe(1);

    clock.advance(100);
    expect(exec1).toHaveBeenCalledTimes(1);
    expect(exec2).toHaveBeenCalledTimes(1);
    expect(runner.state.actionCount).toBe(2);

    await runner.stop();
    expect(runner.state.running).toBe(false);
    expect(writer.getReports()).toHaveLength(1);
    expect(writer.getLastReport()?.completedActions).toBe(2);
  });

  it('stops automatically after maxActions is reached', async () => {
    const clock = createFakeClock();
    const router = createMockRouter();
    const logger = createMockLogger();
    const writer = new MemoryReportWriter();
    const { managed: win1 } = createMockWindow('w1');

    const runner = startSoak({
      config: { ...baseConfig, maxActions: 2 },
      windows: [win1],
      resolved: mockResolved,
      router,
      logger,
      isPackaged: false,
      clock,
      reportWriter: writer,
    });

    clock.advance(100);
    clock.advance(100);
    await vi.waitFor(() => expect(runner.state.running).toBe(false));
    expect(writer.getReports()).toHaveLength(1);
    expect(writer.getLastReport()?.completedActions).toBe(2);
  });
});
