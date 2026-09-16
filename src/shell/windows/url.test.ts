import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toWindowUrl } from './url.js';

const appDir = path.resolve('C:/apps/mural');

describe('toWindowUrl', () => {
  it('passes URLs with a scheme through', () => {
    expect(toWindowUrl('http://localhost:3000/', appDir)).toBe('http://localhost:3000/');
    expect(toWindowUrl('file:///C:/x/index.html', appDir)).toBe('file:///C:/x/index.html');
  });

  it('turns a relative path into a file URL under appDir', () => {
    expect(toWindowUrl('public/index.html', appDir)).toBe(
      pathToFileURL(path.join(appDir, 'public', 'index.html')).href
    );
  });
});
