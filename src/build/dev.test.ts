import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { startDev } from './dev.js';
import { LaunchError, ProcessError } from '../errors.js';
import type { ProcessConfig } from '../config/types.js';
import type { ShellRoots } from '../paths/roots.js';
import type { SpawnFn } from '../process/supervisor.js';
import { createRecordingSpawn, createRecordingTaskkill } from './__testing__/mock-spawn.js';
import { createFakeClock } from '../__testing__/fake-clock.js';

function buildRoots(tempDir: string): ShellRoots {
  return {
    packageRoot: path.resolve('node_modules/eggshell'),
    projectRoot: tempDir,
    userDataRoot: path.join(tempDir, 'userData'),
  };
}

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

describe('startDev', () => {
  const dummyRoots = buildRoots(path.resolve('examples/basic-kiosk'));

  it('runs phase dev and always processes and launches Electron with args before entry', async () => {
    const clock = createFakeClock();
    const recording = createRecordingSpawn({ autoExitOnKill: true, clock });
    const processes: ProcessConfig[] = [
      buildProcess('dev-api', 'dev'),
      buildProcess('shared-db', 'always'),
      buildProcess('prod-service', 'production'),
    ];

    const handle = await startDev({
      roots: dummyRoots,
      entryPath: 'dist/main.js',
      processes,
      electronBinary: '/path/to/electron',
      electronArgs: ['--inspect'],
      spawn: recording.spawn,
      clock,
      killTree: false,
      skipFileCheck: true,
    });

    expect(recording.get('dev-api')).toBeDefined();
    expect(recording.get('shared-db')).toBeDefined();
    expect(recording.get('prod-service')).toBeUndefined();

    const electron = recording.get('electron');
    expect(electron).toBeDefined();
    expect(electron?.options.command).toBe('/path/to/electron');
    expect(electron?.options.args).toEqual(['--inspect', path.resolve('examples/basic-kiosk/dist/main.js')]);

    await handle.stop();
  });

  it('resolves relative electronBinary against roots.projectRoot', async () => {
    const clock = createFakeClock();
    const recording = createRecordingSpawn({ autoExitOnKill: true, clock });
    const handle = await startDev({
      roots: dummyRoots,
      entryPath: 'dist/main.js',
      electronBinary: 'bin/custom-electron.exe',
      spawn: recording.spawn,
      clock,
      killTree: false,
      skipFileCheck: true,
    });
    const electron = recording.get('electron');
    expect(electron?.options.command).toBe(path.resolve('examples/basic-kiosk/bin/custom-electron.exe'));
    await handle.stop();
  });

  it('threads env through to the spawned Electron process', async () => {
    const clock = createFakeClock();
    const recording = createRecordingSpawn({ autoExitOnKill: true, clock });
    const handle = await startDev({
      roots: dummyRoots,
      entryPath: 'dist/main.js',
      electronBinary: '/bin/electron',
      env: { NODE_ENV: 'development', DISPLAY_VAR: '1' },
      spawn: recording.spawn,
      clock,
      killTree: false,
      skipFileCheck: true,
    });
    const electron = recording.get('electron');
    expect(electron?.options.env).toEqual({ NODE_ENV: 'development', DISPLAY_VAR: '1' });
    await handle.stop();
  });

  it('throws immediate spawn failure when Electron fails to start', async () => {
    const clock = createFakeClock();
    const fakeSpawn: SpawnFn = opts => {
      return {
        id: opts.id,
        pid: undefined,
        lines: { onLine: () => () => undefined },
        exited: Promise.reject(new ProcessError('failed to spawn electron: ENOENT')),
        kill: () => {},
      };
    };
    await expect(
      startDev({
        roots: dummyRoots,
        entryPath: 'dist/main.js',
        electronBinary: '/bin/nonexistent-electron',
        spawn: fakeSpawn,
        clock,
        killTree: false,
        skipFileCheck: true,
      })
    ).rejects.toThrow(/failed to spawn electron: ENOENT/);
  });

  it('stop() terminates Electron and supervised processes via kill', async () => {
    const clock = createFakeClock();
    const recording = createRecordingSpawn({ autoExitOnKill: true, clock });
    const processes: ProcessConfig[] = [buildProcess('api', 'dev')];

    const handle = await startDev({
      roots: dummyRoots,
      entryPath: 'dist/main.js',
      processes,
      electronBinary: '/bin/electron',
      spawn: recording.spawn,
      clock,
      killTree: false,
      skipFileCheck: true,
    });

    const electron = recording.get('electron')!;
    const api = recording.get('api')!;

    const results = await handle.stop();
    expect(results.length).toBe(2);
    expect(electron.killed).toEqual(['SIGTERM']);
    expect(api.killed).toEqual(['SIGTERM']);
  });

  it('stop() invokes taskkill when tree-kill is active', async () => {
    const clock = createFakeClock();
    const recording = createRecordingSpawn({ clock });
    const { taskkill, calls } = createRecordingTaskkill(() => recording.spawned);
    const processes: ProcessConfig[] = [buildProcess('api', 'dev')];

    const handle = await startDev({
      roots: dummyRoots,
      entryPath: 'dist/main.js',
      processes,
      electronBinary: '/bin/electron',
      spawn: recording.spawn,
      taskkill,
      clock,
      killTree: true,
      skipFileCheck: true,
    });

    const results = await handle.stop();
    expect(results.length).toBe(2);
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain('/T');
    expect(calls[0]).toContain('/F');
  });

  it('automatically triggers shutdown when Electron process exits', async () => {
    const clock = createFakeClock();
    const recording = createRecordingSpawn({ autoExitOnKill: true, clock });
    const processes: ProcessConfig[] = [buildProcess('api', 'dev')];

    const handle = await startDev({
      roots: dummyRoots,
      entryPath: 'dist/main.js',
      processes,
      electronBinary: '/bin/electron',
      spawn: recording.spawn,
      clock,
      killTree: false,
      skipFileCheck: true,
    });

    const electron = recording.get('electron')!;
    const api = recording.get('api')!;

    electron.resolveExit({ code: 0, signal: null });

    const exit = await handle.exited;
    expect(exit.code).toBe(0);
    expect(api.killed).toEqual(['SIGTERM']);
  });

  it('throws LaunchError if entryPath does not exist on disk', async () => {
    await expect(
      startDev({
        roots: dummyRoots,
        entryPath: 'dist/nonexistent.js',
        electronBinary: '/bin/electron',
        skipFileCheck: false,
      })
    ).rejects.toThrow(LaunchError);
  });

  it('throws LaunchError if electronBinary does not exist on disk', async () => {
    const tempDir = path.resolve('userData', 'test-dev-no-electron');
    await fs.mkdir(tempDir, { recursive: true });
    const entryPath = path.join(tempDir, 'main.js');
    await fs.writeFile(entryPath, 'console.log(1);');

    await expect(
      startDev({
        roots: buildRoots(tempDir),
        entryPath,
        electronBinary: path.join(tempDir, 'nonexistent-electron.exe'),
        skipFileCheck: false,
      })
    ).rejects.toThrow(LaunchError);

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('throws ProcessError and cleans up when a supervised process fails to spawn', async () => {
    const clock = createFakeClock();
    let apiKilled = false;

    let resolveOk!: (val: { code: number | null; signal: NodeJS.Signals | null }) => void;
    const okExited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      resolve => { resolveOk = resolve; }
    );

    const fakeSpawn: SpawnFn = opts => {
      if (opts.id === 'failing') {
        const exited = Promise.resolve({ code: 1, signal: null });
        return {
          id: opts.id,
          pid: 1001,
          lines: { onLine: () => () => undefined },
          exited,
          kill: () => {},
        };
      }
      return {
        id: opts.id,
        pid: 1000,
        lines: { onLine: () => () => undefined },
        exited: okExited,
        kill: () => {
          apiKilled = true;
          resolveOk({ code: 0, signal: null });
        },
      };
    };

    const failingConfig: ProcessConfig = {
      ...buildProcess('failing', 'dev'),
      readiness: { kind: 'log', pattern: 'READY' },
      readinessTimeoutMs: 1000,
    };

    const promise = startDev({
      roots: dummyRoots,
      entryPath: 'dist/main.js',
      processes: [buildProcess('ok-service', 'dev'), failingConfig],
      electronBinary: '/bin/electron',
      spawn: fakeSpawn,
      clock,
      killTree: false,
      skipFileCheck: true,
    });

    await expect(promise).rejects.toThrow(ProcessError);
    expect(apiKilled).toBe(true);
  });
});
