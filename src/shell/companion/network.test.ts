import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { buildCompanionUrl, detectLocalIp, type NetworkInterfaceDirectory } from './network.js';

describe('network utilities', () => {
  it('detects first non-internal IPv4 address', () => {
    const mockInterfaces: NetworkInterfaceDirectory = {
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as NetworkInterfaceInfo],
      eth0: [
        { address: 'fe80::1', family: 'IPv6', internal: false } as NetworkInterfaceInfo,
        { address: '192.168.1.100', family: 'IPv4', internal: false } as NetworkInterfaceInfo,
      ],
    };

    const ip = detectLocalIp(() => mockInterfaces);
    expect(ip).toBe('192.168.1.100');
  });

  it('falls back to 127.0.0.1 when no non-internal IPv4 exists', () => {
    const mockInterfaces: NetworkInterfaceDirectory = {
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as NetworkInterfaceInfo],
      eth0: [{ address: 'fe80::1', family: 'IPv6', internal: false } as NetworkInterfaceInfo],
      empty: undefined,
    };

    const ip = detectLocalIp(() => mockInterfaces);
    expect(ip).toBe('127.0.0.1');
  });

  it('returns explicit URL if provided', () => {
    const url = buildCompanionUrl({ url: 'https://kiosk.example.com/control' });
    expect(url).toBe('https://kiosk.example.com/control');
  });

  it('builds companion URL using detected IP, port, and path', () => {
    const url = buildCompanionUrl({ port: 3005, path: '/dashboard' }, () => '10.0.0.15');
    expect(url).toBe('http://10.0.0.15:3005/dashboard');
  });

  it('prepends leading slash to path if missing', () => {
    const url = buildCompanionUrl(
      { host: 'localhost', port: 8080, path: 'admin' },
      () => '127.0.0.1'
    );
    expect(url).toBe('http://localhost:8080/admin');
  });

  it('skips virtual adapters in favor of physical ones', () => {
    const mockInterfaces: NetworkInterfaceDirectory = {
      vEthernet: [
        { address: '192.168.99.1', family: 'IPv4', internal: false } as NetworkInterfaceInfo,
      ],
      eth0: [{ address: '192.168.1.100', family: 'IPv4', internal: false } as NetworkInterfaceInfo],
    };
    const ip = detectLocalIp(() => mockInterfaces);
    expect(ip).toBe('192.168.1.100');
  });

  it('falls back to virtual adapter if only virtual exists', () => {
    const mockInterfaces: NetworkInterfaceDirectory = {
      docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false } as NetworkInterfaceInfo],
    };
    const ip = detectLocalIp(() => mockInterfaces);
    expect(ip).toBe('172.17.0.1');
  });

  it('handles IPv6 hosts and paths with spaces correctly via URL encoding', () => {
    const url = buildCompanionUrl(
      { host: '::1', port: 3005, path: '/my path with spaces' },
      () => '127.0.0.1'
    );
    expect(url).toBe('http://[::1]:3005/my%20path%20with%20spaces');
  });
});
