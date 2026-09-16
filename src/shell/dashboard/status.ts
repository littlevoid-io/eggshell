import type { ResolvedApp } from '../../config/resolved.js';
import type { DisplaySnapshot } from '../../layout/types.js';
import type { ProcessStatus } from '../../process/supervisor.js';
import type { CompanionOverlay } from '../companion/index.js';
import type { OfflineOverlay } from '../offline/index.js';
import type { SoakState } from '../soak/types.js';
import type { ManagedWindow } from '../windows/create.js';
import type { DashboardStatus, WindowSummary } from './types.js';

export interface StatusSources {
  readonly resolved: ResolvedApp;
  readonly windows: readonly ManagedWindow[];
  readonly displays: () => readonly DisplaySnapshot[];
  readonly processes: () => readonly ProcessStatus[];
  readonly offline: OfflineOverlay;
  readonly companion: CompanionOverlay;
  readonly soak?: (() => SoakState | undefined) | undefined;
}

function summarizeWindow(managed: ManagedWindow): WindowSummary {
  if (managed.window.isDestroyed()) {
    return {
      id: managed.id,
      url: undefined,
      bounds: null,
      isDestroyed: true,
    };
  }
  const url = managed.window.webContents.getURL();
  return {
    id: managed.id,
    url: url.length > 0 ? url : undefined,
    bounds: managed.window.getBounds(),
    isDestroyed: false,
  };
}

function summarizeRuntime() {
  const memory = process.memoryUsage();
  return {
    platform: process.platform,
    arch: process.arch,
    uptimeSeconds: Math.floor(process.uptime()),
    memory: { rss: memory.rss, heapUsed: memory.heapUsed },
  };
}

export function buildStatus(sources: StatusSources): DashboardStatus {
  const soak = sources.soak?.();
  return {
    ...summarizeRuntime(),
    appId: sources.resolved.config.appId,
    productName: sources.resolved.config.productName,
    version: sources.resolved.config.version,
    isDev: sources.resolved.isDev,
    displays: sources.displays(),
    windows: sources.windows.map(summarizeWindow),
    processes: sources.processes(),
    overlays: {
      offline: sources.offline.status(),
      companion: { visible: sources.companion.visible },
    },
    ...(soak !== undefined ? { soak } : {}),
  };
}
