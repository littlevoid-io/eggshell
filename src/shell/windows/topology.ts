import type { Screen } from 'electron';
import { systemClock } from '../../clock.js';
import type { ResolvedApp } from '../../config/resolved.js';
import { resolveLayout } from '../../layout/resolve.js';
import { createTopologySupervisor } from '../../layout/supervisor.js';
import type { DisplaySnapshot, WindowPlacement } from '../../layout/types.js';
import type { Logger } from '../../logging/logger.js';
import type { ManagedWindow } from './create.js';
import { toDisplaySnapshots } from './displays.js';
import { applyPlacement, matchesPlacement } from './placement.js';

const SCREEN_EVENTS = ['display-added', 'display-removed', 'display-metrics-changed'] as const;

export interface WatchTopologyOptions {
  readonly resolved: ResolvedApp;
  readonly screen: Screen;
  readonly windows: readonly ManagedWindow[];
  readonly logger: Logger;
}

function placementsFor(
  resolved: ResolvedApp,
  displays: readonly DisplaySnapshot[],
  logger: Logger
): WindowPlacement[] {
  const layout = resolveLayout({
    displays,
    windows: resolved.config.windows,
    roles: resolved.config.display.roles,
  });
  for (const problem of layout.problems) {
    logger[problem.severity === 'error' ? 'error' : 'warn'](problem.message, {
      fieldPath: problem.fieldPath,
    });
  }
  return layout.placements;
}

function forEachPlacement(
  windows: readonly ManagedWindow[],
  placements: readonly WindowPlacement[],
  visit: (window: ManagedWindow, placement: WindowPlacement) => boolean
): boolean {
  return placements.every(placement => {
    const managed = windows.find(window => window.id === placement.windowId);
    return managed ? visit(managed, placement) : true;
  });
}

export interface TopologyWatcher {
  reapply(): void;
  dispose(): void;
}

function applyPlacements(
  windows: readonly ManagedWindow[],
  resolved: ResolvedApp,
  displays: readonly DisplaySnapshot[],
  logger: Logger
): void {
  forEachPlacement(windows, placementsFor(resolved, displays, logger), (managed, placement) => {
    applyPlacement(managed.window, placement);
    return true;
  });
}

function createDisplaySupervisor(
  options: WatchTopologyOptions,
  applyCurrent: (displays: readonly DisplaySnapshot[]) => void
) {
  const displayIdOf = (bounds: Electron.Rectangle) => options.screen.getDisplayMatching(bounds).id;
  return createTopologySupervisor({
    ...options.resolved.config.display.supervisor,
    clock: systemClock,
    logger: options.logger,
    apply: applyCurrent,
    verify: displays =>
      forEachPlacement(
        options.windows,
        placementsFor(options.resolved, displays, options.logger),
        (managed, placement) => matchesPlacement(managed.window, placement, displayIdOf)
      ),
  });
}

/** Re-applies the layout when displays change, through the topology supervisor's debounce and attempt caps. */
export function watchTopology(options: WatchTopologyOptions): TopologyWatcher {
  const applyCurrent = (displays: readonly DisplaySnapshot[]) =>
    applyPlacements(options.windows, options.resolved, displays, options.logger);
  const supervisor = createDisplaySupervisor(options, applyCurrent);
  const onChange = () => supervisor.onDisplaysChanged(toDisplaySnapshots(options.screen));
  const emitter: NodeJS.EventEmitter = options.screen;
  SCREEN_EVENTS.forEach(event => emitter.on(event, onChange));
  return {
    reapply: () => applyCurrent(toDisplaySnapshots(options.screen)),
    dispose: () => {
      SCREEN_EVENTS.forEach(event => emitter.off(event, onChange));
      supervisor.dispose();
    },
  };
}
