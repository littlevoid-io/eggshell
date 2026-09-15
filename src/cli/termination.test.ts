import { describe, it, expect, vi } from 'vitest';
import { waitForTermination, terminationExitCode } from './termination.js';
import type { StartHandle } from '../index.js';

function createFakeHandle(exit: { code: number | null; signal: NodeJS.Signals | null }): {
  handle: StartHandle;
  stop: ReturnType<typeof vi.fn>;
} {
  const stop = vi.fn().mockResolvedValue([]);
  const handle = {
    process: {} as StartHandle['process'],
    supervisor: {} as StartHandle['supervisor'],
    stop,
    exited: Promise.resolve(exit),
  } as StartHandle;
  return { handle, stop };
}

describe('waitForTermination', () => {
  it('reports a clean natural exit and calls stop', async () => {
    const { handle, stop } = createFakeHandle({ code: 0, signal: null });
    const result = await waitForTermination(handle);
    expect(result.signalReceived).toBe(false);
    expect(result.exit).toEqual({ code: 0, signal: null });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('reports a crash (nonzero exit code) as not signal-received', async () => {
    const { handle } = createFakeHandle({ code: 1, signal: null });
    const result = await waitForTermination(handle);
    expect(result.signalReceived).toBe(false);
    expect(result.exit.code).toBe(1);
  });
});

describe('terminationExitCode', () => {
  it('maps a deliberate signal stop to 0 regardless of the underlying exit code', () => {
    expect(terminationExitCode({ signalReceived: true, exit: { code: 1, signal: null } })).toBe(0);
  });

  it('maps a clean natural exit (code 0) to 0', () => {
    expect(terminationExitCode({ signalReceived: false, exit: { code: 0, signal: null } })).toBe(
      0
    );
  });

  it('maps a crash (nonzero code) to 1', () => {
    expect(terminationExitCode({ signalReceived: false, exit: { code: 1, signal: null } })).toBe(
      1
    );
  });

  it('maps an external kill (null code, a signal) to 1', () => {
    expect(
      terminationExitCode({ signalReceived: false, exit: { code: null, signal: 'SIGKILL' } })
    ).toBe(1);
  });
});
