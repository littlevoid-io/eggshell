import { describe, it, expect } from 'vitest';
import type { Session, WebContents } from 'electron';
import {
  applyNavigationGuards,
  applyPermissionHandlers,
  applyWebRequestFilter,
  createHardenedWindowOptions,
} from './hardening.js';
import type { PermissionPolicy } from '../config/types.js';
import type { Logger, LogFields } from '../logging/logger.js';

/**
 * Electron cannot run inside vitest (T3.2 task doc). These fakes duck-type
 * only the slice of `Session`/`WebContents` that `hardening.ts` actually
 * calls, capture the handlers/listeners it registers, and are cast through
 * `unknown` at the boundary so the rest of the file can call the captured
 * functions directly with plain data.
 */

function buildPolicy(allow: PermissionPolicy['allow'] = []): PermissionPolicy {
  return { default: 'deny', allow };
}

interface WarnCall {
  readonly message: string;
  readonly fields?: LogFields;
}

function createCapturingLogger(): Logger & { readonly warnCalls: WarnCall[] } {
  const warnCalls: WarnCall[] = [];
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: (message, fields) => {
      warnCalls.push(fields === undefined ? { message } : { message, fields });
    },
    error: () => undefined,
    warnCalls,
  };
}

interface PermissionRequestDetails {
  readonly requestingUrl?: string;
  readonly isMainFrame: boolean;
}
type PermissionRequestHandler = (
  webContents: WebContents,
  permission: string,
  callback: (granted: boolean) => void,
  details: PermissionRequestDetails
) => void;

interface PermissionCheckDetails {
  readonly requestingUrl?: string;
  readonly isMainFrame: boolean;
}
type PermissionCheckHandler = (
  webContents: WebContents | null,
  permission: string,
  requestingOrigin: string,
  details: PermissionCheckDetails
) => boolean;

interface WebRequestDetails {
  readonly url: string;
  readonly resourceType: string;
}
type WebRequestListener = (
  details: WebRequestDetails,
  callback: (response: { cancel?: boolean }) => void
) => void;

function createFakeSession() {
  let requestHandler: PermissionRequestHandler | null = null;
  let checkHandler: PermissionCheckHandler | null = null;
  let webRequestListener: WebRequestListener | null = null;

  const fakeSession = {
    setPermissionRequestHandler(handler: PermissionRequestHandler | null) {
      requestHandler = handler;
    },
    setPermissionCheckHandler(handler: PermissionCheckHandler | null) {
      checkHandler = handler;
    },
    webRequest: {
      onBeforeRequest(listener: WebRequestListener | null) {
        webRequestListener = listener;
      },
    },
  };

  return {
    session: fakeSession as unknown as Session,
    getRequestHandler: () => requestHandler,
    getCheckHandler: () => checkHandler,
    getWebRequestListener: () => webRequestListener,
  };
}

interface WindowOpenDetails {
  readonly url: string;
}
type WindowOpenHandler = (details: WindowOpenDetails) => { action: 'allow' | 'deny' };

interface NavigationEvent {
  readonly url: string;
  readonly isMainFrame: boolean;
  preventDefault: () => void;
  defaultPrevented: boolean;
}
type NavigationListener = (event: NavigationEvent) => void;

function createFakeWebContents() {
  let windowOpenHandler: WindowOpenHandler | null = null;
  let willNavigateListener: NavigationListener | null = null;
  let willRedirectListener: NavigationListener | null = null;

  const fakeWebContents = {
    setWindowOpenHandler(handler: WindowOpenHandler) {
      windowOpenHandler = handler;
    },
    on(event: string, listener: NavigationListener) {
      if (event === 'will-navigate') {
        willNavigateListener = listener;
      } else if (event === 'will-redirect') {
        willRedirectListener = listener;
      }
    },
  };

  return {
    webContents: fakeWebContents as unknown as WebContents,
    getWindowOpenHandler: () => windowOpenHandler,
    getWillNavigateListener: () => willNavigateListener,
    getWillRedirectListener: () => willRedirectListener,
  };
}

function makeNavigationEvent(url: string, isMainFrame = true): NavigationEvent {
  return {
    url,
    isMainFrame,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

describe('applyPermissionHandlers', () => {
  it('request handler denies an unlisted origin', () => {
    const { session, getRequestHandler } = createFakeSession();
    applyPermissionHandlers(session, buildPolicy([]));
    const handler = getRequestHandler();
    expect(handler).not.toBeNull();

    let granted: boolean | undefined;
    handler?.({} as unknown as WebContents, 'camera', g => (granted = g), {
      requestingUrl: 'https://example.com',
      isMainFrame: true,
    });

    expect(granted).toBe(false);
  });

  it('allows a listed origin for its listed permission only; a sibling permission is denied', () => {
    const policy = buildPolicy([{ origin: 'https://example.com', permissions: ['camera'] }]);
    const { session, getRequestHandler } = createFakeSession();
    applyPermissionHandlers(session, policy);
    const handler = getRequestHandler();

    let granted: boolean | undefined;
    handler?.({} as unknown as WebContents, 'camera', g => (granted = g), {
      requestingUrl: 'https://example.com',
      isMainFrame: true,
    });
    expect(granted).toBe(true);

    handler?.({} as unknown as WebContents, 'microphone', g => (granted = g), {
      requestingUrl: 'https://example.com',
      isMainFrame: true,
    });
    expect(granted).toBe(false);
  });

  it('the check handler behaves identically to the request handler for the same inputs', () => {
    const policy = buildPolicy([{ origin: 'https://example.com', permissions: ['camera'] }]);
    const { session, getRequestHandler, getCheckHandler } = createFakeSession();
    applyPermissionHandlers(session, policy);
    const requestHandler = getRequestHandler();
    const checkHandler = getCheckHandler();

    const cases: Array<{ origin: string; permission: string }> = [
      { origin: 'https://example.com', permission: 'camera' },
      { origin: 'https://example.com', permission: 'microphone' },
      { origin: 'https://other.com', permission: 'camera' },
      { origin: 'https://evil-example.com', permission: 'camera' },
    ];

    for (const { origin, permission } of cases) {
      let requestGranted: boolean | undefined;
      requestHandler?.({} as unknown as WebContents, permission, g => (requestGranted = g), {
        requestingUrl: origin,
        isMainFrame: true,
      });

      const checkGranted = checkHandler?.(null, permission, origin, {
        requestingUrl: origin,
        isMainFrame: true,
      });

      expect(checkGranted).toBe(requestGranted);
    }
  });

  it('iframe hazard: evaluates the requesting frame origin, not the top-level window origin', () => {
    // Allow-list only covers the top-level origin. A third-party iframe on
    // a different origin must NOT inherit that grant, and the top-level
    // window's URL must play no role at all -- it is never passed in.
    const policy = buildPolicy([{ origin: 'https://example.com', permissions: ['camera'] }]);
    const { session, getRequestHandler, getCheckHandler } = createFakeSession();
    applyPermissionHandlers(session, policy);

    let granted: boolean | undefined;
    getRequestHandler()?.({} as unknown as WebContents, 'camera', g => (granted = g), {
      requestingUrl: 'https://third-party-iframe.com/embed',
      isMainFrame: false,
    });
    expect(granted).toBe(false);

    const checkGranted = getCheckHandler()?.(null, 'camera', 'https://third-party-iframe.com', {
      isMainFrame: false,
    });
    expect(checkGranted).toBe(false);
  });

  it('an undeterminable requesting origin denies and logs a warning', () => {
    const policy = buildPolicy([{ origin: 'https://example.com', permissions: ['camera'] }]);
    const logger = createCapturingLogger();
    const { session, getRequestHandler, getCheckHandler } = createFakeSession();
    applyPermissionHandlers(session, policy, logger);

    let granted: boolean | undefined;
    getRequestHandler()?.({} as unknown as WebContents, 'camera', g => (granted = g), {
      requestingUrl: '',
      isMainFrame: true,
    });
    expect(granted).toBe(false);
    expect(logger.warnCalls.length).toBeGreaterThan(0);

    logger.warnCalls.length = 0;
    const checkGranted = getCheckHandler()?.(null, 'camera', '', { isMainFrame: true });
    expect(checkGranted).toBe(false);
    expect(logger.warnCalls.length).toBeGreaterThan(0);
  });

  it('a handler that would throw internally results in a denial, not a propagated exception', () => {
    const throwingPolicy = {
      default: 'deny',
      get allow(): never {
        throw new Error('boom');
      },
    } as unknown as PermissionPolicy;
    const logger = createCapturingLogger();
    const { session, getRequestHandler, getCheckHandler } = createFakeSession();
    applyPermissionHandlers(session, throwingPolicy, logger);

    let granted: boolean | undefined;
    expect(() =>
      getRequestHandler()?.({} as unknown as WebContents, 'camera', g => (granted = g), {
        requestingUrl: 'https://example.com',
        isMainFrame: true,
      })
    ).not.toThrow();
    expect(granted).toBe(false);

    let checkGranted: boolean | undefined;
    expect(() => {
      checkGranted = getCheckHandler()?.(null, 'camera', 'https://example.com', {
        isMainFrame: true,
      });
    }).not.toThrow();
    expect(checkGranted).toBe(false);
    expect(logger.warnCalls.length).toBeGreaterThan(0);
  });

  it('lookalike origin denied through the wired handler (proves it reaches policy.ts strict matching)', () => {
    const policy = buildPolicy([{ origin: 'https://example.com', permissions: ['camera'] }]);
    const { session, getRequestHandler } = createFakeSession();
    applyPermissionHandlers(session, policy);

    let granted: boolean | undefined;
    getRequestHandler()?.({} as unknown as WebContents, 'camera', g => (granted = g), {
      requestingUrl: 'https://evil-example.com',
      isMainFrame: true,
    });

    expect(granted).toBe(false);
  });
});

describe('applyNavigationGuards', () => {
  const allowedOrigins = ['https://example.com'];

  it('setWindowOpenHandler denies any URL and logs', () => {
    const logger = createCapturingLogger();
    const { webContents, getWindowOpenHandler } = createFakeWebContents();
    applyNavigationGuards(webContents, allowedOrigins, logger);

    const result = getWindowOpenHandler()?.({ url: 'https://example.com/popup' });

    expect(result).toEqual({ action: 'deny' });
    expect(logger.warnCalls.length).toBe(1);
    expect(logger.warnCalls[0]?.fields?.['url']).toBe('https://example.com/popup');
  });

  it('will-navigate calls preventDefault for a disallowed origin and not for an allowed one', () => {
    const logger = createCapturingLogger();
    const { webContents, getWillNavigateListener } = createFakeWebContents();
    applyNavigationGuards(webContents, allowedOrigins, logger);
    const listener = getWillNavigateListener();

    const disallowed = makeNavigationEvent('https://evil.com/page');
    listener?.(disallowed);
    expect(disallowed.defaultPrevented).toBe(true);

    const allowed = makeNavigationEvent('https://example.com/page');
    listener?.(allowed);
    expect(allowed.defaultPrevented).toBe(false);
  });

  it('will-redirect calls preventDefault for a disallowed origin and not for an allowed one', () => {
    const { webContents, getWillRedirectListener } = createFakeWebContents();
    applyNavigationGuards(webContents, allowedOrigins);
    const listener = getWillRedirectListener();

    const disallowed = makeNavigationEvent('https://evil.com/redirected');
    listener?.(disallowed);
    expect(disallowed.defaultPrevented).toBe(true);

    const allowed = makeNavigationEvent('https://example.com/redirected');
    listener?.(allowed);
    expect(allowed.defaultPrevented).toBe(false);
  });
});

describe('applyWebRequestFilter (opt-in)', () => {
  it('allows a sub-resource load from an allow-listed origin', () => {
    const { session, getWebRequestListener } = createFakeSession();
    applyWebRequestFilter(session, ['https://example.com']);
    const listener = getWebRequestListener();

    let response: { cancel?: boolean } | undefined;
    listener?.({ url: 'https://example.com/font.woff2', resourceType: 'font' }, r => {
      response = r;
    });

    expect(response?.cancel).toBeUndefined();
  });

  it('denies a sub-resource load from a non-allow-listed origin and logs', () => {
    const logger = createCapturingLogger();
    const { session, getWebRequestListener } = createFakeSession();
    applyWebRequestFilter(session, ['https://example.com'], logger);
    const listener = getWebRequestListener();

    let response: { cancel?: boolean } | undefined;
    listener?.({ url: 'https://cdn.evil.com/script.js', resourceType: 'script' }, r => {
      response = r;
    });

    expect(response?.cancel).toBe(true);
    expect(logger.warnCalls.length).toBe(1);
  });
});

describe('createHardenedWindowOptions', () => {
  it('includes the non-negotiable webPreferences flags and the preload path', () => {
    const options = createHardenedWindowOptions('/dist/preload.cjs');

    expect(options.webPreferences?.contextIsolation).toBe(true);
    expect(options.webPreferences?.nodeIntegration).toBe(false);
    expect(options.webPreferences?.sandbox).toBe(true);
    expect(options.webPreferences?.preload).toBe('/dist/preload.cjs');
  });
});
