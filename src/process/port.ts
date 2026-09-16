import detectPort from 'detect-port';
import { ProcessError } from '../errors.js';

const MIN_PORT = 1;
const MAX_PORT = 65535;
const DEFAULT_HOST = '127.0.0.1';

/** Resolves to the port itself when free, or to another free port when taken (detect-port's contract). */
export type DetectPortFn = (port: number, host?: string) => Promise<number>;

const defaultDetect: DetectPortFn = (port, host) => detectPort({ port, hostname: host });

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}

function describeInvalidPorts(ports: readonly number[]): string {
  const invalid = ports.filter(port => !isValidPort(port));
  const rendered = invalid.map(port => (Object.is(port, NaN) ? 'NaN' : String(port))).join(', ');
  return `Invalid port${invalid.length > 1 ? 's' : ''}: ${rendered}. Ports must be integers between ${MIN_PORT} and ${MAX_PORT}.`;
}

export async function isPortFree(
  port: number,
  host: string = DEFAULT_HOST,
  detect: DetectPortFn = defaultDetect
): Promise<boolean> {
  if (!isValidPort(port)) {
    throw new ProcessError(describeInvalidPorts([port]));
  }
  return (await detect(port, host)) === port;
}

function checkTakenPorts(taken: readonly number[], host: string): void {
  if (taken.length === 0) return;
  const label = taken.length > 1 ? 'Ports' : 'Port';
  throw new ProcessError(
    `${label} already in use on ${host}: ${taken.join(', ')}. ` +
      'This is commonly an orphaned process from a previous run that was never reaped.'
  );
}

export async function assertPortsFree(
  ports: readonly number[],
  host: string = DEFAULT_HOST,
  detect: DetectPortFn = defaultDetect
): Promise<void> {
  const invalid = ports.filter(port => !isValidPort(port));
  if (invalid.length > 0) {
    throw new ProcessError(describeInvalidPorts(invalid));
  }
  const results = await Promise.all(
    ports.map(async port => ({ port, free: await isPortFree(port, host, detect) }))
  );
  checkTakenPorts(
    results.filter(result => !result.free).map(result => result.port),
    host
  );
}
