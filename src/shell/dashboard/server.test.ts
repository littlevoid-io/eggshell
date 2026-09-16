import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import type { DashboardConfig } from '../../config/types.js';
import { noopLogger } from '../../logging/logger.js';
import { createDashboardServer } from './server.js';

describe('createDashboardServer', () => {
  let serverInstance: ReturnType<typeof createDashboardServer> | undefined;

  afterEach(async () => {
    if (serverInstance) {
      await serverInstance.stop();
      serverInstance = undefined;
    }
  });

  it('starts on port 0, serves static files, and provides url', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eggshell-dashboard-test-'));
    fs.writeFileSync(path.join(tempDir, 'index.html'), '<html><body>Hello Dashboard</body></html>');

    const config: DashboardConfig = {
      enabled: true,
      port: 0,
      host: '127.0.0.1',
      allowRestart: true,
      allowQuit: true,
      logBufferSize: 500,
    };

    serverInstance = createDashboardServer({
      config,
      uiDirectory: tempDir,
      router: Router(),
      logger: noopLogger,
    });

    const port = await serverInstance.start();
    expect(port).toBeGreaterThan(0);
    expect(serverInstance.url()).toContain(`:${port}/`);

    const response = await fetch(`http://127.0.0.1:${port}/`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Hello Dashboard');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('responds with 404 text when UI is not built', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eggshell-dashboard-empty-'));

    const config: DashboardConfig = {
      enabled: true,
      port: 0,
      host: '127.0.0.1',
      allowRestart: true,
      allowQuit: true,
      logBufferSize: 500,
    };

    serverInstance = createDashboardServer({
      config,
      uiDirectory: emptyDir,
      router: Router(),
      logger: noopLogger,
    });

    const port = await serverInstance.start();
    const response = await fetch(`http://127.0.0.1:${port}/`);
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toBe('Dashboard UI not built');

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
