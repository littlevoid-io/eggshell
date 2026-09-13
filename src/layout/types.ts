/**
 * Plain-data types for the layout layer (T2.1).
 *
 * `DisplaySnapshot` mirrors the subset of Electron's `Display` that layout
 * decisions depend on. It is a plain-data copy, not an Electron type, so
 * that nothing in `src/layout/**` (or anything importing it) ends up with a
 * transitive dependency on Electron. The Electron -> `DisplaySnapshot`
 * conversion happens later, at the edge, in `src/shell/`.
 */

import type { Bounds } from '../config/types.js';

// `Bounds` already exists as a type inferred from `boundsSchema` in
// src/config (T1.3) with exactly this shape (x, y, width, height). Reusing
// it here is a type-only import — it adds no runtime dependency on
// src/config — and avoids a second, hand-maintained copy of the same shape
// that could silently drift out of sync.
export type { Bounds };

export interface DisplaySnapshot {
  id: number;
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
