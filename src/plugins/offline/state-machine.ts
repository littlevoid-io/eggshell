/**
 * Pure state machine for offline overlay management (T4.1).
 *
 * Implements the disconnect threshold, user dismissal, and forced-show logic
 * without any platform or timer I/O.
 */

import type { OfflineOverlayConfig, OfflineOverlayState } from './types.js';

export class OfflineStateMachine {
  private isOnline = true;
  private isShowing = false;
  private isForcedShow = false;
  private isDismissedByUser = false;
  private offlineStart: number | null = null;

  constructor(private readonly config: Pick<OfflineOverlayConfig, 'timeoutMs'>) {}

  getState(): OfflineOverlayState {
    return {
      isOnline: this.isOnline,
      isShowing: this.isShowing,
      isForcedShow: this.isForcedShow,
      isDismissedByUser: this.isDismissedByUser,
      offlineStart: this.offlineStart,
    };
  }

  handleProbeResult(online: boolean, now: number): boolean {
    const wasShowing = this.isShowing;
    this.isOnline = online;

    if (online) {
      this.handleOnlineResult();
    } else {
      this.handleOfflineResult(now);
    }

    return this.isShowing !== wasShowing;
  }

  dismiss(): boolean {
    const wasShowing = this.isShowing;
    this.isDismissedByUser = true;
    this.isForcedShow = false;
    this.isShowing = false;
    return this.isShowing !== wasShowing;
  }

  forceShow(): boolean {
    const wasShowing = this.isShowing;
    this.isForcedShow = true;
    this.isDismissedByUser = false;
    this.isShowing = true;
    return this.isShowing !== wasShowing;
  }

  toggle(): boolean {
    if (this.isShowing) {
      return this.dismiss();
    }
    return this.forceShow();
  }

  private handleOnlineResult(): void {
    this.isDismissedByUser = false;
    this.offlineStart = null;
    if (!this.isForcedShow) {
      this.isShowing = false;
    }
  }

  private handleOfflineResult(now: number): void {
    if (this.offlineStart === null) {
      this.offlineStart = now;
    }
    const elapsed = now - this.offlineStart;
    if (elapsed >= this.config.timeoutMs && !this.isDismissedByUser) {
      this.isShowing = true;
    }
  }
}
