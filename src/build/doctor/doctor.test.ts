import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { runDoctor } from '../doctor.js';
import type { DoctorOptions } from './types.js';

describe('runDoctor orchestrator', () => {
  let tempDir: string;
  let fakeBinary: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doctor-orchestrator-'));
    fakeBinary = path.join(tempDir, 'electron.exe');
    await fs.writeFile(fakeBinary, 'fake binary');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('runs all 9 checks and returns overallStatus pass when healthy', async () => {
    const validConfig = {
      appId: 'com.example.app',
      productName: 'App',
      windows: [{ id: 'main', url: 'https://example.com', target: { kind: 'primary' } }],
    };

    const options: DoctorOptions = {
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config: validConfig,
      resolveElectron: async () => fakeBinary,
      getDisplays: async () => [{ id: 0 }],
      touchProbe: { detect: async () => [] },
      isPortFree: async () => true,
      assetExists: async () => true,
    };

    const report = await runDoctor(options);
    expect(report.overallStatus).toBe('pass');
    expect(report.checks).toHaveLength(9);

    const checkNames = report.checks.map(c => c.name);
    expect(checkNames).toEqual([
      'platform/arch',
      'Electron resolvable',
      'config validates',
      'override file parse',
      'required ports free',
      'display count vs. configured targets',
      'touch probe result',
      'plugin asset presence',
      'write access to userDataRoot',
    ]);
  });

  it('isolates unexpected check errors without aborting other checks', async () => {
    const validConfig = {
      appId: 'com.example.app',
      productName: 'App',
      windows: [{ id: 'main', url: 'https://example.com', target: { kind: 'primary' } }],
    };

    const options: DoctorOptions = {
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config: validConfig,
      resolveElectron: async () => fakeBinary,
      getDisplays: async () => {
        throw new Error('Exploded display driver');
      },
      touchProbe: { detect: async () => [] },
      isPortFree: async () => true,
      assetExists: async () => true,
    };

    const report = await runDoctor(options);
    expect(report.overallStatus).toBe('fail');

    const displayCheck = report.checks.find(c => c.name === 'display count vs. configured targets');
    expect(displayCheck?.status).toBe('fail');
    expect(displayCheck?.message).toContain('Exploded display driver');

    const platformCheck = report.checks.find(c => c.name === 'platform/arch');
    expect(platformCheck?.status).toBe('pass');

    const writeCheck = report.checks.find(c => c.name === 'write access to userDataRoot');
    expect(writeCheck?.status).toBe('pass');
  });

  it('aggregates fail status when any check fails', async () => {
    const invalidConfig = { appId: 'invalid!' };
    const options: DoctorOptions = {
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config: invalidConfig,
      resolveElectron: async () => fakeBinary,
      getDisplays: async () => [{ id: 0 }],
      touchProbe: { detect: async () => [] },
      isPortFree: async () => true,
      assetExists: async () => true,
    };

    const report = await runDoctor(options);
    expect(report.overallStatus).toBe('fail');
    const configCheck = report.checks.find(c => c.name === 'config validates');
    expect(configCheck?.status).toBe('fail');
  });

  it('times out stalled checks and reports failure with clear timeout message', async () => {
    const validConfig = {
      appId: 'com.example.app',
      productName: 'App',
      windows: [{ id: 'main', url: 'https://example.com', target: { kind: 'primary' } }],
    };

    const options: DoctorOptions = {
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config: validConfig,
      resolveElectron: async () => fakeBinary,
      getDisplays: () => new Promise(() => {}),
      touchProbe: { detect: async () => [] },
      isPortFree: async () => true,
      assetExists: async () => true,
      checkTimeoutMs: 50,
    };

    const report = await runDoctor(options);
    expect(report.overallStatus).toBe('fail');
    const displayCheck = report.checks.find(c => c.name === 'display count vs. configured targets');
    expect(displayCheck?.status).toBe('fail');
    expect(displayCheck?.message).toBe('check timed out after 50ms');
  });

  it('runs independent checks concurrently', async () => {
    const validConfig = {
      appId: 'com.example.app',
      productName: 'App',
      windows: [{ id: 'main', url: 'https://example.com', target: { kind: 'primary' } }],
    };

    let electronRunning = false;
    let displaysRunning = false;
    let didOverlap = false;

    const options: DoctorOptions = {
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config: validConfig,
      resolveElectron: async () => {
        electronRunning = true;
        if (displaysRunning) didOverlap = true;
        await new Promise(resolve => setTimeout(resolve, 20));
        electronRunning = false;
        return fakeBinary;
      },
      getDisplays: async () => {
        displaysRunning = true;
        if (electronRunning) didOverlap = true;
        await new Promise(resolve => setTimeout(resolve, 20));
        displaysRunning = false;
        return [{ id: 0 }];
      },
      touchProbe: { detect: async () => [] },
      isPortFree: async () => true,
      assetExists: async () => true,
    };

    const report = await runDoctor(options);
    expect(report.overallStatus).toBe('pass');
    expect(didOverlap).toBe(true);
  });

  it('passes validated config to downstream checks when validation passes', async () => {
    const rawConfig = {
      appId: 'com.example.app',
      productName: 'App',
      windows: [{ id: 'main', url: 'https://example.com', target: { kind: 'primary' } }],
      processes: [
        {
          id: 'worker',
          command: 'node',
          phase: 'always',
          readiness: { kind: 'http', url: 'http://127.0.0.1:8080/health' },
        },
      ],
    };

    const checkedPorts: number[] = [];
    const options: DoctorOptions = {
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config: rawConfig,
      resolveElectron: async () => fakeBinary,
      getDisplays: async () => [{ id: 0 }],
      touchProbe: { detect: async () => [] },
      isPortFree: async port => {
        checkedPorts.push(port);
        return true;
      },
      assetExists: async () => true,
    };

    const report = await runDoctor(options);
    expect(report.overallStatus).toBe('pass');
    expect(checkedPorts).toContain(8080);
  });
});
