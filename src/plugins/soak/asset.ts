/**
 * Asset resolution for soak fuzzer plugin (T4.4).
 */

import { existsSync, readFileSync } from 'node:fs';
import type { ShellRoots } from '../../paths/roots.js';
import { resolvePackageAsset } from '../../paths/roots.js';

export function resolveFuzzerAssetPath(roots: ShellRoots): string {
  const distPath = resolvePackageAsset(roots, 'dist/plugins/soak/assets/fuzzer.js');
  if (existsSync(distPath)) {
    return distPath;
  }
  return resolvePackageAsset(roots, 'src/plugins/soak/assets/fuzzer.js');
}

export function loadFuzzerAsset(roots: ShellRoots): string {
  const assetPath = resolveFuzzerAssetPath(roots);
  if (existsSync(assetPath)) {
    return readFileSync(assetPath, 'utf8');
  }
  return '';
}
