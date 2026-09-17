import { describe, expect, it } from 'vitest';
import { isValidHttpUrl } from './open-url.js';

describe('isValidHttpUrl', () => {
  it('accepts valid http and https URLs', () => {
    expect(isValidHttpUrl('http://localhost:3005')).toBe(true);
    expect(isValidHttpUrl('https://example.com/path?foo=bar')).toBe(true);
    expect(isValidHttpUrl('http://192.168.1.50:3005/#/settings')).toBe(true);
  });

  it('rejects non-http protocols and malformed strings', () => {
    expect(isValidHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isValidHttpUrl('data:text/html,test')).toBe(false);
    expect(isValidHttpUrl('not-a-url')).toBe(false);
    expect(isValidHttpUrl('')).toBe(false);
  });
});
