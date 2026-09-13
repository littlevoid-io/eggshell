import { describe, it, expect } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('index', () => {
  it('exports PACKAGE_NAME', () => {
    expect(PACKAGE_NAME).toBe('eggshell');
  });
});
