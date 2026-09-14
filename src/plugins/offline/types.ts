/**
 * Types for the offline overlay plugin (T4.1).
 *
 * Implements the contracts for reachability detection, overlay timing,
 * and user dismissal state.
 */

export interface OfflineOverlayState {
  readonly isOnline: boolean;
  readonly isShowing: boolean;
  readonly isForcedShow: boolean;
  readonly isDismissedByUser: boolean;
  readonly offlineStart: number | null;
}

export interface OfflineOverlayConfig {
  readonly enabled: boolean;
  /** Milliseconds of sustained disconnection before the overlay appears (default 30000). */
  readonly timeoutMs: number;
  /** Milliseconds between connectivity checks (default 5000). */
  readonly pollIntervalMs: number;
  /** Optional HTTP/HTTPS endpoint to test when OS reports online. */
  readonly pingUrl?: string | undefined;
  /** Optional window IDs to show the overlay on. Defaults to all windows. */
  readonly targetWindowIds?: readonly string[] | undefined;
}

export type StateListener = (state: OfflineOverlayState) => void;
