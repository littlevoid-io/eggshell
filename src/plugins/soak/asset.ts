/**
 * Asset resolution for soak fuzzer plugin (T4.4).
 */

import { existsSync, readFileSync } from 'node:fs';
import type { ShellRoots } from '../../paths/roots.js';
import { resolvePluginAsset } from '../shared/asset.js';

export function resolveFuzzerAssetPath(roots: ShellRoots): string {
  return resolvePluginAsset(roots, 'soak', 'fuzzer.js');
}

export function loadFuzzerAsset(roots: ShellRoots): string {
  const assetPath = resolveFuzzerAssetPath(roots);
  if (existsSync(assetPath)) {
    return readFileSync(assetPath, 'utf8');
  }
  return '';
}
