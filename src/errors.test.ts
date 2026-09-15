import { describe, it, expect } from 'vitest';
import {
  EggshellError,
  ConfigError,
  LayoutError,
  ProcessError,
  BuildError,
  LaunchError,
  PluginError,
  isEggshellError,
} from './errors.js';
import type { ConfigIssue } from './errors.js';

describe('EggshellError subclasses', () => {
  const cases: Array<{
    name: string;
    code: string;
    build: (cause: unknown) => EggshellError;
  }> = [
    {
      name: 'ConfigError',
      code: 'ERR_EGGSHELL_CONFIG',
      build: cause => new ConfigError('bad config', [], { cause }),
    },
    {
      name: 'LayoutError',
      code: 'ERR_EGGSHELL_LAYOUT',
      build: cause => new LayoutError('bad layout', { cause }),
    },
    {
      name: 'ProcessError',
      code: 'ERR_EGGSHELL_PROCESS',
      build: cause => new ProcessError('process failed', { cause }),
    },
    {
      name: 'BuildError',
      code: 'ERR_EGGSHELL_BUILD',
      build: cause => new BuildError('build failed', { cause }),
    },
    {
      name: 'LaunchError',
      code: 'ERR_EGGSHELL_LAUNCH',
      build: cause => new LaunchError('launch failed', { cause }),
    },
    {
      name: 'PluginError',
      code: 'ERR_EGGSHELL_PLUGIN',
      build: cause => new PluginError('plugin failed', { cause }),
    },
  ];

  for (const { name, code, build } of cases) {
    it(`${name} is an instanceof EggshellError and Error with code ${code}`, () => {
      const error = build(undefined);
      expect(error).toBeInstanceOf(EggshellError);
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe(code);
    });

    it(`${name} sets name to '${name}'`, () => {
      const error = build(undefined);
      expect(error.name).toBe(name);
    });

    it(`${name} preserves a passed cause`, () => {
      const cause = new Error('root cause');
      const error = build(cause);
      expect(error.cause).toBe(cause);
    });
  }
});

describe('ProcessError', () => {
  it('carries an optional processId', () => {
    const error = new ProcessError('crashed', { processId: 'renderer-1' });
    expect(error.processId).toBe('renderer-1');
  });

  it('leaves processId undefined when not provided', () => {
    const error = new ProcessError('crashed');
    expect(error.processId).toBeUndefined();
  });
});

describe('PluginError', () => {
  it('carries an optional pluginId', () => {
    const error = new PluginError('setup threw', { pluginId: 'overlay' });
    expect(error.pluginId).toBe('overlay');
  });

  it('leaves pluginId undefined when not provided', () => {
    const error = new PluginError('setup threw');
    expect(error.pluginId).toBeUndefined();
  });
});

describe('ConfigError', () => {
  it('renders every issue path and message, one per line (I7)', () => {
    const issues: ConfigIssue[] = [
      { path: 'appId', message: 'must match reverse-dns pattern' },
      { path: 'windows[1].target.kind', message: 'unknown display target kind "spanning"' },
      { path: 'processes[0].readiness.port', message: 'expected a number, got a string' },
    ];
    const error = ConfigError.fromIssues(issues, 'Configuration validation failed');

    for (const issue of issues) {
      expect(error.message).toContain(issue.path);
      expect(error.message).toContain(issue.message);
    }
    expect(error.issues).toEqual(issues);
  });

  it('produces a sensible non-empty message with no issues', () => {
    const error = ConfigError.fromIssues([], 'Config file is not valid JSON');
    expect(error.message.length).toBeGreaterThan(0);
    expect(error.message).toContain('Config file is not valid JSON');
    expect(error.issues).toEqual([]);
  });
});

describe('isEggshellError', () => {
  it('returns true for EggshellError instances', () => {
    expect(isEggshellError(new LayoutError('bad layout'))).toBe(true);
    expect(isEggshellError(ConfigError.fromIssues([]))).toBe(true);
  });

  it('returns false for a plain Error', () => {
    expect(isEggshellError(new Error('plain'))).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(isEggshellError(null)).toBe(false);
    expect(isEggshellError(undefined)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isEggshellError('ERR_EGGSHELL_CONFIG')).toBe(false);
  });

  it('returns false for a plain object shaped like an error', () => {
    expect(
      isEggshellError({ name: 'ConfigError', code: 'ERR_EGGSHELL_CONFIG', message: 'x' })
    ).toBe(false);
  });
});
