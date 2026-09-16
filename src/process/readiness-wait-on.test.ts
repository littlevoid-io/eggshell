import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ProcessError } from '../errors.js';
import { waitOnTcp } from './readiness-wait-on.js';

let server: net.Server | undefined;

afterEach(async () => {
  await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function listen(host: string): Promise<number> {
  server = net.createServer().listen(0, host);
  await new Promise<void>(resolve => server?.once('listening', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('no address');
  return address.port;
}

describe('waitOnTcp', () => {
  it('treats a server bound only to ::1 as ready, like Vite on localhost', async () => {
    const port = await listen('::1');
    await expect(waitOnTcp(port, 2000, 'vite')).resolves.toBeUndefined();
  });

  it('treats a server bound only to 127.0.0.1 as ready', async () => {
    const port = await listen('127.0.0.1');
    await expect(waitOnTcp(port, 2000, 'server')).resolves.toBeUndefined();
  });

  it('fails with a ProcessError naming the process when nothing listens', async () => {
    const error = await waitOnTcp(1, 300, 'server').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProcessError);
    expect(String((error as Error).message)).toContain('process "server"');
  });
});
