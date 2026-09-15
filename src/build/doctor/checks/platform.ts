import type { DoctorCheck, DoctorOptions } from '../types.js';

export function checkPlatformArch(options: DoctorOptions): DoctorCheck {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  return {
    name: 'platform/arch',
    status: 'pass',
    message: `${platform} (${arch})`,
  };
}
