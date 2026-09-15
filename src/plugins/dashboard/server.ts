/**
 * HTTP server lifecycle for remote dashboard (T4.2).
 */

import express, { json } from 'express';
import type { Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import type { Logger } from '../../logging/logger.js';
import { noopLogger } from '../../logging/logger.js';
import { createAuthMiddleware } from './auth.js';
import { createDashboardRouter } from './router.js';
import type { DashboardActions, DashboardConfig, DashboardStatus } from './types.js';

export interface DashboardServerOptions {
  readonly config: DashboardConfig;
  readonly getStatus: () => DashboardStatus;
  readonly actions: DashboardActions;
  readonly assetPath: string;
  readonly logger?: Logger | undefined;
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
    this.configureStaticServing(options.assetPath);
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
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server?.close(err => {
        if (err) reject(err);
        else {
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
      getStatus: options.getStatus,
      actions: options.actions,
    });
    this.app.use('/api', router);
  }

  private configureStaticServing(assetPath: string): void {
    this.app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) {
        next();
        return;
      }
      if (existsSync(assetPath)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(readFileSync(assetPath, 'utf8'));
      } else {
        res.status(404).send('Dashboard UI asset not found');
      }
    });
  }
}
