/**
 * Step execution and target window resolution for soak fuzzer (T4.4).
 */

import type { BrowserWindow } from 'electron';
import type { ShellContext, WindowHandle } from '../../plugin-api/types.js';
import type { ActionGenerator } from './generator.js';
import { buildActionScript } from './script.js';
import type { ReportCollector } from './reporter.js';
import type { WindowMonitor } from './monitor.js';
import type { FuzzAction, SoakConfig, SoakState } from './types.js';

export function findTargetWindows(
  context: ShellContext<BrowserWindow>,
  config: SoakConfig
): readonly WindowHandle<BrowserWindow>[] {
  const allowed = config.targetWindowIds;
  return context.windows
    .list()
    .filter(handle => allowed === undefined || allowed.includes(handle.id))
    .filter(handle => handle.native !== undefined);
}

export function executeFuzzStep(
  context: ShellContext<BrowserWindow>,
  config: SoakConfig,
  generator: ActionGenerator,
  collector: ReportCollector,
  monitor: WindowMonitor | null,
  targetIndex = 0
): number {
  const targets = findTargetWindows(context, config);
  if (targets.length === 0) return targetIndex;

  const index = targetIndex % targets.length;
  const target = targets[index]!;
  if (!target.native) return (index + 1) % targets.length;

  monitor?.attach(target.id, target.native);
  const bounds =
    typeof target.native.getContentBounds === 'function'
      ? target.native.getContentBounds()
      : undefined;
  const action = generator.nextAction(target.id, Date.now(), bounds?.width, bounds?.height);
  collector.recordAction(action);
  dispatchAction(context, target, action);
  return (index + 1) % targets.length;
}

function dispatchAction(
  context: ShellContext<BrowserWindow>,
  target: WindowHandle<BrowserWindow>,
  action: FuzzAction
): void {
  const script = buildActionScript(action);
  target.native?.webContents.executeJavaScript(script).catch((err: unknown) => {
    context.logger.debug('soak plugin: script execution rejected', { error: String(err) });
  });
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
