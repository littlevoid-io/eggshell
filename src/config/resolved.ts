import fs from 'node:fs';
import path from 'node:path';
import type { ShellConfig } from './types.js';
import { validateConfig } from './validate.js';

/** Hand-off from the CLI (or the packaged app folder) to the Electron main: everything already resolved. */
export interface ResolvedApp {
  readonly appDir: string;
  readonly userData: string;
  readonly isDev: boolean;
  readonly config: ShellConfig;
}

/** The packaged app ships only `isDev` and `config`; the shell derives the two paths at runtime. */
export type StagedApp = Pick<ResolvedApp, 'isDev' | 'config'> & Partial<ResolvedApp>;

export function writeResolvedApp(filePath: string, app: ResolvedApp): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(app, null, 2));
}

export function readResolvedApp(
  filePath: string,
  defaults: (config: ShellConfig) => Pick<ResolvedApp, 'appDir' | 'userData'>
): ResolvedApp {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as StagedApp;
  const config = validateConfig(raw.config);
  return { ...defaults(config), ...raw, config };
}
