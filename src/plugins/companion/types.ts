/**
 * Types for the companion QR/info overlay plugin (T4.3).
 */

import type { OverlayHandle } from '../../plugin-api/types.js';

export interface CompanionState {
  readonly isShowing: boolean;
  readonly url: string;
  readonly qrDataUrl: string;
  readonly title: string;
  readonly description?: string | undefined;
}

export interface CompanionConfig {
  readonly enabled: boolean;
  readonly url?: string | undefined;
  readonly port: number;
  readonly host?: string | undefined;
  readonly path: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly autoShow: boolean;
  readonly targetWindowIds?: readonly string[] | undefined;
}

export interface CompanionPluginOptions {
  readonly config?: Partial<CompanionConfig> | undefined;
  readonly viewManager?: OverlayHandle | undefined;
  readonly qrGenerator?: ((text: string) => Promise<string>) | undefined;
  readonly ipResolver?: (() => string) | undefined;
}
