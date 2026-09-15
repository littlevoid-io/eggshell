import { describe, it, expect, afterEach, vi } from 'vitest';
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

function portOf(server: net.Server | http.Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected a bound server with a numeric port');
  }
  return address.port;
}

async function flushAsync(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
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
  it('resolves once a listener starts, proving the poll works', async () => {
    const clock = createFakeClock();
    let ready = false;
    const probeTcp = vi.fn(() => Promise.resolve(ready));

    const promise = waitForReadiness(
      { kind: 'tcp', port: 12345 },
      { processId: 'p', timeoutMs: 5000, clock, probeTcp }
    );

    await flushAsync();
    expect(probeTcp).toHaveBeenCalledTimes(1);

    ready = true;
    clock.advance(50);
    await flushAsync();

    await expect(promise).resolves.toBeUndefined();
    expect(probeTcp).toHaveBeenCalledTimes(2);
  });

  it('resolves against a real listening TCP socket', async () => {
    const server = await listenTcpAt(0);
    const port = portOf(server);

    await expect(
      waitForReadiness({ kind: 'tcp', port }, { processId: 'p', timeoutMs: 5000 })
    ).resolves.toBeUndefined();
  });

  it('times out with a ProcessError naming the process id and kind', async () => {
    const clock = createFakeClock();
    const probeTcp = vi.fn(() => Promise.resolve(false));

    const promise = waitForReadiness(
      { kind: 'tcp', port: 12345 },
      { processId: 'my-proc', timeoutMs: 150, clock, probeTcp }
    );
    const assertion = expect(promise).rejects.toBeInstanceOf(ProcessError);
    clock.advance(150);
    await assertion;

    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProcessError);
    const message = (error as ProcessError).message;
    expect(message).toContain('my-proc');
    expect(message).toContain('tcp');
  });
});

describe('waitForReadiness: http', () => {
  it('resolves on a real 200 from a node:http server', async () => {
    const server = await listenHttpAt(0, (_req, res) => {
      res.writeHead(200);
      res.end();
    });
    const port = portOf(server);

    await expect(
      waitForReadiness(
        { kind: 'http', url: `http://${HOST}:${port}/` },
        { processId: 'p', timeoutMs: 5000 }
      )
    ).resolves.toBeUndefined();
  });

  it('with expectStatus 204 does not resolve on 200, and resolves on 204', async () => {
    const clock = createFakeClock();
    const probeHttp = vi.fn(() => Promise.resolve(false));

    const timeoutPromise = waitForReadiness(
      { kind: 'http', url: `http://${HOST}:12345/`, expectStatus: 204 },
      { processId: 'p', timeoutMs: 150, clock, probeHttp }
    );
    const assertion = expect(timeoutPromise).rejects.toBeInstanceOf(ProcessError);
    clock.advance(150);
    await assertion;

    const server204 = await listenHttpAt(0, (_req, res) => {
      res.writeHead(204);
      res.end();
    });
    const port204 = portOf(server204);

    await expect(
      waitForReadiness(
        { kind: 'http', url: `http://${HOST}:${port204}/`, expectStatus: 204 },
        { processId: 'p', timeoutMs: 5000 }
      )
    ).resolves.toBeUndefined();
  });

  it('retries through an initial connection-refused and then succeeds', async () => {
    const clock = createFakeClock();
    let ready = false;
    const probeHttp = vi.fn(() => Promise.resolve(ready));

    const promise = waitForReadiness(
      { kind: 'http', url: `http://${HOST}:12345/` },
      { processId: 'p', timeoutMs: 5000, clock, probeHttp }
    );

    await flushAsync();
    expect(probeHttp).toHaveBeenCalledTimes(1);

    ready = true;
    clock.advance(50);
    await flushAsync();

    await expect(promise).resolves.toBeUndefined();
    expect(probeHttp).toHaveBeenCalledTimes(2);
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
    const probeTcp = vi.fn(
      (_port: number, signal: AbortSignal) =>
        new Promise<boolean>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );

    const promise = waitForReadiness(
      { kind: 'tcp', port: 12345 },
      { processId: 'my-proc', timeoutMs: 5000, clock, signal: controller.signal, probeTcp }
    );

    await flushAsync();
    controller.abort();

    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProcessError);
    expect((error as ProcessError).message).toContain('my-proc');
    expect(clock.pendingCount).toBe(0);
  });
});
