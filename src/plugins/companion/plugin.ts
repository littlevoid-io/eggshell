/**
 * Companion QR/info overlay plugin implementation (T4.3).
 */

import { existsSync } from 'node:fs';
import type { BrowserWindow } from 'electron';
import type { ShellContext, ShellPlugin } from '../../plugin-api/types.js';
import { resolvePackageAsset } from '../../paths/roots.js';
import { validateCompanionConfig } from './schema.js';
import { buildCompanionUrl, detectLocalIp } from './network.js';
import { generateQrDataUrl } from './qr.js';
import { CompanionStateMachine } from './state-machine.js';
import { CompanionViewManager } from './view.js';
import type { CompanionConfig, CompanionPluginOptions, CompanionState } from './types.js';

export const PLUGIN_ID = 'companion';

export type { CompanionPluginOptions } from './types.js';

export function createCompanionPlugin(
  options: CompanionPluginOptions = {}
): ShellPlugin<BrowserWindow> {
  let viewManager: CompanionViewManager | null = null;

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

function createDefaultViewManager(context: ShellContext<BrowserWindow>): CompanionViewManager {
  const assetPath = resolveAssetPath(context);
  const preloadPath = resolvePreloadPath(context);
  return new CompanionViewManager({ assetPath, preloadPath, logger: context.logger });
}

function resolveAssetPath(context: ShellContext<BrowserWindow>): string {
  const distPath = resolvePackageAsset(
    context.roots,
    'dist/plugins/companion/assets/companion.html'
  );
  if (existsSync(distPath)) {
    return distPath;
  }
  return resolvePackageAsset(context.roots, 'src/plugins/companion/assets/companion.html');
}

function resolvePreloadPath(context: ShellContext<BrowserWindow>): string {
  return resolvePackageAsset(context.roots, 'dist/preload.cjs');
}

function setupHandlers(
  context: ShellContext<BrowserWindow>,
  stateMachine: CompanionStateMachine,
  views: CompanionViewManager,
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

function updateViews(
  context: ShellContext<BrowserWindow>,
  showing: boolean,
  views: CompanionViewManager,
  config: CompanionConfig
): void {
  const targets = filterTargetWindows(context, config);
  if (showing) {
    views.show(targets);
  } else {
    views.hide(targets);
  }
}

function filterTargetWindows(
  context: ShellContext<BrowserWindow>,
  config: CompanionConfig
): BrowserWindow[] {
  const allowed = config.targetWindowIds;
  return context.windows
    .list()
    .filter(handle => allowed === undefined || allowed.includes(handle.id))
    .map(handle => handle.native)
    .filter((win): win is BrowserWindow => win !== undefined);
}

function publishState(context: ShellContext<BrowserWindow>, state: CompanionState): void {
  context.status.publish(state);
}
