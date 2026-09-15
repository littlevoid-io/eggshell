import { describe, it, expect } from 'vitest';
import { aggregateDoctorStatus } from './aggregate.js';
import type { DoctorCheck } from './types.js';

function makeCheck(status: DoctorCheck['status']): DoctorCheck {
  return { name: 'test', status, message: 'msg' };
}

describe('aggregateDoctorStatus', () => {
  it('returns pass when all checks pass', () => {
    const checks = [makeCheck('pass'), makeCheck('pass')];
    expect(aggregateDoctorStatus(checks)).toBe('pass');
  });

  it('returns warn when at least one check is warn and none fail', () => {
    const checks = [makeCheck('pass'), makeCheck('warn'), makeCheck('pass')];
    expect(aggregateDoctorStatus(checks)).toBe('warn');
  });

  it('returns fail when any check fails even if others are warn or pass', () => {
    const checks = [makeCheck('pass'), makeCheck('warn'), makeCheck('fail')];
    expect(aggregateDoctorStatus(checks)).toBe('fail');
  });

  it('returns pass when checks list is empty', () => {
    expect(aggregateDoctorStatus([])).toBe('pass');
  });
});
