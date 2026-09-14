/**
 * Touch-display probe interface (T2.3, I10: "Any platform-native probe is
 * async, has an explicit timeout, and sits behind an interface.").
 *
 * See ARCHITECTURE.md, "The lockup that justifies the layout design", cause
 * 3: the predecessor's touch-detection probe was a synchronous,
 * timeout-less child-process call sitting inside the shared layout-resolution
 * path, whose cache was invalidated by every display-changed event — it
 * blocked the whole process's event loop with no recovery short of a power
 * cycle. `TouchProbe` exists to make that specific failure structurally
 * impossible: `resolveLayout` (`src/layout/resolve.ts`) never calls a
 * `TouchProbe` itself — it is pure and receives `touchDisplayIds` as
 * injected **data** — so a probe implementation is free to be async and
 * fallible without threatening the pure layer at all. A consumer calls
 * `detect()` at the I/O edge, once, before invoking `resolveLayout`.
 */
export interface TouchProbe {
  /**
   * Resolves with the ids of touch-capable displays, using whatever id
   * scheme the concrete implementation documents (see each implementation's
   * own doc comment for what, if anything, it claims about correlating that
   * id with an Electron `Display.id`).
   *
   * Contract implementations MUST uphold:
   *
   * - MUST resolve, **never reject**. A denied permission, a missing
   *   platform service, an unparseable result, or any other failure is not
   *   layout-fatal — it degrades to "no touch displays known", which
   *   `resolveLayout` already handles via the `role-unmatched` problem code
   *   and each window's configured `fallback`. A probe that throws forces
   *   every caller in the layout path to handle a rejection it was never
   *   designed to see, which is exactly the shape of the original lockup.
   * - MUST respect `signal`. When `signal` aborts, `detect` must stop
   *   waiting on any outstanding I/O and settle promptly — resolving `[]` is
   *   an acceptable, conservative response to an abort. A probe that ignores
   *   `signal` and keeps waiting on its own is the documented lockup by
   *   another name: an uncancellable async wait blocks its caller's timeout
   *   from ever actually bounding wall-clock time.
   * - MUST have an internal timeout budget of its own; `signal` is a second,
   *   independent way to stop early, not the only one. A probe that only
   *   stops when told to by the caller, and otherwise waits on a platform
   *   command with no bound, has not actually fixed the lockup — it has only
   *   moved the missing timeout one layer up.
   */
  detect(signal: AbortSignal): Promise<readonly number[]>;
}
