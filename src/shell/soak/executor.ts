import type { Logger } from '../../logging/logger.js';
import type { ManagedWindow } from '../windows/create.js';
import type { ActionGenerator } from './generator.js';
import type { WindowMonitor } from './monitor.js';
import type { ReportCollector } from './reporter.js';
import { buildActionScript } from './script.js';
import type { SoakState, SoakStep } from './types.js';

function dispatchStep(target: ManagedWindow, step: SoakStep, logger?: Logger): void {
  const script = buildActionScript(step);
  target.window.webContents.executeJavaScript(script).catch((err: unknown) => {
    logger?.debug('soak: script execution rejected', { error: String(err) });
  });
}

function getWindowBounds(window: ManagedWindow['window']) {
  return typeof window.getContentBounds === 'function' ? window.getContentBounds() : undefined;
}

function runStepOnTarget(
  target: ManagedWindow,
  generator: ActionGenerator,
  collector: ReportCollector,
  monitor?: WindowMonitor | null,
  logger?: Logger
): void {
  monitor?.attach(target.id, target.window);
  const bounds = getWindowBounds(target.window);
  const step = generator.nextStep(target.id, Date.now(), bounds?.width, bounds?.height);
  collector.recordStep(step);
  dispatchStep(target, step, logger);
}

export function executeSoakStep(
  windows: readonly ManagedWindow[],
  generator: ActionGenerator,
  collector: ReportCollector,
  monitor?: WindowMonitor | null,
  logger?: Logger,
  targetIndex = 0
): number {
  if (windows.length === 0) return targetIndex;
  const index = targetIndex % windows.length;
  const target = windows[index];
  if (target === undefined || target.window.isDestroyed?.()) {
    return (index + 1) % windows.length;
  }
  runStepOnTarget(target, generator, collector, monitor, logger);
  return (index + 1) % windows.length;
}

export function buildSoakState(
  collector: ReportCollector | null,
  running: boolean,
  seed: number
): SoakState {
  return {
    running,
    seed,
    actionCount: collector?.getActionCount() ?? 0,
    crashCount: collector?.getCrashCount() ?? 0,
    errorCount: collector?.getErrorCount() ?? 0,
  };
}
