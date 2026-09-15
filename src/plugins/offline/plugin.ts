/**
 * Offline overlay plugin implementation (T4.1).
 */

import type { BrowserWindow } from 'electron';
import type { ShellContext, ShellPlugin } from '../../plugin-api/types.js';
import { resolvePluginAsset, resolvePluginPreloadPath } from '../shared/asset.js';
import { OverlayViewManager, updateViews } from '../shared/overlay.js';
import { validateOfflineConfig } from './schema.js';
import { OfflineStateMachine } from './state-machine.js';
import { ReachabilityProbe } from './probe.js';
import type { OfflineOverlayConfig, OfflineOverlayState } from './types.js';

export const PLUGIN_ID = 'offline';

export interface OfflinePluginOptions {
  readonly config?: Partial<OfflineOverlayConfig>;
  readonly probe?: ReachabilityProbe;
  readonly viewManager?: OverlayViewManager;
}

export function createOfflinePlugin(options: OfflinePluginOptions = {}): ShellPlugin<BrowserWindow> {
  let timer: NodeJS.Timeout | null = null;
  let viewManager: OverlayViewManager | null = null;

  return {
    id: PLUGIN_ID,
    setup(context: ShellContext<BrowserWindow>): void {
      const config = validateOfflineConfig(options.config ?? context.config);
      if (!config.enabled) {
        context.logger.info('offline plugin: disabled by configuration');
        return;
      }

      const stateMachine = new OfflineStateMachine(config);
      const probe = options.probe ?? new ReachabilityProbe({ pingUrl: config.pingUrl, logger: context.logger });
      viewManager = options.viewManager ?? createDefaultViewManager(context);

      setupHandlers(context, stateMachine, viewManager, config);
      publishState(context, stateMachine.getState());

      timer = setInterval(() => {
        void executeProbe(context, stateMachine, probe, viewManager, config);
      }, config.pollIntervalMs);
    },

    teardown(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      viewManager?.destroy();
      viewManager = null;
    },
  };
}

function createDefaultViewManager(context: ShellContext<BrowserWindow>): OverlayViewManager {
  const assetPath = resolvePluginAsset(context.roots, 'offline', 'offline.html');
  const preloadPath = resolvePluginPreloadPath(context.roots);
  return new OverlayViewManager({
    assetPath,
    preloadPath,
    logPrefix: 'offline overlay',
    logger: context.logger,
  });
}

function setupHandlers(
  context: ShellContext<BrowserWindow>,
  stateMachine: OfflineStateMachine,
  views: OverlayViewManager,
  config: OfflineOverlayConfig
): void {
  const applyChange = (changed: boolean) => {
    // Always call updateViews to ensure newly created windows get the view if it is showing
    updateViews(context, stateMachine.getState().isShowing, views, config);
    if (changed) {
      publishState(context, stateMachine.getState());
    }
  };

  context.ipc.handle('status', () => stateMachine.getState());
  context.ipc.handle('dismiss', () => applyChange(stateMachine.dismiss()));
  context.ipc.handle('force-show', () => applyChange(stateMachine.forceShow()));
  context.ipc.handle('toggle', () => applyChange(stateMachine.toggle()));

  context.commands.register('status', () => stateMachine.getState());
  context.commands.register('dismiss', () => applyChange(stateMachine.dismiss()));
  context.commands.register('force-show', () => applyChange(stateMachine.forceShow()));
  context.commands.register('toggle', () => applyChange(stateMachine.toggle()));
}

async function executeProbe(
  context: ShellContext<BrowserWindow>,
  stateMachine: OfflineStateMachine,
  probe: ReachabilityProbe,
  views: OverlayViewManager | null,
  config: OfflineOverlayConfig
): Promise<void> {
  const online = await probe.check();
  const changed = stateMachine.handleProbeResult(online, Date.now());
  if (changed && views !== null) {
    updateViews(context, stateMachine.getState().isShowing, views, config);
    publishState(context, stateMachine.getState());
  }
}

function publishState(context: ShellContext<BrowserWindow>, state: OfflineOverlayState): void {
  context.status.publish(state);
}
