/**
 * The pure layout resolver (T2.2).
 *
 * `resolveLayout` is a total function: every reachable branch either
 * returns a placement or records a `LayoutProblem` and moves on. It never
 * throws, never loops, and never emits a placement that cannot be
 * satisfied. See ARCHITECTURE.md, "The lockup that justifies the layout
 * design", for why that specific property is the point of this file:
 *
 *   1. An unsatisfiable `spanAll` + `kiosk` (or `spanAll` + `fullscreen` —
 *      the identical contradiction, since both snap a window to a single
 *      monitor) target used to be retried every 10 seconds forever. Here it
 *      is detected once and deterministically downgraded (see
 *      `finishPlacement` below) — an unsatisfiable target can never be the
 *      output of this function.
 *   2. Recovery re-triggering itself and (3) the actual freeze — a
 *      synchronous, timeout-less child-process touch probe sitting in the
 *      layout path — are structural non-issues here because this file
 *      performs zero I/O and awaits nothing (I9, enforced by
 *      eslint.config.mjs's PURE_LAYER_FILES block: no `node:*` import, no
 *      `async`, no `await`). Touch information arrives as the
 *      `touchDisplayIds` **data** parameter; this file must never probe for
 *      anything, directly or transitively.
 *
 * `colorDepth` and `displayFrequency` deliberately do not influence any
 * decision in this file, for the same reason `topologySignature` (T2.1)
 * excludes them from its hash: the supervisor upstream dedups display
 * events by that signature, so a change visible only through those two
 * fields never reaches this resolver at all. Do not add refresh-rate- or
 * colour-depth-dependent placement logic here — the event that would
 * trigger it is swallowed before this function is ever called.
 */

import type {
  DisplaySnapshot,
  DisplayRoleRule,
  LayoutInput,
  LayoutResolution,
  LayoutProblem,
  LayoutProblemCode,
  WindowPlacement,
  Bounds,
} from './types.js';
import type { WindowConfig, DisplayTarget } from '../config/types.js';

interface ResolutionContext {
  readonly sortedDisplays: readonly DisplaySnapshot[];
  readonly roles: Readonly<Record<string, DisplayRoleRule>> | undefined;
  readonly touchDisplayIds: readonly number[] | undefined;
  readonly windowId: string;
  readonly fieldPath: string;
  readonly problems: LayoutProblem[];
}

type TargetResolution =
  | {
      readonly ok: true;
      readonly displayId: number | null;
      readonly bounds: Bounds;
      readonly spanAll: boolean;
    }
  | { readonly ok: false; readonly code: LayoutProblemCode; readonly message: string };

export function resolveLayout(input: LayoutInput): LayoutResolution {
  const problems: LayoutProblem[] = [];

  if (input.displays.length === 0) {
    problems.push({
      windowId: null,
      code: 'no-displays',
      severity: 'error',
      message: 'no displays are available; cannot resolve a layout',
      fieldPath: 'displays',
    });
    return { placements: [], problems };
  }

  const sortedDisplays = [...input.displays].sort((a, b) => a.id - b.id);
  const placements: WindowPlacement[] = [];
  const displayOwners = new Map<number, string>();

  input.windows.forEach((window, index) => {
    const placement = resolveWindow(
      window,
      index,
      sortedDisplays,
      input.roles,
      input.touchDisplayIds,
      problems
    );
    if (placement === undefined) {
      return;
    }
    recordDuplicate(placement, index, displayOwners, problems);
    placements.push(placement);
  });

  return { placements, problems };
}

// ---------------------------------------------------------------------------
// Per-window resolution
// ---------------------------------------------------------------------------

function resolveWindow(
  window: WindowConfig,
  index: number,
  sortedDisplays: readonly DisplaySnapshot[],
  roles: Readonly<Record<string, DisplayRoleRule>> | undefined,
  touchDisplayIds: readonly number[] | undefined,
  problems: LayoutProblem[]
): WindowPlacement | undefined {
  const ctx: ResolutionContext = {
    sortedDisplays,
    roles,
    touchDisplayIds,
    windowId: window.id,
    fieldPath: `windows[${index}].target`,
    problems,
  };

  const resolution = resolveTarget(window.target, ctx);
  return resolution.ok
    ? finishPlacement(window, resolution, ctx)
    : resolveUnresolvedTarget(window, resolution, ctx);
}

/**
 * `required: true` and `fallback: 'error'` both mean "never place this
 * window, always surface an error"; `required` is checked first, so when a
 * window config sets `required: true` together with `fallback: 'primary'`
 * (a self-contradictory combination the schema does not forbid), `required`
 * wins and no placement is emitted — this is a deliberate reading, not an
 * oversight.
 */
function resolveUnresolvedTarget(
  window: WindowConfig,
  failure: Extract<TargetResolution, { ok: false }>,
  ctx: ResolutionContext
): WindowPlacement | undefined {
  const blocking = window.required || window.fallback === 'error';
  ctx.problems.push({
    windowId: window.id,
    code: failure.code,
    severity: blocking ? 'error' : 'warning',
    message: failure.message,
    fieldPath: ctx.fieldPath,
  });

  if (blocking || window.fallback === 'none') {
    return undefined;
  }

  const primary = resolvePrimaryDisplay(ctx);
  const bounds = applyExplicitBounds(window, primary.bounds);
  return buildPlacement(window.id, primary.id, bounds, selectMode(window), window.target);
}

/**
 * `spanAll` combined with either `kiosk` or `fullscreen` is unsatisfiable:
 * both are display-snapping modes in Electron (`BrowserWindow.setKiosk` and
 * `setFullScreen` both operate against the window's *current* display), and
 * neither can span multiple monitors. Do not special-case `kiosk` alone
 * here — `fullscreen` has the identical contradiction, and treating only
 * `kiosk` as unsatisfiable would silently reintroduce the same forever-retry
 * failure mode for `spanAll` + `fullscreen` windows.
 *
 * Because the config schema defaults `kiosk` to `true`, any `spanAll`
 * window will normally trip this warning unless the config explicitly sets
 * `kiosk: false` — that is intended and informative, not a bug. This is
 * resolved deterministically (never retried, never left unsatisfied):
 * downgrade to a windowed placement across the union bounds and say so via
 * a warning naming the mode that was overridden, per the failure-mode-(a)
 * fix in ARCHITECTURE.md. `spanAll` with neither `kiosk` nor `fullscreen`
 * requested already resolves to `'windowed'`, so no problem is emitted.
 */
function finishPlacement(
  window: WindowConfig,
  resolution: Extract<TargetResolution, { ok: true }>,
  ctx: ResolutionContext
): WindowPlacement {
  const requestedMode = selectMode(window);
  const needsDowngrade = resolution.spanAll && requestedMode !== 'windowed';
  if (needsDowngrade) {
    ctx.problems.push({
      windowId: window.id,
      code: 'span-all-incompatible-with-mode',
      severity: 'warning',
      message: `spanAll cannot be combined with ${requestedMode} mode (${requestedMode} snaps to a single monitor); downgrading to a windowed placement across the union of all displays`,
      fieldPath: ctx.fieldPath,
    });
  }

  const mode = needsDowngrade ? 'windowed' : requestedMode;
  const bounds = applyExplicitBounds(window, resolution.bounds);
  return buildPlacement(window.id, resolution.displayId, bounds, mode);
}

function selectMode(window: WindowConfig): WindowPlacement['mode'] {
  if (window.kiosk) return 'kiosk';
  if (window.fullscreen) return 'fullscreen';
  return 'windowed';
}

/** An explicit `bounds` on the window config wins verbatim; it never changes `displayId`. */
function applyExplicitBounds(window: WindowConfig, resolvedBounds: Bounds): Bounds {
  return window.bounds ?? resolvedBounds;
}

function buildPlacement(
  windowId: string,
  displayId: number | null,
  bounds: Bounds,
  mode: WindowPlacement['mode'],
  degradedFrom?: DisplayTarget
): WindowPlacement {
  return degradedFrom === undefined
    ? { windowId, displayId, bounds, mode }
    : { windowId, displayId, bounds, mode, degradedFrom };
}

/**
 * Two or more windows resolving to the same display is a legitimate
 * installation choice (e.g. two overlapping widgets on one monitor), so
 * this is a `warning`, never an `error` — it must not stop the shell from
 * starting. Reported once per extra window, naming the window that already
 * claimed the display.
 *
 * `spanAll` placements (`displayId: null`) are deliberately exempt: two
 * `spanAll` layers (e.g. a background layer plus a transparent overlay) is
 * a normal layout pattern, not a collision, since neither belongs to "a
 * display" in the first place. Do not remove this exemption to make
 * `duplicate-target` "more thorough" — it would make that pattern warn on
 * every resolve.
 */
function recordDuplicate(
  placement: WindowPlacement,
  index: number,
  displayOwners: Map<number, string>,
  problems: LayoutProblem[]
): void {
  if (placement.displayId === null) {
    return;
  }

  const firstOwner = displayOwners.get(placement.displayId);
  if (firstOwner === undefined) {
    displayOwners.set(placement.displayId, placement.windowId);
    return;
  }

  problems.push({
    windowId: placement.windowId,
    code: 'duplicate-target',
    severity: 'warning',
    message: `window "${placement.windowId}" and window "${firstOwner}" both resolve to display ${placement.displayId}`,
    fieldPath: `windows[${index}].target`,
  });
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

function resolveTarget(target: DisplayTarget, ctx: ResolutionContext): TargetResolution {
  switch (target.kind) {
    case 'primary':
      return succeedOnDisplay(resolvePrimaryDisplay(ctx));
    case 'index':
      return resolveIndexTarget(target.index, ctx);
    case 'role':
      return resolveRoleTarget(target.role, ctx);
    case 'matchLabel':
      return resolveMatchLabelTarget(target.pattern, ctx);
    case 'spanAll':
      return { ok: true, displayId: null, bounds: unionBounds(ctx.sortedDisplays), spanAll: true };
  }
}

function succeedOnDisplay(display: DisplaySnapshot): TargetResolution {
  return { ok: true, displayId: display.id, bounds: display.bounds, spanAll: false };
}

/**
 * `primary` — the display flagged `primary: true`. If the OS reports none
 * (should not happen, but nothing here trusts that), fall back to the
 * lowest `id` deterministically and warn (`primary-unflagged`): this
 * heuristic must never depend on OS enumeration order, or a window could
 * land on a different monitor between reboots.
 *
 * This always succeeds — it is called directly, never routed through
 * `resolveUnresolvedTarget` — so `primary-unflagged` never runs through the
 * `required`/`fallback` machinery and its severity is unconditionally
 * `warning`. Unlike a genuinely unresolvable target, there is no failure to
 * escalate to `error`: a display was found, just via a heuristic instead of
 * an explicit flag.
 */
function resolvePrimaryDisplay(ctx: ResolutionContext): DisplaySnapshot {
  const flagged = ctx.sortedDisplays.find(display => display.primary);
  if (flagged !== undefined) {
    return flagged;
  }

  const lowestId = ctx.sortedDisplays[0]!; // resolveLayout guarantees a non-empty displays array
  ctx.problems.push({
    windowId: ctx.windowId,
    code: 'primary-unflagged',
    severity: 'warning',
    message: `no display is flagged primary; using the lowest display id (${lowestId.id}) as a deterministic fallback`,
    fieldPath: ctx.fieldPath,
  });
  return lowestId;
}

/** Indexes into `sortedDisplays` (sorted by `id`), never raw OS enumeration order, which is unstable. */
function resolveIndexTarget(index: number, ctx: ResolutionContext): TargetResolution {
  const display = ctx.sortedDisplays[index];
  if (display === undefined) {
    return {
      ok: false,
      code: 'index-out-of-range',
      message: `target.index ${index} is out of range: only ${ctx.sortedDisplays.length} display(s) available`,
    };
  }
  return succeedOnDisplay(display);
}

function resolveRoleTarget(role: string, ctx: ResolutionContext): TargetResolution {
  const rule = ctx.roles?.[role];
  if (rule === undefined) {
    return {
      ok: false,
      code: 'role-unmatched',
      message: `no display role rule named "${role}" is configured`,
    };
  }

  const matches = matchDisplays(rule, ctx);
  if (matches.length === 0) {
    return { ok: false, code: 'role-unmatched', message: `no display matches role "${role}"` };
  }
  return resolveMatchedDisplays(matches, `role "${role}"`, ctx);
}

/**
 * `pattern` is matched as a case-insensitive **substring**, never compiled
 * as a `RegExp`: the config field is a plain string (I4 keeps config
 * JSON-serializable), and treating a user-supplied string as a regex
 * invites both crashes on invalid syntax and catastrophic backtracking on
 * pathological ones.
 */
function resolveMatchLabelTarget(pattern: string, ctx: ResolutionContext): TargetResolution {
  const needle = pattern.toLowerCase();
  const matches = ctx.sortedDisplays.filter(display =>
    display.label.toLowerCase().includes(needle)
  );
  if (matches.length === 0) {
    return {
      ok: false,
      code: 'matchlabel-unmatched',
      message: `no display label contains "${pattern}"`,
    };
  }
  return resolveMatchedDisplays(matches, `label pattern "${pattern}"`, ctx);
}

/**
 * `matches` is a filter over `sortedDisplays`, so `matches[0]` is always
 * the lowest-id match. Shared by `role` and `matchLabel`: both use the same
 * lowest-id tie-break, and the same `target-ambiguous` code — a technician
 * seeing "role-ambiguous" for a `matchLabel` misconfiguration would be
 * misled, so the code name is target-kind-agnostic.
 */
function resolveMatchedDisplays(
  matches: readonly DisplaySnapshot[],
  selectorDescription: string,
  ctx: ResolutionContext
): TargetResolution {
  const display = matches[0]!;
  if (matches.length > 1) {
    ctx.problems.push({
      windowId: ctx.windowId,
      code: 'target-ambiguous',
      severity: 'warning',
      message: `${matches.length} displays match ${selectorDescription}; using the lowest display id (${display.id})`,
      fieldPath: ctx.fieldPath,
    });
  }
  return succeedOnDisplay(display);
}

// ---------------------------------------------------------------------------
// Display role rule matching
// ---------------------------------------------------------------------------

function matchDisplays(rule: DisplayRoleRule, ctx: ResolutionContext): DisplaySnapshot[] {
  return ctx.sortedDisplays.filter((display, index) =>
    ruleMatches(rule, display, index, ctx.touchDisplayIds)
  );
}

function ruleMatches(
  rule: DisplayRoleRule,
  display: DisplaySnapshot,
  index: number,
  touchDisplayIds: readonly number[] | undefined
): boolean {
  if (
    rule.labelPattern !== undefined &&
    !display.label.toLowerCase().includes(rule.labelPattern.toLowerCase())
  ) {
    return false;
  }
  if (rule.index !== undefined && rule.index !== index) {
    return false;
  }
  if (rule.internal !== undefined && rule.internal !== display.internal) {
    return false;
  }
  if (
    rule.touchCapable !== undefined &&
    rule.touchCapable !== isTouchCapable(display, touchDisplayIds)
  ) {
    return false;
  }
  return true;
}

/**
 * Touch capability precedence: `display.touchSupport` is Electron's own
 * per-display signal, scoped to this exact `Display.id` — it wins whenever
 * it expresses an opinion (`'available'` or `'unavailable'`), in either
 * direction. The injected `touchDisplayIds` (T2.3's probe result, delivered
 * as data — never fetched here) is consulted only when `touchSupport` is
 * `'unknown'`, and even then only as a best effort: on Windows those ids are
 * WMI/CIM enumeration-order ordinals for touch digitizers, not verified
 * Electron display ids (see `src/layout/probes/windows-touch.ts`'s module
 * doc comment for why no such correlation is possible on that platform), so
 * they must never override a positive-or-negative answer Electron already
 * gave. With no probe result at all (`touchDisplayIds === undefined`) and an
 * `'unknown'` `touchSupport`, this defaults to not touch-capable.
 */
function isTouchCapable(
  display: DisplaySnapshot,
  touchDisplayIds: readonly number[] | undefined
): boolean {
  if (display.touchSupport !== 'unknown') {
    return display.touchSupport === 'available';
  }
  return touchDisplayIds?.includes(display.id) ?? false;
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

function unionBounds(displays: readonly DisplaySnapshot[]): Bounds {
  const first = displays[0]!; // resolveLayout guarantees a non-empty displays array
  let minX = first.bounds.x;
  let minY = first.bounds.y;
  let maxX = first.bounds.x + first.bounds.width;
  let maxY = first.bounds.y + first.bounds.height;

  for (const display of displays.slice(1)) {
    minX = Math.min(minX, display.bounds.x);
    minY = Math.min(minY, display.bounds.y);
    maxX = Math.max(maxX, display.bounds.x + display.bounds.width);
    maxY = Math.max(maxY, display.bounds.y + display.bounds.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
