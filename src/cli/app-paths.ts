import path from 'node:path';
import { userDataFor } from '../paths/user-data.js';

export interface AppPaths {
  readonly appDir: string;
  /** Per-app writable directory: logs, deployment override, Electron user data. */
  readonly userData: string;
  /** `<appDir>/.eggshell`, gitignored scratch state for the CLI. */
  readonly stateDir: string;
  readonly resolvedAppPath: string;
}

export function resolveAppPaths(appDir: string, appId: string): AppPaths {
  const stateDir = path.join(appDir, '.eggshell');
  return {
    appDir,
    userData: userDataFor(appId),
    stateDir,
    resolvedAppPath: path.join(stateDir, 'resolved.json'),
  };
}
