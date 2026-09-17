export const RELAUNCH_EXIT_CODE = 75;

export interface RelaunchController {
  readonly requested: boolean;
  request(): void;
}

export function createRelaunchController(): RelaunchController {
  let requested = false;
  return {
    get requested(): boolean {
      return requested;
    },
    request(): void {
      requested = true;
    },
  };
}
