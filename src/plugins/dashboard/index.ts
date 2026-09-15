/**
 * Public exports for the `dashboard` plugin (T4.2).
 */

export { PLUGIN_ID, createDashboardPlugin } from './plugin.js';
export type { DashboardPluginOptions } from './plugin.js';
export { dashboardConfigSchema, validateDashboardConfig } from './schema.js';
export { DashboardServer } from './server.js';
export type { DashboardServerOptions } from './server.js';
export { createDashboardRouter } from './router.js';
export type { DashboardRouterOptions } from './router.js';
export { constantTimeEquals, extractToken, createAuthMiddleware } from './auth.js';
export { buildDashboardStatus, createDashboardActions } from './status.js';
export type {
  DashboardConfig,
  DashboardStatus,
  DashboardActions,
  WindowSummary,
} from './types.js';
