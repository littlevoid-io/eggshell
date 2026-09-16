import type { DisplayRoleRule, DisplaySnapshot } from './types.js';

function matchesPattern(pattern: string | undefined, label: string): boolean {
  return pattern === undefined || label.toLowerCase().includes(pattern.toLowerCase());
}

/**
 * Touch capability precedence: `display.touchSupport` is Electron's own
 * per-display signal, scoped to this exact `Display.id` — it wins whenever
 * it expresses an opinion (`'available'` or `'unavailable'`), in either
 * direction. The injected `touchDisplayIds` (T2.3's probe result, delivered
 * as data — never fetched here) is consulted only when `touchSupport` is
 * `'unknown'`, and even then only as a best effort.
 */
export function isTouchCapable(
  display: DisplaySnapshot,
  touchDisplayIds: readonly number[] | undefined
): boolean {
  if (display.touchSupport !== 'unknown') {
    return display.touchSupport === 'available';
  }
  return touchDisplayIds?.includes(display.id) ?? false;
}

export function ruleMatches(
  rule: DisplayRoleRule,
  display: DisplaySnapshot,
  index: number,
  touchDisplayIds: readonly number[] | undefined
): boolean {
  if (!matchesPattern(rule.labelPattern, display.label)) return false;
  if (rule.index !== undefined && rule.index !== index) return false;
  if (rule.internal !== undefined && rule.internal !== display.internal) return false;
  if (
    rule.touchCapable !== undefined &&
    rule.touchCapable !== isTouchCapable(display, touchDisplayIds)
  ) {
    return false;
  }
  return true;
}

export function matchDisplays(
  rule: DisplayRoleRule,
  displays: readonly DisplaySnapshot[],
  touchDisplayIds: readonly number[] | undefined
): DisplaySnapshot[] {
  return displays.filter((display, index) => ruleMatches(rule, display, index, touchDisplayIds));
}
