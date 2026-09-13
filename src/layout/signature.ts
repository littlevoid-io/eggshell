/**
 * Display topology signature (T2.1).
 *
 * This is a **dedup key for the window supervisor** (T2.4), not a display
 * summary. The supervisor drops any `displays-changed` event whose signature
 * matches the last settled topology, treating it as a no-op. That dedup is
 * what stops failure mode (b) from ARCHITECTURE.md's "lockup that justifies
 * the layout design": applying a layout perturbs monitor work-area, which
 * re-fires the OS display-changed event, which — without this signature —
 * re-triggered recovery, which re-perturbed work-area, forever. Every field
 * included below makes the supervisor more sensitive (more events count as
 * "a real change"); every field left out makes it blinder (more events are
 * silently ignored). This include/exclude split is therefore a deliberate
 * behavioural contract, not an implementation detail:
 *
 * - Included: `id`, `bounds`, `workArea`, `scaleFactor`, `rotation`,
 *   `internal`, `label`, `touchSupport` — every field that can change where
 *   a window ends up. A 1px `workArea` change (e.g. a taskbar appearing)
 *   must change the signature, because it is a real change to usable space.
 * - Excluded: `colorDepth`, `displayFrequency` — Windows fires
 *   `display-metrics-changed` for refresh-rate and colour-depth changes,
 *   neither of which can affect window placement. In the predecessor, every
 *   such event invalidated a cache and scheduled another recovery attempt;
 *   that unbounded cascade kept a blocking native touch probe firing until
 *   the machine locked up. Excluding these fields is what makes the dedup
 *   in the supervisor actually dedup instead of firing on every refresh
 *   cycle.
 *
 * Order-independence: the OS enumerates displays in an arbitrary, not
 * necessarily stable, order. Sorting by `id` before serializing means a
 * pure re-enumeration (same displays, different order) never looks like a
 * topology change. The input array is never mutated — callers may hold
 * onto it (e.g. as "the last known displays") across the call.
 *
 * The serialized form is built field-by-field rather than via
 * `JSON.stringify(display)`, because `JSON.stringify` follows the object's
 * own key insertion order — two logically-identical snapshots constructed
 * with keys in a different order would otherwise produce different
 * signatures.
 */

import type { DisplaySnapshot, Bounds } from './types.js';

/**
 * Distinct from any real topology's signature, so "no displays" is a
 * representable topology in its own right rather than colliding with an
 * empty string or `undefined`.
 */
const EMPTY_TOPOLOGY_SIGNATURE = 'topology:empty';

const FIELD_SEPARATOR = '|';
const DISPLAY_SEPARATOR = '#';

function serializeBounds(bounds: Bounds): string {
  return `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
}

function serializeDisplay(display: DisplaySnapshot): string {
  return [
    display.id,
    serializeBounds(display.bounds),
    serializeBounds(display.workArea),
    display.scaleFactor,
    display.rotation,
    display.internal,
    display.label,
    display.touchSupport,
  ].join(FIELD_SEPARATOR);
}

export function topologySignature(displays: readonly DisplaySnapshot[]): string {
  if (displays.length === 0) {
    return EMPTY_TOPOLOGY_SIGNATURE;
  }

  return [...displays]
    .sort((a, b) => a.id - b.id)
    .map(serializeDisplay)
    .join(DISPLAY_SEPARATOR);
}
