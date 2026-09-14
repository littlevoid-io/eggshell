/**
 * Electron binding for the window layer (T3.1).
 *
 * ARCHITECTURE.md pins this file's job precisely: convert Electron's own
 * `Display` objects into the plain-data `DisplaySnapshot` that
 * `resolveLayout` consumes, and apply an already-computed `WindowPlacement`
 * to a real `BrowserWindow`. All placement maths — which display a window
 * lands on, what its bounds are, whether `spanAll` must downgrade a
 * requested mode — lives in `src/layout/resolve.ts` (T2.2) and stays there.
 * Nothing in this file computes a bound, chooses a display, or decides a
 * mode; it only copies data across the Electron boundary and calls the
 * Electron methods that correspond to a decision someone else already made.
 *
 * Electron cannot run inside vitest, so every exported function here is
 * exercised in `windows.test.ts` against fake objects implementing only the
 * handful of methods this file actually calls (`setKiosk`, `setBounds`, ...)
 * — never a real `BrowserWindow`. Keeping the file this thin is what makes
 * that possible.
 */

import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Display,
  Input,
  WebPreferences,
} from 'electron';
import type { Logger } from '../logging/logger.js';
import { noopLogger } from '../logging/logger.js';
import type { DisplaySnapshot, WindowPlacement } from '../layout/types.js';
import type { WindowHandle, WindowRegistry } from '../plugin-api/types.js';

// ---------------------------------------------------------------------------
// Display mapping
// ---------------------------------------------------------------------------

/**
 * Maps Electron's `Display[]` to the plain-data `DisplaySnapshot[]` that
 * `resolveLayout` consumes (see src/layout/types.ts). Every field is a
 * straight copy except `primary`, which is not a field on Electron's
 * `Display` at all — the OS-reported primary is exposed only via
 * `screen.getPrimaryDisplay().id`.
 *
 * `primaryDisplayId` is an explicit parameter rather than this function
 * importing and calling Electron's `screen` module itself, for two reasons:
 *  - it keeps this a pure function of its inputs, unit-testable with plain
 *    fixture objects and no Electron runtime at all;
 *  - it matches the pattern ARCHITECTURE.md already establishes for
 *    `touchDisplayIds` in `resolveLayout`: data the caller already has is
 *    injected in, never independently re-fetched by the function that needs
 *    it, so exactly one place (the caller — T3.7's display-change wiring)
 *    decides when `screen` is read.
 */
export function toDisplaySnapshots(
  displays: readonly Display[],
  primaryDisplayId: number
): DisplaySnapshot[] {
  return displays.map(display => ({
    id: display.id,
    primary: display.id === primaryDisplayId,
    bounds: { ...display.bounds },
    workArea: { ...display.workArea },
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    internal: display.internal,
    label: normalizeLabel(display.label, display.id),
    touchSupport: display.touchSupport,
    colorDepth: display.colorDepth,
    displayFrequency: display.displayFrequency,
  }));
}

/**
 * Electron documents `label` as "user-friendly, determined by the platform"
 * but leaves it `''` in practice on some platforms/monitors (observed on
 * headless/virtual displays and some setups without EDID data). An empty
 * string is a value `resolveLayout`'s `matchLabel` substring match could
 * receive, but two blank-labeled displays would then be indistinguishable
 * from each other and from a config typo that also produces an empty
 * needle. Rather than inventing a fake vendor/model string, this normalises
 * to a synthetic, still-honest placeholder built from the one piece of
 * identity Electron does give us — the display's own `id` — so the field is
 * never silently empty and never fabricated.
 */
function normalizeLabel(label: string, id: number): string {
  const trimmed = label.trim();
  return trimmed === '' ? `Display ${id}` : trimmed;
}

// ---------------------------------------------------------------------------
// Placement application
// ---------------------------------------------------------------------------

/**
 * Applies an already-resolved `WindowPlacement` to a real `BrowserWindow`,
 * honouring `placement.mode`. Every decision here was already made by
 * `resolveLayout` (T2.2); this function only carries it out.
 *
 * Order of operations, deliberately:
 *  - `'kiosk'` / `'fullscreen'`: bounds are set *before* the mode is
 *    switched on. Electron's `setBounds` is documented to be unreliable
 *    once kiosk or fullscreen is already active (both modes actively manage
 *    the window's geometry themselves), so the window is positioned onto
 *    its target display as an ordinary window first, then snapped into
 *    kiosk/fullscreen on that display.
 *  - `'windowed'`: kiosk and fullscreen are turned off *before* `setBounds`,
 *    unconditionally rather than only when currently active. This is the
 *    regression fix ARCHITECTURE.md calls out by name: a `spanAll` window
 *    `resolveLayout` downgraded from `kiosk` to `windowed` must actually
 *    leave kiosk mode, or Electron keeps it snapped to a single monitor and
 *    silently defeats the downgrade `resolveLayout` deliberately performed.
 *
 * Only real multi-monitor hardware can confirm whether `setBounds` is
 * honoured in every case once a window has to move to a *different* display
 * than the one it currently occupies while kiosk/fullscreen was active on
 * the old one, and whether a direct `'kiosk'` <-> `'fullscreen'` transition
 * (never emitted by `resolveLayout` today, but possible across two
 * `applyPlacement` calls if a consumer's config ever produces one) needs the
 * outgoing mode cleared first — this file does not currently clear the
 * *other* mode when entering `'kiosk'` or `'fullscreen'`, only for
 * `'windowed'`, because that is the only transition ARCHITECTURE.md's lockup
 * post-mortem and the T3.1 spec call for.
 */
export function applyPlacement(
  window: BrowserWindow,
  placement: WindowPlacement,
  logger: Logger = noopLogger
): void {
  if (placement.mode === 'windowed') {
    window.setKiosk(false);
    window.setFullScreen(false);
  }

  window.setBounds(placement.bounds);

  if (placement.mode === 'kiosk') {
    window.setKiosk(true);
  } else if (placement.mode === 'fullscreen') {
    window.setFullScreen(true);
  }

  logger.debug('applied window placement', {
    windowId: placement.windowId,
    mode: placement.mode,
    displayId: placement.displayId,
  });
}

// ---------------------------------------------------------------------------
// Kiosk hardening
// ---------------------------------------------------------------------------

export interface KioskLockOptions {
  /**
   * Explicit escape hatch instead of this file sniffing `NODE_ENV` or any
   * other ambient signal (I1's "no discovered state" principle extends
   * naturally here) — the caller (T3.4's `launch()`) already knows whether
   * it is running the consumer's dev build, so it passes that verdict in
   * rather than this file guessing at it.
   */
  readonly isDevelopment: boolean;
  readonly alwaysOnTop?: boolean;
}

/**
 * Kiosk hardening for an unattended display: hides the menu bar
 * unconditionally, optionally pins the window always-on-top, and — in
 * production only — blocks the standard ways to escape kiosk mode (devtools
 * shortcuts, F11, Escape) so a venue visitor cannot back out of the kiosk
 * with the keyboard. Skipped entirely when `options.isDevelopment` is true,
 * so a developer's own devtools workflow is never blocked.
 */
export function applyKioskLock(
  window: BrowserWindow,
  options: KioskLockOptions,
  logger: Logger = noopLogger
): void {
  window.setMenuBarVisibility(false);
  window.autoHideMenuBar = true;

  if (options.alwaysOnTop === true) {
    window.setAlwaysOnTop(true);
  }

  if (options.isDevelopment) {
    logger.debug('kiosk lock: escape/devtools blocking skipped (isDevelopment)', {});
    return;
  }

  blockKioskEscapes(window, logger);
}

/**
 * Registers the two listeners that make kiosk mode actually kiosk: closes
 * devtools the instant they open, and swallows the keyboard input that would
 * otherwise open them or drop the window out of kiosk/fullscreen. Only real
 * hardware/OS testing can confirm this is exhaustive — Electron's
 * `before-input-event` fires for OS-level accelerators inconsistently across
 * platforms, and a global OS shortcut (e.g. Alt+Tab, or Windows' own
 * Ctrl+Alt+Del) is outside `before-input-event`'s reach entirely and cannot
 * be blocked from inside a renderer/window at all.
 */
function blockKioskEscapes(window: BrowserWindow, logger: Logger): void {
  window.webContents.on('devtools-opened', () => {
    window.webContents.closeDevTools();
    logger.warn('blocked devtools open attempt in kiosk mode', {});
  });

  window.webContents.on('before-input-event', (event, input) => {
    if (!isBlockedKioskInput(input)) {
      return;
    }
    event.preventDefault();
    logger.warn('blocked kiosk escape input', { key: input.key, code: input.code });
  });
}

/** F12 and the usual browser devtools chords, plus F11 and Escape (kiosk/fullscreen escapes). */
function isBlockedKioskInput(input: Input): boolean {
  if (input.type !== 'keyDown') {
    return false;
  }
  const key = input.key.toLowerCase();
  const isDevtoolsShortcut =
    key === 'f12' ||
    ((input.control || input.meta) && input.shift && ['i', 'j', 'c'].includes(key));
  const isKioskEscapeKey = key === 'f11' || key === 'escape';
  return isDevtoolsShortcut || isKioskEscapeKey;
}

// ---------------------------------------------------------------------------
// Window creation + registry
// ---------------------------------------------------------------------------

/** Constructs a `BrowserWindow`; injected so this file stays unit-testable without a real Electron runtime. */
export type BrowserWindowFactory = (options: BrowserWindowConstructorOptions) => BrowserWindow;

export interface WindowSpec {
  readonly id: string;
  /**
   * Required, not defaulted: T3.2 owns `hardenedWebPreferences()`, and this
   * file must not duplicate or weaken that hardening by inventing its own
   * `webPreferences` default. T3.4's `launch()` is expected to pass
   * `hardenedWebPreferences()`'s output straight through here.
   */
  readonly webPreferences: WebPreferences;
}

/** A window this shell owns: the plugin-facing `id` plus the real Electron handle. */
export interface ManagedWindow {
  readonly id: string;
  readonly native: BrowserWindow;
}

/**
 * Constructs one `BrowserWindow` per `spec` via `factory`, deliberately
 * decoupled from `WindowPlacement` — construction only needs an id and
 * `webPreferences`, never bounds or mode, which belong to `applyPlacement`
 * once the window exists. Windows are created hidden (`show: false`); the
 * caller is expected to show each one only after its first placement has
 * been applied, so a kiosk window is never visible mid-repositioning.
 */
export function createWindows(
  specs: readonly WindowSpec[],
  factory: BrowserWindowFactory
): ManagedWindow[] {
  return specs.map(spec => ({
    id: spec.id,
    native: factory({ webPreferences: spec.webPreferences, show: false }),
  }));
}

/**
 * A `WindowRegistry` (plugin-api, T2.10) over the real windows this shell
 * created. Handles are shaped `{ id, native }` — `native` (the real
 * `BrowserWindow`) is a valid extra property on a `WindowHandle` because
 * `WindowHandle` is structurally just `{ readonly id: string }`, but it is
 * never part of the `WindowRegistry`/`WindowHandle` *type* a plugin sees:
 * code that holds this value through those interfaces (as every plugin
 * does) gets `WindowHandle`'s declared shape from `get`/`list`, not this
 * function's concrete return type, so `native` is invisible at the type
 * level even though it is present at runtime.
 */
export function createWindowRegistry(windows: readonly ManagedWindow[]): WindowRegistry {
  const byId = new Map<string, ManagedWindow>(windows.map(window => [window.id, window]));

  return {
    get: (id: string): WindowHandle | undefined => byId.get(id),
    list: (): readonly WindowHandle[] => windows,
  };
}
