export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

export type Check = () => Promise<CheckResult> | CheckResult;

export function ok(name: string, detail: string): CheckResult {
  return { name, status: 'ok', detail };
}

export function warn(name: string, detail: string): CheckResult {
  return { name, status: 'warn', detail };
}

export function fail(name: string, detail: string): CheckResult {
  return { name, status: 'fail', detail };
}
