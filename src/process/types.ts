/**
 * Shared vocabulary for the process layer (T2.6 spawn, T2.7 readiness, T2.8
 * supervisor, T2.9 shutdown).
 *
 * `ProcessLineStream` is deliberately importable without pulling in
 * `spawn.ts` at all: T2.7's `log` readiness probe consumes exactly this
 * interface, so it can be unit-tested against a synthetic stream built by
 * hand, with no real child process, spawn error handling, or line-splitting
 * logic involved.
 */

export interface ProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export type ProcessStreamName = 'stdout' | 'stderr';

export interface ProcessLine {
  readonly stream: ProcessStreamName;
  readonly text: string;
}

/**
 * Bounded replay buffer size for `ProcessLineStream.onLine`. A readiness
 * probe that subscribes only after the process has already printed its ready
 * line must still see it — subscribing then hanging forever is a real and
 * nasty failure mode (a slow-starting plugin registration, a probe wired up
 * one tick late, etc.) — so this many of the most recent lines are always
 * replayed to a new subscriber before it receives further live lines. Lines
 * older than this bound are gone; this is a bounded buffer, not a full log.
 */
export const LINE_REPLAY_BUFFER_SIZE = 200;

/**
 * A subscribable stream of captured stdout/stderr lines, one line per call.
 *
 * `onLine` immediately replays up to `LINE_REPLAY_BUFFER_SIZE` of the most
 * recently seen lines (oldest first) to the new listener, then delivers every
 * further line live. It returns an unsubscribe function; calling it more than
 * once is a no-op.
 */
export interface ProcessLineStream {
  onLine(listener: (line: ProcessLine) => void): () => void;
}

/**
 * The handle returned by `spawnManaged`. Kept small and honest: it does not
 * expose the underlying Node `ChildProcess` (that would leak spawn.ts's
 * implementation details, e.g. raw stream objects, into every consumer),
 * only what a supervisor, readiness probe, or shutdown routine needs.
 */
export interface ManagedProcess {
  readonly id: string;
  /** The OS process id, or `undefined` if the process never actually started (see spawn.ts's spawn-failure handling). */
  readonly pid: number | undefined;
  readonly lines: ProcessLineStream;
  /** Resolves once the process exits; rejects with a `ProcessError` if it never managed to start. */
  readonly exited: Promise<ProcessExit>;
  kill(signal?: NodeJS.Signals): void;
}
