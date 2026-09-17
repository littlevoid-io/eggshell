import { describe, expect, it } from 'vitest';
import { createRelaunchController, RELAUNCH_EXIT_CODE } from './relaunch.js';

describe('relaunch', () => {
  it('has expected exit code', () => {
    expect(RELAUNCH_EXIT_CODE).toBe(75);
  });

  it('tracks requested relaunch state', () => {
    const controller = createRelaunchController();
    expect(controller.requested).toBe(false);
    controller.request();
    expect(controller.requested).toBe(true);
  });
});
