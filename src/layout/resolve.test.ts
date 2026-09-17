import { describe, it, expect } from 'vitest';
import { resolveLayout } from './resolve.js';
import type { DisplaySnapshot, DisplayRoleRule, LayoutInput } from './types.js';
import type { WindowConfig, DisplayTarget } from '../config/types.js';

/**
 * Fixture factories. Defaults describe one ordinary, non-primary external
 * display and one kiosk window targeting `primary`; tests override only the
 * field(s) under test, so each test reads as "what changed, what happened".
 */
function buildDisplay(overrides: Partial<DisplaySnapshot> = {}): DisplaySnapshot {
  return {
    id: 1,
    primary: false,
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

function buildWindow(
  overrides: Partial<WindowConfig> & Pick<WindowConfig, 'id' | 'target'>
): WindowConfig {
  return {
    url: 'https://example.test/',
    kiosk: true,
    fullscreen: false,
    borderless: false,
    autoHideMenuBar: true,
    zoomFactor: 1,
    showWhenReady: true,
    required: false,
    fallback: 'primary',
    ...overrides,
  };
}

describe('resolveLayout', () => {
  it('single display + primary-targeted kiosk window -> one placement, no problems', () => {
    const displays = [buildDisplay({ id: 1, primary: true })];
    const windows = [buildWindow({ id: 'main', target: { kind: 'primary' } })];

    const result = resolveLayout({ displays, windows });

    expect(result.problems).toEqual([]);
    expect(result.placements).toEqual([
      { windowId: 'main', displayId: 1, bounds: displays[0]!.bounds, mode: 'kiosk' },
    ]);
  });

  it('index targets resolve against displays sorted by id, not array order', () => {
    const d1 = buildDisplay({
      id: 1,
      primary: true,
      label: 'One',
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    });
    const d2 = buildDisplay({
      id: 2,
      label: 'Two',
      bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
    });
    const d3 = buildDisplay({
      id: 3,
      label: 'Three',
      bounds: { x: 3840, y: 0, width: 1920, height: 1080 },
    });
    const shuffled = [d3, d1, d2]; // deliberately not id-ordered, to prove the sort

    const windows = [
      buildWindow({ id: 'w0', target: { kind: 'index', index: 0 } }),
      buildWindow({ id: 'w1', target: { kind: 'index', index: 1 } }),
      buildWindow({ id: 'w2', target: { kind: 'index', index: 2 } }),
    ];

    const result = resolveLayout({ displays: shuffled, windows });

    expect(result.problems).toEqual([]);
    expect(result.placements.map(p => [p.windowId, p.displayId])).toEqual([
      ['w0', 1],
      ['w1', 2],
      ['w2', 3],
    ]);
  });

  describe('index out of range', () => {
    const displays = [buildDisplay({ id: 1, primary: true })];

    it('required:true -> error, no placement', () => {
      const windows = [
        buildWindow({ id: 'w', target: { kind: 'index', index: 5 }, required: true }),
      ];

      const result = resolveLayout({ displays, windows });

      expect(result.placements).toEqual([]);
      expect(result.problems).toEqual([
        {
          windowId: 'w',
          code: 'index-out-of-range',
          severity: 'error',
          message: expect.any(String) as string,
          fieldPath: 'windows[0].target',
        },
      ]);
    });

    it("fallback:'primary' -> warning, degraded placement on the primary display", () => {
      const target: DisplayTarget = { kind: 'index', index: 5 };
      const windows = [buildWindow({ id: 'w', target, fallback: 'primary' })];

      const result = resolveLayout({ displays, windows });

      expect(result.problems).toEqual([
        {
          windowId: 'w',
          code: 'index-out-of-range',
          severity: 'warning',
          message: expect.any(String) as string,
          fieldPath: 'windows[0].target',
        },
      ]);
      expect(result.placements).toEqual([
        {
          windowId: 'w',
          displayId: 1,
          bounds: displays[0]!.bounds,
          mode: 'kiosk',
          degradedFrom: target,
        },
      ]);
    });

    it("fallback:'none' -> warning, no placement", () => {
      const windows = [
        buildWindow({ id: 'w', target: { kind: 'index', index: 5 }, fallback: 'none' }),
      ];

      const result = resolveLayout({ displays, windows });

      expect(result.placements).toEqual([]);
      expect(result.problems).toEqual([
        {
          windowId: 'w',
          code: 'index-out-of-range',
          severity: 'warning',
          message: expect.any(String) as string,
          fieldPath: 'windows[0].target',
        },
      ]);
    });
  });

  it('role with touchCapable:true matches the display named in touchDisplayIds', () => {
    const displays = [
      buildDisplay({ id: 1, primary: true, label: 'Main' }),
      buildDisplay({ id: 2, label: 'Touch' }),
    ];
    const roles: Record<string, DisplayRoleRule> = { touch: { touchCapable: true } };
    const windows = [buildWindow({ id: 'kiosk', target: { kind: 'role', role: 'touch' } })];

    const result = resolveLayout({ displays, windows, roles, touchDisplayIds: [2] });

    expect(result.problems).toEqual([]);
    expect(result.placements).toEqual([
      { windowId: 'kiosk', displayId: 2, bounds: displays[1]!.bounds, mode: 'kiosk' },
    ]);
  });

  it("role touch absent from touchDisplayIds -> role-unmatched, fallback:'primary' produces a degraded placement", () => {
    const displays = [
      buildDisplay({ id: 1, primary: true, label: 'Main' }),
      buildDisplay({ id: 2, label: 'Other' }),
    ];
    const roles: Record<string, DisplayRoleRule> = { touch: { touchCapable: true } };
    const target: DisplayTarget = { kind: 'role', role: 'touch' };
    const windows = [buildWindow({ id: 'kiosk', target, fallback: 'primary' })];

    const result = resolveLayout({ displays, windows, roles, touchDisplayIds: [] });

    expect(result.problems).toEqual([
      {
        windowId: 'kiosk',
        code: 'role-unmatched',
        severity: 'warning',
        message: expect.any(String) as string,
        fieldPath: 'windows[0].target',
      },
    ]);
    expect(result.placements).toEqual([
      {
        windowId: 'kiosk',
        displayId: 1,
        bounds: displays[0]!.bounds,
        mode: 'kiosk',
        degradedFrom: target,
      },
    ]);
  });

  it('touchDisplayIds undefined falls back to display.touchSupport === "available"', () => {
    const displays = [
      buildDisplay({ id: 1, primary: true, label: 'Main' }),
      buildDisplay({ id: 2, label: 'Touch', touchSupport: 'available' }),
    ];
    const roles: Record<string, DisplayRoleRule> = { touch: { touchCapable: true } };
    const windows = [buildWindow({ id: 'kiosk', target: { kind: 'role', role: 'touch' } })];

    const result = resolveLayout({ displays, windows, roles });

    expect(result.problems).toEqual([]);
    expect(result.placements[0]?.displayId).toBe(2);
  });

  it('spanAll + kiosk:true downgrades to windowed across the union bounds, including negative-coordinate displays', () => {
    const left = buildDisplay({
      id: 1,
      label: 'Left',
      bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
    });
    const primary = buildDisplay({
      id: 2,
      primary: true,
      label: 'Primary',
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    });
    const above = buildDisplay({
      id: 3,
      label: 'Above',
      bounds: { x: 0, y: -600, width: 1920, height: 600 },
    });
    const displays = [left, primary, above];
    const windows = [buildWindow({ id: 'wall', target: { kind: 'spanAll' }, kiosk: true })];

    const result = resolveLayout({ displays, windows });

    expect(result.problems).toEqual([
      {
        windowId: 'wall',
        code: 'span-all-incompatible-with-mode',
        severity: 'warning',
        message: expect.any(String) as string,
        fieldPath: 'windows[0].target',
      },
    ]);
    expect(result.placements).toEqual([
      {
        windowId: 'wall',
        displayId: null,
        mode: 'windowed',
        bounds: { x: -1920, y: -600, width: 3840, height: 1680 },
      },
    ]);
  });

  it('spanAll + fullscreen:true (kiosk:false) also downgrades to windowed: fullscreen snaps to one display too', () => {
    const left = buildDisplay({
      id: 1,
      label: 'Left',
      bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
    });
    const primary = buildDisplay({
      id: 2,
      primary: true,
      label: 'Primary',
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    });
    const displays = [left, primary];
    const windows = [
      buildWindow({ id: 'wall', target: { kind: 'spanAll' }, kiosk: false, fullscreen: true }),
    ];

    const result = resolveLayout({ displays, windows });

    expect(result.problems).toEqual([
      {
        windowId: 'wall',
        code: 'span-all-incompatible-with-mode',
        severity: 'warning',
        message: expect.any(String) as string,
        fieldPath: 'windows[0].target',
      },
    ]);
    expect(result.placements).toEqual([
      {
        windowId: 'wall',
        displayId: null,
        mode: 'windowed',
        bounds: { x: -1920, y: 0, width: 3840, height: 1080 },
      },
    ]);
  });

  it('spanAll with neither kiosk nor fullscreen requested resolves to windowed with zero problems', () => {
    const displays = [
      buildDisplay({ id: 1, primary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
      buildDisplay({ id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }),
    ];
    const windows = [
      buildWindow({ id: 'wall', target: { kind: 'spanAll' }, kiosk: false, fullscreen: false }),
    ];

    const result = resolveLayout({ displays, windows });

    expect(result.problems).toEqual([]);
    expect(result.placements).toEqual([
      {
        windowId: 'wall',
        displayId: null,
        mode: 'windowed',
        bounds: { x: 0, y: 0, width: 3840, height: 1080 },
      },
    ]);
  });

  it('zero displays -> single no-displays error, zero placements, no synthetic display invented', () => {
    const windows = [buildWindow({ id: 'w', target: { kind: 'primary' } })];

    const result = resolveLayout({ displays: [], windows });

    expect(result.placements).toEqual([]);
    expect(result.problems).toEqual([
      {
        windowId: null,
        code: 'no-displays',
        severity: 'error',
        message: expect.any(String) as string,
        fieldPath: 'displays',
      },
    ]);
  });

  it('two windows resolving to the same display -> duplicate-target warning, both placements kept', () => {
    const displays = [buildDisplay({ id: 1, primary: true })];
    const windows = [
      buildWindow({ id: 'a', target: { kind: 'primary' } }),
      buildWindow({ id: 'b', target: { kind: 'index', index: 0 } }),
    ];

    const result = resolveLayout({ displays, windows });

    expect(result.placements).toHaveLength(2);
    expect(result.placements.map(p => p.windowId)).toEqual(['a', 'b']);
    expect(result.problems).toEqual([
      {
        windowId: 'b',
        code: 'duplicate-target',
        severity: 'warning',
        message: expect.any(String) as string,
        fieldPath: 'windows[1].target',
      },
    ]);
  });

  it('role matching two displays picks the lowest id and warns target-ambiguous', () => {
    const displays = [
      buildDisplay({ id: 5, label: 'Wall A', internal: false }),
      buildDisplay({ id: 2, primary: true, label: 'Wall B', internal: false }),
    ];
    const roles: Record<string, DisplayRoleRule> = { wall: { internal: false } };
    const windows = [buildWindow({ id: 'w', target: { kind: 'role', role: 'wall' } })];

    const result = resolveLayout({ displays, windows, roles });

    expect(result.problems).toEqual([
      {
        windowId: 'w',
        code: 'target-ambiguous',
        severity: 'warning',
        message: expect.any(String) as string,
        fieldPath: 'windows[0].target',
      },
    ]);
    expect(result.placements[0]?.displayId).toBe(2);
  });

  it('matchLabel is a case-insensitive substring match', () => {
    const displays = [buildDisplay({ id: 1, primary: true, label: 'Front Wall LED' })];
    const windows = [
      buildWindow({ id: 'w', target: { kind: 'matchLabel', pattern: 'front wall' } }),
    ];

    const result = resolveLayout({ displays, windows });

    expect(result.problems).toEqual([]);
    expect(result.placements[0]?.displayId).toBe(1);
  });

  it('matchLabel treats regex metacharacters in the label literally and never throws (regex-injection regression)', () => {
    const displays = [buildDisplay({ id: 1, primary: true, label: 'Dell (2)+' })];
    const windows = [
      buildWindow({ id: 'w', target: { kind: 'matchLabel', pattern: 'Dell (2)+' } }),
    ];

    expect(() => resolveLayout({ displays, windows })).not.toThrow();
    const result = resolveLayout({ displays, windows });
    expect(result.problems).toEqual([]);
    expect(result.placements[0]?.displayId).toBe(1);
  });

  it('matchLabel matching zero displays emits matchlabel-unmatched, not the generic role-unmatched code', () => {
    const displays = [buildDisplay({ id: 1, primary: true, label: 'Front Wall LED' })];
    const windows = [
      buildWindow({
        id: 'w',
        target: { kind: 'matchLabel', pattern: 'no such label anywhere' },
        fallback: 'none',
      }),
    ];

    const result = resolveLayout({ displays, windows });

    expect(result.placements).toEqual([]);
    expect(result.problems).toEqual([
      {
        windowId: 'w',
        code: 'matchlabel-unmatched',
        severity: 'warning',
        message: expect.any(String) as string,
        fieldPath: 'windows[0].target',
      },
    ]);
  });

  it('no display flagged primary -> primary-unflagged warning; required:true still gets a placement', () => {
    const lowest = buildDisplay({ id: 2 });
    const displays = [buildDisplay({ id: 5 }), lowest, buildDisplay({ id: 9 })];
    // `required: true` proves this does NOT run through the required/fallback
    // failure path: the target still resolves (via the lowest-id heuristic),
    // it just resolves with a warning attached.
    const windows = [buildWindow({ id: 'w', target: { kind: 'primary' }, required: true })];

    const result = resolveLayout({ displays, windows });

    expect(result.problems).toEqual([
      {
        windowId: 'w',
        code: 'primary-unflagged',
        severity: 'warning',
        message: expect.any(String) as string,
        fieldPath: 'windows[0].target',
      },
    ]);
    expect(result.placements).toEqual([
      { windowId: 'w', displayId: 2, bounds: lowest.bounds, mode: 'kiosk' },
    ]);
  });

  it('explicit window bounds overrides the resolved display bounds but not displayId', () => {
    const displays = [
      buildDisplay({ id: 1, primary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
    ];
    const customBounds = { x: 100, y: 100, width: 800, height: 600 };
    const windows = [buildWindow({ id: 'w', target: { kind: 'primary' }, bounds: customBounds })];

    const result = resolveLayout({ displays, windows });

    expect(result.placements).toEqual([
      { windowId: 'w', displayId: 1, bounds: customBounds, mode: 'kiosk' },
    ]);
  });

  describe('touch capability precedence (T2.12)', () => {
    it('touchSupport:"available" is touch-capable even when touchDisplayIds omits the display (probe cannot veto a positive)', () => {
      const displays = [
        buildDisplay({ id: 1, primary: true, label: 'Main' }),
        buildDisplay({ id: 2, label: 'Touch', touchSupport: 'available' }),
      ];
      const roles: Record<string, DisplayRoleRule> = { touch: { touchCapable: true } };
      const windows = [buildWindow({ id: 'kiosk', target: { kind: 'role', role: 'touch' } })];

      // The probe found no touch digitizers at all — Electron's positive
      // answer for display 2 must still win.
      const result = resolveLayout({ displays, windows, roles, touchDisplayIds: [] });

      expect(result.problems).toEqual([]);
      expect(result.placements[0]?.displayId).toBe(2);
    });

    it(
      'touchSupport:"unavailable" with the display\'s id present in touchDisplayIds is NOT ' +
        'touch-capable (regression: probe ids are unverified WMI enumeration ordinals, not ' +
        "verified Electron display ids, and must never override Electron's own negative answer)",
      () => {
        const displays = [
          buildDisplay({ id: 1, primary: true, label: 'Main' }),
          buildDisplay({ id: 2, label: 'NotTouch', touchSupport: 'unavailable' }),
        ];
        const roles: Record<string, DisplayRoleRule> = { touch: { touchCapable: true } };
        const target: DisplayTarget = { kind: 'role', role: 'touch' };
        const windows = [buildWindow({ id: 'kiosk', target, fallback: 'primary' })];

        // The probe's ordinal happens to name display 2, but touchSupport says
        // it is not touch-capable, so no display matches the role.
        const result = resolveLayout({ displays, windows, roles, touchDisplayIds: [2] });

        expect(result.problems).toEqual([
          {
            windowId: 'kiosk',
            code: 'role-unmatched',
            severity: 'warning',
            message: expect.any(String) as string,
            fieldPath: 'windows[0].target',
          },
        ]);
        expect(result.placements).toEqual([
          {
            windowId: 'kiosk',
            displayId: 1,
            bounds: displays[0]!.bounds,
            mode: 'kiosk',
            degradedFrom: target,
          },
        ]);
      }
    );

    it('touchSupport:"unknown" with the id present in touchDisplayIds is touch-capable (the probe\'s legitimate use)', () => {
      const displays = [
        buildDisplay({ id: 1, primary: true, label: 'Main' }),
        buildDisplay({ id: 2, label: 'Touch' }), // touchSupport defaults to 'unknown'
      ];
      const roles: Record<string, DisplayRoleRule> = { touch: { touchCapable: true } };
      const windows = [buildWindow({ id: 'kiosk', target: { kind: 'role', role: 'touch' } })];

      const result = resolveLayout({ displays, windows, roles, touchDisplayIds: [2] });

      expect(result.problems).toEqual([]);
      expect(result.placements[0]?.displayId).toBe(2);
    });

    it('touchSupport:"unknown" with the id absent from touchDisplayIds is not touch-capable', () => {
      const displays = [
        buildDisplay({ id: 1, primary: true, label: 'Main' }),
        buildDisplay({ id: 2, label: 'Other' }), // touchSupport defaults to 'unknown'
      ];
      const roles: Record<string, DisplayRoleRule> = { touch: { touchCapable: true } };
      const target: DisplayTarget = { kind: 'role', role: 'touch' };
      const windows = [buildWindow({ id: 'kiosk', target, fallback: 'primary' })];

      const result = resolveLayout({ displays, windows, roles, touchDisplayIds: [99] });

      expect(result.problems).toEqual([
        {
          windowId: 'kiosk',
          code: 'role-unmatched',
          severity: 'warning',
          message: expect.any(String) as string,
          fieldPath: 'windows[0].target',
        },
      ]);
      expect(result.placements).toEqual([
        {
          windowId: 'kiosk',
          displayId: 1,
          bounds: displays[0]!.bounds,
          mode: 'kiosk',
          degradedFrom: target,
        },
      ]);
    });

    it('touchSupport:"unknown" with touchDisplayIds undefined (no probe ran) is not touch-capable, and resolution succeeds via fallback rather than throwing', () => {
      const displays = [
        buildDisplay({ id: 1, primary: true, label: 'Main' }),
        buildDisplay({ id: 2, label: 'Other' }), // touchSupport defaults to 'unknown'
      ];
      const roles: Record<string, DisplayRoleRule> = { touch: { touchCapable: true } };
      const target: DisplayTarget = { kind: 'role', role: 'touch' };
      const windows = [buildWindow({ id: 'kiosk', target, fallback: 'primary' })];

      expect(() => resolveLayout({ displays, windows, roles })).not.toThrow();
      const result = resolveLayout({ displays, windows, roles });

      expect(result.problems).toEqual([
        {
          windowId: 'kiosk',
          code: 'role-unmatched',
          severity: 'warning',
          message: expect.any(String) as string,
          fieldPath: 'windows[0].target',
        },
      ]);
      expect(result.placements).toEqual([
        {
          windowId: 'kiosk',
          displayId: 1,
          bounds: displays[0]!.bounds,
          mode: 'kiosk',
          degradedFrom: target,
        },
      ]);
    });

    it('end-to-end: a touchCapable:true role lands on the display touchSupport identifies, not the one a misaligned probe ordinal claims', () => {
      const wrongOne = buildDisplay({
        id: 1,
        primary: true,
        label: 'Wrong',
        touchSupport: 'unavailable',
      });
      const rightOne = buildDisplay({
        id: 2,
        label: 'Right',
        touchSupport: 'available',
      });
      const displays = [wrongOne, rightOne];
      const roles: Record<string, DisplayRoleRule> = { touch: { touchCapable: true } };
      const windows = [buildWindow({ id: 'kiosk', target: { kind: 'role', role: 'touch' } })];

      // The probe's WMI ordinal names display 1 as touch-capable and omits
      // display 2 — the opposite of what Electron's own touchSupport reports.
      const result = resolveLayout({ displays, windows, roles, touchDisplayIds: [1] });

      expect(result.problems).toEqual([]);
      expect(result.placements).toEqual([
        { windowId: 'kiosk', displayId: 2, bounds: rightOne.bounds, mode: 'kiosk' },
      ]);
    });
  });

  it('is pure: the same input called twice yields deeply-equal results, and inputs are not mutated', () => {
    const displays = [
      buildDisplay({ id: 3, label: 'C' }),
      buildDisplay({ id: 1, primary: true, label: 'A' }),
      buildDisplay({ id: 2, label: 'B' }),
    ];
    const windows = [
      buildWindow({ id: 'a', target: { kind: 'index', index: 0 } }),
      buildWindow({ id: 'b', target: { kind: 'spanAll' }, kiosk: true }),
    ];
    const input: LayoutInput = { displays, windows };
    const inputClone = structuredClone(input);

    const first = resolveLayout(input);
    const second = resolveLayout(input);

    expect(first).toEqual(second);
    expect(input).toEqual(inputClone);
  });
});
