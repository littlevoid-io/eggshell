/**
 * View manager for companion overlay (T4.3).
 *
 * Re-exports shared OverlayViewManager.
 */

export {
  OverlayViewManager,
  OverlayViewManager as CompanionViewManager,
} from '../shared/overlay.js';
export type {
  OverlayViewManagerOptions,
  OverlayViewManagerOptions as CompanionViewManagerOptions,
} from '../shared/overlay.js';
