import { describe, expect, it } from 'vitest';
import { validateDashboardConfig } from './schema.js';
import { ConfigError } from '../../errors.js';

describe('dashboardConfigSchema (T4.2)', () => {
  it('provides default config with loopback host and no token', () => {
    const config = validateDashboardConfig({});

    expect(config.enabled).toBe(true);
    expect(config.port).toBe(3005);
    expect(config.host).toBe('127.0.0.1');
    expect(config.token).toBeUndefined();
    expect(config.allowRestart).toBe(false);
  });

  it('allows loopback hosts without token', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1']) {
      const config = validateDashboardConfig({ host });
      expect(config.host).toBe(host);
    }
  });

  it('rejects non-loopback host when token is missing or empty (I3)', () => {
    for (const host of ['0.0.0.0', '192.168.1.100', '10.0.0.1']) {
      expect(() => validateDashboardConfig({ host })).toThrow(ConfigError);
      try {
        validateDashboardConfig({ host, token: '   ' });
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        const issues = (error as ConfigError).issues;
        expect(issues[0]?.path).toBe('plugins.dashboard.token');
      }
    }
  });

  it('accepts non-loopback host with valid token (I3)', () => {
    const config = validateDashboardConfig({
      host: '0.0.0.0',
      port: 8080,
      token: 'secret-token-123',
      allowRestart: true,
    });

    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(8080);
    expect(config.token).toBe('secret-token-123');
    expect(config.allowRestart).toBe(true);
  });

  it('rejects out of range port numbers', () => {
    expect(() => validateDashboardConfig({ port: 0 })).toThrow(ConfigError);
    expect(() => validateDashboardConfig({ port: 70000 })).toThrow(ConfigError);
  });

  it('rejects unrecognized keys via strict schema', () => {
    expect(() => validateDashboardConfig({ unknownKey: true })).toThrow(ConfigError);
  });
});
