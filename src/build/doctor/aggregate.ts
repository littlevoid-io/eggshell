import type { DoctorCheck, DoctorStatus } from './types.js';

export function aggregateDoctorStatus(checks: readonly DoctorCheck[]): DoctorStatus {
  if (checks.some(check => check.status === 'fail')) {
    return 'fail';
  }
  if (checks.some(check => check.status === 'warn')) {
    return 'warn';
  }
  return 'pass';
}
