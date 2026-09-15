import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import { BuildError } from '../errors.js';
import type { ShellRoots, ShellConfig } from '../index.js';

describe('build()', () => {
  const dummyRoots: ShellRoots = {
    packageRoot: path.resolve('node_modules/eggshell'),
    projectRoot: path.resolve('examples/basic-kiosk'),
    userDataRoot: path.resolve('userData'),
  };

  const dummyConfig = {
    appId: 'com.example.test',
    productName: 'Test App',
    windows: [{ id: 'main', url: 'https://example.com', target: { kind: 'primary' } }],
  } as ShellConfig;

  it('composes electron-builder config in memory and returns executable path', async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    const fakeBuilder = {
      build: async (options: Record<string, unknown>) => {
        capturedOptions = options;
        return [path.resolve('examples/basic-kiosk/release/win-unpacked/Test App.exe')];
      }
    };

    const result = await build({
      roots: dummyRoots,
      config: dummyConfig,
      builderModule: fakeBuilder
    });

    expect(capturedOptions?.projectDir).toBe(dummyRoots.projectRoot);
    expect((capturedOptions?.config as Record<string, unknown>)?.appId).toBe('com.example.test');
    const files = (capturedOptions?.config as Record<string, unknown>)?.files as string[];
    expect(files).toContain('package.json');
    expect(files).toContain('dist/**/*');
    expect(files).toContain('public/**/*');
    expect(files).toContain('!release/**');
    expect(files).toContain('!**/.git{,/**}');
    expect(files).toContain('!**/.env*');
    expect(files).toContain('!**/*.log');
    expect(files).not.toContain('**/*');

    expect(result.executablePath).toBe(path.resolve('examples/basic-kiosk/release/win-unpacked/Test App.exe'));
    expect(result.manifestPath).toBe(path.resolve('examples/basic-kiosk/release/win-unpacked/eggshell.launch.json'));

    // Check if manifest was actually written
    const manifestRaw = await fs.readFile(result.manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw) as { appId: string };
    expect(manifest.appId).toBe('com.example.test');
    
    // Clean up
    await fs.rm(result.manifestPath, { force: true });
  });

  it('throws BuildError if package.json has non-string or missing version', async () => {
    const tempDir = path.resolve('userData', 'test-invalid-pkg');
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'test', version: 123 }));

    const invalidRoots: ShellRoots = {
      packageRoot: dummyRoots.packageRoot,
      projectRoot: tempDir,
      userDataRoot: dummyRoots.userDataRoot,
    };

    const fakeBuilder = {
      build: async () => []
    };

    await expect(build({
      roots: invalidRoots,
      config: dummyConfig,
      builderModule: fakeBuilder
    })).rejects.toThrow(BuildError);

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('never claims .dmg as executable and resolves Mach-O inside .app bundle', async () => {
    const tempAppDir = path.resolve('userData', 'test-mac-app', 'Test App.app', 'Contents', 'MacOS');
    await fs.mkdir(tempAppDir, { recursive: true });
    const macBin = path.join(tempAppDir, 'Test App');
    await fs.writeFile(macBin, 'binary');

    const appBundlePath = path.resolve('userData', 'test-mac-app', 'Test App.app');
    const fakeBuilder = {
      build: async () => [
        path.resolve('userData', 'test-mac-app', 'installer.dmg'),
        appBundlePath,
      ]
    };

    const result = await build({
      roots: dummyRoots,
      config: dummyConfig,
      builderModule: fakeBuilder
    });

    expect(result.executablePath).toBe(macBin);
    expect(result.executablePath.endsWith('.dmg')).toBe(false);
    expect(result.executablePath.endsWith('.app')).toBe(false);

    await fs.rm(path.resolve('userData', 'test-mac-app'), { recursive: true, force: true });
    await fs.rm(result.manifestPath, { force: true });
  });

  it('throws BuildError if electron-builder fails', async () => {
    const fakeBuilder = {
      build: async () => {
        throw new Error('EACCESS');
      }
    };

    await expect(build({
      roots: dummyRoots,
      config: dummyConfig,
      builderModule: fakeBuilder
    })).rejects.toThrow(BuildError);
  });
});
