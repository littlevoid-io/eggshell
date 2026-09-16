import type { LayoutProblem, WindowPlacement } from './types.js';

export function createNoDisplaysProblem(): LayoutProblem {
  return {
    windowId: null,
    code: 'no-displays',
    severity: 'error',
    message: 'no displays are available; cannot resolve a layout',
    fieldPath: 'displays',
  };
}

export function createSpanAllProblem(
  windowId: string,
  mode: string,
  fieldPath: string
): LayoutProblem {
  return {
    windowId,
    code: 'span-all-incompatible-with-mode',
    severity: 'warning',
    message: `spanAll cannot be combined with ${mode} mode (${mode} snaps to a single monitor); downgrading to a windowed placement across the union of all displays`,
    fieldPath,
  };
}

export function createPrimaryUnflaggedProblem(
  windowId: string,
  lowestId: number,
  fieldPath: string
): LayoutProblem {
  return {
    windowId,
    code: 'primary-unflagged',
    severity: 'warning',
    message: `no display is flagged primary; using the lowest display id (${lowestId}) as a deterministic fallback`,
    fieldPath,
  };
}

export function createAmbiguousProblem(
  windowId: string,
  count: number,
  selectorDescription: string,
  displayId: number,
  fieldPath: string
): LayoutProblem {
  return {
    windowId,
    code: 'target-ambiguous',
    severity: 'warning',
    message: `${count} displays match ${selectorDescription}; using the lowest display id (${displayId})`,
    fieldPath,
  };
}

export function createDuplicateProblem(
  windowId: string,
  firstOwner: string,
  displayId: number,
  index: number
): LayoutProblem {
  return {
    windowId,
    code: 'duplicate-target',
    severity: 'warning',
    message: `window "${windowId}" and window "${firstOwner}" both resolve to display ${displayId}`,
    fieldPath: `windows[${index}].target`,
  };
}

export function recordDuplicate(
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
  problems.push(createDuplicateProblem(placement.windowId, firstOwner, placement.displayId, index));
}
