import type { Logger } from '../../logging/logger.js';
import type { ManagedWindow } from '../windows/create.js';

export function selectOverlayWindows(
  windows: readonly ManagedWindow[],
  ids: readonly string[] | undefined,
  logger: Logger
): ManagedWindow[] {
  if (ids === undefined) {
    return [...windows];
  }
  const windowsById = new Map(windows.map(window => [window.id, window]));
  const selected: ManagedWindow[] = [];
  for (const id of ids) {
    const window = windowsById.get(id);
    if (window !== undefined) {
      selected.push(window);
    } else {
      logger.warn(`Overlay window id "${id}" not found`, { windowId: id });
    }
  }
  return selected;
}
