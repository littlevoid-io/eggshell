import { net } from 'electron';

export type ConnectivityProbe = () => Promise<boolean>;

export interface ConnectivityProbeOptions {
  pingUrl?: string | undefined;
  timeoutMs?: number | undefined;
  isOnline?: () => boolean;
  fetchFn?: typeof fetch;
}

export async function headIsOk(
  url: string,
  timeoutMs: number = 3000,
  fetchFn: typeof fetch = fetch
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: 'HEAD',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function checkOsOnline(isOnline: () => boolean): boolean {
  try {
    return isOnline();
  } catch {
    return false;
  }
}

export function createConnectivityProbe(options: ConnectivityProbeOptions = {}): ConnectivityProbe {
  const { pingUrl, timeoutMs = 3000, isOnline = () => net.isOnline(), fetchFn = fetch } = options;

  return async (): Promise<boolean> => {
    if (!checkOsOnline(isOnline)) {
      return false;
    }
    if (pingUrl === undefined) {
      return true;
    }
    return headIsOk(pingUrl, timeoutMs, fetchFn);
  };
}
