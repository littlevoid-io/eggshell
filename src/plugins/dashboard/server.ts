/**
 * Express HTTP server lifecycle for remote dashboard (T4.2).
 */

import express, { json, static as serveStatic } from 'express';
import type { Server } from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { Logger } from '../../logging/logger.js';
import { noopLogger } from '../../logging/logger.js';
import { createAuthMiddleware } from './auth.js';
import { createDashboardRouter } from './routes.js';
import type { DashboardActions, DashboardConfig, DashboardStatusData } from './types.js';
import type { DashboardLogStore } from './logger.js';

export interface DashboardServerOptions {
  readonly config: DashboardConfig;
  readonly getStatusData: () => DashboardStatusData;
  readonly actions: DashboardActions;
  readonly logStore: DashboardLogStore;
  readonly assetsPath: string;
  readonly logger?: Logger;
}

export class DashboardServer {
  private server: Server | null = null;
  private readonly app = express();
  private readonly config: DashboardConfig;
  private readonly logger: Logger;

  constructor(options: DashboardServerOptions) {
    this.config = options.config;
    this.logger = options.logger ?? noopLogger;
    this.configureMiddleware();
    this.configureRoutes(options);
    this.configureStaticServing(options.assetsPath);
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.config.port, this.config.host, () => {
        const address = this.server?.address();
        const port = typeof address === 'object' && address !== null ? address.port : this.config.port;
        this.logger.info(`dashboard server listening on http://${this.config.host}:${port}`);
        resolve(port);
      });
      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    return new Promise((resolve, reject) => {
      this.server?.close(err => {
        if (err) {
          reject(err);
        } else {
          this.server = null;
          resolve();
        }
      });
    });
  }

  private configureMiddleware(): void {
    this.app.use(json());
    this.app.use((_req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-dashboard-token');
      next();
    });
    this.app.use('/api', createAuthMiddleware(this.config.token));
  }

  private configureRoutes(options: DashboardServerOptions): void {
    const router = createDashboardRouter({
      config: this.config,
      getStatusData: options.getStatusData,
      actions: options.actions,
      logStore: options.logStore,
    });
    this.app.use('/api', router);
  }

  private configureStaticServing(assetsPath: string): void {
    if (!existsSync(assetsPath)) {
      return;
    }
    this.app.use(serveStatic(assetsPath));
    const indexPath = path.join(assetsPath, 'index.html');
    this.app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api') && existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        next();
      }
    });
  }
}
