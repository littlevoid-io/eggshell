import { describe, it, expect } from 'vitest';

import { ConfigError } from '../errors.js';
import { formatIssuePath, validateConfig } from './validate.js';

function minimalConfig() {
  return {
    appId: 'com.example.minimal',
    productName: 'Minimal Kiosk',
    windows: [{ id: 'main', url: 'http://localhost:3000', target: { kind: 'primary' } }],
  };
}

describe('validateConfig — success', () => {
  it('returns a fully-parsed config with schema defaults applied for a valid minimal config', () => {
    const parsed = validateConfig(minimalConfig());
    expect(parsed.processes).toEqual([]);
    expect(parsed.browserPermissions.allow).toEqual(['media', 'camera', 'microphone']);
    expect(parsed.logging.level).toBe('info');
    expect(parsed.windows[0]).toMatchObject({
      kiosk: true,
      fullscreen: false,
      zoomFactor: 1,
      showWhenReady: true,
      required: false,
      fallback: 'primary',
    });
  });
});

describe('validateConfig — single-issue field paths', () => {
  it('rejects a typo\'d enum value deep in an array with path "windows[0].target.kind"', () => {
    const config = {
      ...minimalConfig(),
      windows: [{ id: 'main', url: 'http://localhost:3000', target: { kind: 'spanning' } }],
    };
    let caught: unknown;
    try {
      validateConfig(config);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).issues).toContainEqual(
      expect.objectContaining({ path: 'windows[0].target.kind' })
    );
  });

  it('rejects a missing required field with path "appId"', () => {
    const config: Record<string, unknown> = { ...minimalConfig() };
    delete config['appId'];
    let caught: unknown;
    try {
      validateConfig(config);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).issues).toContainEqual(
      expect.objectContaining({ path: 'appId' })
    );
  });

  it('rejects duplicate window ids, pointing the path at the offending array index', () => {
    const config = minimalConfig();
    config.windows.push({
      id: 'main',
      url: 'http://localhost:3000/2',
      target: { kind: 'primary' },
    });
    let caught: unknown;
    try {
      validateConfig(config);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).issues).toContainEqual(
      expect.objectContaining({ path: 'windows[1].id' })
    );
  });

  it('rejects a bad appId with path "appId"', () => {
    const config = { ...minimalConfig(), appId: 'not_valid appId!' };
    let caught: unknown;
    try {
      validateConfig(config);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).issues).toContainEqual(
      expect.objectContaining({ path: 'appId' })
    );
  });

  it('rejects an unknown top-level key (strict schema), naming the offending key', () => {
    const config = { ...minimalConfig(), typoField: true };
    let caught: unknown;
    try {
      validateConfig(config);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).issues).toContainEqual(
      expect.objectContaining({ path: 'typoField' })
    );
  });

  it('rejects an unknown nested key (override-typo regression), naming the offending key', () => {
    const config = {
      ...minimalConfig(),
      windows: [
        {
          id: 'main',
          url: 'http://localhost:3000',
          target: { kind: 'primary' },
          typo: 1,
        },
      ],
    };
    let caught: unknown;
    try {
      validateConfig(config);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).issues).toContainEqual(
      expect.objectContaining({ path: 'windows[0].typo' })
    );
  });
});

describe('validateConfig — multiple simultaneous problems', () => {
  it('collects all issues and lists all paths in the message', () => {
    const config = {
      appId: 'BAD!',
      productName: '',
      windows: [{ id: 'main', url: 'http://localhost:3000', target: { kind: 'nope' } }],
    };
    let caught: unknown;
    try {
      validateConfig(config);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    const configError = caught as ConfigError;
    expect(configError.issues).toHaveLength(3);
    expect(configError.message).toContain('appId');
    expect(configError.message).toContain('productName');
    expect(configError.message).toContain('windows[0].target.kind');
  });
});

describe('validateConfig — error identity', () => {
  it('throws an instance of ConfigError with the ConfigError code', () => {
    let caught: unknown;
    try {
      validateConfig({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).code).toBe('ERR_EGGSHELL_CONFIG');
  });
});

describe('validateConfig — wrong root input type', () => {
  it('throws ConfigError, not a TypeError, for null', () => {
    expect(() => validateConfig(null)).toThrow(ConfigError);
  });

  it('throws ConfigError, not a TypeError, for a string', () => {
    expect(() => validateConfig('not a config')).toThrow(ConfigError);
  });

  it('throws ConfigError, not a TypeError, for an array', () => {
    expect(() => validateConfig([])).toThrow(ConfigError);
  });
});

describe('formatIssuePath', () => {
  it('renders a nested array index with bracket notation', () => {
    expect(formatIssuePath(['windows', 1, 'target', 'kind'])).toBe('windows[1].target.kind');
  });

  it('renders a single segment with no leading dot', () => {
    expect(formatIssuePath(['appId'])).toBe('appId');
  });

  it('renders consecutive indices back-to-back', () => {
    expect(formatIssuePath(['a', 0, 1])).toBe('a[0][1]');
  });

  it('renders an empty path as the "(root)" placeholder', () => {
    expect(formatIssuePath([])).toBe('(root)');
  });

  it('does not throw on a symbol segment', () => {
    const symbol = Symbol('weird');
    expect(() => formatIssuePath(['a', symbol])).not.toThrow();
    expect(formatIssuePath(['a', symbol])).toBe(`a.${String(symbol)}`);
  });
});
