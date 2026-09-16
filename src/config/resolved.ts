import fs from 'node:fs';
import path from 'node:path';
import type { ShellConfig } from './types.js';
import { validateConfig } from './validate.js';

/** Hand-off from the CLI to the Electron main: everything already resolved. */
export interface ResolvedApp {
  readonly appDir: string;
  readonly userData: string;
  readonly isDev: boolean;
  readonly config: ShellConfig;
}

export function writeResolvedApp(filePath: string, app: ResolvedApp): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(app, null, 2));
}

export function readResolvedApp(filePath: string): ResolvedApp {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ResolvedApp;
  return { ...raw, config: validateConfig(raw.config) };
}
