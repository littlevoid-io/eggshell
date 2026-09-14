/**
 * Electron wiring for the pure permission/hardening policy (T2.11,
 * `./policy.ts`). This file is adaptation only: every allow/deny decision
 * is made by `evaluatePermission` / `isNavigationAllowed`. Nothing here
 * re-implements an origin comparison, a permission lookup, or a
 * default-deny branch -- duplicating that logic would mean the 19 tests
 * covering `policy.ts` no longer cover the code that actually runs inside
 * Electron.
 *
 * Callers (T3.4's `launch()`) must apply these only **after**
 * `validateConfig` has produced a `ShellConfig`. The predecessor granted
 * media/camera permissions globally, to every origin including remote
 * third-party URLs, before any config was read at all -- see `policy.ts`'s
 * module doc. There is deliberately no code path here that can run before
 * a validated `PermissionPolicy` exists to pass in.
 */

import type {
  BrowserWindowConstructorOptions,
  PermissionCheckHandlerHandlerDetails,
  Session,
  WebContents,
} from 'electron';
import { evaluatePermission, hardenedWebPreferences, isNavigationAllowed } from './policy.js';
import type { PermissionPolicy } from '../config/types.js';
import type { Logger } from '../logging/logger.js';
import { noopLogger } from '../logging/logger.js';

/**
 * Minimal shape both permission-handler detail objects share, for the
 * origin-determination helpers below. Electron's real detail types have
 * more fields; structural typing accepts them as-is.
 */
interface OriginBearingDetails {
  readonly requestingUrl?: string;
  readonly isMainFrame: boolean;
}

/**
 * Origin-determination fallback order for `session.setPermissionRequestHandler`.
 *
 * Electron's request-handler `details` (the `PermissionRequest` structure
 * and its `fileSystem`/`media`/`openExternal` variants) always carries
 * `requestingUrl` -- the URL of the frame that actually asked, which for an
 * iframe is the IFRAME's own URL, never the top-level window's. There is no
 * `requestingOrigin` field on this handler; that only exists on the check
 * handler below.
 *
 * Fallback order:
 *   1. `details.requestingUrl`, if it is a non-empty string.
 *   2. Otherwise: undetermined (`undefined`).
 *
 * There is deliberately no further fallback to `webContents.getURL()`.
 * That method returns the top FRAME's URL, and using it here would
 * silently attribute a third-party iframe's permission request to the
 * top-level page's origin -- exactly the embedding bypass this module
 * exists to close. An undetermined origin denies (see `decidePermission`).
 */
function requestOriginFrom(details: OriginBearingDetails): string | undefined {
  return details.requestingUrl !== undefined && details.requestingUrl !== ''
    ? details.requestingUrl
    : undefined;
}

/**
 * Origin-determination fallback order for `session.setPermissionCheckHandler`
 * (synchronous). Electron passes `requestingOrigin` as its own positional
 * argument; per Electron's docs it is populated "for `media`, `hid`, `usb`
 * and `serial` checks" specifically, so `details.requestingUrl` is used as
 * a same-meaning fallback for every other permission kind.
 *
 * Fallback order:
 *   1. `requestingOrigin`, if non-empty.
 *   2. `details.requestingUrl`, if non-empty.
 *   3. Otherwise: undetermined (`undefined`).
 *
 * Same rule as the request handler: never falls back to a webContents URL.
 */
function checkOriginFrom(
  requestingOrigin: string,
  details: PermissionCheckHandlerHandlerDetails
): string | undefined {
  return requestingOrigin !== '' ? requestingOrigin : requestOriginFrom(details);
}

/**
 * Shared decision path for both permission handlers. Delegates entirely to
 * `evaluatePermission`; the only logic here is (a) treating an
 * undeterminable origin as a logged denial, and (b) containing any
 * unexpected throw -- from `evaluatePermission` or from constructing its
 * arguments -- as a logged denial rather than letting it propagate out of
 * an Electron handler invocation, which would be worse than a denial.
 */
function decidePermission(
  policy: PermissionPolicy,
  permission: string,
  origin: string | undefined,
  isMainFrame: boolean,
  logger: Logger
): boolean {
  try {
    if (origin === undefined) {
      logger.warn('denying permission request: could not determine requesting origin', {
        permission,
        isMainFrame,
      });
      return false;
    }

    return evaluatePermission(policy, { origin, permission }) === 'allow';
  } catch (error) {
    logger.warn('denying permission request: policy evaluation threw unexpectedly', {
      permission,
      origin,
      isMainFrame,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Wires `policy`'s permission decisions into both of Electron's permission
 * surfaces on `session`. Electron requires both to be implemented for
 * complete coverage -- most web APIs perform a synchronous check first and
 * only fall through to the asynchronous request if the check denies -- and
 * the two handlers have different shapes:
 *
 * - `setPermissionRequestHandler`: asynchronous, answered via `callback(boolean)`.
 * - `setPermissionCheckHandler`: synchronous, answered via a `boolean` return value.
 *
 * Both delegate to the same `decidePermission` helper so they cannot
 * diverge on the same input, which `hardening.test.ts` asserts directly.
 */
export function applyPermissionHandlers(
  session: Session,
  policy: PermissionPolicy,
  logger: Logger = noopLogger
): void {
  session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const origin = requestOriginFrom(details);
    callback(decidePermission(policy, permission, origin, details.isMainFrame, logger));
  });

  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const origin = checkOriginFrom(requestingOrigin, details);
    return decidePermission(policy, permission, origin, details.isMainFrame, logger);
  });
}

/**
 * Wires the navigation-hardening guards for one `webContents`:
 *
 * - `setWindowOpenHandler` always denies. A kiosk must never open a second
 *   window; `window.open` from remote content is an escape hatch out of
 *   the single hardened window, independent of origin, so this is not an
 *   `isNavigationAllowed` decision at all -- it is an unconditional deny.
 * - `will-navigate` denies (via `preventDefault`) unless the target origin
 *   is in `allowedOrigins`.
 * - `will-redirect` gets the same guard as `will-navigate`. A server-side
 *   redirect chain (e.g. the allowed page 302-ing to an attacker origin)
 *   changes the destination without going through another `will-navigate`
 *   check, so a `will-navigate`-only guard is bypassable by anything that
 *   can trigger a redirect on the allowed origin. The cost of covering it
 *   is a second identical listener; there is no legitimate-traffic
 *   trade-off here the way there is for `webRequest` below, so this is
 *   default-on.
 *
 * Every denial is logged at `warn` with the attempted URL, which is the
 * only diagnostic available once a kiosk is deployed unattended at a venue.
 */
export function applyNavigationGuards(
  webContents: WebContents,
  allowedOrigins: readonly string[],
  logger: Logger = noopLogger
): void {
  webContents.setWindowOpenHandler(details => {
    logger.warn('denying window.open: a kiosk window never opens a second window', {
      url: details.url,
    });
    return { action: 'deny' };
  });

  webContents.on('will-navigate', event => {
    if (!isNavigationAllowed(allowedOrigins, event.url)) {
      logger.warn('denying navigation to a disallowed origin', { url: event.url });
      event.preventDefault();
    }
  });

  webContents.on('will-redirect', event => {
    if (!isNavigationAllowed(allowedOrigins, event.url)) {
      logger.warn('denying redirect to a disallowed origin', { url: event.url });
      event.preventDefault();
    }
  });
}

/**
 * OPTIONAL, opt-in `webRequest` filter that denies any request -- including
 * sub-resource loads -- whose origin is not in `allowedOrigins`. Nothing in
 * this module calls it; a consumer (T3.4) must invoke it deliberately per
 * session.
 *
 * Why opt-in rather than wired by default: `onBeforeRequest` fires for
 * every request a page makes, including cross-origin-by-host loads a
 * legitimate remote page commonly and correctly depends on -- a CDN-hosted
 * script, a webfont host, an analytics beacon. Denying all of those by
 * default turns an incomplete-but-otherwise-fine allow-list (one that
 * lists the page's own origin but not its CDN) into a blank or
 * half-rendered kiosk with no on-screen error and no obvious cause -- the
 * exact "hard to diagnose at a venue" failure this project treats as
 * unacceptable. `applyPermissionHandlers` and `applyNavigationGuards`
 * already close the two hazards requirement 3 names (silent camera/mic
 * grants, top-level navigation hijack); this function is for a
 * deliberately stricter deployment -- e.g. a single-origin kiosk that
 * ships no external assets at all -- where a config author has confirmed
 * the allow-list is complete.
 */
export function applyWebRequestFilter(
  session: Session,
  allowedOrigins: readonly string[],
  logger: Logger = noopLogger
): void {
  session.webRequest.onBeforeRequest((details, callback) => {
    if (isNavigationAllowed(allowedOrigins, details.url)) {
      callback({});
      return;
    }

    logger.warn('denying sub-resource load from a disallowed origin', {
      url: details.url,
      resourceType: details.resourceType,
    });
    callback({ cancel: true });
  });
}

/**
 * Composes `hardenedWebPreferences()` with a preload script path into the
 * `webPreferences` slice of `BrowserWindowConstructorOptions`, for T3.1/
 * T3.4 to spread into their own window-construction options. Does not
 * create a window or know anything about placement -- that is T3.1's
 * concern (`src/shell/windows.ts`).
 */
export function createHardenedWindowOptions(
  preloadPath: string
): Pick<BrowserWindowConstructorOptions, 'webPreferences'> {
  return {
    webPreferences: {
      ...hardenedWebPreferences(),
      preload: preloadPath,
    },
  };
}
