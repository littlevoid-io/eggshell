/**
 * Types for the remote dashboard plugin (T4.2).
 */

export interface DashboardConfig {
  readonly enabled: boolean;
  readonly port: number;
  readonly host: string;
  readonly token?: string | undefined;
  readonly allowRestart: boolean;
}

export interface LogEntry {
  readonly id: number;
  readonly type: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly timestamp: string;
}

export interface WindowStatusItem {
  readonly id: string;
  readonly url?: string | undefined;
  readonly bounds: { x: number; y: number; width: number; height: number } | null;
  readonly isDestroyed: boolean;
}

export interface DisplayStatusItem {
  readonly id: number;
  readonly label: string;
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly touchSupport: 'available' | 'unavailable' | 'unknown';
}

export interface DashboardStatusData {
  readonly appId: string;
  readonly productName: string;
  readonly platform: string;
  readonly arch: string;
  readonly uptime: number;
  readonly memory: { rss: number; heapTotal: number; heapUsed: number };
  readonly displays: readonly DisplayStatusItem[];
  readonly combinedBounds: { x: number; y: number; width: number; height: number };
  readonly windows: readonly WindowStatusItem[];
  readonly offlineOverlay: {
    readonly enabled: boolean;
    readonly isShowing: boolean;
    readonly isForcedShow: boolean;
  };
  readonly companionOverlay: {
    readonly isShowing: boolean;
  };
}

export interface DashboardActions {
  reloadWindows(): void;
  focusWindows(): void;
  recalculateLayout?(): void;
  toggleOffline(show?: boolean): void;
  toggleCompanion(show?: boolean): void;
  restartApp?(): void;
}
