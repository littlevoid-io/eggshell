import { Router, type Response } from 'express';
import type { Clock } from '../../clock.js';
import type { DashboardConfig } from '../../config/types.js';
import type { LogBroadcast } from '../../logging/broadcast.js';
import { streamLogs } from './sse.js';
import type { DashboardActions, DashboardStatus } from './types.js';

export interface RouterOptions {
  readonly config: DashboardConfig;
  readonly getStatus: () => DashboardStatus;
  readonly actions: DashboardActions;
  readonly logs: LogBroadcast;
  readonly clock?: Clock | undefined;
}

function extractShowFlag(body: unknown): boolean | undefined {
  if (typeof body === 'object' && body !== null && 'show' in body) {
    const value = (body as Record<string, unknown>).show;
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
}

function handleRestart(res: Response, options: RouterOptions): void {
  if (!options.config.allowRestart) {
    res.status(403).json({ error: 'Restart is disabled' });
    return;
  }
  res.json({ success: true });
  options.actions.restart();
}

function handleQuit(res: Response, options: RouterOptions): void {
  if (!options.config.allowQuit) {
    res.status(403).json({ error: 'Quit is disabled' });
    return;
  }
  res.json({ success: true });
  options.actions.quit();
}

function registerQueryRoutes(router: Router, options: RouterOptions): void {
  router.get('/status', (_req, res) => res.json(options.getStatus()));
  router.get('/logs', (_req, res) => res.json({ lines: options.logs.recent() }));
  router.get('/logs-stream', (req, res) => {
    streamLogs(res, { getStatus: options.getStatus, logs: options.logs, req });
  });
}

function registerActionRoutes(router: Router, actions: DashboardActions): void {
  router.post('/reload-windows', (_req, res) => {
    actions.reloadWindows();
    res.json({ success: true });
  });
  router.post('/focus-windows', (_req, res) => {
    actions.focusWindows();
    res.json({ success: true });
  });
  router.post('/recalculate-layout', (_req, res) => {
    actions.recalculateLayout();
    res.json({ success: true });
  });
}

function registerOverlayRoutes(router: Router, actions: DashboardActions): void {
  router.post('/toggle-offline', (req, res) => {
    actions.setOffline(extractShowFlag(req.body));
    res.json({ success: true });
  });
  router.post('/toggle-companion', (req, res) => {
    actions.setCompanion(extractShowFlag(req.body));
    res.json({ success: true });
  });
}

export function createDashboardRouter(options: RouterOptions): Router {
  const router = Router();
  registerQueryRoutes(router, options);
  registerActionRoutes(router, options.actions);
  registerOverlayRoutes(router, options.actions);
  router.post('/restart', (_req, res) => handleRestart(res, options));
  router.post('/quit', (_req, res) => handleQuit(res, options));
  return router;
}
