import type {
  DisplaySnapshot,
  LayoutInput,
  LayoutResolution,
  LayoutProblem,
  WindowPlacement,
  Bounds,
} from './types.js';
import type { WindowConfig, DisplayTarget } from '../config/types.js';
import {
  type ResolutionContext,
  type TargetResolution,
  resolvePrimaryDisplay,
  resolveTarget,
} from './resolve-targets.js';
import {
  createNoDisplaysProblem,
  createSpanAllProblem,
  recordDuplicate,
} from './resolve-problems.js';

export function resolveLayout(input: LayoutInput): LayoutResolution {
  const problems: LayoutProblem[] = [];
  if (input.displays.length === 0) {
    problems.push(createNoDisplaysProblem());
    return { placements: [], problems };
  }
  const sortedDisplays = [...input.displays].sort((a, b) => a.id - b.id);
  return { placements: placeWindows(input, sortedDisplays, problems), problems };
}

function makeContext(
  window: WindowConfig,
  index: number,
  input: LayoutInput,
  sortedDisplays: readonly DisplaySnapshot[],
  problems: LayoutProblem[]
): ResolutionContext {
  return {
    sortedDisplays,
    roles: input.roles,
    touchDisplayIds: input.touchDisplayIds,
    windowId: window.id,
    fieldPath: `windows[${index}].target`,
    problems,
  };
}

function placeWindow(window: WindowConfig, ctx: ResolutionContext): WindowPlacement | undefined {
  const resolution = resolveTarget(window.target, ctx);
  return resolution.ok
    ? finishPlacement(window, resolution, ctx)
    : resolveUnresolvedTarget(window, resolution, ctx);
}

function placeSingleWindow(
  window: WindowConfig,
  index: number,
  input: LayoutInput,
  sortedDisplays: readonly DisplaySnapshot[],
  displayOwners: Map<number, string>,
  problems: LayoutProblem[]
): WindowPlacement | undefined {
  const ctx = makeContext(window, index, input, sortedDisplays, problems);
  const placement = placeWindow(window, ctx);
  if (placement === undefined) return undefined;
  recordDuplicate(placement, index, displayOwners, problems);
  return placement;
}

function placeWindows(
  input: LayoutInput,
  sortedDisplays: readonly DisplaySnapshot[],
  problems: LayoutProblem[]
): WindowPlacement[] {
  const placements: WindowPlacement[] = [];
  const displayOwners = new Map<number, string>();
  for (const [index, window] of input.windows.entries()) {
    const placement = placeSingleWindow(
      window,
      index,
      input,
      sortedDisplays,
      displayOwners,
      problems
    );
    if (placement !== undefined) placements.push(placement);
  }
  return placements;
}

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

function finishPlacement(
  window: WindowConfig,
  resolution: Extract<TargetResolution, { ok: true }>,
  ctx: ResolutionContext
): WindowPlacement {
  const requestedMode = selectMode(window);
  const needsDowngrade = resolution.spanAll && requestedMode !== 'windowed';
  if (needsDowngrade) {
    ctx.problems.push(createSpanAllProblem(window.id, requestedMode, ctx.fieldPath));
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
