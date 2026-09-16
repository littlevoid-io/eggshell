import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BuildError } from '../errors.js';
import { findManifest } from './find-manifest.js';
import { MANIFEST_FILENAME } from './manifest.js';

let output: string;

beforeEach(() => {
  output = fs.mkdtempSync(path.join(os.tmpdir(), 'eggshell-release-'));
});

afterEach(() => {
  fs.rmSync(output, { recursive: true, force: true });
});

function addBuild(name: string): string {
  const directory = path.join(output, name);
  fs.mkdirSync(directory);
  const manifest = path.join(directory, MANIFEST_FILENAME);
  fs.writeFileSync(manifest, '{}');
  return manifest;
}

describe('findManifest', () => {
  it('finds the single manifest below the output directory', () => {
    const manifest = addBuild('win-unpacked');
    expect(findManifest(output)).toBe(manifest);
  });

  it('fails when nothing was built', () => {
    expect(() => findManifest(output)).toThrow(BuildError);
    expect(() => findManifest(path.join(output, 'missing'))).toThrow(BuildError);
  });

  it('refuses to guess between several builds', () => {
    addBuild('win-unpacked');
    addBuild('win-arm64-unpacked');
    expect(() => findManifest(output)).toThrow(/--manifest/);
  });
});
