import fs from 'node:fs';
import type { ShellConfig } from '../../config/types.js';
import { fail, ok, warn, type CheckResult } from './types.js';

export function checkOverrideFile(overridePath: string): CheckResult {
  if (!fs.existsSync(overridePath)) return ok('deployment override', `none at ${overridePath}`);
  try {
    JSON.parse(fs.readFileSync(overridePath, 'utf8'));
    return ok('deployment override', `applied from ${overridePath}`);
  } catch (error) {
    return fail('deployment override', `${overridePath} is not valid JSON: ${String(error)}`);
  }
}

/** Ports the app expects to own: readiness tcp ports, requirePortsFree and the dashboard. */
export function expectedPorts(config: ShellConfig): number[] {
  const ports = new Set<number>();
  for (const process of config.processes) {
    process.requirePortsFree.forEach(port => ports.add(port));
    if (process.readiness.kind === 'tcp') ports.add(process.readiness.port);
  }
  if (config.dashboard.enabled) ports.add(config.dashboard.port);
  return [...ports].sort((a, b) => a - b);
}

export async function checkPorts(
  ports: readonly number[],
  isFree: (port: number) => Promise<boolean>
): Promise<CheckResult> {
  if (ports.length === 0) return ok('ports', 'no ports configured');
  const results = await Promise.all(ports.map(async port => ({ port, free: await isFree(port) })));
  const busy = results.filter(result => !result.free).map(result => result.port);
  return busy.length === 0
    ? ok('ports', `free: ${ports.join(', ')}`)
    : warn(
        'ports',
        `in use right now: ${busy.join(', ')} (fine if the app's own server is running)`
      );
}

export function checkWindowUrls(
  config: ShellConfig,
  appDir: string,
  exists: (path: string) => boolean
): CheckResult {
  const missing = config.windows
    .filter(window => !/^[a-z][a-z0-9+.-]*:/i.test(window.url))
    .map(window => window.url)
    .filter(url => !exists(`${appDir}/${url}`));
  return missing.length === 0
    ? ok('window files', 'all local window files exist')
    : fail('window files', `missing under ${appDir}: ${missing.join(', ')}`);
}
