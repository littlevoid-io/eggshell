import fs from 'node:fs';
import path from 'node:path';
import type { TouchProbe } from '../../layout/probes/types.js';
import { fail, ok, warn, type CheckResult } from './types.js';

export function checkElectron(binary: string, version: string): CheckResult {
  return fs.existsSync(binary)
    ? ok('electron', `${version} at ${binary}`)
    : fail('electron', `binary missing at ${binary}; reinstall eggshell`);
}

/** Creates the directory and writes a probe file, the same way logging and overrides will. */
export function checkUserDataWritable(userData: string): CheckResult {
  const probe = path.join(userData, '.eggshell-doctor');
  try {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe);
    return ok('user data', `writable: ${userData}`);
  } catch (error) {
    return fail('user data', `cannot write ${userData}: ${String(error)}`);
  }
}

export async function checkTouchProbe(
  enabled: boolean,
  probe: TouchProbe,
  platform: NodeJS.Platform
): Promise<CheckResult> {
  if (!enabled) return ok('touch probe', 'disabled (display.touchProbe.enabled = false)');
  if (platform !== 'win32')
    return warn('touch probe', `no probe for ${platform}; roles with touchCapable never match`);
  const ids = await probe.detect(AbortSignal.timeout(5000));
  return ids.length > 0
    ? ok('touch probe', `touch displays: ${ids.join(', ')}`)
    : warn('touch probe', 'no touch display detected');
}
