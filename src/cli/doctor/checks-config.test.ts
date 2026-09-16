import { describe, expect, it } from 'vitest';
import { validateConfig } from '../../config/validate.js';
import { checkPorts, checkWindowUrls, expectedPorts } from './checks-config.js';

const config = validateConfig({
  appId: 'com.example.doctor',
  productName: 'Doctor',
  windows: [
    { id: 'main', url: 'public/index.html' },
    { id: 'web', url: 'http://localhost:3000' },
  ],
  processes: [
    {
      id: 'server',
      command: 'node',
      readiness: { kind: 'tcp', port: 3001 },
      requirePortsFree: [3001, 3002],
    },
  ],
  dashboard: { enabled: true, port: 3005 },
});

describe('doctor config checks', () => {
  it('collects readiness, requirePortsFree and dashboard ports once each, sorted', () => {
    expect(expectedPorts(config)).toEqual([3001, 3002, 3005]);
  });

  it('reports busy ports as a warning', async () => {
    const result = await checkPorts([3001, 3005], async port => port !== 3005);
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('3005');
  });

  it('only checks scheme-less window urls against the file system', () => {
    const missing = checkWindowUrls(config, '/app', () => false);
    expect(missing.status).toBe('fail');
    expect(missing.detail).toContain('public/index.html');
    expect(missing.detail).not.toContain('localhost');
    expect(checkWindowUrls(config, '/app', () => true).status).toBe('ok');
  });
});
