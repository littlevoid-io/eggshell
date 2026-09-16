import waitOn from 'wait-on';
import { ProcessError } from '../errors.js';

/** wait-on rejects with its own Error; surface it as a ProcessError naming the process and probe. */
function toProcessError(processId: string, kind: string, error: unknown): ProcessError {
  const detail = error instanceof Error ? error.message : String(error);
  return new ProcessError(`process "${processId}": readiness probe "${kind}" failed: ${detail}`, {
    processId,
    cause: error,
  });
}

/**
 * `localhost` rather than `127.0.0.1`: Node connects with autoSelectFamily, so a server
 * that binds only `::1` (Vite does) counts as ready too. wait-on cannot parse a literal IPv6 host.
 */
export async function waitOnTcp(port: number, timeoutMs: number, processId: string): Promise<void> {
  try {
    await waitOn({
      resources: [`tcp:localhost:${port}`],
      timeout: timeoutMs,
      interval: 250,
      tcpTimeout: 1000,
      window: 0,
    });
  } catch (error) {
    throw toProcessError(processId, 'tcp', error);
  }
}

function toHttpGetUrl(rawUrl: string): string {
  if (rawUrl.startsWith('https:')) {
    return rawUrl.replace(/^https:/, 'https-get:');
  }
  return rawUrl.replace(/^http:/, 'http-get:');
}

export async function waitOnHttp(
  url: string,
  expectStatus: number | undefined,
  timeoutMs: number,
  processId: string
): Promise<void> {
  try {
    await waitOn({
      resources: [toHttpGetUrl(url)],
      timeout: timeoutMs,
      interval: 250,
      tcpTimeout: 1000,
      window: 0,
      validateStatus: status =>
        expectStatus !== undefined ? status === expectStatus : status >= 200 && status < 300,
    });
  } catch (error) {
    throw toProcessError(processId, 'http', error);
  }
}
