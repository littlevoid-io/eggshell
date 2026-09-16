import path from 'node:path';

/** Where the running shell finds its own files: preload, overlay HTML, dashboard UI. */
export interface ShellPaths {
  readonly preload: string;
  readonly dashboardUi: string;
  asset(name: string): string;
}

/**
 * In development the main lives at `<package>/dist/shell/main.js`; packaged, the
 * bundled main sits at the app root next to `preload.cjs`, `assets/` and `dashboard-ui/`.
 */
export function resolveShellPaths(mainDirectory: string, packaged: boolean): ShellPaths {
  const root = packaged ? mainDirectory : path.resolve(mainDirectory, '..', '..');
  return {
    preload: path.join(mainDirectory, 'preload.cjs'),
    dashboardUi: packaged
      ? path.join(root, 'dashboard-ui')
      : path.join(root, 'dist', 'dashboard-ui'),
    asset: name => path.join(root, 'assets', name),
  };
}
