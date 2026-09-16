import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

export type NetworkInterfaceDirectory = Record<string, NetworkInterfaceInfo[] | undefined>;

const VIRTUAL_PATTERN = /vbox|wsl|hyper-v|vethernet|vpn|docker|veth|virtual|tun|tap/i;

function findEntryIp(entries: readonly NetworkInterfaceInfo[]): string | undefined {
  for (const info of entries) {
    const isIpv4 = info.family === 'IPv4' || (info.family as unknown) === 4;
    if (isIpv4 && !info.internal) return info.address;
  }
  return undefined;
}

export function detectLocalIp(
  getInterfaces: () => NetworkInterfaceDirectory = networkInterfaces
): string {
  const interfaces = getInterfaces();
  let firstVirtualIp: string | undefined;

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries) continue;
    const ip = findEntryIp(entries);
    if (!ip) continue;
    if (!VIRTUAL_PATTERN.test(name)) return ip;
    if (!firstVirtualIp) firstVirtualIp = ip;
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
  if (options.url) return options.url;
  const host = options.host ?? resolveIp();
  const port = options.port ?? 3005;
  const rawPath = options.path ?? '/';
  const formattedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const safeHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const url = new URL('http://localhost');
  url.hostname = safeHost;
  url.port = port.toString();
  url.pathname = formattedPath;
  return url.toString();
}
