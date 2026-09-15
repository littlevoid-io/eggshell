import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { startProduction } from './start.js';
import { LaunchError, ProcessError } from '../errors.js';
import type { ProcessConfig } from '../config/types.js';
import type { LaunchManifest } from './manifest.js';
import type { SpawnFn } from '../process/supervisor.js';
import { createRecordingSpawn } from './__testing__/mock-spawn.js';
import { createFakeClock } from '../__testing__/fake-clock.js';

function buildProcess(id: string, phase: 'dev' | 'production' | 'always'): ProcessConfig {
  return {
    id,
    command: 'node',
    args: [],
    phase,
    readiness: { kind: 'none' },
    readinessTimeoutMs: 5000,
    requirePortsFree: [],
    restart: {
      policy: 'never',
      maxRestarts: 0,
      backoffMs: 100,
      backoffMultiplier: 2,
      maxBackoffMs: 1000,
      resetAfterMs: 10_000,
    },
    shutdown: { signal: 'SIGTERM', graceMs: 1000 },
  };
}

describe('startProduction', () => {
  it('runs phase production and always processes, launches executable from executablePath', async () => {
    const clock = createFakeClock();
    const recording = createRecordingSpawn({ autoExitOnKill: true, clock });
    const processes: ProcessConfig[] = [
      buildProcess('prod-worker', 'production'),
      buildProcess('shared-db', 'always'),
      buildProcess('dev-only', 'dev'),
    ];

    const handle = await startProduction({
      executablePath: path.resolve('/bin/my-kiosk.exe'),
      args: ['--kiosk'],
      processes,
      spawn: recording.spawn,
      clock,
      killTree: false,
      skipFileCheck: true,
    });

    expect(recording.get('prod-worker')).toBeDefined();
    expect(recording.get('shared-db')).toBeDefined();
    expect(recording.get('dev-only')).toBeUndefined();

    const app = recording.get('app');
    expect(app).toBeDefined();
    expect(app?.options.command).toBe(path.resolve('/bin/my-kiosk.exe'));
    expect(app?.options.args).toEqual(['--kiosk']);

    await handle.stop();
  });

  it('resolves executable from LaunchManifest object', async () => {
    const clock = createFakeClock();
    const recording = createRecordingSpawn({ autoExitOnKill: true, clock });
    const manifest: LaunchManifest = {
      manifestVersion: 1,
      appId: 'com.example.prod',
      productName: 'Prod App',
      version: '1.0.0',
      executablePath: path.resolve('/release/app.exe'),
      builtAt: '2026-09-14T00:00:00Z',
      platform: process.platform,
      arch: process.arch,
    };

    const handle = await startProduction({
      manifest,
      spawn: recording.spawn,
      clock,
      killTree: false,
      skipFileCheck: true,
    });

    const app = recording.get('app');
    expect(app?.options.command).toBe(path.resolve('/release/app.exe'));
    await handle.stop();
  });

  it('resolves executable from manifestPath on disk', async () => {
    const tempDir = path.resolve('userData', 'test-start-manifest');
    await fs.mkdir(tempDir, { recursive: true });
    const manifestPath = path.join(tempDir, 'eggshell.launch.json');

    const manifest: LaunchManifest = {
      manifestVersion: 1,
      appId: 'com.example.prod',
      productName: 'Prod App',
      version: '1.0.0',
      executablePath: path.resolve('/release/built.exe'),
      builtAt: '2026-09-14T00:00:00Z',
      platform: process.platform,
      arch: process.arch,
    };
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const clock = createFakeClock();
    const recording = createRecordingSpawn({ autoExitOnKill: true, clock });

    const handle = await startProduction({
      manifestPath,
      spawn: recording.spawn,
      clock,
      killTree: false,
      skipFileCheck: true,
    });

    const app = recording.get('app');
    expect(app?.options.command).toBe(path.resolve('/release/built.exe'));
    await handle.stop();

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('throws LaunchError when no executable or manifest is provided', async () => {
    await expect(startProduction({ skipFileCheck: true })).rejects.toThrow(LaunchError);
  });

  it('throws LaunchError if manifest fails validation', async () => {
    const badManifest = { manifestVersion: 2 } as unknown as LaunchManifest;
    await expect(startProduction({ manifest: badManifest, skipFileCheck: true })).rejects.toThrow(
      LaunchError
    );
  });

  it('throws LaunchError if directly-supplied manifest has relative executablePath', async () => {
    const manifest = {
      manifestVersion: 1,
      appId: 'com.example.prod',
      productName: 'Prod App',
      version: '1.0.0',
      executablePath: 'relative/app.exe',
      builtAt: '2026-09-14T00:00:00Z',
      platform: process.platform,
      arch: process.arch,
    } as unknown as LaunchManifest;
    await expect(startProduction({ manifest, skipFileCheck: true })).rejects.toThrow(LaunchError);
  });

  it('throws LaunchError on platform or arch mismatch in manifest', async () => {
    const wrongPlatform = process.platform === 'win32' ? 'darwin' : 'win32';
    const manifest: LaunchManifest = {
      manifestVersion: 1,
      appId: 'com.example.prod',
      productName: 'Prod App',
      version: '1.0.0',
      executablePath: path.resolve('/bin/app.exe'),
      builtAt: '2026-09-14T00:00:00Z',
      platform: wrongPlatform,
      arch: 'arm64',
    };
    await expect(startProduction({ manifest, skipFileCheck: true })).rejects.toThrow(
      new RegExp(`Manifest was built for ${wrongPlatform}/arm64, but this machine is ${process.platform}/${process.arch}`)
    );
  });

  it('throws LaunchError if manifestPath does not exist', async () => {
    await expect(
      startProduction({
        manifestPath: path.resolve('/nonexistent/eggshell.launch.json'),
        skipFileCheck: true,
      })
    ).rejects.toThrow(LaunchError);
  });

  it('throws LaunchError if executablePath does not exist on disk', async () => {
    await expect(
      startProduction({
        executablePath: path.resolve('/nonexistent/app.exe'),
        skipFileCheck: false,
      })
    ).rejects.toThrow(LaunchError);
  });

  it('threads env through to the spawned application process', async () => {
    const clock = createFakeClock();
    const recording = createRecordingSpawn({ autoExitOnKill: true, clock });
    const handle = await startProduction({
      executablePath: path.resolve('/bin/app.exe'),
      env: { CUSTOM_VAR: 'production-value' },
      spawn: recording.spawn,
      clock,
      killTree: false,
      skipFileCheck: true,
    });
    const app = recording.get('app');
    expect(app?.options.env).toEqual({ CUSTOM_VAR: 'production-value' });
    await handle.stop();
  });

  it('throws immediate spawn failure when app process fails to start', async () => {
    const clock = createFakeClock();
    const fakeSpawn: SpawnFn = opts => {
      return {
        id: opts.id,
        pid: undefined,
        lines: { onLine: () => () => undefined },
        exited: Promise.reject(new ProcessError('failed to spawn app: ENOENT')),
        kill: () => {},
      };
    };
    await expect(
      startProduction({
        executablePath: path.resolve('/bin/nonexistent.exe'),
        spawn: fakeSpawn,
        clock,
        killTree: false,
        skipFileCheck: true,
      })
    ).rejects.toThrow(/failed to spawn app: ENOENT/);
  });

  it('stop() terminates the application and supervised processes', async () => {
    const clock = createFakeClock();
    const recording = createRecordingSpawn({ autoExitOnKill: true, clock });
    const processes: ProcessConfig[] = [buildProcess('db', 'production')];

    const handle = await startProduction({
      executablePath: path.resolve('/bin/app.exe'),
      processes,
      spawn: recording.spawn,
      clock,
      killTree: false,
      skipFileCheck: true,
    });

    const app = recording.get('app')!;
    const db = recording.get('db')!;

    const results = await handle.stop();
    expect(results.length).toBe(2);
    expect(app.killed).toEqual(['SIGTERM']);
    expect(db.killed).toEqual(['SIGTERM']);
  });

  it('automatically triggers shutdown when app process exits', async () => {
    const clock = createFakeClock();
    const recording = createRecordingSpawn({ autoExitOnKill: true, clock });
    const processes: ProcessConfig[] = [buildProcess('db', 'production')];

    const handle = await startProduction({
      executablePath: path.resolve('/bin/app.exe'),
      processes,
      spawn: recording.spawn,
      clock,
      killTree: false,
      skipFileCheck: true,
    });

    const app = recording.get('app')!;
    const db = recording.get('db')!;

    app.resolveExit({ code: 0, signal: null });

    const exit = await handle.exited;
    expect(exit.code).toBe(0);
    expect(db.killed).toEqual(['SIGTERM']);
  });
});
