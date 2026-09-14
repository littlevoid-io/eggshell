/**
 * Public exports for the `dashboard` plugin (T4.2).
 */

export { PLUGIN_ID, createDashboardPlugin } from './plugin.js';
export type { DashboardPluginOptions } from './plugin.js';
export { dashboardConfigSchema, validateDashboardConfig } from './schema.js';
export { DashboardServer } from './server.js';
export type { DashboardServerOptions } from './server.js';
export { DashboardLogStore } from './logger.js';
export { constantTimeEquals, extractRequestToken, createAuthMiddleware } from './auth.js';
export { buildStatusData, createDashboardActions } from './status-builder.js';
export type {
  DashboardConfig,
  DashboardStatusData,
  DashboardActions,
  LogEntry,
  WindowStatusItem,
  DisplayStatusItem,
} from './types.js';
