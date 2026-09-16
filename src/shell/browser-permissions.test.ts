import { describe, expect, it } from 'vitest';
import type { Session } from 'electron';
import { browserPermissionsSchema } from '../config/schema/index.js';
import { applyBrowserPermissions } from './browser-permissions.js';

type RequestHandler = (
  contents: unknown,
  permission: string,
  callback: (granted: boolean) => void
) => void;
type CheckHandler = (contents: unknown, permission: string) => boolean;

function fakeSession(): {
  session: Session;
  handlers: { request?: RequestHandler; check?: CheckHandler };
} {
  const handlers: { request?: RequestHandler; check?: CheckHandler } = {};
  const session = {
    setPermissionRequestHandler: (handler: RequestHandler) => void (handlers.request = handler),
    setPermissionCheckHandler: (handler: CheckHandler) => void (handlers.check = handler),
  } as unknown as Session;
  return { session, handlers };
}

function ask(handlers: { request?: RequestHandler }, permission: string): boolean {
  let granted = false;
  handlers.request?.(null, permission, value => void (granted = value));
  return granted;
}

describe('applyBrowserPermissions', () => {
  it('allows the default media set and denies everything else', () => {
    const { session, handlers } = fakeSession();
    applyBrowserPermissions(session, browserPermissionsSchema.parse({}));
    expect(ask(handlers, 'media')).toBe(true);
    expect(ask(handlers, 'camera')).toBe(true);
    expect(ask(handlers, 'geolocation')).toBe(false);
    expect(handlers.check?.(null, 'microphone')).toBe(true);
    expect(handlers.check?.(null, 'notifications')).toBe(false);
  });

  it('denies everything when disabled', () => {
    const { session, handlers } = fakeSession();
    applyBrowserPermissions(session, browserPermissionsSchema.parse({ enabled: false }));
    expect(ask(handlers, 'media')).toBe(false);
  });
});
