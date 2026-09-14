/**
 * Step execution and target window resolution for soak fuzzer (T4.4).
 */

import type { BrowserWindow } from 'electron';
import type { ShellContext, WindowHandle } from '../../plugin-api/types.js';
import type { ActionGenerator } from './generator.js';
import { buildActionScript } from './script.js';
import type { ReportCollector } from './reporter.js';
import type { WindowMonitor } from './monitor.js';
import type { SoakConfig, SoakState } from './types.js';

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
  monitor: WindowMonitor | null
): void {
  const targets = findTargetWindows(context, config);
  if (targets.length === 0) return;

  const target = targets[0]!;
  if (!target.native) return;

  monitor?.attach(target.id, target.native);
  const action = generator.nextAction(target.id, Date.now());
  collector.recordAction(action);

  const script = buildActionScript(action);
  target.native.webContents.executeJavaScript(script).catch((err: unknown) => {
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
