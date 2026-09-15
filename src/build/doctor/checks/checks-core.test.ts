import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { checkPlatformArch } from './platform.js';
import { checkElectronResolvable } from './electron.js';
import { checkConfigValidates } from './config.js';
import { checkOverrideFileParse } from './override.js';
import type { DoctorOptions } from '../types.js';

describe('doctor core checks', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doctor-core-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('reports platform/arch with pass status', () => {
    const check = checkPlatformArch({
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config: {},
      platform: 'linux',
      arch: 'arm64',
    });
    expect(check.status).toBe('pass');
    expect(check.message).toBe('linux (arm64)');
  });

  it('resolves electron binary when available and file exists', async () => {
    const fakeBinary = path.join(tempDir, 'fake-electron.exe');
    await fs.writeFile(fakeBinary, 'binary');

    const options: DoctorOptions = {
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config: {},
      resolveElectron: async () => fakeBinary,
    };
    const check = await checkElectronResolvable(options);
    expect(check.status).toBe('pass');
    expect(check.message).toContain(fakeBinary);
  });

  it('fails electron resolvable check when binary resolution fails', async () => {
    const options: DoctorOptions = {
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config: {},
      resolveElectron: async () => {
        throw new Error('Module not found');
      },
    };
    const check = await checkElectronResolvable(options);
    expect(check.status).toBe('fail');
    expect(check.remediation).toBeDefined();
  });

  it('passes config validation for valid configuration', () => {
    const validConfig = {
      appId: 'com.example.test',
      productName: 'Test App',
      windows: [{ id: 'main', url: 'https://example.com', target: { kind: 'primary' } }],
    };
    const result = checkConfigValidates({
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config: validConfig,
    });
    expect(result.check.status).toBe('pass');
    expect(result.validatedConfig?.appId).toBe('com.example.test');
  });

  it('fails config validation for invalid configuration', () => {
    const result = checkConfigValidates({
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config: { appId: 'Invalid Id!' },
    });
    expect(result.check.status).toBe('fail');
    expect(result.validatedConfig).toBeUndefined();
    expect(result.check.remediation).toBeDefined();
  });

  it('passes override check when no override file is present', () => {
    const check = checkOverrideFileParse({
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config: { appId: 'com.example.test', productName: 'App', windows: [{ id: 'w', url: 'u', target: { kind: 'primary' } }] },
    });
    expect(check.status).toBe('pass');
    expect(check.message).toContain('optional');
  });

  it('fails override check when file is malformed JSON', async () => {
    const overridePath = path.join(tempDir, 'eggshell.deployment.json');
    await fs.writeFile(overridePath, '{ not valid json', 'utf8');

    const check = checkOverrideFileParse({
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config: { appId: 'com.example.test', productName: 'App', windows: [{ id: 'w', url: 'u', target: { kind: 'primary' } }] },
    });
    expect(check.status).toBe('fail');
    expect(check.message).toContain('Invalid JSON');
  });
});
