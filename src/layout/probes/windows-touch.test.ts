import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../../__testing__/fake-clock.js';
import type { Logger, LogFields } from '../../logging/logger.js';
import { createWindowsTouchProbe } from './windows-touch.js';
import type { ExecFn } from './windows-touch.js';

interface CapturingLogger extends Logger {
  readonly warnings: readonly { message: string; fields: LogFields | undefined }[];
}

function createCapturingLogger(): CapturingLogger {
  const warnings: { message: string; fields: LogFields | undefined }[] = [];
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: (message, fields) => {
      warnings.push({ message, fields });
    },
    error: () => undefined,
    warnings,
  };
}

/** A fresh, never-aborted signal — every `detect()` call in this file needs one. */
function freshSignal(): AbortSignal {
  return new AbortController().signal;
}

describe('createWindowsTouchProbe', () => {
  it('T2.3 lockup regression: a fake exec that never settles resolves [] within timeoutMs, kills the child, and warns once', async () => {
    const clock = createFakeClock();
    const logger = createCapturingLogger();
    let childSignal: AbortSignal | undefined;
    const hangingExec: ExecFn = (_file, _args, signal) => {
      childSignal = signal;
      // Never resolves or rejects: this is the predecessor's timeout-less
      // hang, reproduced deliberately. If `detect()` ever went back to
      // simply `await`-ing this, this test would hang forever instead of
      // failing — that is the whole point of the regression test.
      return new Promise(() => undefined);
    };

    const probe = createWindowsTouchProbe({
      exec: hangingExec,
      clock,
      logger,
      timeoutMs: 5_000,
      platform: 'win32',
    });

    const resultPromise = probe.detect(freshSignal());
    clock.advance(5_000);
    const result = await resultPromise;

    expect(result).toEqual([]);
    expect(childSignal?.aborted).toBe(true);
    expect(logger.warnings).toHaveLength(1);
  });

  it('a fake exec that rejects (non-zero exit) resolves [] and logs exactly one warning', async () => {
    const logger = createCapturingLogger();
    const failingExec: ExecFn = () =>
      Promise.reject(new Error('powershell.exe exited with code 1'));
    const probe = createWindowsTouchProbe({ exec: failingExec, logger, platform: 'win32' });

    const result = await probe.detect(freshSignal());

    expect(result).toEqual([]);
    expect(logger.warnings).toHaveLength(1);
  });

  it('unparseable stdout resolves [] and logs exactly one warning', async () => {
    const logger = createCapturingLogger();
    const garbledExec: ExecFn = () => Promise.resolve({ stdout: 'not json at all' });
    const probe = createWindowsTouchProbe({ exec: garbledExec, logger, platform: 'win32' });

    const result = await probe.detect(freshSignal());

    expect(result).toEqual([]);
    expect(logger.warnings).toHaveLength(1);
  });

  it('two concurrent detect() calls spawn exactly one child and resolve to the same value', async () => {
    let callCount = 0;
    const exec: ExecFn = () => {
      callCount++;
      return Promise.resolve({ stdout: '[2,5]' });
    };
    const probe = createWindowsTouchProbe({ exec, platform: 'win32' });

    const [first, second] = await Promise.all([
      probe.detect(freshSignal()),
      probe.detect(freshSignal()),
    ]);

    expect(callCount).toBe(1);
    expect(first).toEqual([2, 5]);
    expect(second).toEqual([2, 5]);
  });

  it('a second detect() after the first completes serves the cached result (call count stays 1)', async () => {
    let callCount = 0;
    const exec: ExecFn = () => {
      callCount++;
      return Promise.resolve({ stdout: '[1]' });
    };
    const probe = createWindowsTouchProbe({ exec, platform: 'win32' });

    const first = await probe.detect(freshSignal());
    const second = await probe.detect(freshSignal());

    expect(callCount).toBe(1);
    expect(first).toEqual([1]);
    expect(second).toEqual([1]);
  });

  it('resolves [] on a non-Windows platform without calling exec at all', async () => {
    let callCount = 0;
    const exec: ExecFn = () => {
      callCount++;
      return Promise.resolve({ stdout: '[1]' });
    };
    const probe = createWindowsTouchProbe({ exec, platform: 'darwin' });

    const result = await probe.detect(freshSignal());

    expect(result).toEqual([]);
    expect(callCount).toBe(0);
  });

  it('detect() never rejects when the fake exec times out', async () => {
    const clock = createFakeClock();
    const probe = createWindowsTouchProbe({
      exec: () => new Promise(() => undefined),
      clock,
      timeoutMs: 50,
      platform: 'win32',
    });

    const resultPromise = probe.detect(freshSignal());
    clock.advance(50);

    await expect(resultPromise).resolves.toEqual([]);
  });

  it.each<[string, ExecFn]>([
    ['exits non-zero (rejects with an Error)', () => Promise.reject(new Error('exit code 1'))],
    [
      'throws synchronously instead of returning a promise',
      () => {
        throw new Error('synchronous exec failure');
      },
    ],
    ['rejects with a non-Error value', () => Promise.reject('stringy failure')],
  ])('detect() never rejects when the fake exec %s', async (_label, exec) => {
    const probe = createWindowsTouchProbe({ exec, platform: 'win32' });

    await expect(probe.detect(freshSignal())).resolves.toEqual([]);
  });

  it('a successful parse returns the ids from the probe output', async () => {
    const exec: ExecFn = () => Promise.resolve({ stdout: '[3, 7]' });
    const probe = createWindowsTouchProbe({ exec, platform: 'win32' });

    const result = await probe.detect(freshSignal());

    expect(result).toEqual([3, 7]);
  });

  it('accepts a bare JSON number (Windows PowerShell 5.1 collapses a single-element array)', async () => {
    const exec: ExecFn = () => Promise.resolve({ stdout: '4' });
    const probe = createWindowsTouchProbe({ exec, platform: 'win32' });

    const result = await probe.detect(freshSignal());

    expect(result).toEqual([4]);
  });

  it('re-probes once cacheTtlMs elapses (time-based staleness, not event-driven invalidation)', async () => {
    const clock = createFakeClock();
    let callCount = 0;
    const exec: ExecFn = () => {
      callCount++;
      return Promise.resolve({ stdout: '[9]' });
    };
    const probe = createWindowsTouchProbe({ exec, clock, cacheTtlMs: 1_000, platform: 'win32' });

    await probe.detect(freshSignal());
    expect(callCount).toBe(1);

    clock.advance(999);
    await probe.detect(freshSignal());
    expect(callCount).toBe(1);

    clock.advance(2);
    await probe.detect(freshSignal());
    expect(callCount).toBe(2);
  });

  it('invalidate() forces the next detect() to re-probe immediately, well inside cacheTtlMs', async () => {
    const clock = createFakeClock();
    let callCount = 0;
    const exec: ExecFn = () => {
      callCount++;
      return Promise.resolve({ stdout: '[]' });
    };
    const probe = createWindowsTouchProbe({ exec, clock, cacheTtlMs: 60_000, platform: 'win32' });

    await probe.detect(freshSignal());
    probe.invalidate();
    await probe.detect(freshSignal());

    expect(callCount).toBe(2);
  });

  it("aborting the caller's signal kills the child and settles detect() promptly, without waiting for the timeout", async () => {
    const controller = new AbortController();
    let childSawAbort = false;
    const exec: ExecFn = (_file, _args, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          childSawAbort = true;
          reject(new Error('killed by abort signal'));
        });
      });
    // A very long timeout: if this test only passes because the timeout
    // fired, that would prove the opposite of what it claims. Not using a
    // fake clock here is deliberate — with the real clock, resolving before
    // this elapses can only happen via the abort path.
    const probe = createWindowsTouchProbe({ exec, timeoutMs: 60_000, platform: 'win32' });

    const resultPromise = probe.detect(controller.signal);
    controller.abort();

    await expect(resultPromise).resolves.toEqual([]);
    expect(childSawAbort).toBe(true);
  });
});
