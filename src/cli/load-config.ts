import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { ConfigError } from '../errors.js';
import type { ConfigContext, ConfigFactory } from '../config/factory.js';
import { loadShellConfig } from '../config/overrides.js';
import type { ResolvedApp } from '../config/resolved.js';
import { resolveRoots } from '../paths/roots.js';
import type { Logger } from '../logging/logger.js';
import { resolveAppPaths, type AppPaths } from './app-paths.js';

export const CONFIG_FILENAMES = [
  'eggshell.config.ts',
  'eggshell.config.mts',
  'eggshell.config.mjs',
  'eggshell.config.js',
] as const;

export function findConfigFile(appDir: string): string {
  const found = CONFIG_FILENAMES.map(name => path.join(appDir, name)).find(candidate =>
    fs.existsSync(candidate)
  );
  if (!found) {
    throw new ConfigError(
      `No eggshell config in "${appDir}". Expected one of: ${CONFIG_FILENAMES.join(', ')}. Run "eggshell init".`,
      []
    );
  }
  return found;
}

interface ModuleLike {
  default?: unknown;
}

/** tsx wraps the namespace one level deeper than a native import; accept both shapes. */
function defaultExportOf(imported: ModuleLike): unknown {
  const inner = imported.default as ModuleLike | undefined;
  return typeof inner === 'object' && inner !== null && 'default' in inner ? inner.default : inner;
}

export async function importConfigFactory(configPath: string): Promise<ConfigFactory> {
  const imported = (await tsImport(pathToFileURL(configPath).href, import.meta.url)) as ModuleLike;
  const factory = defaultExportOf(imported);
  if (typeof factory !== 'function') {
    throw new ConfigError(
      `"${configPath}" must default-export a function: export default defineConfig(({ appDir, isDev }) => ({ ... }))`,
      []
    );
  }
  return factory as ConfigFactory;
}

function appIdOf(raw: unknown): string {
  const appId = (raw as { appId?: unknown } | null)?.appId;
  return typeof appId === 'string' && appId.length > 0 ? appId : 'eggshell';
}

export interface LoadAppOptions {
  readonly appDir: string;
  readonly isDev: boolean;
  readonly logger?: Logger;
}

export interface LoadedApp extends ResolvedApp {
  readonly configPath: string;
  readonly paths: AppPaths;
}

/** Runs the consumer's factory, applies the deployment override, validates. */
export async function loadApp({ appDir, isDev, logger }: LoadAppOptions): Promise<LoadedApp> {
  const configPath = findConfigFile(appDir);
  const factory = await importConfigFactory(configPath);
  const context: ConfigContext = { appDir, isDev, platform: process.platform };
  const raw = await factory(context);
  const paths = resolveAppPaths(appDir, appIdOf(raw));
  const roots = resolveRoots({ projectRoot: appDir, userDataRoot: paths.userData });
  const config = loadShellConfig({ config: raw, roots, ...(logger ? { logger } : {}) });
  return { appDir, userData: paths.userData, isDev, config, configPath, paths };
}

export function toResolvedApp(app: LoadedApp): ResolvedApp {
  return { appDir: app.appDir, userData: app.userData, isDev: app.isDev, config: app.config };
}
