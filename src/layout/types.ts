/**
 * Plain-data types for the layout layer (T2.1, T2.2).
 *
 * `DisplaySnapshot` mirrors the subset of Electron's `Display` that layout
 * decisions depend on. It is a plain-data copy, not an Electron type, so
 * that nothing in `src/layout/**` (or anything importing it) ends up with a
 * transitive dependency on Electron. The Electron -> `DisplaySnapshot`
 * conversion happens later, at the edge, in `src/shell/`.
 */

import type { Bounds, WindowConfig, DisplayTarget, DisplayPolicy } from '../config/types.js';

// `Bounds` already exists as a type inferred from `boundsSchema` in
// src/config (T1.3) with exactly this shape (x, y, width, height). Reusing
// it here is a type-only import — it adds no runtime dependency on
// src/config — and avoids a second, hand-maintained copy of the same shape
// that could silently drift out of sync.
export type { Bounds };

export interface DisplaySnapshot {
  id: number;
  /**
   * True for exactly the display the OS reports as primary. On Windows the
   * primary monitor can be reassigned without any display's `bounds`
   * changing, so this flag is the only way `{kind:'primary'}` targets and
   * the `fallback: 'primary'` path can react to that change at all — and
   * the only way `topologySignature` can tell the reassignment apart from a
   * no-op re-enumeration (see signature.ts).
   */
  primary: boolean;
  bounds: Bounds;
  workArea: Bounds;
  scaleFactor: number;
  rotation: number;
  internal: boolean;
  label: string;
  touchSupport: 'available' | 'unavailable' | 'unknown';
  colorDepth: number;
  displayFrequency: number;
}

/**
 * A single named display-selection rule, e.g. `{touchCapable: true}`. This
 * is `DisplayPolicy['roles'][string]` by indexed access rather than a
 * hand-copied interface, so it can never silently drift from
 * `displayRoleRuleSchema` in src/config/schema.ts.
 */
export type DisplayRoleRule = DisplayPolicy['roles'][string];

/** Input to `resolveLayout` (T2.2). Plain data only — see ARCHITECTURE.md I9. */
export interface LayoutInput {
  readonly displays: readonly DisplaySnapshot[];
  readonly windows: readonly WindowConfig[];
  readonly roles?: Readonly<Record<string, DisplayRoleRule>>;
  readonly touchDisplayIds?: readonly number[];
}

export interface WindowPlacement {
  windowId: string;
  /** `null` for a `spanAll` placement, which belongs to no single display. */
  displayId: number | null;
  bounds: Bounds;
  mode: 'kiosk' | 'fullscreen' | 'windowed';
  /** Set only when this placement is a degraded (`fallback: 'primary'`) landing for an originally-unresolvable target. */
  degradedFrom?: DisplayTarget;
}

export type LayoutProblemCode =
  | 'no-displays'
  | 'index-out-of-range'
  | 'role-unmatched'
  | 'matchlabel-unmatched'
  | 'target-ambiguous'
  | 'duplicate-target'
  | 'span-all-incompatible-with-mode'
  | 'primary-unflagged';

export interface LayoutProblem {
  /** `null` for whole-input problems, e.g. `no-displays`. */
  windowId: string | null;
  code: LayoutProblemCode;
  severity: 'error' | 'warning';
  message: string;
  /** Config-style field path, e.g. `windows[1].target`, so a consumer can point the user at the offending config. */
  fieldPath: string;
}

export interface LayoutResolution {
  placements: WindowPlacement[];
  problems: LayoutProblem[];
}
