import { describe, expect, it } from 'vitest';
import { validateOfflineConfig } from './schema.js';
import { ConfigError } from '../../errors.js';

describe('offlineConfigSchema (T4.1)', () => {
  it('supplies defaults when empty object is passed', () => {
    const config = validateOfflineConfig({});

    expect(config.enabled).toBe(true);
    expect(config.timeoutMs).toBe(30000);
    expect(config.pollIntervalMs).toBe(5000);
    expect(config.pingUrl).toBeUndefined();
    expect(config.targetWindowIds).toBeUndefined();
  });

  it('accepts valid custom configuration', () => {
    const config = validateOfflineConfig({
      enabled: false,
      timeoutMs: 15000,
      pollIntervalMs: 2000,
      pingUrl: 'https://127.0.0.1:8080/health',
      targetWindowIds: ['primary-window'],
    });

    expect(config.enabled).toBe(false);
    expect(config.timeoutMs).toBe(15000);
    expect(config.pollIntervalMs).toBe(2000);
    expect(config.pingUrl).toBe('https://127.0.0.1:8080/health');
    expect(config.targetWindowIds).toEqual(['primary-window']);
  });

  it('rejects non-positive timeoutMs with field path', () => {
    expect(() => validateOfflineConfig({ timeoutMs: -100 })).toThrow(ConfigError);
    try {
      validateOfflineConfig({ timeoutMs: 0 });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const issues = (error as ConfigError).issues;
      expect(issues[0]?.path).toBe('plugins.offline.timeoutMs');
    }
  });

  it('rejects invalid pingUrl format with field path', () => {
    try {
      validateOfflineConfig({ pingUrl: 'not-a-valid-url' });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const issues = (error as ConfigError).issues;
      expect(issues[0]?.path).toBe('plugins.offline.pingUrl');
    }
  });

  it('rejects unrecognized keys via strict schema', () => {
    try {
      validateOfflineConfig({ invalidProperty: 123 });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
    }
  });
});
