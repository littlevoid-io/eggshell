import { describe, expect, it } from 'vitest';
import { OfflineStateMachine } from './state.js';

describe('OfflineStateMachine', () => {
  it('starts in an online, hidden state', () => {
    const machine = new OfflineStateMachine(30_000);
    const state = machine.getState();
    expect(state.isOnline).toBe(true);
    expect(state.isShowing).toBe(false);
    expect(state.isForcedShow).toBe(false);
    expect(state.isDismissedByUser).toBe(false);
    expect(state.offlineStart).toBeNull();
  });

  it('shows only after timeoutMs offline', () => {
    const machine = new OfflineStateMachine(30_000);
    expect(machine.handleProbeResult(false, 1000)).toBe(false);
    expect(machine.getState().isShowing).toBe(false);
    expect(machine.getState().offlineStart).toBe(1000);

    expect(machine.handleProbeResult(false, 25_000)).toBe(false);
    expect(machine.getState().isShowing).toBe(false);

    expect(machine.handleProbeResult(false, 31_000)).toBe(true);
    expect(machine.getState().isShowing).toBe(true);
  });

  it('hides when back online', () => {
    const machine = new OfflineStateMachine(30_000);
    machine.handleProbeResult(false, 1000);
    machine.handleProbeResult(false, 31_000);
    expect(machine.getState().isShowing).toBe(true);

    expect(machine.handleProbeResult(true, 35_000)).toBe(true);
    expect(machine.getState().isShowing).toBe(false);
    expect(machine.getState().offlineStart).toBeNull();
  });

  it('dismiss suppresses until online again', () => {
    const machine = new OfflineStateMachine(30_000);
    machine.handleProbeResult(false, 1000);
    machine.handleProbeResult(false, 31_000);
    expect(machine.getState().isShowing).toBe(true);

    expect(machine.dismiss()).toBe(true);
    expect(machine.getState().isShowing).toBe(false);
    expect(machine.getState().isDismissedByUser).toBe(true);

    expect(machine.handleProbeResult(false, 40_000)).toBe(false);
    expect(machine.getState().isShowing).toBe(false);

    machine.handleProbeResult(true, 50_000);
    expect(machine.getState().isDismissedByUser).toBe(false);

    machine.handleProbeResult(false, 60_000);
    expect(machine.handleProbeResult(false, 90_000)).toBe(true);
    expect(machine.getState().isShowing).toBe(true);
  });

  it('forceShow survives an online result', () => {
    const machine = new OfflineStateMachine(30_000);
    expect(machine.forceShow()).toBe(true);
    expect(machine.getState().isShowing).toBe(true);
    expect(machine.getState().isForcedShow).toBe(true);

    expect(machine.handleProbeResult(true, 5000)).toBe(false);
    expect(machine.getState().isShowing).toBe(true);
  });

  it('toggle flips', () => {
    const machine = new OfflineStateMachine(30_000);
    expect(machine.getState().isShowing).toBe(false);

    expect(machine.toggle()).toBe(true);
    expect(machine.getState().isShowing).toBe(true);

    expect(machine.toggle()).toBe(true);
    expect(machine.getState().isShowing).toBe(false);
  });
});
