/**
 * Permission + hardening policy (T2.11).
 *
 * Pure decision logic for two of the shell's security surfaces: Electron's
 * permission-request/-check handlers, and the `will-navigate` guard. Nothing
 * here talks to Electron or Node — this file sits in the pure layer (I9) so
 * it is fully unit-testable, and T3.2 wires these functions directly into
 * `session.setPermissionRequestHandler`, `session.setPermissionCheckHandler`,
 * and a `will-navigate` listener.
 *
 * Why this exists (requirement 3): the predecessor granted media/camera
 * permissions **globally, to every origin including remote third-party
 * URLs, before any config was even read**. A kiosk that loads a remote page
 * could therefore silently access the camera and microphone of a machine
 * sitting in a public venue. `evaluatePermission` replaces that with
 * default-deny, per-origin, per-permission allow-listing (I3): the schema
 * pins `policy.default` to the literal `'deny'`, so there is no
 * allow-everything mode to implement here.
 *
 * ---------------------------------------------------------------------
 * Origin normalisation rules (decided and documented here; every matcher
 * in this file goes through `parseOrigin` so the rules apply uniformly):
 *
 * - Comparison is on the **parsed** origin — scheme + host + port — never
 *   on the raw string. `https://evil-example.com` must not match an allow
 *   entry for `https://example.com` (it doesn't share a host), and
 *   `https://example.com.attacker.net` must not either (different host,
 *   `example.com` is only a suffix of it). A substring/`startsWith`/
 *   `includes` check would get both of these wrong, which is exactly the
 *   hazard this module exists to close.
 * - Scheme is compared exactly and case-insensitively (`HTTPS://` ==
 *   `https://`). `http://example.com` does NOT match an allow entry for
 *   `https://example.com` — scheme is part of the identity of an origin,
 *   and silently upgrading/ignoring it would let a MITM'd or downgraded
 *   plain-HTTP load inherit an HTTPS origin's grants.
 * - Host is compared case-insensitively (`EXAMPLE.com` == `example.com`),
 *   matching how the URL spec and browsers already normalise hostnames.
 * - Port: an explicit port is compared exactly, except that an omitted
 *   port is treated as the scheme's default port (`https:` -> 443,
 *   `http:` -> 80), so `https://example.com` and `https://example.com:443`
 *   are the same origin. `https://example.com:8443` does NOT match
 *   `https://example.com` (443 != 8443). This mirrors `URL`'s own
 *   normalisation, which already drops a default port from `.port`.
 * - Trailing slash / path / query / hash are irrelevant to origin identity
 *   and are discarded by construction — `parseOrigin` only ever reads
 *   `protocol`, `hostname`, and the resolved port off the parsed `URL`.
 * - Opaque origins deny by default. `about:blank` and any other
 *   non-hierarchical scheme without a host is treated as opaque:
 *   `parseOrigin` returns `null` for it (an `about:` URL has no
 *   `hostname`), which every matcher below treats as "cannot match, so
 *   deny". This is deliberate — an opaque origin has no stable identity to
 *   grant permissions to.
 * - `file://` URLs parse with an empty `hostname`. That also normalises to
 *   `null` here (no host to compare), so `file://` origins deny by
 *   default too, and can only be reached by an allow entry that itself
 *   parses to a non-null origin — which a bare `file://` entry with no
 *   host never will. This is intentional: a kiosk's allow-list is written
 *   in terms of remote origins the config author controls, not the local
 *   filesystem.
 * - Malformed/unparseable input (`''`, `'not a url'`, `'://'`, ...) must
 *   never throw inside an Electron permission handler — a throw there is
 *   worse than a denial, since it can crash the handler invocation.
 *   `parseOrigin` wraps `new URL(...)` in try/catch and returns `null` on
 *   failure; every caller treats `null` as "deny".
 *
 * Wildcard subdomains: an allow entry's `origin` may be written as
 * `*.example.com` (scheme + explicit port are not part of the wildcard
 * form; the match is host-only and requires the request to be secure-origin
 * agnostic only insofar as the allow entry's own scheme still applies via
 * the same `scheme://*.host` shape, e.g. `https://*.example.com`). Such an
 * entry matches any single-label-or-deeper strict subdomain
 * (`https://a.example.com`, `https://a.b.example.com`) but NOT the bare
 * parent (`https://example.com` itself needs its own explicit entry) and
 * NOT a lookalike suffix (`https://a.example.com.evil.net` — the wildcard
 * anchors to the end of the hostname with a literal dot before the
 * suffix, not a raw string suffix match). A bare `*` as an origin entry
 * (or as the wildcard's host portion, e.g. `https://*`) is rejected: it is
 * ignored by the matcher (never expanded to "any host"), because silently
 * treating a config typo as allow-everything is the same class of bug this
 * module was written to close.
 * ---------------------------------------------------------------------
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
