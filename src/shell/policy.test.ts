import { describe, it, expect } from 'vitest';
import { evaluatePermission, hardenedWebPreferences, isNavigationAllowed } from './policy.js';
import type { PermissionPolicy } from '../config/types.js';

/**
 * Fixture factory. Defaults describe a default-deny policy with no allow
 * entries; tests override `allow` for the case under test.
 */
function buildPolicy(allow: PermissionPolicy['allow'] = []): PermissionPolicy {
  return { default: 'deny', allow };
}

describe('evaluatePermission', () => {
  it('denies a permission for an origin absent from the allow list (default deny)', () => {
    const policy = buildPolicy([{ origin: 'https://example.com', permissions: ['camera'] }]);

    expect(evaluatePermission(policy, { origin: 'https://other.com', permission: 'camera' })).toBe(
      'deny'
    );
  });

  it('grants only the listed permission for an allowed origin; a sibling permission is denied', () => {
    const policy = buildPolicy([{ origin: 'https://example.com', permissions: ['camera'] }]);

    expect(
      evaluatePermission(policy, { origin: 'https://example.com', permission: 'camera' })
    ).toBe('allow');
    expect(
      evaluatePermission(policy, { origin: 'https://example.com', permission: 'microphone' })
    ).toBe('deny');
  });

  it('substring-match regression: https://evil-example.com does not match an allow entry for https://example.com', () => {
    const policy = buildPolicy([{ origin: 'https://example.com', permissions: ['camera'] }]);

    expect(
      evaluatePermission(policy, { origin: 'https://evil-example.com', permission: 'camera' })
    ).toBe('deny');
  });

  it('does not match a lookalike suffix: https://example.com.attacker.net does not match https://example.com', () => {
    const policy = buildPolicy([{ origin: 'https://example.com', permissions: ['camera'] }]);

    expect(
      evaluatePermission(policy, {
        origin: 'https://example.com.attacker.net',
        permission: 'camera',
      })
    ).toBe('deny');
  });

  it('denies on scheme mismatch: http://example.com does not match an allow entry for https://example.com', () => {
    const policy = buildPolicy([{ origin: 'https://example.com', permissions: ['camera'] }]);

    expect(evaluatePermission(policy, { origin: 'http://example.com', permission: 'camera' })).toBe(
      'deny'
    );
  });

  it('denies on port mismatch: https://example.com:8443 does not match https://example.com', () => {
    const policy = buildPolicy([{ origin: 'https://example.com', permissions: ['camera'] }]);

    expect(
      evaluatePermission(policy, { origin: 'https://example.com:8443', permission: 'camera' })
    ).toBe('deny');
  });

  it('host comparison is case-insensitive', () => {
    const policy = buildPolicy([{ origin: 'https://example.com', permissions: ['camera'] }]);

    expect(
      evaluatePermission(policy, { origin: 'https://EXAMPLE.com', permission: 'camera' })
    ).toBe('allow');
  });

  it('treats an omitted port as the scheme default: https://example.com and https://example.com:443 are the same origin', () => {
    const policy = buildPolicy([{ origin: 'https://example.com:443', permissions: ['camera'] }]);

    expect(
      evaluatePermission(policy, { origin: 'https://example.com', permission: 'camera' })
    ).toBe('allow');
  });

  it('denies malformed origins without throwing', () => {
    const policy = buildPolicy([{ origin: 'https://example.com', permissions: ['camera'] }]);

    for (const origin of ['', 'not a url', '://', 'null']) {
      expect(() => evaluatePermission(policy, { origin, permission: 'camera' })).not.toThrow();
      expect(evaluatePermission(policy, { origin, permission: 'camera' })).toBe('deny');
    }
  });

  it('denies file:// and about:blank by default (opaque/hostless origins)', () => {
    const policy = buildPolicy([
      { origin: 'https://example.com', permissions: ['camera'] },
      { origin: 'file:///C:/kiosk/index.html', permissions: ['camera'] },
    ]);

    expect(evaluatePermission(policy, { origin: 'about:blank', permission: 'camera' })).toBe(
      'deny'
    );
    expect(
      evaluatePermission(policy, {
        origin: 'file:///C:/kiosk/index.html',
        permission: 'camera',
      })
    ).toBe('deny');
  });

  it('denies everything when the allow array is empty', () => {
    const policy = buildPolicy([]);

    expect(
      evaluatePermission(policy, { origin: 'https://example.com', permission: 'camera' })
    ).toBe('deny');
  });

  describe('wildcard subdomains', () => {
    it('*.example.com matches a subdomain but not the bare parent origin', () => {
      const policy = buildPolicy([{ origin: 'https://*.example.com', permissions: ['camera'] }]);

      expect(
        evaluatePermission(policy, { origin: 'https://a.example.com', permission: 'camera' })
      ).toBe('allow');
      expect(
        evaluatePermission(policy, { origin: 'https://example.com', permission: 'camera' })
      ).toBe('deny');
    });

    it('*.example.com does not match a lookalike suffix domain', () => {
      const policy = buildPolicy([{ origin: 'https://*.example.com', permissions: ['camera'] }]);

      expect(
        evaluatePermission(policy, {
          origin: 'https://a.example.com.evil.net',
          permission: 'camera',
        })
      ).toBe('deny');
    });

    it('a bare "*" origin entry is ignored, not treated as allow-everything', () => {
      const policy = buildPolicy([{ origin: '*', permissions: ['camera'] }]);

      expect(
        evaluatePermission(policy, { origin: 'https://example.com', permission: 'camera' })
      ).toBe('deny');
    });
  });
});

describe('hardenedWebPreferences', () => {
  it('returns the non-negotiable baseline flags (regression test)', () => {
    const preferences = hardenedWebPreferences();

    expect(preferences.contextIsolation).toBe(true);
    expect(preferences.nodeIntegration).toBe(false);
    expect(preferences.sandbox).toBe(true);
    expect(preferences.webSecurity).toBe(true);
  });
});

describe('isNavigationAllowed', () => {
  const allowedOrigins = ['https://example.com'];

  it('allows navigation to a listed origin', () => {
    expect(isNavigationAllowed(allowedOrigins, 'https://example.com/page')).toBe(true);
  });

  it('denies navigation to an unlisted origin', () => {
    expect(isNavigationAllowed(allowedOrigins, 'https://other.com')).toBe(false);
  });

  it('denies navigation to a lookalike origin', () => {
    expect(isNavigationAllowed(allowedOrigins, 'https://evil-example.com')).toBe(false);
    expect(isNavigationAllowed(allowedOrigins, 'https://example.com.attacker.net')).toBe(false);
  });

  it('denies malformed navigation targets without throwing', () => {
    expect(() => isNavigationAllowed(allowedOrigins, 'not a url')).not.toThrow();
    expect(isNavigationAllowed(allowedOrigins, 'not a url')).toBe(false);
  });
});
