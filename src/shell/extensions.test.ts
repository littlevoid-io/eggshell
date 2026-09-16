import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extensionDirectories } from './extensions.js';

const appDir = path.resolve('/apps/mural');

describe('extensionDirectories', () => {
  it('resolves configured paths against appDir', () => {
    const directories = extensionDirectories(
      { enabled: true, paths: ['extensions/devtools', path.resolve('/abs/ext')] },
      appDir
    );
    expect(directories).toEqual([
      path.join(appDir, 'extensions', 'devtools'),
      path.resolve('/abs/ext'),
    ]);
  });

  it('loads nothing when disabled', () => {
    expect(extensionDirectories({ enabled: false, paths: ['x'] }, appDir)).toEqual([]);
  });
});
