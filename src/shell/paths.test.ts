import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveShellPaths } from './paths.js';

describe('resolveShellPaths', () => {
  it('resolves development paths relative to the package root', () => {
    const paths = resolveShellPaths(path.resolve('/pkg/dist/shell'), false);
    expect(paths.preload).toBe(path.resolve('/pkg/dist/shell/preload.cjs'));
    expect(paths.asset('offline.html')).toBe(path.resolve('/pkg/assets/offline.html'));
    expect(paths.dashboardUi).toBe(path.resolve('/pkg/dist/dashboard-ui'));
  });

  it('resolves packaged paths next to the bundled main', () => {
    const paths = resolveShellPaths(path.resolve('/app'), true);
    expect(paths.preload).toBe(path.resolve('/app/preload.cjs'));
    expect(paths.asset('companion.html')).toBe(path.resolve('/app/assets/companion.html'));
    expect(paths.dashboardUi).toBe(path.resolve('/app/dashboard-ui'));
  });
});
