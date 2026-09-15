/**
 * Permission + hardening policy: pure decision logic for Electron's
 * permission-request/-check handlers and the `will-navigate` guard. Nothing
 * here touches Electron or Node (pure layer, I9) -- fully unit-testable.
 * Default-deny, per-origin, per-permission allow-listing; there is no
 * allow-everything mode.
 *
 * Origin comparison rules (every matcher goes through `parseOrigin`):
 * - Compared on the PARSED origin (scheme + host + port), never the raw
 *   string -- a substring/startsWith/includes check would wrongly match
 *   `https://example.com.attacker.net` or `https://evil-example.com`.
 * - Scheme compared exactly, case-insensitively; `http://` never matches an
 *   `https://` allow entry (silently upgrading it would let a MITM'd or
 *   downgraded load inherit HTTPS-origin grants).
 * - Host compared case-insensitively, matching URL-spec normalization.
 * - Port compared exactly, except an omitted port is treated as the
 *   scheme's default (443/80), matching `URL`'s own normalization.
 * - Path/query/hash/trailing-slash are irrelevant to origin identity.
 * - Opaque origins (`about:blank`, `file://` with no host) parse to `null`
 *   and always deny -- no stable identity to grant permissions to.
 * - Malformed input (`''`, `'not a url'`) never throws -- `parseOrigin`
 *   catches and returns `null`; every caller treats `null` as deny. A throw
 *   inside an Electron permission handler is worse than a denial.
 * - Wildcard subdomains (`*.example.com`) match any strict subdomain but
 *   never the bare parent and never a lookalike suffix
 *   (`a.example.com.evil.net`) -- the wildcard anchors to the end of the
 *   hostname with a literal dot before the suffix. A bare `*` origin entry
 *   is rejected, never expanded to "any host".
 */

import type { PermissionPolicy } from '../config/types.js';

/** A parsed, comparable origin. Never constructed for an opaque origin. */
interface ParsedOrigin {
  readonly scheme: string;
  readonly host: string;
  readonly port: string;
}

const DEFAULT_PORT_BY_SCHEME: Record<string, string> = {
  'https:': '443',
  'http:': '80',
};

/**
 * Parses a URL/origin string into a comparable `{scheme, host, port}`.
 * Returns `null` for anything that does not parse, or that parses without a
 * usable host (opaque origins such as `about:blank`, or `file://` URLs,
 * which have an empty `hostname`). Never throws — callers in an Electron
 * permission handler must never see an exception from this module.
 */
function parseOrigin(value: string): ParsedOrigin | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.hostname === '') {
    return null;
  }

  const scheme = url.protocol.toLowerCase();
  const port = url.port !== '' ? url.port : (DEFAULT_PORT_BY_SCHEME[scheme] ?? '');

  return { scheme, host: url.hostname.toLowerCase(), port };
}

function sameOrigin(a: ParsedOrigin, b: ParsedOrigin): boolean {
  return a.scheme === b.scheme && a.host === b.host && a.port === b.port;
}

/**
 * True if `entryHost` is a `*.`-prefixed wildcard host with a non-empty
 * suffix, and `requestHost` is a strict subdomain of that suffix. Anchors
 * on a literal leading dot before the suffix, so
 * `a.example.com.evil.net` (a lookalike, not a subdomain) never matches
 * `*.example.com`.
 */
function matchesWildcardHost(entryHost: string, requestHost: string): boolean {
  if (!entryHost.startsWith('*.')) {
    return false;
  }
  const suffix = entryHost.slice(2);
  return suffix !== '' && requestHost.endsWith(`.${suffix}`);
}

/**
 * True if `allowedEntry` (a raw origin string from config, possibly a
 * `scheme://*.host` wildcard form) grants access to `requestOrigin`
 * (already parsed). A bare `*` entry is rejected outright rather than
 * expanded to "any origin" — see the wildcard-decision note in the module
 * doc. Reuses `parseOrigin` for the entry too: `URL` parses a `*.`-prefixed
 * hostname as a literal string, which is all the wildcard match needs.
 */
function originMatchesEntry(allowedEntry: string, requestOrigin: ParsedOrigin): boolean {
  if (allowedEntry === '*') {
    return false;
  }

  const parsedEntry = parseOrigin(allowedEntry);
  if (parsedEntry === null) {
    return false;
  }

  if (parsedEntry.host.startsWith('*.')) {
    return (
      requestOrigin.scheme === parsedEntry.scheme &&
      requestOrigin.port === parsedEntry.port &&
      matchesWildcardHost(parsedEntry.host, requestOrigin.host)
    );
  }

  return sameOrigin(parsedEntry, requestOrigin);
}

export interface PermissionRequest {
  readonly origin: string;
  readonly permission: string;
}

/**
 * Default-deny permission decision. Grants `request.permission` only if
 * `policy.allow` contains an entry whose `origin` matches `request.origin`
 * (exact origin, or wildcard-subdomain form — see module doc) AND whose
 * `permissions` list contains `request.permission` exactly. Listing
 * `camera` for an origin never implies `microphone`.
 *
 * A malformed/unparseable `request.origin` denies rather than throwing —
 * see the module doc's note on `parseOrigin`.
 */
export function evaluatePermission(
  policy: PermissionPolicy,
  request: PermissionRequest
): 'allow' | 'deny' {
  const requestOrigin = parseOrigin(request.origin);
  if (requestOrigin === null) {
    return 'deny';
  }

  const matchingEntry = policy.allow.find(entry => originMatchesEntry(entry.origin, requestOrigin));
  if (matchingEntry === undefined) {
    return 'deny';
  }

  return matchingEntry.permissions.includes(request.permission) ? 'allow' : 'deny';
}

/**
 * Baseline `BrowserWindow` `webPreferences` for a kiosk that loads
 * untrusted remote content. Typed as a plain object literal — not
 * Electron's `WebPreferences` — so this file stays Electron-free; T3.2
 * spreads this into the real `webPreferences` object.
 */
export function hardenedWebPreferences(): {
  contextIsolation: boolean;
  nodeIntegration: boolean;
  nodeIntegrationInSubFrames: boolean;
  sandbox: boolean;
  webSecurity: boolean;
  allowRunningInsecureContent: boolean;
  experimentalFeatures: boolean;
} {
  return {
    // Keeps preload/main-world JS out of reach of page scripts; without
    // this, a compromised remote page can reach Node/Electron internals
    // through the shared prototype chain.
    contextIsolation: true,
    // Denies `require`/Node globals inside the renderer entirely — the
    // single biggest RCE surface for a window that loads remote content.
    nodeIntegration: false,
    // Closes the same hole for iframes embedded by the top-level page,
    // which `nodeIntegration: false` alone does not cover.
    nodeIntegrationInSubFrames: false,
    // Runs the renderer inside Chromium's OS-level sandbox, containing a
    // renderer-process exploit instead of letting it touch the host.
    sandbox: true,
    // Keeps mixed-content and cert-validity checks on; a kiosk showing a
    // public-facing page must not silently downgrade transport security.
    webSecurity: true,
    // Refuses HTTP subresources on an HTTPS page rather than mixing them
    // in, which is what `webSecurity` governs for passive content.
    allowRunningInsecureContent: false,
    // Keeps unshipped/experimental Chromium features off, since they are
    // not vetted for a kiosk exposed to arbitrary remote content.
    experimentalFeatures: false,
  };
}

/**
 * Default-deny navigation guard for `will-navigate`. Allows `url` only if
 * its origin exactly matches (or wildcard-matches) one of `allowedOrigins`
 * — the same strict comparison as `evaluatePermission`, so a compromised or
 * redirecting remote page cannot carry the kiosk to an arbitrary origin.
 * Malformed `url` denies rather than throwing.
 */
export function isNavigationAllowed(allowedOrigins: readonly string[], url: string): boolean {
  const targetOrigin = parseOrigin(url);
  if (targetOrigin === null) {
    return false;
  }

  return allowedOrigins.some(entry => originMatchesEntry(entry, targetOrigin));
}
