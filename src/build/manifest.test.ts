import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BuildError } from '../errors.js';
import {
  assertManifestPlatform,
  MANIFEST_FILENAME,
  readManifest,
  writeManifest,
  type LaunchManifest,
} from './manifest.js';

let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eggshell-manifest-'));
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

function manifest(): LaunchManifest {
  return {
    manifestVersion: 1,
    appId: 'com.example.demo',
    productName: 'Demo',
    version: '1.2.3',
    executablePath: path.resolve(directory, 'Demo.exe'),
    builtAt: '2026-09-16T10:00:00.000Z',
    platform: process.platform,
    arch: process.arch,
  };
}

describe('launch manifest', () => {
  it('round-trips through the file', () => {
    const file = writeManifest(directory, manifest());
    expect(path.basename(file)).toBe(MANIFEST_FILENAME);
    expect(readManifest(file)).toEqual(manifest());
  });

  it('rejects a relative executable path', () => {
    expect(() =>
      writeManifest(directory, { ...manifest(), executablePath: 'relative/Demo.exe' })
    ).toThrow(BuildError);
  });

  it('rejects a manifest from another platform', () => {
    expect(() => assertManifestPlatform({ ...manifest(), arch: 'never' })).toThrow(BuildError);
    expect(() => assertManifestPlatform(manifest())).not.toThrow();
  });
});
