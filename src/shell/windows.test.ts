import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, Display, Input } from 'electron';
import {
  applyKioskLock,
  applyPlacement,
  createWindowRegistry,
  toDisplaySnapshots,
} from './windows.js';
import type { ManagedWindow } from './windows.js';
import type { WindowPlacement } from '../layout/types.js';
import type { WindowRegistry } from '../plugin-api/types.js';

/**
 * A fake Electron `Display`. Only the fields `toDisplaySnapshots` actually
 * reads are meaningful; every test starts from this and overrides what it
 * needs, so a field added to `Display` later does not have to be threaded
 * through every call site.
 */
function buildDisplay(overrides: Partial<Display> = {}): Display {
  return {
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    scaleFactor: 1,
    rotation: 0,
    internal: false,
    label: 'Fake Display',
    touchSupport: 'unknown',
    colorDepth: 24,
    displayFrequency: 60,
    ...overrides,
  } as Display;
}

/**
 * A fake `BrowserWindow` implementing only the methods this module calls —
 * Electron cannot run inside vitest, so every test here exercises this
 * fake, never a real `BrowserWindow`.
 */
function buildFakeWindow() {
  return {
    setKiosk: vi.fn(),
    setFullScreen: vi.fn(),
    setBounds: vi.fn(),
    setMenuBarVisibility: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    autoHideMenuBar: false,
    webContents: {
      on: vi.fn(),
      closeDevTools: vi.fn(),
    },
  };
}

type FakeWindow = ReturnType<typeof buildFakeWindow>;

function buildPlacement(overrides: Partial<WindowPlacement> = {}): WindowPlacement {
  return {
    windowId: 'main',
    displayId: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    mode: 'windowed',
    ...overrides,
  };
}

describe('toDisplaySnapshots', () => {
  it('maps every field from a fake Electron Display', () => {
    const display = buildDisplay({
      id: 7,
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      workArea: { x: 10, y: 20, width: 800, height: 560 },
      scaleFactor: 1.5,
      rotation: 90,
      internal: true,
      label: 'Studio Display',
      touchSupport: 'available',
      colorDepth: 30,
      displayFrequency: 120,
    });

    const [snapshot] = toDisplaySnapshots([display], /* primaryDisplayId */ 999);

    expect(snapshot).toEqual({
      id: 7,
      primary: false,
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      workArea: { x: 10, y: 20, width: 800, height: 560 },
      scaleFactor: 1.5,
      rotation: 90,
      internal: true,
      label: 'Studio Display',
      touchSupport: 'available',
      colorDepth: 30,
      displayFrequency: 120,
    });
  });

  it('sets primary on exactly the display matching the given primary id, and on no other', () => {
    const displays = [buildDisplay({ id: 1 }), buildDisplay({ id: 2 }), buildDisplay({ id: 3 })];

    const snapshots = toDisplaySnapshots(displays, 2);

    expect(snapshots.map(s => [s.id, s.primary])).toEqual([
      [1, false],
      [2, true],
      [3, false],
    ]);
  });

  it('normalises an empty label to a synthetic, id-derived placeholder', () => {
    const [snapshot] = toDisplaySnapshots([buildDisplay({ id: 5, label: '' })], 5);
    expect(snapshot?.label).toBe('Display 5');
  });

  it('normalises a whitespace-only label the same way as an empty one', () => {
    const [snapshot] = toDisplaySnapshots([buildDisplay({ id: 9, label: '   ' })], 9);
    expect(snapshot?.label).toBe('Display 9');
  });

  it('leaves a non-empty label untouched', () => {
    const [snapshot] = toDisplaySnapshots([buildDisplay({ id: 1, label: 'LG UltraFine' })], 1);
    expect(snapshot?.label).toBe('LG UltraFine');
  });
});

describe('applyPlacement', () => {
  it("'kiosk' mode calls setKiosk(true) and sets bounds", () => {
    const window = buildFakeWindow();
    const placement = buildPlacement({
      mode: 'kiosk',
      bounds: { x: 0, y: 0, width: 1280, height: 720 },
    });

    applyPlacement(window as never, placement);

    expect(window.setKiosk).toHaveBeenCalledWith(true);
    expect(window.setBounds).toHaveBeenCalledWith(placement.bounds);
  });

  it("'fullscreen' mode calls setFullScreen(true) and sets bounds", () => {
    const window = buildFakeWindow();
    const placement = buildPlacement({ mode: 'fullscreen' });

    applyPlacement(window as never, placement);

    expect(window.setFullScreen).toHaveBeenCalledWith(true);
    expect(window.setBounds).toHaveBeenCalledWith(placement.bounds);
  });

  it("'windowed' mode turns kiosk AND fullscreen off before setting bounds (spanAll-downgrade regression)", () => {
    const window = buildFakeWindow();
    const placement = buildPlacement({ mode: 'windowed' });

    applyPlacement(window as never, placement);

    expect(window.setKiosk).toHaveBeenCalledWith(false);
    expect(window.setFullScreen).toHaveBeenCalledWith(false);
    expect(window.setBounds).toHaveBeenCalledWith(placement.bounds);

    const kioskOffOrder = window.setKiosk.mock.invocationCallOrder[0]!;
    const fullScreenOffOrder = window.setFullScreen.mock.invocationCallOrder[0]!;
    const boundsOrder = window.setBounds.mock.invocationCallOrder[0]!;
    expect(kioskOffOrder).toBeLessThan(boundsOrder);
    expect(fullScreenOffOrder).toBeLessThan(boundsOrder);
  });

  it("'windowed' mode never calls setKiosk(true) or setFullScreen(true)", () => {
    const window = buildFakeWindow();
    applyPlacement(window as never, buildPlacement({ mode: 'windowed' }));

    expect(window.setKiosk).not.toHaveBeenCalledWith(true);
    expect(window.setFullScreen).not.toHaveBeenCalledWith(true);
  });
});

describe('applyKioskLock', () => {
  function beforeInputHandler(window: FakeWindow): (event: unknown, input: Input) => void {
    const call = window.webContents.on.mock.calls.find(c => c[0] === 'before-input-event');
    if (call === undefined) {
      throw new Error('before-input-event handler was not registered');
    }
    return call[1] as (event: unknown, input: Input) => void;
  }

  it('hides the menu bar unconditionally', () => {
    const window = buildFakeWindow();
    applyKioskLock(window as never, { isDevelopment: false });

    expect(window.setMenuBarVisibility).toHaveBeenCalledWith(false);
    expect(window.autoHideMenuBar).toBe(true);
  });

  it('in production, registers devtools/escape blocking', () => {
    const window = buildFakeWindow();
    applyKioskLock(window as never, { isDevelopment: false });

    expect(window.webContents.on).toHaveBeenCalledWith('devtools-opened', expect.any(Function));
    expect(window.webContents.on).toHaveBeenCalledWith('before-input-event', expect.any(Function));
  });

  it('with isDevelopment true, does not register devtools/escape blocking', () => {
    const window = buildFakeWindow();
    applyKioskLock(window as never, { isDevelopment: true });

    expect(window.webContents.on).not.toHaveBeenCalled();
  });

  it('closes devtools the instant they open, in production', () => {
    const window = buildFakeWindow();
    applyKioskLock(window as never, { isDevelopment: false });

    const call = window.webContents.on.mock.calls.find(c => c[0] === 'devtools-opened');
    const handler = call?.[1] as (() => void) | undefined;
    handler?.();

    expect(window.webContents.closeDevTools).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Partial<Input>]>([
    ['F12', { key: 'F12' }],
    ['Ctrl+Shift+I', { key: 'I', control: true, shift: true }],
    ['F11', { key: 'F11' }],
    ['Escape', { key: 'Escape' }],
  ])('blocks %s in production', (_name, overrides) => {
    const window = buildFakeWindow();
    applyKioskLock(window as never, { isDevelopment: false });
    const handler = beforeInputHandler(window);
    const preventDefault = vi.fn();

    handler(
      { preventDefault } as never,
      {
        type: 'keyDown',
        isAutoRepeat: false,
        isComposing: false,
        shift: false,
        control: false,
        alt: false,
        meta: false,
        ...overrides,
      } as Input
    );

    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('does not block an ordinary key press', () => {
    const window = buildFakeWindow();
    applyKioskLock(window as never, { isDevelopment: false });
    const handler = beforeInputHandler(window);
    const preventDefault = vi.fn();

    handler(
      { preventDefault } as never,
      {
        type: 'keyDown',
        key: 'a',
        isAutoRepeat: false,
        isComposing: false,
        shift: false,
        control: false,
        alt: false,
        meta: false,
      } as Input
    );

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('pins the window always-on-top only when requested', () => {
    const window = buildFakeWindow();
    applyKioskLock(window as never, { isDevelopment: false, alwaysOnTop: true });
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true);

    const withoutFlag = buildFakeWindow();
    applyKioskLock(withoutFlag as never, { isDevelopment: false });
    expect(withoutFlag.setAlwaysOnTop).not.toHaveBeenCalled();
  });
});

describe('createWindowRegistry', () => {
  function buildManagedWindow(id: string): ManagedWindow {
    return { id, native: buildFakeWindow() as never };
  }

  it('get() returns the handle for a known id and undefined for an unknown one', () => {
    const registry = createWindowRegistry([buildManagedWindow('a'), buildManagedWindow('b')]);

    expect(registry.get('a')?.id).toBe('a');
    expect(registry.get('missing')).toBeUndefined();
  });

  it('list() returns every registered handle', () => {
    const registry = createWindowRegistry([buildManagedWindow('a'), buildManagedWindow('b')]);

    expect(registry.list().map(handle => handle.id)).toEqual(['a', 'b']);
  });

  it('exposes `native` through the WindowRegistry interface at the type level', () => {
    const registry: WindowRegistry<BrowserWindow> = createWindowRegistry([buildManagedWindow('a')]);
    const handle = registry.get('a');

    expect(handle?.id).toBe('a');
    const native = handle?.native;
    expect(native).toBeDefined();
  });
});
