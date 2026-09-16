import type { BrowserWindow } from 'electron';
import type { Clock, TimerHandle } from '../../clock.js';
import type { OfflineConfig } from '../../config/types.js';
import type { Logger } from '../../logging/logger.js';
import type { IpcRouter } from '../ipc.js';
import type { OverlayView } from '../overlay-view.js';
import { createOverlaySet, type OverlaySet } from '../overlays/overlay-set.js';
import { selectOverlayWindows } from '../overlays/targets.js';
import type { ManagedWindow } from '../windows/create.js';
import type { ConnectivityProbe } from './probe.js';
import { OfflineStateMachine, type OfflineState } from './state.js';

export interface OfflineOverlay {
  toggle(): void;
  setShowing(showing: boolean): void;
  status(): OfflineState;
  dispose(): void;
}

export interface OfflineOverlayOptions {
  readonly config: OfflineConfig;
  readonly windows: readonly ManagedWindow[];
  readonly attach: (window: BrowserWindow) => OverlayView;
  readonly probe: ConnectivityProbe;
  readonly router: IpcRouter;
  readonly clock: Clock;
  readonly logger: Logger;
}

function createNoopOfflineOverlay(): OfflineOverlay {
  return {
    toggle: () => {},
    setShowing: () => {},
    status: () => ({
      isOnline: true,
      isShowing: false,
      isForcedShow: false,
      isDismissedByUser: false,
      offlineStart: null,
    }),
    dispose: () => {},
  };
}

function applyStateChange(
  changed: boolean,
  state: OfflineStateMachine,
  overlays: OverlaySet,
  logger: Logger
): void {
  if (!changed) return;
  const current = state.getState();
  if (current.isShowing) {
    overlays.show();
    logger.info('offline overlay shown', { online: current.isOnline });
  } else {
    overlays.hide();
    logger.info('offline overlay hidden', { online: current.isOnline });
  }
}

interface PollerOptions {
  readonly config: OfflineConfig;
  readonly probe: ConnectivityProbe;
  readonly state: OfflineStateMachine;
  readonly onResult: (changed: boolean) => void;
  readonly clock: Clock;
}

interface PollerRef {
  active: boolean;
  timerHandle?: TimerHandle | undefined;
}

function scheduleNextProbe(options: PollerOptions, ref: PollerRef): void {
  if (!ref.active) return;
  ref.timerHandle = options.clock.setTimeout(() => {
    void executeProbe(options, ref);
  }, options.config.pollIntervalMs);
}

async function executeProbe(options: PollerOptions, ref: PollerRef): Promise<void> {
  if (!ref.active) return;
  const online = await options.probe();
  if (!ref.active) return;
  options.onResult(options.state.handleProbeResult(online, options.clock.now()));
  scheduleNextProbe(options, ref);
}

function startPolling(options: PollerOptions): () => void {
  const ref: PollerRef = { active: true };
  scheduleNextProbe(options, ref);
  return () => {
    ref.active = false;
    if (ref.timerHandle !== undefined) options.clock.clearTimeout(ref.timerHandle);
  };
}

export function createOfflineOverlay(options: OfflineOverlayOptions): OfflineOverlay {
  const { config, windows, attach, probe, router, clock, logger } = options;
  if (!config.enabled) return createNoopOfflineOverlay();
  const targetWindows = selectOverlayWindows(windows, config.windows, logger);
  const overlaySet = createOverlaySet(targetWindows, attach);
  const state = new OfflineStateMachine(config.timeoutMs);
  const apply = (changed: boolean) => applyStateChange(changed, state, overlaySet, logger);
  const stopPolling = startPolling({ config, probe, state, onResult: apply, clock });
  router.handle('offline:dismiss', () => apply(state.dismiss()));
  router.handle('offline:status', () => state.getState());
  return {
    toggle: () => apply(state.toggle()),
    setShowing: showing => apply(showing ? state.forceShow() : state.dismiss()),
    status: () => state.getState(),
    dispose: () => {
      stopPolling();
      overlaySet.destroy();
    },
  };
}
