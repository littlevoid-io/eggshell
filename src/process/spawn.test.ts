import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { ProcessError } from '../errors.js';
import { spawnManaged } from './spawn.js';
import type { ManagedProcess, ProcessLine } from './types.js';

vi.mock('execa', async importOriginal => {
  const actual = await importOriginal<typeof import('execa')>();
  return { ...actual, execa: vi.fn(actual.execa) };
});

const mockedExeca = vi.mocked(execa);

/** Subscribes immediately and collects every line delivered from then on (including replay). */
function collectLines(managed: ManagedProcess): ProcessLine[] {
  const lines: ProcessLine[] = [];
  managed.lines.onLine(line => lines.push(line));
  return lines;
}

describe('spawnManaged', () => {
  afterEach(() => {
    mockedExeca.mockClear();
  });

  it('I2: spawns via (command, argsArray, options) with options.shell left unset', async () => {
    const managed = spawnManaged({
      id: 'i2-regression',
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
    });
    await managed.exited;

    expect(mockedExeca).toHaveBeenCalledTimes(1);
    const call = mockedExeca.mock.calls[0] as unknown as [
      string,
      string[],
      { shell?: unknown } | undefined,
    ];
    expect(call[0]).toBe(process.execPath);
    expect(call[1]).toEqual(['-e', 'process.exit(0)']);
    const options = call[2];
    expect(options?.shell).toBeUndefined();
  });

  it('rejects a command containing whitespace before spawning anything', () => {
    expect(() => spawnManaged({ id: 'whitespace', command: 'node -e 1', args: [] })).toThrow(
      ProcessError
    );
    expect(mockedExeca).not.toHaveBeenCalled();
  });

  it('allows a real, existing executable whose own path contains whitespace', async () => {
    // Regression: a built app's path (e.g. electron-builder's default
    // "<productName>.exe" naming) routinely contains a space — this must
    // never be confused with a mashed-together "command args" string.
    const dir = mkdtempSync(path.join(tmpdir(), 'eggshell spawn test '));
    const spacedPath = path.join(dir, 'has space.exe');
    try {
      copyFileSync(process.execPath, spacedPath);
      const managed = spawnManaged({
        id: 'spaced-path',
        command: spacedPath,
        args: ['-e', 'process.exit(0)'],
      });
      await managed.exited;
      expect(mockedExeca).toHaveBeenCalledTimes(1);
      expect(mockedExeca.mock.calls[0]![0]).toBe(spacedPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(['a&&b', 'a|b', 'a;b', 'a`b', 'a$(id)b'])(
    'rejects a command containing the shell metacharacter case %s',
    command => {
      expect(() => spawnManaged({ id: 'metachar', command, args: [] })).toThrow(ProcessError);
      expect(mockedExeca).not.toHaveBeenCalled();
    }
  );

  it('captures a line of real stdout output end-to-end', async () => {
    const managed = spawnManaged({
      id: 'stdout-line',
      command: process.execPath,
      args: ['-e', 'console.log("hello")'],
    });
    const lines = collectLines(managed);
    await managed.exited;

    expect(lines).toEqual([{ stream: 'stdout', text: 'hello' }]);
  });

  it('flushes a trailing line that has no terminating newline', async () => {
    const managed = spawnManaged({
      id: 'no-trailing-newline',
      command: process.execPath,
      args: ['-e', 'process.stdout.write("no-newline")'],
    });
    const lines = collectLines(managed);
    await managed.exited;

    expect(lines).toEqual([{ stream: 'stdout', text: 'no-newline' }]);
  });

  it('reassembles one line written across two separate writes', async () => {
    const managed = spawnManaged({
      id: 'split-line',
      command: process.execPath,
      args: [
        '-e',
        "process.stdout.write('foo'); setTimeout(() => process.stdout.write('bar\\n'), 50);",
      ],
    });
    const lines = collectLines(managed);
    await managed.exited;

    expect(lines).toEqual([{ stream: 'stdout', text: 'foobar' }]);
  });

  it('captures stderr lines tagged as stderr', async () => {
    const managed = spawnManaged({
      id: 'stderr-line',
      command: process.execPath,
      args: ['-e', 'console.error("oops")'],
    });
    const lines = collectLines(managed);
    await managed.exited;

    expect(lines).toEqual([{ stream: 'stderr', text: 'oops' }]);
  });

  it('reports the child exit code', async () => {
    const managed = spawnManaged({
      id: 'exit-code',
      command: process.execPath,
      args: ['-e', 'process.exit(3)'],
    });
    const exit = await managed.exited;

    expect(exit.code).toBe(3);
    expect(exit.signal).toBeNull();
  });

  it('surfaces a missing executable as a rejected ProcessError, never an unhandled error event', async () => {
    const managed = spawnManaged({
      id: 'missing-binary',
      command: 'eggshell-definitely-missing-binary',
      args: [],
    });

    await expect(managed.exited).rejects.toThrow(ProcessError);
    await expect(managed.exited).rejects.toThrow(/eggshell-definitely-missing-binary/);
  });

  describe('child environment', () => {
    const SENTINEL_KEY = 'EGGSHELL_TEST_SENTINEL';

    afterEach(() => {
      delete process.env[SENTINEL_KEY];
    });

    it('does not inherit a parent-only environment variable', async () => {
      process.env[SENTINEL_KEY] = 'leaked-from-parent';
      const managed = spawnManaged({
        id: 'env-not-inherited',
        command: process.execPath,
        args: ['-e', `console.log(process.env.${SENTINEL_KEY} ?? 'absent')`],
      });
      const lines = collectLines(managed);
      await managed.exited;

      expect(lines).toEqual([{ stream: 'stdout', text: 'absent' }]);
    });

    it('passes through a variable explicitly provided via env', async () => {
      const managed = spawnManaged({
        id: 'env-explicit',
        command: process.execPath,
        args: ['-e', `console.log(process.env.${SENTINEL_KEY})`],
        env: { [SENTINEL_KEY]: 'explicit-value' },
      });
      const lines = collectLines(managed);
      await managed.exited;

      expect(lines).toEqual([{ stream: 'stdout', text: 'explicit-value' }]);
    });
  });

  it('resolves cleanly with a signal when killed, instead of rejecting as a spawn failure', async () => {
    const managed = spawnManaged({
      id: 'killed-by-signal',
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
    });
    managed.kill('SIGTERM');
    const exit = await managed.exited;

    expect(exit.code).toBeNull();
    expect(exit.signal).toBe('SIGTERM');
  });

  it('replays earlier lines to a subscriber that joins after they were printed', async () => {
    const managed = spawnManaged({
      id: 'late-subscriber',
      command: process.execPath,
      args: ['-e', 'console.log("early")'],
    });
    await managed.exited;

    const lateLines: ProcessLine[] = [];
    managed.lines.onLine(line => lateLines.push(line));

    expect(lateLines).toEqual([{ stream: 'stdout', text: 'early' }]);
  });
});
