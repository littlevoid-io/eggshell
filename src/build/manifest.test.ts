import { describe, it, expect } from 'vitest';
import { writeManifest } from './manifest.js';
import type { LaunchManifest } from './manifest.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import { BuildError } from '../errors.js';

describe('writeManifest', () => {
  it('writes valid manifest correctly', async () => {
    const data: LaunchManifest = {
      manifestVersion: 1,
      appId: 'com.example.test',
      productName: 'Test App',
      version: '1.2.3',
      executablePath: path.resolve('/fake/app.exe'),
      builtAt: '2026-09-14T00:00:00Z',
      platform: 'win32',
      arch: 'x64'
    };

    let writtenPath = '';
    let writtenContent = '';
    const writeFunc = async (p: string, c: string) => {
      writtenPath = p;
      writtenContent = c;
    };

    await writeManifest('/out/dir', data, writeFunc);

    expect(writtenPath).toBe(path.join('/out/dir', 'eggshell.launch.json'));
    const parsed = JSON.parse(writtenContent);
    expect(parsed.appId).toBe('com.example.test');
    expect(writtenContent.endsWith('\n')).toBe(true);
  });

  it('throws on relative executablePath', async () => {
    const data = {
      manifestVersion: 1,
      appId: 'com.example.test',
      productName: 'Test App',
      version: '1.2.3',
      executablePath: 'relative/app.exe',
      builtAt: '2026-09-14T00:00:00Z',
      platform: 'win32',
      arch: 'x64'
    } as unknown as LaunchManifest;

    await expect(writeManifest('/out', data, async () => {})).rejects.toThrow(BuildError);
  });

  it('throws on missing required fields', async () => {
    const data = {
      manifestVersion: 1,
      appId: 'com.example.test',
    } as unknown as LaunchManifest;

    await expect(writeManifest('/out', data, async () => {})).rejects.toThrow(/Invalid launch manifest/);
  });

  it('creates targetDir recursively if it does not exist', async () => {
    const targetDir = path.resolve('userData', 'test-manifest-mkdir', 'nested');
    await fs.rm(path.resolve('userData', 'test-manifest-mkdir'), { recursive: true, force: true });

    const data: LaunchManifest = {
      manifestVersion: 1,
      appId: 'com.example.test',
      productName: 'Test App',
      version: '1.2.3',
      executablePath: path.resolve('/fake/app.exe'),
      builtAt: '2026-09-14T00:00:00Z',
      platform: 'win32',
      arch: 'x64'
    };

    await writeManifest(targetDir, data);
    const content = await fs.readFile(path.join(targetDir, 'eggshell.launch.json'), 'utf8');
    expect(JSON.parse(content).appId).toBe('com.example.test');

    await fs.rm(path.resolve('userData', 'test-manifest-mkdir'), { recursive: true, force: true });
  });
});
