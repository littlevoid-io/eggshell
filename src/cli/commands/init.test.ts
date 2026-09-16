import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from './init.js';

let appDir: string;

beforeEach(() => {
  appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eggshell-init-'));
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(appDir, { recursive: true, force: true });
});

const read = (relative: string) => fs.readFileSync(path.join(appDir, relative), 'utf8');
const readJson = (relative: string) => JSON.parse(read(relative)) as Record<string, unknown>;

describe('runInit', () => {
  it('scaffolds an empty directory', async () => {
    await runInit({ projectRoot: appDir, appId: 'com.example.demo', productName: 'Demo' });
    expect(read('eggshell.config.ts')).toContain('"com.example.demo"');
    expect(read('public/index.html')).toContain('Demo');
    expect(read('eggshell.config.ts')).toContain(`url: "public/index.html"`);
    expect(readJson('package.json')).toMatchObject({
      type: 'module',
      scripts: { dev: 'eggshell dev', doctor: 'eggshell doctor' },
      devDependencies: { '@littlevoid/eggshell': expect.stringMatching(/^\^\d+\.\d+\.\d+$/) },
    });
    expect(read('.gitignore')).toContain('.eggshell/');
  });

  it('points the window at an existing root index.html and adds no placeholder', async () => {
    fs.writeFileSync(path.join(appDir, 'index.html'), '<h1>existing</h1>');
    await runInit({ projectRoot: appDir });
    expect(read('eggshell.config.ts')).toContain(`url: "index.html"`);
    expect(fs.existsSync(path.join(appDir, 'public'))).toBe(false);
  });

  it('merges into an existing package.json without overwriting existing keys', async () => {
    fs.writeFileSync(
      path.join(appDir, 'package.json'),
      JSON.stringify({ name: 'mural', scripts: { dev: 'vite', test: 'vitest' } }, null, 2)
    );
    fs.mkdirSync(path.join(appDir, 'public'));
    await runInit({ projectRoot: appDir });
    const manifest = readJson('package.json');
    expect(manifest['name']).toBe('mural');
    expect(manifest['scripts']).toEqual({
      dev: 'vite',
      test: 'vitest',
      build: 'eggshell build',
      start: 'eggshell start',
      doctor: 'eggshell doctor',
    });
    expect(fs.existsSync(path.join(appDir, 'public', 'index.html'))).toBe(false);
  });

  it('is idempotent', async () => {
    await runInit({ projectRoot: appDir });
    const first = read('package.json') + read('.gitignore') + read('eggshell.config.ts');
    await runInit({ projectRoot: appDir });
    expect(read('package.json') + read('.gitignore') + read('eggshell.config.ts')).toBe(first);
  });
});
