import { aggregateDoctorStatus } from './doctor/aggregate.js';
import { checkPlatformArch } from './doctor/checks/platform.js';
import { checkElectronResolvable } from './doctor/checks/electron.js';
import { checkConfigValidates } from './doctor/checks/config.js';
import { checkOverrideFileParse } from './doctor/checks/override.js';
import { checkRequiredPortsFree } from './doctor/checks/ports.js';
import { checkDisplayCount } from './doctor/checks/displays.js';
import { checkTouchProbe } from './doctor/checks/touch.js';
import { checkPluginAssets } from './doctor/checks/assets.js';
import { checkUserDataWriteAccess } from './doctor/checks/user-data.js';
import type { DoctorCheck, DoctorOptions, DoctorReport } from './doctor/types.js';

export type {
  DoctorStatus,
  DoctorCheck,
  DoctorReport,
  DoctorOptions,
  GetDisplaysFn,
  ResolveElectronFn,
  PortCheckFn,
  AssetExistsFn,
} from './doctor/types.js';
export { aggregateDoctorStatus } from './doctor/aggregate.js';

const DEFAULT_CHECK_TIMEOUT_MS = 10_000;

class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`check timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

async function safelyRunCheck(
  name: string,
  fn: () => Promise<DoctorCheck> | DoctorCheck,
  timeoutMs: number = DEFAULT_CHECK_TIMEOUT_MS
): Promise<DoctorCheck> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => fn()), timeoutPromise]);
  } catch (error) {
    const isTimeout = error instanceof TimeoutError;
    const detail = error instanceof Error ? error.message : String(error);
    return {
      name,
      status: 'fail',
      message: isTimeout ? detail : `Unexpected check error: ${detail}`,
      remediation: 'Inspect diagnostic errors and system configuration.',
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function runRemainingChecks(
  options: DoctorOptions,
  timeoutMs: number
): Promise<[
  DoctorCheck,
  DoctorCheck,
  DoctorCheck,
  DoctorCheck,
  DoctorCheck,
  DoctorCheck,
  DoctorCheck,
  DoctorCheck,
]> {
  return Promise.all([
    safelyRunCheck('platform/arch', () => checkPlatformArch(options), timeoutMs),
    safelyRunCheck('Electron resolvable', () => checkElectronResolvable(options), timeoutMs),
    safelyRunCheck('override file parse', () => checkOverrideFileParse(options), timeoutMs),
    safelyRunCheck('required ports free', () => checkRequiredPortsFree(options), timeoutMs),
    safelyRunCheck('display count vs. configured targets', () => checkDisplayCount(options), timeoutMs),
    safelyRunCheck('touch probe result', () => checkTouchProbe(options), timeoutMs),
    safelyRunCheck('plugin asset presence', () => checkPluginAssets(options), timeoutMs),
    safelyRunCheck('write access to userDataRoot', () => checkUserDataWriteAccess(options), timeoutMs),
  ]);
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const timeoutMs = options.checkTimeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;

  let validatedConfig: unknown;
  const configCheck = await safelyRunCheck(
    'config validates',
    () => {
      const result = checkConfigValidates(options);
      validatedConfig = result.validatedConfig;
      return result.check;
    },
    timeoutMs
  );

  const effectiveOptions: DoctorOptions =
    validatedConfig !== undefined ? { ...options, config: validatedConfig } : options;

  const [
    platformCheck,
    electronCheck,
    overrideCheck,
    portsCheck,
    displayCheck,
    touchCheck,
    assetCheck,
    userDataCheck,
  ] = await runRemainingChecks(effectiveOptions, timeoutMs);

  const checks: DoctorCheck[] = [
    platformCheck,
    electronCheck,
    configCheck,
    overrideCheck,
    portsCheck,
    displayCheck,
    touchCheck,
    assetCheck,
    userDataCheck,
  ];

  return {
    checks,
    overallStatus: aggregateDoctorStatus(checks),
  };
}
