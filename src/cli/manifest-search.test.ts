import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findLaunchManifest } from './manifest-search.js';
import { LaunchError } from '../errors.js';

describe('findLaunchManifest', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eggshell-manifest-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('throws LaunchError when release directory does not exist', async () => {
    await expect(findLaunchManifest(tempDir)).rejects.toThrow(LaunchError);
  });

  it('throws LaunchError when release directory has no manifests', async () => {
    await fs.mkdir(path.join(tempDir, 'release', 'win-unpacked'), { recursive: true });
    await expect(findLaunchManifest(tempDir)).rejects.toThrow(/No eggshell.launch.json found/);
  });

  it('finds manifest when exactly one exists in a release subdirectory', async () => {
    const targetDir = path.join(tempDir, 'release', 'win-unpacked');
    await fs.mkdir(targetDir, { recursive: true });
    const manifestPath = path.join(targetDir, 'eggshell.launch.json');
    await fs.writeFile(manifestPath, JSON.stringify({ version: 1 }));

    const found = await findLaunchManifest(tempDir);
    expect(found).toBe(manifestPath);
  });

  it('throws LaunchError when multiple manifests exist in subdirectories', async () => {
    const winDir = path.join(tempDir, 'release', 'win-unpacked');
    const macDir = path.join(tempDir, 'release', 'mac-unpacked');
    await fs.mkdir(winDir, { recursive: true });
    await fs.mkdir(macDir, { recursive: true });
    await fs.writeFile(path.join(winDir, 'eggshell.launch.json'), '{}');
    await fs.writeFile(path.join(macDir, 'eggshell.launch.json'), '{}');

    await expect(findLaunchManifest(tempDir)).rejects.toThrow(/Found multiple launch manifests/);
  });
});
