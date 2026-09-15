import { describe, expect, it } from 'vitest';
import { OfflineStateMachine } from './state-machine.js';

describe('OfflineStateMachine (T4.1)', () => {
  it('starts in an online, hidden state', () => {
    const machine = new OfflineStateMachine({ timeoutMs: 30000 });
    const state = machine.getState();

    expect(state.isOnline).toBe(true);
    expect(state.isShowing).toBe(false);
    expect(state.isForcedShow).toBe(false);
    expect(state.isDismissedByUser).toBe(false);
    expect(state.offlineStart).toBeNull();
  });

  it('suppresses flaps before timeoutMs threshold', () => {
    const machine = new OfflineStateMachine({ timeoutMs: 30000 });

    let changed = machine.handleProbeResult(false, 1000);
    expect(changed).toBe(false);
    expect(machine.getState().isShowing).toBe(false);
    expect(machine.getState().offlineStart).toBe(1000);

    // After 20 seconds, still offline, but below 30s threshold
    changed = machine.handleProbeResult(false, 21000);
    expect(changed).toBe(false);
    expect(machine.getState().isShowing).toBe(false);

    // Recovers at 25 seconds
    changed = machine.handleProbeResult(true, 26000);
    expect(changed).toBe(false);
    expect(machine.getState().isOnline).toBe(true);
    expect(machine.getState().offlineStart).toBeNull();
  });

  it('shows overlay only after sustained timeoutMs disconnect', () => {
    const machine = new OfflineStateMachine({ timeoutMs: 30000 });

    machine.handleProbeResult(false, 1000);
    expect(machine.getState().isShowing).toBe(false);

    // Exactly at threshold
    const changed = machine.handleProbeResult(false, 31000);
    expect(changed).toBe(true);
    expect(machine.getState().isShowing).toBe(true);

    // Stays showing on subsequent checks
    const secondCheck = machine.handleProbeResult(false, 36000);
    expect(secondCheck).toBe(false);
    expect(machine.getState().isShowing).toBe(true);
  });

  it('auto-dismisses when connectivity recovers', () => {
    const machine = new OfflineStateMachine({ timeoutMs: 30000 });

    machine.handleProbeResult(false, 1000);
    machine.handleProbeResult(false, 31000);
    expect(machine.getState().isShowing).toBe(true);

    const changed = machine.handleProbeResult(true, 35000);
    expect(changed).toBe(true);
    expect(machine.getState().isShowing).toBe(false);
    expect(machine.getState().offlineStart).toBeNull();
  });

  it('honours user dismissal until connection cycle resets', () => {
    const machine = new OfflineStateMachine({ timeoutMs: 30000 });

    machine.handleProbeResult(false, 1000);
    machine.handleProbeResult(false, 31000);
    expect(machine.getState().isShowing).toBe(true);

    // User holds screen for 5s to dismiss
    const changed = machine.dismiss();
    expect(changed).toBe(true);
    expect(machine.getState().isShowing).toBe(false);
    expect(machine.getState().isDismissedByUser).toBe(true);

    // Still offline 10s later, does NOT re-show
    const laterProbe = machine.handleProbeResult(false, 41000);
    expect(laterProbe).toBe(false);
    expect(machine.getState().isShowing).toBe(false);

    // Connection recovers: resets isDismissedByUser
    machine.handleProbeResult(true, 50000);
    expect(machine.getState().isDismissedByUser).toBe(false);
  });

  it('forceShow and toggle override automatic timing', () => {
    const machine = new OfflineStateMachine({ timeoutMs: 30000 });

    machine.forceShow();
    expect(machine.getState().isShowing).toBe(true);
    expect(machine.getState().isForcedShow).toBe(true);

    // An online result does not dismiss forced show
    machine.handleProbeResult(true, 5000);
    expect(machine.getState().isShowing).toBe(true);

    // Toggle dismisses it
    machine.toggle();
    expect(machine.getState().isShowing).toBe(false);
  });
});
