import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../errors.js';
import { findConfigFile, importConfigFactory, loadApp } from './load-config.js';

let appDir: string;

beforeEach(() => {
  appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eggshell-config-'));
});

afterEach(() => {
  fs.rmSync(appDir, { recursive: true, force: true });
});

function writeConfig(source: string, name = 'eggshell.config.ts'): string {
  const file = path.join(appDir, name);
  fs.writeFileSync(file, source);
  return file;
}

describe('findConfigFile', () => {
  it('throws a ConfigError naming the directory when no config exists', () => {
    expect(() => findConfigFile(appDir)).toThrow(ConfigError);
    expect(() => findConfigFile(appDir)).toThrow(appDir);
  });

  it('prefers the .ts config', () => {
    writeConfig('export default () => ({});', 'eggshell.config.mjs');
    const ts = writeConfig('export default () => ({});');
    expect(findConfigFile(appDir)).toBe(ts);
  });
});

describe('importConfigFactory', () => {
  it('rejects a config that does not default-export a function', () => {
    const file = writeConfig('export default { appId: "x" };');
    return expect(importConfigFactory(file)).rejects.toThrow(ConfigError);
  });
});

describe('loadApp', () => {
  it('runs a TypeScript factory with the context and validates the result', async () => {
    writeConfig(`
      type Context = { appDir: string; isDev: boolean };
      export default ({ appDir, isDev }: Context) => ({
        appId: 'com.example.test',
        productName: isDev ? 'Test (dev)' : 'Test',
        windows: [{ id: 'main', url: appDir + '/public/index.html' }],
      });
    `);
    const app = await loadApp({ appDir, isDev: true });
    expect(app.config.productName).toBe('Test (dev)');
    expect(app.config.windows[0]?.url).toContain(appDir);
    expect(app.config.keybindings.enabled).toBe(true);
    expect(app.paths.resolvedAppPath).toBe(path.join(appDir, '.eggshell', 'resolved.json'));
    expect(app.userData).toContain('com.example.test');
  });

  it('reports a validation issue with its field path', async () => {
    writeConfig(
      `export default () => ({ appId: 'com.example.test', productName: 'T', windows: [{ id: 'main', url: 'x', kiosk: 'yes' }] });`
    );
    await expect(loadApp({ appDir, isDev: true })).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: 'windows[0].kiosk' })],
    });
  });
});
