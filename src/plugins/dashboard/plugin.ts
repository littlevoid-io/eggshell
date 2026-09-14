/**
 * Remote dashboard plugin implementation (T4.2).
 */

import { existsSync } from 'node:fs';
import type { BrowserWindow } from 'electron';
import type { ShellContext, ShellPlugin } from '../../plugin-api/types.js';
import { resolvePackageAsset } from '../../paths/roots.js';
import { validateDashboardConfig } from './schema.js';
import { DashboardServer } from './server.js';
import { buildDashboardStatus, createDashboardActions } from './status.js';
import type { DashboardConfig } from './types.js';

export const PLUGIN_ID = 'dashboard';

export interface DashboardPluginOptions {
  readonly config?: Partial<DashboardConfig> | undefined;
  readonly server?: DashboardServer | undefined;
}

export function createDashboardPlugin(options: DashboardPluginOptions = {}): ShellPlugin<BrowserWindow> {
  let server: DashboardServer | null = null;

  return {
    id: PLUGIN_ID,
    async setup(context: ShellContext<BrowserWindow>): Promise<void> {
      const config = validateDashboardConfig(options.config ?? context.config);
      if (!config.enabled) {
        context.logger.info('dashboard plugin: disabled by configuration');
        return;
      }

      const assetPath = resolveDashboardAssetPath(context);
      const actions = createDashboardActions(context);
      const getStatus = () => buildDashboardStatus(context);

      server = options.server ?? new DashboardServer({
        config,
        getStatus,
        actions,
        assetPath,
        logger: context.logger,
      });

      await server.start();
      context.status.publish(getStatus());
      registerDashboardCommands(context, actions, getStatus);
    },

    async teardown(): Promise<void> {
      if (server) {
        await server.stop();
        server = null;
      }
    },
  };
}

function resolveDashboardAssetPath(context: ShellContext<BrowserWindow>): string {
  const distPath = resolvePackageAsset(context.roots, 'dist/plugins/dashboard/assets/dashboard.html');
  if (existsSync(distPath)) {
    return distPath;
  }
  return resolvePackageAsset(context.roots, 'src/plugins/dashboard/assets/dashboard.html');
}

function registerDashboardCommands(
  context: ShellContext<BrowserWindow>,
  actions: ReturnType<typeof createDashboardActions>,
  getStatus: () => ReturnType<typeof buildDashboardStatus>
): void {
  context.commands.register('status', () => getStatus());
  context.commands.register('reload-windows', () => actions.reloadWindows());
  context.commands.register('focus-windows', () => actions.focusWindows());
}
