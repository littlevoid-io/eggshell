/**
 * Type definitions for the remote dashboard plugin (T4.2).
 */

export interface DashboardConfig {
  readonly enabled: boolean;
  readonly port: number;
  readonly host: string;
  readonly token?: string | undefined;
  readonly allowRestart: boolean;
  readonly allowQuit: boolean;
}

export interface WindowSummary {
  readonly id: string;
  readonly url?: string | undefined;
  readonly bounds: { x: number; y: number; width: number; height: number } | null;
  readonly isDestroyed: boolean;
}

export interface DashboardStatus {
  readonly appId: string;
  readonly platform: string;
  readonly arch: string;
  readonly uptimeSeconds: number;
  readonly memoryUsage: {
    readonly rss: number;
    readonly heapTotal: number;
    readonly heapUsed: number;
  };
  readonly windows: readonly WindowSummary[];
  readonly statusBus: Record<string, unknown>;
}

export interface DashboardActions {
  reloadWindows(): void;
  focusWindows(): void;
  restart?(): void;
  quit?(): void;
}
