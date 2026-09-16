import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { isPortFree, assertPortsFree } from './port.js';
import { ProcessError } from '../errors.js';

const HOST = '127.0.0.1';

/**
 * Servers opened by a test, closed in `afterEach` regardless of outcome so
 * the suite never leaks a real listener into later tests or the OS.
 */
let openServers: net.Server[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.map(
      server =>
        new Promise<void>(resolve => {
          if (!server.listening) {
            resolve();
            return;
          }
          server.close(() => resolve());
        })
    )
  );
  openServers = [];
});

/** Starts a real listener on an OS-assigned ephemeral port and returns it. */
async function listenOnEphemeralPort(): Promise<net.Server> {
  const server = net.createServer();
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, () => resolve());
  });
  return server;
}

function portOf(server: net.Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected a bound TCP server with a numeric port');
  }
  return address.port;
}

/** Binds to port 0 to obtain a genuinely free port, then releases it. */
async function reserveFreePort(): Promise<number> {
  const server = await listenOnEphemeralPort();
  const port = portOf(server);
  await new Promise<void>(resolve => server.close(() => resolve()));
  openServers = openServers.filter(candidate => candidate !== server);
  return port;
}

describe('isPortFree', () => {
  it('reports false for a port held by a real listener', async () => {
    const server = await listenOnEphemeralPort();
    const port = portOf(server);

    await expect(isPortFree(port, HOST)).resolves.toBe(false);
  });

  it('reports true for a genuinely free port', async () => {
    const port = await reserveFreePort();

    await expect(isPortFree(port, HOST)).resolves.toBe(true);
  });

  it('does not leave a listener behind after reporting a port free', async () => {
    const port = await reserveFreePort();

    await expect(isPortFree(port, HOST)).resolves.toBe(true);

    // If the probe left its own socket bound, this second bind would fail.
    const server = await listenOnEphemeralPortAt(port);
    expect(portOf(server)).toBe(port);
  });
});

/** Binds a real listener to a specific, already-known-free port. */
async function listenOnEphemeralPortAt(port: number): Promise<net.Server> {
  const server = net.createServer();
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => resolve());
  });
  return server;
}

describe('assertPortsFree', () => {
  it('resolves when every port is free', async () => {
    const portA = await reserveFreePort();
    const portB = await reserveFreePort();

    await expect(assertPortsFree([portA, portB], HOST)).resolves.toBeUndefined();
  });

  it('throws a ProcessError naming the taken port', async () => {
    const server = await listenOnEphemeralPort();
    const takenPort = portOf(server);

    const error = await assertPortsFree([takenPort], HOST).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProcessError);
    expect((error as ProcessError).message).toContain(String(takenPort));
  });

  it('names every conflicting port, not just the first', async () => {
    const serverA = await listenOnEphemeralPort();
    const serverB = await listenOnEphemeralPort();
    const takenPortA = portOf(serverA);
    const takenPortB = portOf(serverB);
    const freePort = await reserveFreePort();

    const error = await assertPortsFree([takenPortA, freePort, takenPortB], HOST).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(ProcessError);
    const message = (error as ProcessError).message;
    expect(message).toContain(String(takenPortA));
    expect(message).toContain(String(takenPortB));
    expect(message).not.toContain(String(freePort));
  });

  it.each([0, 65536, -1, 1.5, NaN])(
    'rejects the invalid port %s with a clear message',
    async invalidPort => {
      const error = await assertPortsFree([invalidPort], HOST).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ProcessError);
      expect((error as ProcessError).message).toMatch(/Invalid port/);
    }
  );

  it('names all invalid ports without probing any of them', async () => {
    const error = await assertPortsFree([0, 70000], HOST).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProcessError);
    const message = (error as ProcessError).message;
    expect(message).toContain('0');
    expect(message).toContain('70000');
  });

  it('respects an injected detect function in isPortFree and assertPortsFree', async () => {
    const fakeDetect = async (port: number) => (port === 8080 ? 8081 : port);
    await expect(isPortFree(8080, HOST, fakeDetect)).resolves.toBe(false);
    await expect(isPortFree(9090, HOST, fakeDetect)).resolves.toBe(true);

    const error = await assertPortsFree([8080], HOST, fakeDetect).catch(
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(ProcessError);
    expect((error as ProcessError).message).toContain('8080');
  });
});
