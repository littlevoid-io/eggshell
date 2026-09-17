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

  it('remains idempotent and true under abrupt multiple succeeding requests', () => {
    const controller = createRelaunchController();
    expect(controller.requested).toBe(false);
    for (let i = 0; i < 100; i++) {
      controller.request();
      expect(controller.requested).toBe(true);
    }
  });

  it('handles concurrent succeeding relaunch requests gracefully', async () => {
    const controller = createRelaunchController();
    const calls = Array.from({ length: 50 }, async () => {
      await Promise.resolve();
      controller.request();
    });
    await Promise.all(calls);
    expect(controller.requested).toBe(true);
  });

  it('isolates state between multiple controller instances under rapid requests', () => {
    const first = createRelaunchController();
    const second = createRelaunchController();
    for (let i = 0; i < 20; i++) {
      first.request();
    }
    expect(first.requested).toBe(true);
    expect(second.requested).toBe(false);
  });
});
