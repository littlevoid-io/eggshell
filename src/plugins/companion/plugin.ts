/**
 * Companion QR/info overlay plugin implementation (T4.3).
 */

import type { BrowserWindow } from 'electron';
import type { ShellContext, ShellPlugin } from '../../plugin-api/types.js';
import { resolvePluginAsset, resolvePluginPreloadPath } from '../shared/asset.js';
import { OverlayViewManager, updateViews } from '../shared/overlay.js';
import { validateCompanionConfig } from './schema.js';
import { buildCompanionUrl, detectLocalIp } from './network.js';
import { generateQrDataUrl } from './qr.js';
import { CompanionStateMachine } from './state-machine.js';
import type { CompanionConfig, CompanionPluginOptions, CompanionState } from './types.js';

export const PLUGIN_ID = 'companion';

export type { CompanionPluginOptions } from './types.js';

export function createCompanionPlugin(
  options: CompanionPluginOptions = {}
): ShellPlugin<BrowserWindow> {
  let viewManager: OverlayViewManager | null = null;

  return {
    id: PLUGIN_ID,
    async setup(context: ShellContext<BrowserWindow>): Promise<void> {
      const config = validateCompanionConfig(options.config ?? context.config);
      if (!config.enabled) {
        context.logger.info('companion plugin: disabled by configuration');
        return;
      }

      const url = buildCompanionUrl(config, options.ipResolver ?? detectLocalIp);
      const qrDataUrl = await generateQrDataUrl(url, options.qrGenerator);
      if (context.signal.aborted) {
        context.logger.debug('companion plugin: setup aborted by teardown');
        return;
      }
      const stateMachine = new CompanionStateMachine({
        url,
        qrDataUrl,
        title: config.title,
        description: config.description,
        isShowing: config.autoShow,
      });

      viewManager = options.viewManager ?? createDefaultViewManager(context);
      setupHandlers(context, stateMachine, viewManager, config);
      publishState(context, stateMachine.getState());

      if (config.autoShow) {
        updateViews(context, true, viewManager, config);
      }
    },

    teardown(): void {
      viewManager?.destroy();
      viewManager = null;
    },
  };
}

function createDefaultViewManager(context: ShellContext<BrowserWindow>): OverlayViewManager {
  const assetPath = resolvePluginAsset(context.roots, 'companion', 'companion.html');
  const preloadPath = resolvePluginPreloadPath(context.roots);
  return new OverlayViewManager({
    assetPath,
    preloadPath,
    logPrefix: 'companion overlay',
    logger: context.logger,
  });
}

function setupHandlers(
  context: ShellContext<BrowserWindow>,
  stateMachine: CompanionStateMachine,
  views: OverlayViewManager,
  config: CompanionConfig
): void {
  const applyChange = (changed: boolean) => {
    // Always call updateViews to ensure newly created windows get the view if it is showing
    updateViews(context, stateMachine.getState().isShowing, views, config);
    if (changed) {
      publishState(context, stateMachine.getState());
    }
  };

  context.ipc.handle('status', () => stateMachine.getState());
  context.ipc.handle('show', () => applyChange(stateMachine.show()));
  context.ipc.handle('hide', () => applyChange(stateMachine.hide()));
  context.ipc.handle('dismiss', () => applyChange(stateMachine.hide()));
  context.ipc.handle('toggle', () => applyChange(stateMachine.toggle()));

  context.commands.register('status', () => stateMachine.getState());
  context.commands.register('show', () => applyChange(stateMachine.show()));
  context.commands.register('hide', () => applyChange(stateMachine.hide()));
  context.commands.register('dismiss', () => applyChange(stateMachine.hide()));
  context.commands.register('toggle', () => applyChange(stateMachine.toggle()));
}

function publishState(context: ShellContext<BrowserWindow>, state: CompanionState): void {
  context.status.publish(state);
}
