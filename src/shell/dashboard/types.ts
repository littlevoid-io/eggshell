import type { Bounds } from '../../config/types.js';
import type { DisplaySnapshot } from '../../layout/types.js';
import type { ProcessStatus } from '../../process/supervisor.js';
import type { OfflineState } from '../offline/state.js';

export interface WindowSummary {
  readonly id: string;
  readonly url: string | undefined;
  readonly bounds: Bounds | null;
  readonly isDestroyed: boolean;
}

export interface OverlayStatus {
  readonly offline: OfflineState;
  readonly companion: { readonly visible: boolean };
}

export interface DashboardStatus {
  readonly appId: string;
  readonly productName: string;
  readonly version: string | undefined;
  readonly isDev: boolean;
  readonly platform: string;
  readonly arch: string;
  readonly uptimeSeconds: number;
  readonly memory: { readonly rss: number; readonly heapUsed: number };
  readonly displays: readonly DisplaySnapshot[];
  readonly windows: readonly WindowSummary[];
  readonly processes: readonly ProcessStatus[];
  readonly overlays: OverlayStatus;
}

export interface DashboardActions {
  reloadWindows(): void;
  focusWindows(): void;
  recalculateLayout(): void;
  setOffline(showing: boolean | undefined): void;
  setCompanion(showing: boolean | undefined): void;
  restart(): void;
  quit(): void;
}
