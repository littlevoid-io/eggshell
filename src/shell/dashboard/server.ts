import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import express, {
  json,
  static as serveStatic,
  type Express,
  type NextFunction,
  type Request,
  type Response,
  type Router,
} from 'express';
import type { DashboardConfig } from '../../config/types.js';
import type { Logger } from '../../logging/logger.js';
import { detectLocalIp } from '../companion/network.js';
import { createAuthMiddleware } from './auth.js';

export interface DashboardServerOptions {
  readonly config: DashboardConfig;
  readonly uiDirectory: string;
  readonly router: Router;
  readonly logger: Logger;
}

export interface DashboardServer {
  start(): Promise<number>;
  stop(): Promise<void>;
  url(): string;
}

function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-dashboard-token');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
}

function handleSpaFallback(
  uiDirectory: string,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    const indexHtml = path.resolve(uiDirectory, 'index.html');
    if (existsSync(indexHtml)) {
      res.sendFile(indexHtml);
      return;
    }
    res.status(404).type('text/plain').send('Dashboard UI not built');
    return;
  }
  next();
}

function buildApp(options: DashboardServerOptions): Express {
  const app = express();
  app.use(json());
  app.use(corsMiddleware);
  app.use('/api', createAuthMiddleware(options.config.token), options.router);
  app.use(serveStatic(options.uiDirectory));
  app.use((req, res, next) => handleSpaFallback(options.uiDirectory, req, res, next));
  return app;
}

function listenServer(
  app: Express,
  config: DashboardConfig,
  onInstance: (instance: Server) => void
): Promise<number> {
  return new Promise((resolve, reject) => {
    const instance = app.listen(config.port, config.host, () => {
      instance.removeListener('error', onError);
      const address = instance.address();
      const port = typeof address === 'object' && address !== null ? address.port : config.port;
      resolve(port);
    });
    const onError = (error: Error) => reject(error);
    instance.once('error', onError);
    onInstance(instance);
  });
}

function closeServer(server: Server | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function createDashboardServer(options: DashboardServerOptions): DashboardServer {
  const app = buildApp(options);
  let activeServer: Server | undefined;
  let boundPort: number | undefined;

  return {
    async start(): Promise<number> {
      boundPort = await listenServer(app, options.config, s => {
        activeServer = s;
      });
      return boundPort;
    },
    stop: () => closeServer(activeServer),
    url: () => `http://${detectLocalIp()}:${boundPort ?? options.config.port}/`,
  };
}
