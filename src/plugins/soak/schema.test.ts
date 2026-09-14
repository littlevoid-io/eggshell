import { describe, expect, it } from 'vitest';
import { ConfigError } from '../../errors.js';
import { validateSoakConfig } from './schema.js';

describe('soakConfigSchema (T4.4)', () => {
  it('supplies defaults when empty object is passed', () => {
    const config = validateSoakConfig({});

    expect(config.enabled).toBe(true);
    expect(config.intervalMs).toBe(1000);
    expect(config.actionTypes).toEqual(['click', 'move', 'key', 'scroll']);
    expect(config.seed).toBeUndefined();
    expect(config.targetWindowIds).toBeUndefined();
    expect(config.maxActions).toBeUndefined();
    expect(config.reportPath).toBeUndefined();
  });

  it('accepts valid custom configuration', () => {
    const config = validateSoakConfig({
      enabled: false,
      seed: 12345,
      intervalMs: 250,
      actionTypes: ['click', 'key'],
      targetWindowIds: ['primary-window'],
      maxActions: 50,
      reportPath: 'C:/logs/soak.json',
    });

    expect(config.enabled).toBe(false);
    expect(config.seed).toBe(12345);
    expect(config.intervalMs).toBe(250);
    expect(config.actionTypes).toEqual(['click', 'key']);
    expect(config.targetWindowIds).toEqual(['primary-window']);
    expect(config.maxActions).toBe(50);
    expect(config.reportPath).toBe('C:/logs/soak.json');
  });

  it('rejects non-positive intervalMs with field path', () => {
    expect(() => validateSoakConfig({ intervalMs: 0 })).toThrow(ConfigError);
    try {
      validateSoakConfig({ intervalMs: -500 });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const issues = (error as ConfigError).issues;
      expect(issues[0]?.path).toBe('plugins.soak.intervalMs');
    }
  });

  it('rejects non-integer seed with field path', () => {
    try {
      validateSoakConfig({ seed: 3.14 });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const issues = (error as ConfigError).issues;
      expect(issues[0]?.path).toBe('plugins.soak.seed');
    }
  });

  it('rejects empty or invalid actionTypes', () => {
    expect(() => validateSoakConfig({ actionTypes: [] })).toThrow(ConfigError);
    expect(() => validateSoakConfig({ actionTypes: ['invalid-action'] })).toThrow(ConfigError);
  });

  it('rejects unrecognized keys via strict schema', () => {
    expect(() => validateSoakConfig({ unknownOption: true })).toThrow(ConfigError);
  });
});
