/**
 * Shared plugin asset and preload path resolution.
 */

import { existsSync } from 'node:fs';
import { resolvePackageAsset } from '../../paths/roots.js';
import type { ShellRoots } from '../../paths/roots.js';

/** Resolves a plugin's shipped asset, preferring the built dist/ copy and falling back to the src/ copy for local dev. */
export function resolvePluginAsset(roots: ShellRoots, pluginDir: string, assetFile: string): string {
  const distPath = resolvePackageAsset(roots, `dist/plugins/${pluginDir}/assets/${assetFile}`);
  if (existsSync(distPath)) {
    return distPath;
  }
  return resolvePackageAsset(roots, `src/plugins/${pluginDir}/assets/${assetFile}`);
}

/** Resolves core's built preload script, shared by every overlay-style plugin. */
export function resolvePluginPreloadPath(roots: ShellRoots): string {
  return resolvePackageAsset(roots, 'dist/preload.cjs');
}
