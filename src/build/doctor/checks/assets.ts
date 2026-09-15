import fs from 'node:fs';
import { resolvePackageAsset } from '../../../paths/roots.js';
import type { DoctorCheck, DoctorOptions } from '../types.js';

const KNOWN_PLUGIN_ASSETS: Readonly<Record<string, readonly string[]>> = {
  offline: ['dist/plugins/offline/assets/offline.html'],
  dashboard: ['dist/plugins/dashboard/assets/dashboard.html'],
  companion: ['dist/plugins/companion/assets/companion.html'],
  soak: ['dist/plugins/soak/assets/fuzzer.js'],
};

function isPluginEnabled(pluginConfig: unknown): boolean {
  if (typeof pluginConfig === 'object' && pluginConfig !== null) {
    return (pluginConfig as Record<string, unknown>).enabled !== false;
  }
  return true;
}

function getEnabledPluginIds(config: unknown): string[] {
  if (typeof config !== 'object' || config === null) return [];
  const raw = config as Record<string, unknown>;
  if (typeof raw.plugins !== 'object' || raw.plugins === null) return [];
  const plugins = raw.plugins as Record<string, unknown>;
  return Object.keys(plugins).filter(id => isPluginEnabled(plugins[id]));
}

async function verifyAssetsForPlugin(
  pluginId: string,
  options: DoctorOptions,
  missing: string[]
): Promise<number> {
  const expectedAssets = KNOWN_PLUGIN_ASSETS[pluginId] ?? [];
  for (const relPath of expectedAssets) {
    const resolved = resolvePackageAsset(options.roots, relPath);
    const exists = options.assetExists ? await options.assetExists(resolved) : fs.existsSync(resolved);
    if (!exists) missing.push(`${pluginId}: ${relPath}`);
  }
  return expectedAssets.length;
}

export async function checkPluginAssets(options: DoctorOptions): Promise<DoctorCheck> {
  const enabledIds = getEnabledPluginIds(options.config);
  if (enabledIds.length === 0) {
    return { name: 'plugin asset presence', status: 'pass', message: 'No plugins enabled.' };
  }

  const missing: string[] = [];
  let checkedCount = 0;
  for (const pluginId of enabledIds) {
    checkedCount += await verifyAssetsForPlugin(pluginId, options, missing);
  }

  if (missing.length > 0) {
    return {
      name: 'plugin asset presence',
      status: 'fail',
      message: `Missing prebuilt asset(s) for enabled plugin(s): ${missing.join(', ')}.`,
      remediation: 'Run "npm run build:assets" in eggshell to generate prebuilt plugin assets.',
    };
  }
  return {
    name: 'plugin asset presence',
    status: 'pass',
    message: `All prebuilt plugin assets verified (${checkedCount} asset(s) present).`,
  };
}
