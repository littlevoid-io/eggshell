import { describe, it, expect } from 'vitest';
import { topologySignature } from './signature.js';
import type { DisplaySnapshot } from './types.js';

/**
 * Fixture factory. Defaults describe one ordinary external display; tests
 * override only the field(s) under test.
 */
function buildDisplay(overrides: Partial<DisplaySnapshot> = {}): DisplaySnapshot {
  return {
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    scaleFactor: 1,
    rotation: 0,
    internal: false,
    label: 'Display 1',
    touchSupport: 'unknown',
    colorDepth: 24,
    displayFrequency: 60,
    ...overrides,
  };
}

describe('topologySignature', () => {
  it('is order-independent: reordering the input array yields an identical signature', () => {
    const a = buildDisplay({ id: 1, label: 'A' });
    const b = buildDisplay({ id: 2, label: 'B' });
    const c = buildDisplay({ id: 3, label: 'C' });

    expect(topologySignature([a, b, c])).toBe(topologySignature([c, a, b]));
    expect(topologySignature([a, b, c])).toBe(topologySignature([b, c, a]));
  });

  it('does not mutate the caller-provided array while sorting', () => {
    const a = buildDisplay({ id: 3, label: 'A' });
    const b = buildDisplay({ id: 1, label: 'B' });
    const c = buildDisplay({ id: 2, label: 'C' });
    const original = [a, b, c];

    topologySignature(original);

    expect(original).toEqual([a, b, c]);
    expect(original.map(d => d.id)).toEqual([3, 1, 2]);
  });

  it('changes the signature when workArea changes by 1px', () => {
    const base = [buildDisplay()];
    const changed = [buildDisplay({ workArea: { x: 0, y: 0, width: 1920, height: 1039 } })];

    expect(topologySignature(base)).not.toBe(topologySignature(changed));
  });

  it('changes the signature when bounds changes', () => {
    const base = [buildDisplay()];
    const changed = [buildDisplay({ bounds: { x: 0, y: 0, width: 1280, height: 1024 } })];

    expect(topologySignature(base)).not.toBe(topologySignature(changed));
  });

  it.each([
    ['scaleFactor', { scaleFactor: 2 }],
    ['rotation', { rotation: 90 }],
    ['internal', { internal: true }],
    ['label', { label: 'Something Else' }],
    ['touchSupport', { touchSupport: 'available' as const }],
  ])('changes the signature when %s changes', (_field, overrides) => {
    const base = [buildDisplay()];
    const changed = [buildDisplay(overrides)];

    expect(topologySignature(base)).not.toBe(topologySignature(changed));
  });

  it('REGRESSION (cascade bug): changing colorDepth does NOT change the signature', () => {
    const base = [buildDisplay({ colorDepth: 24 })];
    const changed = [buildDisplay({ colorDepth: 32 })];

    expect(topologySignature(base)).toBe(topologySignature(changed));
  });

  it('REGRESSION (cascade bug): changing displayFrequency does NOT change the signature', () => {
    const base = [buildDisplay({ displayFrequency: 60 })];
    const changed = [buildDisplay({ displayFrequency: 144 })];

    expect(topologySignature(base)).toBe(topologySignature(changed));
  });

  it('changes the signature when a display is added', () => {
    const before = [buildDisplay({ id: 1 })];
    const after = [buildDisplay({ id: 1 }), buildDisplay({ id: 2, label: 'Second' })];

    expect(topologySignature(before)).not.toBe(topologySignature(after));
  });

  it('changes the signature when a display is removed', () => {
    const before = [buildDisplay({ id: 1 }), buildDisplay({ id: 2, label: 'Second' })];
    const after = [buildDisplay({ id: 1 })];

    expect(topologySignature(before)).not.toBe(topologySignature(after));
  });

  it('returns a stable, non-empty value for an empty array, and agrees across calls', () => {
    const signature = topologySignature([]);

    expect(signature.length).toBeGreaterThan(0);
    expect(topologySignature([])).toBe(signature);
  });

  it('produces the same signature for structurally-identical snapshots with differently-ordered keys', () => {
    const a: DisplaySnapshot = {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      scaleFactor: 1,
      rotation: 0,
      internal: false,
      label: 'Display 1',
      touchSupport: 'unknown',
      colorDepth: 24,
      displayFrequency: 60,
    };
    const b: DisplaySnapshot = {
      displayFrequency: 60,
      colorDepth: 24,
      touchSupport: 'unknown',
      label: 'Display 1',
      internal: false,
      rotation: 0,
      scaleFactor: 1,
      workArea: { height: 1040, width: 1920, y: 0, x: 0 },
      bounds: { height: 1080, width: 1920, y: 0, x: 0 },
      id: 1,
    };

    expect(topologySignature([a])).toBe(topologySignature([b]));
  });
});
