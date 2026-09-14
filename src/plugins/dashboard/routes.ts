/**
 * Express router for remote dashboard endpoints (T4.2).
 */

import { Router, type Request, type Response } from 'express';
import type { DashboardActions, DashboardConfig, DashboardStatusData } from './types.js';
import type { DashboardLogStore } from './logger.js';

export interface RouterOptions {
  readonly config: DashboardConfig;
  readonly getStatusData: () => DashboardStatusData;
  readonly actions: DashboardActions;
  readonly logStore: DashboardLogStore;
}

export function createDashboardRouter(options: RouterOptions): Router {
  const router = Router();
  const { config, getStatusData, actions, logStore } = options;

  router.get('/status', (_req: Request, res: Response) => {
    res.json(getStatusData());
  });

  router.get('/logs-stream', (req: Request, res: Response) => {
    handleLogsStream(req, res, getStatusData, logStore);
  });

  router.post('/reload-windows', (_req: Request, res: Response) => {
    actions.reloadWindows();
    res.json({ success: true });
  });

  router.post('/focus-windows', (_req: Request, res: Response) => {
    actions.focusWindows();
    res.json({ success: true });
  });

  router.post('/recalculate-layout', (_req: Request, res: Response) => {
    actions.recalculateLayout?.();
    res.json({ success: true });
  });

  router.post('/toggle-offline', (req: Request, res: Response) => {
    actions.toggleOffline(req.body?.show as boolean | undefined);
    res.json({ success: true });
  });

  router.post('/toggle-companion', (req: Request, res: Response) => {
    actions.toggleCompanion(req.body?.show as boolean | undefined);
    res.json({ success: true });
  });

  router.post('/restart-app', (_req: Request, res: Response) => {
    if (!config.allowRestart || !actions.restartApp) {
      res.status(403).json({ error: 'Restart is not permitted by configuration' });
      return;
    }
    res.json({ success: true });
    actions.restartApp();
  });

  return router;
}

function handleLogsStream(
  req: Request,
  res: Response,
  getStatusData: () => DashboardStatusData,
  logStore: DashboardLogStore
): void {
  req.socket.setKeepAlive(true);
  req.socket.setNoDelay(true);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'status', status: getStatusData() })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'logs', logs: logStore.getLogs() })}\n\n`);

  const statusInterval = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'status', status: getStatusData() })}\n\n`);
  }, 2000);

  const unsubscribe = logStore.addListener(entry => {
    res.write(`data: ${JSON.stringify({ type: 'log', log: entry })}\n\n`);
  });

  req.on('close', () => {
    clearInterval(statusInterval);
    unsubscribe();
  });
}
