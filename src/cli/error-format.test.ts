import { describe, it, expect } from 'vitest';
import { formatCliError } from './error-format.js';
import { ConfigError, BuildError } from '../errors.js';

describe('formatCliError', () => {
  it('formats EggshellError as [code] message', () => {
    const error = new BuildError('electron-builder failed');
    const formatted = formatCliError(error);
    expect(formatted).toBe('[ERR_EGGSHELL_BUILD] electron-builder failed');
  });

  it('formats ConfigError including all issue field paths', () => {
    const error = ConfigError.fromIssues([
      { path: 'windows[0].url', message: 'url is required' },
      { path: 'appId', message: 'invalid appId' },
    ]);
    const formatted = formatCliError(error);
    expect(formatted).toContain('[ERR_EGGSHELL_CONFIG]');
    expect(formatted).toContain('windows[0].url: url is required');
    expect(formatted).toContain('appId: invalid appId');
  });

  it('formats standard Error with stack trace', () => {
    const error = new Error('ordinary system error');
    const formatted = formatCliError(error);
    expect(formatted).toContain('Error: ordinary system error');
    expect(formatted).toContain('error-format.test.ts');
  });

  it('formats non-Error values using String()', () => {
    expect(formatCliError('literal error string')).toBe('literal error string');
    expect(formatCliError(12345)).toBe('12345');
    expect(formatCliError(null)).toBe('null');
  });
});
