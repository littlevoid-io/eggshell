import { validateConfig } from '../../../config/index.js';
import type { ShellConfig } from '../../../config/types.js';
import type { DoctorCheck, DoctorOptions } from '../types.js';

export interface ConfigCheckResult {
  readonly check: DoctorCheck;
  readonly validatedConfig: ShellConfig | undefined;
}

export function checkConfigValidates(options: DoctorOptions): ConfigCheckResult {
  try {
    const validated = validateConfig(options.config);
    return {
      check: {
        name: 'config validates',
        status: 'pass',
        message: 'Configuration syntax and schema validated successfully.',
      },
      validatedConfig: validated,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      check: {
        name: 'config validates',
        status: 'fail',
        message: `Configuration validation failed: ${message}`,
        remediation: 'Correct invalid configuration properties to match ShellConfig schema.',
      },
      validatedConfig: undefined,
    };
  }
}
