export interface OfflineState {
  isOnline: boolean;
  isShowing: boolean;
  isForcedShow: boolean;
  isDismissedByUser: boolean;
  offlineStart: number | null;
}

export class OfflineStateMachine {
  private isOnline = true;
  private isShowing = false;
  private isForcedShow = false;
  private isDismissedByUser = false;
  private offlineStart: number | null = null;

  constructor(private readonly timeoutMs: number) {}

  getState(): OfflineState {
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
    if (elapsed >= this.timeoutMs && !this.isDismissedByUser) {
      this.isShowing = true;
    }
  }
}
