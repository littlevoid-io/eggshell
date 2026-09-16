import type { Display, Screen } from 'electron';
import type { DisplaySnapshot } from '../../layout/types.js';

function toSnapshot(display: Display, primary: boolean): DisplaySnapshot {
  return {
    id: display.id,
    primary,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    internal: display.internal,
    label: display.label,
    touchSupport: display.touchSupport,
    colorDepth: display.colorDepth,
    displayFrequency: display.displayFrequency,
  };
}

/** Plain-data copy of the current displays for the Electron-free layout layer. */
export function toDisplaySnapshots(
  screen: Pick<Screen, 'getAllDisplays' | 'getPrimaryDisplay'>
): DisplaySnapshot[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map(display => toSnapshot(display, display.id === primaryId));
}
