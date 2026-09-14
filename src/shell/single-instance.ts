/**
 * Single-instance lock (T3.5) — Electron's `requestSingleInstanceLock()`
 * wired behind an injected `app` seam so this module is unit-testable
 * without an Electron runtime, matching the pattern every other file in
 * `src/shell/**` follows: adapt a decision to Electron, never make the
 * decision inline where it cannot be tested against a real runtime.
 *
 * Why this exists: `eggshell` is launched by an external Windows
 * provisioning tool as a startup task at logon. That task can fire twice —
 * a retry, a misconfigured scheduled task, a fast logon/logoff cycle, or an
 * operator double-clicking a shortcut. A second instance is not cosmetic
 * here: it would try to bind the same supervised-process ports (tripping
 * T2.5's pre-check), open duplicate kiosk windows on the same displays, and
 * race the first instance's window placement, on a machine nobody is
 * watching to notice.
 *
 * I6 (no `process.exit()` outside `src/cli/bin.ts`) means this module
 * cannot decide to terminate the second instance itself. It returns a
 * discriminated `SingleInstanceLockResult` instead of a boolean: the
 * `held: true` branch is the only one carrying `release`, and the
 * `held: false` branch is the only one carrying `reason`. A caller cannot
 * reach for `release` without first narrowing on `held`, and there is
 * nothing to silently ignore the way a bare boolean invites — this is the
 * "discriminated result they must narrow" the task asks for, chosen over a
 * boolean specifically because a boolean has no compile-time cost for a
 * caller who forgets to check it. T3.4's `launch()` (or the CLI's
 * `bin.ts`) is the one place that decides what `held: false` means for the
 * *process* — return early from `launch()`, or exit from the CLI — never
 * this module.
 *
 * Returning rather than throwing on `held: false` is deliberate: losing the
 * race for the lock is an expected, benign outcome of how this app is
 * deployed (see above), not a failure of this module's own operation.
 * Throwing would force every caller into a try/catch for a condition that
 * is not exceptional; a discriminated result makes the benign case exactly
 * as easy to *handle* correctly as it would otherwise be easy to ignore.
 *
 * Ordering relative to config validation (T1.4): this module's position is
 * that the lock should be requested *before* any other work in `launch()`,
 * including config validation. The lock is the cheapest possible check —
 * one synchronous native call — and it is also the only gate that stops a
 * second instance from doing anything else at all, including validating a
 * config the first instance may be simultaneously validating, or reading
 * an override file (T1.5) mid-write by the same provisioning tool that
 * just fired the startup task twice. Acquiring it first means a second
 * instance's outcome is always the same one code path (`held: false`, log,
 * done) regardless of what config it happened to load, instead of a
 * confusing, spurious validation error standing in for the actual, simple
 * cause. This module has no way to enforce that ordering on its
 * caller — it is simply cheap and side-effect-free enough, apart from the
 * lock itself, that "first" costs the caller nothing to choose.
 */

import type { Logger } from '../logging/logger.js';
import { noopLogger } from '../logging/logger.js';

/**
 * The slice of Electron's `App` this module needs. Declared independently
 * of `electron`'s own `App` type — rather than importing it — so tests
 * supply a plain object implementing exactly these three methods and never
 * need an Electron runtime. The real `app` singleton satisfies this
 * structurally with no cast.
 */
export interface SingleInstanceApp {
  requestSingleInstanceLock(additionalData?: Record<string, unknown>): boolean;
  releaseSingleInstanceLock(): void;
  on(
    event: 'second-instance',
    listener: (event: unknown, argv: string[], workingDirectory: string) => void
  ): unknown;
}

/** What the primary instance is told about a second launch attempt. */
export interface SecondInstanceInfo {
  readonly argv: readonly string[];
  readonly workingDirectory: string;
}

/**
 * Caller-supplied hook for what "a second instance appeared" means to the
 * running app — almost always focusing/restoring the existing window(s).
 * Takes only plain data, never a `BrowserWindow`, so this module stays
 * ignorant of window management (T3.1's concern, `./windows.ts`).
 */
export type SecondInstanceHandler = (info: SecondInstanceInfo) => void;

export interface AcquireSingleInstanceLockOptions {
  readonly app: SingleInstanceApp;
  readonly logger?: Logger;
  readonly onSecondInstance?: SecondInstanceHandler;
}

/**
 * Discriminated on `held`. `held: true` is the only branch carrying
 * `release`; `held: false` is the only branch carrying `reason`. See the
 * module doc for why this shape was chosen over a boolean.
 */
export type SingleInstanceLockResult =
  | { readonly held: true; readonly release: () => void }
  | { readonly held: false; readonly reason: string };

/**
 * Requests Electron's single-instance lock via the injected `app`.
 *
 * - Lock acquired (primary instance): registers a `second-instance`
 *   listener that logs the event at `info` — including the second
 *   instance's `argv` and `workingDirectory`, the only diagnostic
 *   available on an unattended venue machine — then invokes
 *   `onSecondInstance`, if supplied. A throwing `onSecondInstance` is
 *   caught and logged rather than left to escape an Electron event
 *   handler, which would be worse than a failed focus attempt. Returns
 *   `{ held: true, release }`.
 * - Lock not acquired (second instance): returns `{ held: false, reason }`
 *   immediately. Never throws, never calls `process.exit` (I6) — see the
 *   module doc for why returning is the correct outcome here.
 */
export function acquireSingleInstanceLock(
  options: AcquireSingleInstanceLockOptions
): SingleInstanceLockResult {
  const logger = options.logger ?? noopLogger;
  const held = options.app.requestSingleInstanceLock();

  if (!held) {
    const reason = 'another instance already holds the single-instance lock';
    logger.info('single-instance lock not acquired', { reason });
    return { held: false, reason };
  }

  options.app.on('second-instance', (_event, argv, workingDirectory) => {
    logger.info('second instance launched; focusing existing windows', {
      argv,
      workingDirectory,
    });

    try {
      options.onSecondInstance?.({ argv, workingDirectory });
    } catch (error) {
      logger.error('second-instance handler threw; ignoring', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return { held: true, release: createRelease(options.app) };
}

/** Wraps `app.releaseSingleInstanceLock()` so calling the result more than once is a no-op. */
function createRelease(app: SingleInstanceApp): () => void {
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    app.releaseSingleInstanceLock();
  };
}
