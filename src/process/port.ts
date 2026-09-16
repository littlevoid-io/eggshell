import detectPort from 'detect-port';
import { ProcessError } from '../errors.js';
import { noopLogger, type Logger } from '../logging/logger.js';

const MIN_PORT = 1;
const MAX_PORT = 65535;
const DEFAULT_HOST = '127.0.0.1';

export type DetectPortFn = (port: number, host?: string) => Promise<number>;

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}

function describeInvalidPorts(ports: readonly number[]): string {
  const invalid = ports.filter(port => !isValidPort(port));
  const rendered = invalid.map(port => (Object.is(port, NaN) ? 'NaN' : String(port))).join(', ');
  return `Invalid port${invalid.length > 1 ? 's' : ''}: ${rendered}. Ports must be integers between ${MIN_PORT} and ${MAX_PORT}.`;
}

function resolveDetect(
  loggerOrDetect?: Logger | DetectPortFn,
  detectFn?: DetectPortFn
): DetectPortFn {
  if (typeof detectFn === 'function') {
    return detectFn;
  }
  if (typeof loggerOrDetect === 'function') {
    return loggerOrDetect;
  }
  return (port: number, host?: string) => detectPort({ port, hostname: host });
}

export async function isPortFree(
  port: number,
  host: string = DEFAULT_HOST,
  loggerOrDetect?: Logger | DetectPortFn,
  detectFn?: DetectPortFn
): Promise<boolean> {
  if (!isValidPort(port)) {
    throw new ProcessError(describeInvalidPorts([port]));
  }
  const detect = resolveDetect(loggerOrDetect, detectFn);
  const detected = await detect(port, host);
  return detected === port;
}

function checkTakenPorts(taken: readonly number[], host: string): void {
  if (taken.length === 0) {
    return;
  }
  const label = taken.length > 1 ? 'Ports' : 'Port';
  throw new ProcessError(
    `${label} already in use on ${host}: ${taken.join(', ')}. ` +
      'This is commonly an orphaned process from a previous run that was never reaped.'
  );
}

export async function assertPortsFree(
  ports: readonly number[],
  host: string = DEFAULT_HOST,
  loggerOrDetect: Logger | DetectPortFn = noopLogger,
  detectFn?: DetectPortFn
): Promise<void> {
  const invalid = ports.filter(port => !isValidPort(port));
  if (invalid.length > 0) {
    throw new ProcessError(describeInvalidPorts(invalid));
  }
  const detect = resolveDetect(loggerOrDetect, detectFn);
  const results = await Promise.all(
    ports.map(async port => ({ port, free: await isPortFree(port, host, detect) }))
  );
  const taken = results.filter(result => !result.free).map(result => result.port);
  checkTakenPorts(taken, host);
}
