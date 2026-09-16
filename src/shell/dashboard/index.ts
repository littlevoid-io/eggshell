import type { DashboardConfig } from '../../config/types.js';
import type { LogBroadcast } from '../../logging/broadcast.js';
import type { Logger } from '../../logging/logger.js';
import { type ActionSources, createActions } from './actions.js';
import { createDashboardRouter } from './router.js';
import { createDashboardServer } from './server.js';
import { type StatusSources, buildStatus } from './status.js';

export interface DashboardOptions {
  readonly config: DashboardConfig;
  readonly uiDirectory: string;
  readonly status: StatusSources;
  readonly actions: ActionSources;
  readonly logs: LogBroadcast;
  readonly logger: Logger;
}

export interface Dashboard {
  start(): Promise<void>;
  stop(): Promise<void>;
}

function buildDashboardServer(options: DashboardOptions) {
  const actions = createActions(options.actions);
  const router = createDashboardRouter({
    config: options.config,
    getStatus: () => buildStatus(options.status),
    actions,
    logs: options.logs,
  });
  return createDashboardServer({
    config: options.config,
    uiDirectory: options.uiDirectory,
    router,
    logger: options.logger,
  });
}

function buildDashboard(options: DashboardOptions): Dashboard {
  const server = buildDashboardServer(options);
  return {
    async start(): Promise<void> {
      await server.start();
      options.logger.info('dashboard listening', { url: server.url() });
    },
    stop: () => server.stop(),
  };
}

export function createDashboard(options: DashboardOptions): Dashboard {
  if (!options.config.enabled) {
    return {
      start: async () => {},
      stop: async () => {},
    };
  }
  return buildDashboard(options);
}
