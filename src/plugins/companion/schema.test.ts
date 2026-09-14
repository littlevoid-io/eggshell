import { describe, expect, it } from 'vitest';
import { validateCompanionConfig } from './schema.js';
import { ConfigError } from '../../errors.js';

describe('companionConfigSchema (T4.3)', () => {
  it('supplies defaults when empty object is passed', () => {
    const config = validateCompanionConfig({});

    expect(config.enabled).toBe(true);
    expect(config.port).toBe(3005);
    expect(config.path).toBe('/');
    expect(config.title).toBe('Companion');
    expect(config.autoShow).toBe(false);
    expect(config.url).toBeUndefined();
    expect(config.host).toBeUndefined();
    expect(config.description).toBeUndefined();
    expect(config.targetWindowIds).toBeUndefined();
  });

  it('accepts valid custom configuration', () => {
    const config = validateCompanionConfig({
      enabled: false,
      url: 'https://example.com/mobile',
      port: 8080,
      host: '192.168.1.50',
      path: '/kiosk-control',
      title: 'Kiosk Companion',
      description: 'Scan to manage',
      autoShow: true,
      targetWindowIds: ['display-1'],
    });

    expect(config.enabled).toBe(false);
    expect(config.url).toBe('https://example.com/mobile');
    expect(config.port).toBe(8080);
    expect(config.host).toBe('192.168.1.50');
    expect(config.path).toBe('/kiosk-control');
    expect(config.title).toBe('Kiosk Companion');
    expect(config.description).toBe('Scan to manage');
    expect(config.autoShow).toBe(true);
    expect(config.targetWindowIds).toEqual(['display-1']);
  });

  it('rejects invalid port with field path', () => {
    try {
      validateCompanionConfig({ port: 70000 });
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const issues = (error as ConfigError).issues;
      expect(issues[0]?.path).toBe('plugins.companion.port');
    }
  });

  it('rejects invalid url with field path', () => {
    try {
      validateCompanionConfig({ url: 'not-a-valid-url' });
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const issues = (error as ConfigError).issues;
      expect(issues[0]?.path).toBe('plugins.companion.url');
    }
  });

  it('rejects javascript: url with field path', () => {
    try {
      validateCompanionConfig({ url: 'javascript:alert(1)' });
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const issues = (error as ConfigError).issues;
      expect(issues[0]?.path).toBe('plugins.companion.url');
      expect(issues[0]?.message).toMatch(/http or https/i);
    }
  });

  it('rejects empty title with field path', () => {
    try {
      validateCompanionConfig({ title: '' });
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const issues = (error as ConfigError).issues;
      expect(issues[0]?.path).toBe('plugins.companion.title');
    }
  });

  it('rejects unrecognized keys via strict schema', () => {
    try {
      validateCompanionConfig({ invalidKey: true });
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
    }
  });
});
