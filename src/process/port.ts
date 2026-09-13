/**
 * Pre-spawn port-conflict detection (T2.5, Requirement 9).
 *
 * The predecessor had no pre-spawn port check: a supervised server whose
 * port was already held — commonly by an orphaned child from a previous run
 * that was never reaped (see T2.9's rationale) — failed in a confusing way
 * deep inside whatever the server's own startup error happened to be. This
 * module turns that into one clear, actionable error before a process is
 * ever spawned.
 *
 * Availability is determined by attempting to **bind** a probe server, not
 * by connecting to the port. Connecting only tells you whether something is
 * currently accepting connections, and races with a server that is still
 * starting up (bound but not yet `listen`-ing, or listening but not yet
 * accepting) — a connect probe can misreport a soon-to-be-occupied port as
 * free. Binding is the same operation the real spawn will need to perform,
 * so it fails exactly when the real spawn would.
 *
 * **This check is advisory, not a guarantee.** Nothing prevents another
 * process from binding the port in the window between this probe closing
 * its socket and the supervised process opening its own — this module does
 * not hold the port open across that gap. Its purpose is to convert a
 * common, confusing failure into a clear message naming the port, not to
 * eliminate the race.
 */

import net from 'node:net';
import { ProcessError } from '../errors.js';
import { noopLogger, type Logger } from '../logging/logger.js';

const MIN_PORT = 1;
const MAX_PORT = 65535;
const DEFAULT_HOST = '127.0.0.1';

/**
 * Bind-time errors that mean "something else holds this port or address",
 * as opposed to an unexpected failure worth surfacing distinctly. `EACCES`
 * shows up for privileged ports (<1024 on POSIX) and some OS-reserved
 * ranges, not just for in-use ports, but from a caller's point of view it
 * means the same thing: this port cannot be bound right now.
 */
const PORT_UNAVAILABLE_CODES = new Set(['EADDRINUSE', 'EACCES']);

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}

function describeInvalidPorts(ports: readonly number[]): string {
  const invalid = ports.filter(port => !isValidPort(port));
  const rendered = invalid.map(port => (Object.is(port, NaN) ? 'NaN' : String(port))).join(', ');
  return `Invalid port${invalid.length > 1 ? 's' : ''}: ${rendered}. Ports must be integers between ${MIN_PORT} and ${MAX_PORT}.`;
}

/**
 * Probes whether `port` on `host` can currently be bound.
 *
 * Resolves `false` for `EADDRINUSE`/`EACCES` (port held or unavailable);
 * rejects with the original error for anything else (e.g. an invalid host,
 * or a `ProcessError` if `port` itself is out of range), since silently
 * reporting those as "not free" would hide a distinct failure mode.
 *
 * Always closes the probe server before resolving, so a `true` result never
 * leaves a listener behind.
 */
export async function isPortFree(
  port: number,
  host: string = DEFAULT_HOST,
  logger: Logger = noopLogger
): Promise<boolean> {
  if (!isValidPort(port)) {
    throw new ProcessError(describeInvalidPorts([port]));
  }

  return new Promise<boolean>((resolve, reject) => {
    const server = net.createServer();

    const onError = (error: NodeJS.ErrnoException): void => {
      server.removeListener('listening', onListening);
      if (error.code !== undefined && PORT_UNAVAILABLE_CODES.has(error.code)) {
        logger.debug('port probe: unavailable', { port, host, code: error.code });
        resolve(false);
        return;
      }
      logger.error('port probe: unexpected error', { port, host, error: error.message });
      reject(error);
    };

    const onListening = (): void => {
      server.removeListener('error', onError);
      server.close(closeError => {
        if (closeError) {
          reject(closeError);
          return;
        }
        logger.debug('port probe: free', { port, host });
        resolve(true);
      });
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/**
 * Throws a `ProcessError` naming every one of `ports` that is not currently
 * bindable on `host`, so a user fixing config sees the whole conflict list
 * rather than fixing one port only to hit the next on the following run.
 *
 * Validates that every entry in `ports` is an integer in `1..65535` before
 * probing anything, and throws a `ProcessError` naming all invalid entries
 * rather than attempting to bind an invalid value.
 */
export async function assertPortsFree(
  ports: readonly number[],
  host: string = DEFAULT_HOST,
  logger: Logger = noopLogger
): Promise<void> {
  const invalidPorts = ports.filter(port => !isValidPort(port));
  if (invalidPorts.length > 0) {
    throw new ProcessError(describeInvalidPorts(invalidPorts));
  }

  const results = await Promise.all(
    ports.map(async port => ({ port, free: await isPortFree(port, host, logger) }))
  );
  const takenPorts = results.filter(result => !result.free).map(result => result.port);

  if (takenPorts.length > 0) {
    throw new ProcessError(
      `Port${takenPorts.length > 1 ? 's' : ''} already in use on ${host}: ${takenPorts.join(', ')}. ` +
        'This is commonly an orphaned process from a previous run that was never reaped.'
    );
  }
}
