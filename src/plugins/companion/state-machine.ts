/**
 * Pure state machine for companion overlay visibility and payload (T4.3).
 */

import type { CompanionState } from './types.js';

export interface StateMachineInitialOptions {
  readonly url: string;
  readonly qrDataUrl: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly isShowing?: boolean | undefined;
}

export class CompanionStateMachine {
  private isShowing: boolean;
  private url: string;
  private qrDataUrl: string;
  private title: string;
  private description?: string | undefined;

  constructor(options: StateMachineInitialOptions) {
    this.isShowing = options.isShowing ?? false;
    this.url = options.url;
    this.qrDataUrl = options.qrDataUrl;
    this.title = options.title;
    this.description = options.description;
  }

  getState(): CompanionState {
    return {
      isShowing: this.isShowing,
      url: this.url,
      qrDataUrl: this.qrDataUrl,
      title: this.title,
      description: this.description,
    };
  }

  show(): boolean {
    if (this.isShowing) {
      return false;
    }
    this.isShowing = true;
    return true;
  }

  hide(): boolean {
    if (!this.isShowing) {
      return false;
    }
    this.isShowing = false;
    return true;
  }

  toggle(): boolean {
    this.isShowing = !this.isShowing;
    return true;
  }

  updatePayload(url: string, qrDataUrl: string): boolean {
    const changed = this.url !== url || this.qrDataUrl !== qrDataUrl;
    this.url = url;
    this.qrDataUrl = qrDataUrl;
    return changed;
  }
}
