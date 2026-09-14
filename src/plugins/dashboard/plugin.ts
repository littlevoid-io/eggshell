/**
 * Remote dashboard plugin implementation (T4.2).
 */

import { existsSync } from 'node:fs';
import type { BrowserWindow } from 'electron';
import type { ShellContext, ShellPlugin } from '../../plugin-api/types.js';
import { resolvePackageAsset } from '../../paths/roots.js';
import { validateDashboardConfig } from './schema.js';
import { DashboardLogStore } from './logger.js';
import { DashboardServer } from './server.js';
import { buildStatusData, createDashboardActions } from './status-builder.js';
import type { DashboardConfig } from './types.js';

export const PLUGIN_ID = 'dashboard';

export interface DashboardPluginOptions {
  readonly config?: Partial<DashboardConfig>;
  readonly server?: DashboardServer;
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

      const logStore = new DashboardLogStore();
      const assetsPath = resolveDashboardAssetsPath(context);
      const actions = createDashboardActions(context);
      const getStatusData = () => buildStatusData(context);

      server = options.server ?? new DashboardServer({
        config,
        getStatusData,
        actions,
        logStore,
        assetsPath,
        logger: context.logger,
      });

      await server.start();
      context.status.publish(getStatusData());
    },

    async teardown(): Promise<void> {
      if (server) {
        await server.stop();
        server = null;
      }
    },
  };
}

function resolveDashboardAssetsPath(context: ShellContext<BrowserWindow>): string {
  const distPath = resolvePackageAsset(context.roots, 'dist/plugins/dashboard/assets');
  if (existsSync(distPath)) {
    return distPath;
  }
  return resolvePackageAsset(context.roots, 'src/plugins/dashboard/assets');
}
