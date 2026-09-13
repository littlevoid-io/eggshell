/**
 * Injected-time seam (T2.4 groundwork).
 *
 * Deliberately a root-level primitive, not `src/layout/clock.ts`: the Phase 2
 * process supervisor (T2.8) needs the identical injected-time treatment for
 * its restart backoff, and this must not be duplicated per-layer.
 *
 * Every scheduling component in this package takes a `Clock` rather than
 * calling `setTimeout`/`Date.now` directly, so its behaviour over time is
 * deterministically testable with a fake clock (see
 * `src/__testing__/fake-clock.ts`). The predecessor's retry logic used real
 * timers directly and therefore could not be driven or asserted on in a
 * test — which is exactly why its unbounded retry cascade (see
 * ARCHITECTURE.md, "The lockup that justifies the layout design") went
 * unnoticed until it froze a real machine.
 */

export interface TimerHandle {
  readonly id: number;
}

export interface Clock {
  setTimeout(callback: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  now(): number;
}

let nextSystemHandleId = 1;
const systemTimersById = new Map<number, ReturnType<typeof setTimeout>>();

/**
 * Wraps the global `setTimeout`/`clearTimeout`/`Date.now` (not `node:timers`,
 * so this stays usable in any JS environment, not just Node). Each returned
 * `TimerHandle` wraps the real timer object opaquely behind a numeric id.
 */
export const systemClock: Clock = {
  setTimeout(callback, ms) {
    const id = nextSystemHandleId++;
    const realHandle = setTimeout(callback, ms);
    systemTimersById.set(id, realHandle);
    return { id };
  },
  clearTimeout(handle) {
    const realHandle = systemTimersById.get(handle.id);
    if (realHandle === undefined) {
      return;
    }
    clearTimeout(realHandle);
    systemTimersById.delete(handle.id);
  },
  now() {
    return Date.now();
  },
};
