import type { Session } from 'electron';
import type { BrowserPermissions } from '../config/types.js';

/** Answers Chromium permission requests from the renderer with the configured allow-list. */
export function applyBrowserPermissions(session: Session, policy: BrowserPermissions): void {
  const allowed = new Set(policy.enabled ? policy.allow : []);
  session.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(allowed.has(permission))
  );
  session.setPermissionCheckHandler((_contents, permission) => allowed.has(permission));
}
