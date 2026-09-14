/**
 * Express router for remote dashboard endpoints (T4.2).
 */

import { Router, type Request, type Response } from 'express';
import type { DashboardActions, DashboardConfig, DashboardStatus } from './types.js';

export interface DashboardRouterOptions {
  readonly config: DashboardConfig;
  readonly getStatus: () => DashboardStatus;
  readonly actions: DashboardActions;
}

export function createDashboardRouter(options: DashboardRouterOptions): Router {
  const router = Router();
  const { config, getStatus, actions } = options;

  router.get('/status', (_req: Request, res: Response) => {
    res.json(getStatus());
  });

  router.post('/reload-windows', (_req: Request, res: Response) => {
    actions.reloadWindows();
    res.json({ success: true });
  });

  router.post('/focus-windows', (_req: Request, res: Response) => {
    actions.focusWindows();
    res.json({ success: true });
  });

  router.post('/restart', (_req: Request, res: Response) => {
    if (!config.allowRestart || !actions.restart) {
      res.status(403).json({ error: 'Restart is disabled by configuration' });
      return;
    }
    res.json({ success: true });
    actions.restart();
  });

  router.post('/quit', (_req: Request, res: Response) => {
    if (!config.allowQuit || !actions.quit) {
      res.status(403).json({ error: 'Quit is disabled by configuration' });
      return;
    }
    res.json({ success: true });
    actions.quit();
  });

  return router;
}
