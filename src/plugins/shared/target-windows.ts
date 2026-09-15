/**
 * Shared window-targeting helpers for overlay plugins.
 */

import type { OverlayHandle, ShellContext } from '../../plugin-api/types.js';

export interface OverlayTargetConfig {
  readonly targetWindowIds?: readonly string[] | undefined;
}

export function filterTargetWindowIds(
  context: Pick<ShellContext, 'windows'>,
  config: OverlayTargetConfig
): string[] {
  const allowed = config.targetWindowIds;
  return context.windows
    .list()
    .filter(handle => allowed === undefined || allowed.includes(handle.id))
    .map(handle => handle.id);
}

export function updateViews(
  context: Pick<ShellContext, 'windows'>,
  showing: boolean,
  views: Pick<OverlayHandle, 'show' | 'hide'>,
  config: OverlayTargetConfig
): void {
  const targets = filterTargetWindowIds(context, config);
  if (showing) {
    views.show(targets);
  } else {
    views.hide(targets);
  }
}
