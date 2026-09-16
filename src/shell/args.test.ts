import { describe, expect, it } from 'vitest';
import { LaunchError } from '../errors.js';
import { parseShellArgs } from './args.js';

describe('parseShellArgs', () => {
  it('reads the resolved app path and parent pid', () => {
    const args = parseShellArgs([
      'electron',
      'main.js',
      '--eggshell-app',
      'C:/x/resolved.json',
      '--eggshell-parent-pid',
      '4242',
    ]);
    expect(args).toEqual({ resolvedAppPath: 'C:/x/resolved.json', parentPid: 4242 });
  });

  it('leaves parentPid undefined when absent', () => {
    expect(parseShellArgs(['--eggshell-app', 'r.json']).parentPid).toBeUndefined();
  });

  it('throws a LaunchError without --eggshell-app', () => {
    expect(() => parseShellArgs(['electron', 'main.js'])).toThrow(LaunchError);
  });
});
