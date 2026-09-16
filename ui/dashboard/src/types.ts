export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DisplaySnapshot {
  readonly id: number;
  readonly primary: boolean;
  readonly bounds: Bounds;
  readonly workArea: Bounds;
  readonly label: string;
  readonly touchSupport: 'available' | 'unavailable' | 'unknown';
}

export interface WindowSummary {
  readonly id: string;
  readonly url: string | undefined;
  readonly bounds: Bounds | null;
  readonly isDestroyed: boolean;
}

export interface OfflineState {
  readonly isOnline: boolean;
  readonly isShowing: boolean;
  readonly isForcedShow: boolean;
  readonly isDismissedByUser: boolean;
  readonly offlineStart: number | null;
}

export interface OverlayStatus {
  readonly offline: OfflineState;
  readonly companion: { readonly visible: boolean };
}

export interface ProcessStatus {
  readonly name: string;
  readonly phase: string;
  readonly status: string;
  readonly pid?: number | undefined;
  readonly restarts?: number | undefined;
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

export interface ParsedLogLine {
  readonly level: number;
  readonly time: number;
  readonly msg: string;
  readonly scope?: string | undefined;
  readonly [key: string]: unknown;
}

export type ConnectionState = 'connected' | 'connecting' | 'offline';

export type SseEvent =
  | { readonly type: 'status'; readonly status: DashboardStatus }
  | { readonly type: 'logs'; readonly lines: readonly string[] }
  | { readonly type: 'log'; readonly line: string };
