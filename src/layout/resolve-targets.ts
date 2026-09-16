import type {
  DisplaySnapshot,
  DisplayRoleRule,
  LayoutProblem,
  LayoutProblemCode,
  Bounds,
} from './types.js';
import type { DisplayTarget } from '../config/types.js';
import { matchDisplays } from './roles.js';
import { createAmbiguousProblem, createPrimaryUnflaggedProblem } from './resolve-problems.js';

export interface ResolutionContext {
  readonly sortedDisplays: readonly DisplaySnapshot[];
  readonly roles: Readonly<Record<string, DisplayRoleRule>> | undefined;
  readonly touchDisplayIds: readonly number[] | undefined;
  readonly windowId: string;
  readonly fieldPath: string;
  readonly problems: LayoutProblem[];
}

export type TargetResolution =
  | {
      readonly ok: true;
      readonly displayId: number | null;
      readonly bounds: Bounds;
      readonly spanAll: boolean;
    }
  | { readonly ok: false; readonly code: LayoutProblemCode; readonly message: string };

export function unionBounds(displays: readonly DisplaySnapshot[]): Bounds {
  const first = displays[0]!;
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

function succeedOnDisplay(display: DisplaySnapshot): TargetResolution {
  return { ok: true, displayId: display.id, bounds: display.bounds, spanAll: false };
}

export function resolvePrimaryDisplay(ctx: ResolutionContext): DisplaySnapshot {
  const flagged = ctx.sortedDisplays.find(display => display.primary);
  if (flagged !== undefined) {
    return flagged;
  }

  const lowestId = ctx.sortedDisplays[0]!;
  ctx.problems.push(createPrimaryUnflaggedProblem(ctx.windowId, lowestId.id, ctx.fieldPath));
  return lowestId;
}

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

  const matches = matchDisplays(rule, ctx.sortedDisplays, ctx.touchDisplayIds);
  if (matches.length === 0) {
    return { ok: false, code: 'role-unmatched', message: `no display matches role "${role}"` };
  }
  return resolveMatchedDisplays(matches, `role "${role}"`, ctx);
}

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

function resolveMatchedDisplays(
  matches: readonly DisplaySnapshot[],
  selectorDescription: string,
  ctx: ResolutionContext
): TargetResolution {
  const display = matches[0]!;
  if (matches.length > 1) {
    ctx.problems.push(
      createAmbiguousProblem(
        ctx.windowId,
        matches.length,
        selectorDescription,
        display.id,
        ctx.fieldPath
      )
    );
  }
  return succeedOnDisplay(display);
}

export function resolveTarget(target: DisplayTarget, ctx: ResolutionContext): TargetResolution {
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
