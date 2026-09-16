import { describe, expect, it } from 'vitest';
import type { Display } from 'electron';
import { toDisplaySnapshots } from './displays.js';

function display(id: number, x: number): Display {
  return {
    id,
    bounds: { x, y: 0, width: 1920, height: 1080 },
    workArea: { x, y: 0, width: 1920, height: 1040 },
    scaleFactor: 1,
    rotation: 0,
    internal: false,
    label: `Display ${id}`,
    touchSupport: 'unknown',
    colorDepth: 24,
    displayFrequency: 60,
  } as unknown as Display;
}

describe('toDisplaySnapshots', () => {
  it('copies display fields and flags the primary display', () => {
    const displays = [display(1, 0), display(2, 1920)];
    const snapshots = toDisplaySnapshots({
      getAllDisplays: () => displays,
      getPrimaryDisplay: () => displays[1] as Display,
    });
    expect(snapshots.map(snapshot => snapshot.primary)).toEqual([false, true]);
    expect(snapshots[1]?.bounds.x).toBe(1920);
    expect(snapshots[0]?.label).toBe('Display 1');
  });
});
