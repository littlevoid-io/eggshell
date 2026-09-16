import envPaths from 'env-paths';

/** Per-app writable directory (logs, deployment override, Electron user data), derived from the app id only. */
export function userDataFor(appId: string): string {
  return envPaths(appId, { suffix: '' }).data;
}
