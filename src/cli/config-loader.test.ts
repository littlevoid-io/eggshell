import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCliConfig } from './config-loader.js';
import { ConfigError } from '../errors.js';

describe('loadCliConfig', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eggshell-config-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('throws ConfigError naming all three candidate filenames when none exist', async () => {
    let thrownError: unknown;
    try {
      await loadCliConfig(tempDir);
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(ConfigError);
    const message = (thrownError as ConfigError).message;
    expect(message).toContain('eggshell.config.ts');
    expect(message).toContain('eggshell.config.mjs');
    expect(message).toContain('eggshell.config.js');
  });

  it('loads and validates a valid eggshell.config.mjs', async () => {
    const validConfig = `
      export default {
        appId: 'com.example.test-kiosk',
        productName: 'Test Kiosk',
        windows: [
          {
            id: 'main',
            url: 'https://example.com',
            target: { kind: 'primary' },
          }
        ]
      };
    `;
    await fs.writeFile(path.join(tempDir, 'eggshell.config.mjs'), validConfig, 'utf8');

    const loaded = await loadCliConfig(tempDir);
    expect(loaded.appId).toBe('com.example.test-kiosk');
    expect(loaded.productName).toBe('Test Kiosk');
    expect(loaded.windows).toHaveLength(1);
    expect(loaded.windows[0]?.target.kind).toBe('primary');
  });

  it('loads and validates a valid eggshell.config.ts', async () => {
    const tsConfig = `
      export default {
        appId: 'com.example.ts-kiosk',
        productName: 'TS Kiosk',
        windows: [
          {
            id: 'main',
            url: 'https://example.com',
            target: { kind: 'primary' },
          }
        ]
      };
    `;
    await fs.writeFile(path.join(tempDir, 'eggshell.config.ts'), tsConfig, 'utf8');

    const loaded = await loadCliConfig(tempDir);
    expect(loaded.appId).toBe('com.example.ts-kiosk');
    expect(loaded.productName).toBe('TS Kiosk');
  });

  it('throws ConfigError when config has no default export', async () => {
    const invalidExport = `export const config = { appId: 'com.example.fail' };`;
    await fs.writeFile(path.join(tempDir, 'eggshell.config.mjs'), invalidExport, 'utf8');

    await expect(loadCliConfig(tempDir)).rejects.toThrow(
      /does not have a default export/
    );
  });

  it('throws ConfigError with issue field paths when config violates schema', async () => {
    const brokenConfig = `
      export default {
        appId: 'bad_app_id_not_reverse_dns',
        productName: 'Test',
        windows: []
      };
    `;
    await fs.writeFile(path.join(tempDir, 'eggshell.config.mjs'), brokenConfig, 'utf8');

    let thrownError: unknown;
    try {
      await loadCliConfig(tempDir);
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(ConfigError);
    const message = (thrownError as ConfigError).message;
    expect(message).toContain('windows');
  });
});
