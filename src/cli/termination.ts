import type { StartHandle } from '../index.js';
import type { ProcessExit } from '../process/types.js';

interface SignalListenerCleanup {
  dispose: () => void;
}

export interface TerminationResult {
  /** True if we stopped the app ourselves (SIGINT/SIGTERM to this CLI process) - always a clean stop. */
  readonly signalReceived: boolean;
  readonly exit: ProcessExit;
}

function listenForShutdownSignals(onSignal: () => void): SignalListenerCleanup {
  const onSigint = () => onSignal();
  const onSigterm = () => onSignal();
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  return {
    dispose: () => {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
    },
  };
}

/**
 * Awaits handle.exited or SIGINT/SIGTERM (whichever occurs first), then stops
 * remaining supervised child processes and reports the app's real exit info -
 * a provisioning tool monitoring this CLI's own exit code needs to see a
 * crash as a crash, not as a clean 0.
 */
export async function waitForTermination(handle: StartHandle): Promise<TerminationResult> {
  let cleanup: SignalListenerCleanup | undefined;
  let signalReceived = false;
  const signalPromise = new Promise<void>(resolve => {
    cleanup = listenForShutdownSignals(() => {
      signalReceived = true;
      resolve();
    });
  });

  try {
    await Promise.race([handle.exited.then(() => undefined), signalPromise]);
  } finally {
    if (cleanup) {
      cleanup.dispose();
    }
  }

  await handle.stop();
  const exit = await handle.exited;
  return { signalReceived, exit };
}

/** Maps a TerminationResult to a CLI exit code: a deliberate stop or a clean exit is 0, anything else is 1. */
export function terminationExitCode(result: TerminationResult): number {
  if (result.signalReceived) return 0;
  return result.exit.code === 0 ? 0 : 1;
}
