import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { waitForReadiness } from './readiness.js';
import { ProcessError } from '../errors.js';
import { createFakeClock, type FakeClock } from '../__testing__/fake-clock.js';
import type { ProcessLine, ProcessLineStream } from './types.js';

const HOST = '127.0.0.1';

let openServers: Array<net.Server | http.Server> = [];

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

/** Binds to port 0 to obtain a genuinely free port, then releases it immediately. */
async function reserveFreePort(): Promise<number> {
  const server = net.createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('expected a bound TCP server with a numeric port'));
        return;
      }
      resolve(address.port);
    });
  });
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

async function listenTcpAt(port: number): Promise<net.Server> {
  const server = net.createServer(socket => socket.end());
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => resolve());
  });
  return server;
}

async function listenHttpAt(
  port: number,
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<http.Server> {
  const server = http.createServer(handler);
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => resolve());
  });
  return server;
}

/** Hand-built `ProcessLineStream` — no real process, per T2.7's spec. */
function createSyntheticLineStream(): { stream: ProcessLineStream; push(text: string): void } {
  const listeners = new Set<(line: ProcessLine) => void>();
  return {
    stream: {
      onLine(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    push(text) {
      for (const listener of listeners) {
        listener({ stream: 'stdout', text });
      }
    },
  };
}

describe('waitForReadiness: none', () => {
  it('resolves immediately', async () => {
    await expect(
      waitForReadiness({ kind: 'none' }, { processId: 'p', timeoutMs: 1000 })
    ).resolves.toBeUndefined();
  });
});

describe('waitForReadiness: delay', () => {
  it('resolves only after ms has elapsed on the fake clock', async () => {
    const clock: FakeClock = createFakeClock();
    let resolved = false;

    const promise = waitForReadiness(
      { kind: 'delay', ms: 1000 },
      { processId: 'p', timeoutMs: 5000, clock }
    ).then(() => {
      resolved = true;
    });

    await Promise.resolve();
    clock.advance(999);
    await Promise.resolve();
    expect(resolved).toBe(false);

    clock.advance(1);
    await promise;
    expect(resolved).toBe(true);
  });

  it('leaves no pending fake-clock timers on success', async () => {
    const clock: FakeClock = createFakeClock();
    const promise = waitForReadiness(
      { kind: 'delay', ms: 100 },
      { processId: 'p', timeoutMs: 5000, clock }
    );
    clock.advance(100);
    await promise;
    expect(clock.pendingCount).toBe(0);
  });
});

describe('waitForReadiness: tcp', () => {
  it('resolves once a real listener starts, proving the poll works', async () => {
    const port = await reserveFreePort();

    const promise = waitForReadiness({ kind: 'tcp', port }, { processId: 'p', timeoutMs: 5000 });

    // Server intentionally starts AFTER the wait begins, so this only passes
    // if the poll loop actually retries rather than getting lucky once.
    await new Promise(resolve => setTimeout(resolve, 60));
    await listenTcpAt(port);

    await expect(promise).resolves.toBeUndefined();
  });

  it('times out with a ProcessError naming the process id and kind', async () => {
    const port = await reserveFreePort();

    const error = await waitForReadiness(
      { kind: 'tcp', port },
      { processId: 'my-proc', timeoutMs: 150 }
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProcessError);
    const message = (error as ProcessError).message;
    expect(message).toContain('my-proc');
    expect(message).toContain('tcp');
  });
});

describe('waitForReadiness: http', () => {
  it('resolves on a real 200 from a node:http server', async () => {
    const port = await reserveFreePort();
    await listenHttpAt(port, (_req, res) => {
      res.writeHead(200);
      res.end();
    });

    await expect(
      waitForReadiness(
        { kind: 'http', url: `http://${HOST}:${port}/` },
        { processId: 'p', timeoutMs: 5000 }
      )
    ).resolves.toBeUndefined();
  });

  it('with expectStatus 204 does not resolve on 200, and resolves on 204', async () => {
    const port200 = await reserveFreePort();
    await listenHttpAt(port200, (_req, res) => {
      res.writeHead(200);
      res.end();
    });

    const error = await waitForReadiness(
      { kind: 'http', url: `http://${HOST}:${port200}/`, expectStatus: 204 },
      { processId: 'p', timeoutMs: 150 }
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProcessError);

    const port204 = await reserveFreePort();
    await listenHttpAt(port204, (_req, res) => {
      res.writeHead(204);
      res.end();
    });

    await expect(
      waitForReadiness(
        { kind: 'http', url: `http://${HOST}:${port204}/`, expectStatus: 204 },
        { processId: 'p', timeoutMs: 5000 }
      )
    ).resolves.toBeUndefined();
  });

  it('retries through an initial connection-refused and then succeeds', async () => {
    const port = await reserveFreePort();

    const promise = waitForReadiness(
      { kind: 'http', url: `http://${HOST}:${port}/` },
      { processId: 'p', timeoutMs: 5000 }
    );

    await new Promise(resolve => setTimeout(resolve, 60));
    await listenHttpAt(port, (_req, res) => {
      res.writeHead(200);
      res.end();
    });

    await expect(promise).resolves.toBeUndefined();
  });
});

describe('waitForReadiness: log', () => {
  it('resolves when a matching line arrives on a synthetic ProcessLineStream', async () => {
    const { stream, push } = createSyntheticLineStream();

    const promise = waitForReadiness(
      { kind: 'log', pattern: 'ready' },
      { processId: 'p', timeoutMs: 5000, lines: stream }
    );

    push('starting up');
    push('server is ready');

    await expect(promise).resolves.toBeUndefined();
  });

  it('treats the pattern as a literal substring, not a RegExp', async () => {
    const { stream, push } = createSyntheticLineStream();

    const promise = waitForReadiness(
      { kind: 'log', pattern: 'Listening on [::1]:3000' },
      { processId: 'p', timeoutMs: 5000, lines: stream }
    );

    push('Listening on [::1]:3000 - ready');

    await expect(promise).resolves.toBeUndefined();
  });

  it('throws a clear ProcessError when no lines stream is provided, rather than hanging', async () => {
    const error = await waitForReadiness(
      { kind: 'log', pattern: 'ready' },
      { processId: 'my-proc', timeoutMs: 5000 }
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProcessError);
    expect((error as ProcessError).message).toContain('my-proc');
    expect((error as ProcessError).message).toContain('log');
  });
});

describe('waitForReadiness: timeout', () => {
  it('rejects with a ProcessError naming process id, kind, and elapsed time', async () => {
    const clock: FakeClock = createFakeClock();
    const { stream } = createSyntheticLineStream();

    const promise = waitForReadiness(
      { kind: 'log', pattern: 'never appears' },
      { processId: 'my-proc', timeoutMs: 1000, clock, lines: stream }
    );
    const assertion = expect(promise).rejects.toBeInstanceOf(ProcessError);
    clock.advance(1000);
    await assertion;

    const error = await promise.catch((caught: unknown) => caught);
    const message = (error as ProcessError).message;
    expect(message).toContain('my-proc');
    expect(message).toContain('log');
    expect(message).toContain('1000');
  });
});

describe('waitForReadiness: abort', () => {
  it('settles promptly on abort and leaves no pending fake-clock timers', async () => {
    const clock: FakeClock = createFakeClock();
    const controller = new AbortController();
    const { stream } = createSyntheticLineStream();

    const promise = waitForReadiness(
      { kind: 'log', pattern: 'never appears' },
      { processId: 'my-proc', timeoutMs: 5000, clock, signal: controller.signal, lines: stream }
    );

    controller.abort();

    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProcessError);
    expect((error as ProcessError).message).toContain('my-proc');
    expect(clock.pendingCount).toBe(0);
  });

  it('aborts a tcp poll in progress with no pending fake-clock timers', async () => {
    const clock: FakeClock = createFakeClock();
    const controller = new AbortController();
    const port = await reserveFreePort();

    const promise = waitForReadiness(
      { kind: 'tcp', port },
      { processId: 'my-proc', timeoutMs: 5000, clock, signal: controller.signal }
    );

    await Promise.resolve();
    controller.abort();

    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProcessError);
    expect(clock.pendingCount).toBe(0);
  });
});
