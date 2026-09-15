import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { assertFileExists, resolveElectronBinary } from './resolve-electron.js';
import { LaunchError } from '../errors.js';

describe('assertFileExists', () => {
  it('resolves if file exists', async () => {
    const tempFile = path.resolve('userData', 'test-file-exists.txt');
    await fs.mkdir(path.dirname(tempFile), { recursive: true });
    await fs.writeFile(tempFile, 'ok');

    await expect(assertFileExists(tempFile, 'Test file')).resolves.toBeUndefined();
    await fs.rm(tempFile, { force: true });
  });

  it('throws LaunchError if file does not exist', async () => {
    await expect(assertFileExists(path.resolve('/nonexistent/file.txt'), 'Test file')).rejects.toThrow(
      LaunchError
    );
  });

  it('throws LaunchError naming directory if path is a directory', async () => {
    const tempDir = path.resolve('userData', 'test-dir-as-file');
    await fs.mkdir(tempDir, { recursive: true });

    await expect(assertFileExists(tempDir, 'Executable')).rejects.toThrow(
      /is a directory, expected a file/
    );
    await fs.rm(tempDir, { recursive: true, force: true });
  });
});

describe('resolveElectronBinary', () => {
  it('resolves electron from package.json in projectRoot when installed', async () => {
    const binary = await resolveElectronBinary(path.resolve('examples/basic-kiosk'));
    expect(typeof binary).toBe('string');
    expect(binary.length).toBeGreaterThan(0);
    expect(path.isAbsolute(binary)).toBe(true);
  });

  it('throws LaunchError when electron is not found in an isolated project', async () => {
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eggshell-no-electron-'));
    await fs.writeFile(path.join(isolatedDir, 'package.json'), JSON.stringify({ name: 'empty' }));

    await expect(resolveElectronBinary(isolatedDir)).rejects.toThrow(LaunchError);
    await fs.rm(isolatedDir, { recursive: true, force: true });
  });

  it('surfaces specific underlying error when electron module fails', async () => {
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eggshell-bad-electron-'));
    const fakeElectronDir = path.join(isolatedDir, 'node_modules', 'electron');
    await fs.mkdir(fakeElectronDir, { recursive: true });
    await fs.writeFile(
      path.join(fakeElectronDir, 'package.json'),
      JSON.stringify({ name: 'electron', main: 'index.js' })
    );
    await fs.writeFile(
      path.join(fakeElectronDir, 'index.js'),
      'throw new Error("Electron postinstall download failed");'
    );
    await fs.writeFile(path.join(isolatedDir, 'package.json'), JSON.stringify({ name: 'broken' }));

    await expect(resolveElectronBinary(isolatedDir)).rejects.toThrow(
      /Electron postinstall download failed/
    );
    await fs.rm(isolatedDir, { recursive: true, force: true });
  });
});
