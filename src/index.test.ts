import { describe, it, expect } from 'vitest';
import * as barrel from './index.js';
import { LayoutError, isEggshellError } from './index.js';

describe('index (public surface)', () => {
  it('exports the expected error classes and guard', () => {
    expect(barrel.EggshellError).toBeTypeOf('function');
    expect(barrel.LayoutError).toBeTypeOf('function');
    expect(barrel.BuildError).toBeTypeOf('function');
    expect(barrel.ProcessError).toBeTypeOf('function');
    expect(barrel.PluginError).toBeTypeOf('function');
    expect(barrel.ConfigError).toBeTypeOf('function');
    expect(barrel.isEggshellError).toBeTypeOf('function');
    expect(new barrel.LayoutError('bad layout')).toBeInstanceOf(Error);
  });

  it('exports the expected config helpers', () => {
    expect(barrel.validateConfig).toBeTypeOf('function');
    expect(barrel.loadExhibitConfig).toBeTypeOf('function');
    expect(barrel.formatIssuePath).toBeTypeOf('function');
    expect(barrel.DEFAULT_OVERRIDE_FILENAME).toBeTypeOf('string');
  });

  it('does not export the internal zod schema values (validation library stays swappable)', () => {
    expect(barrel).not.toHaveProperty('exhibitConfigSchema');
    expect(barrel).not.toHaveProperty('boundsSchema');
  });

  it('exports the expected roots helpers', () => {
    expect(barrel.resolveRoots).toBeTypeOf('function');
    expect(barrel.resolvePackageAsset).toBeTypeOf('function');
    expect(barrel.resolveProjectPath).toBeTypeOf('function');
  });

  it('exports the expected logging surface', () => {
    expect(barrel.LOG_LEVELS).toBeInstanceOf(Array);
    expect(barrel.createChildLogger).toBeTypeOf('function');
    expect(barrel.noopLogger).toBeTypeOf('object');
    expect(barrel.withMinimumLevel).toBeTypeOf('function');
    expect(barrel.consoleLogger).toBeTypeOf('object');
  });

  it('exports no undefined values (catches a typo in a re-export name)', () => {
    const undefinedKeys = Object.entries(barrel)
      .filter(([, value]) => value === undefined)
      .map(([key]) => key);
    expect(undefinedKeys).toEqual([]);
  });

  it('round-trips isEggshellError against an error class from the same barrel', () => {
    const error = new LayoutError('bad layout');
    expect(isEggshellError(error)).toBe(true);
    expect(barrel.isEggshellError(new barrel.LayoutError('bad layout'))).toBe(true);
    expect(isEggshellError(new Error('plain'))).toBe(false);
  });
});
