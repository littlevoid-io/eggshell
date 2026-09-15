/**
 * Network utilities for companion overlay URL generation (T4.3).
 */

import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

export type NetworkInterfaceDirectory = Record<string, NetworkInterfaceInfo[] | undefined>;

export function detectLocalIp(
  getInterfaces: () => NetworkInterfaceDirectory = networkInterfaces
): string {
  const interfaces = getInterfaces();
  const virtualPattern = /vbox|wsl|hyper-v|vethernet|vpn|docker|veth|virtual|tun|tap/i;
  let firstVirtualIp: string | undefined;

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries) {
      continue;
    }
    const isVirtual = virtualPattern.test(name);
    for (const info of entries) {
      const isIpv4 = info.family === 'IPv4' || (info.family as unknown) === 4;
      if (isIpv4 && !info.internal) {
        if (!isVirtual) {
          return info.address;
        }
        if (!firstVirtualIp) {
          firstVirtualIp = info.address;
        }
      }
    }
  }
  return firstVirtualIp ?? '127.0.0.1';
}

export interface BuildCompanionUrlOptions {
  readonly url?: string | undefined;
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly path?: string | undefined;
}

export function buildCompanionUrl(
  options: BuildCompanionUrlOptions,
  resolveIp: () => string = detectLocalIp
): string {
  if (options.url) {
    return options.url;
  }

  const host = options.host ?? resolveIp();
  const port = options.port ?? 3005;
  const rawPath = options.path ?? '/';
  const formattedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;

  let safeHost = host;
  if (safeHost.includes(':') && !safeHost.startsWith('[')) {
    safeHost = `[${safeHost}]`;
  }

  const url = new URL('http://localhost');
  url.hostname = safeHost;
  url.port = port.toString();
  url.pathname = formattedPath;
  return url.toString();
}
