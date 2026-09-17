import { app, powerSaveBlocker } from 'electron';
import { RELAUNCH_EXIT_CODE, type RelaunchController } from './relaunch.js';

export function keepDisplayAwake(): number {
  return powerSaveBlocker.start('prevent-display-sleep');
}

/** Quits when the CLI that spawned this process is gone, so a killed terminal never leaves a kiosk behind. */
export function watchParent(pid: number, onGone: () => void, intervalMs = 2000): NodeJS.Timeout {
  return setInterval(() => {
    try {
      process.kill(pid, 0);
    } catch {
      onGone();
    }
  }, intervalMs);
}

export function initLifecycle(parentPid?: number): void {
  keepDisplayAwake();
  if (parentPid !== undefined) watchParent(parentPid, () => app.quit());
}

export interface ShellShutdownServices {
  readonly overlays: {
    readonly offline: { dispose(): void };
    readonly companion: { dispose(): void };
  };
  readonly topology: { dispose(): void };
  readonly dashboard: { stop(): Promise<unknown> };
  readonly soak: { stop(): Promise<unknown> };
  readonly processes: { stop(): Promise<unknown> };
}

function finishShutdown(relaunch: RelaunchController, parentPid?: number): void {
  if (relaunch.requested) {
    if (parentPid === undefined) app.relaunch();
    app.exit(parentPid === undefined ? 0 : RELAUNCH_EXIT_CODE);
    return;
  }
  app.exit(0);
}

function stopAllServices(services: ShellShutdownServices): Promise<unknown> {
  services.overlays.offline.dispose();
  services.overlays.companion.dispose();
  services.topology.dispose();
  void services.dashboard.stop();
  return Promise.all([services.soak.stop(), services.processes.stop()]);
}

export function registerShutdown(
  services: ShellShutdownServices,
  relaunch: RelaunchController,
  parentPid?: number
): void {
  let isQuitting = false;
  app.on('before-quit', event => {
    event.preventDefault();
    if (isQuitting) return;
    isQuitting = true;
    void stopAllServices(services).finally(() => finishShutdown(relaunch, parentPid));
  });
}
