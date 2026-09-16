import { powerSaveBlocker } from 'electron';

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
