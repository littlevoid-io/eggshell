/**
 * Architectural test for I5: this deliberately duplicates the ESLint import
 * zone (see eslint.config.mjs) by reading the plugin-api source files
 * directly and asserting on their import statements, so the invariant is
 * caught even if a future edit to this module slips past a lint config
 * change or a disabled rule.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_FILES = ['types.ts', 'context.ts', 'registry.ts', 'index.ts'];
const FORBIDDEN_SPECIFIER_PATTERNS = [/plugins\//, /layout\//, /process\//, /[/\\]shell[/\\]/];

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importRegex = /(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(importRegex)) {
    const specifier = match[1];
    if (specifier) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
}

describe('plugin-api import boundary (I5)', () => {
  it.each(SOURCE_FILES)('%s imports nothing from src/plugins, src/layout, or src/process', file => {
    const source = readFileSync(path.join(moduleDir, file), 'utf8');
    const specifiers = importSpecifiers(source);

    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      for (const pattern of FORBIDDEN_SPECIFIER_PATTERNS) {
        expect(specifier).not.toMatch(pattern);
      }
    }
  });

  it('only imports config types, errors, logging, and paths (plus its own sibling files)', () => {
    const allowedExternalPrefixes = ['../config/', '../errors.js', '../logging/', '../paths/'];
    for (const file of SOURCE_FILES) {
      const source = readFileSync(path.join(moduleDir, file), 'utf8');
      for (const specifier of importSpecifiers(source)) {
        const isSibling = specifier.startsWith('./');
        const isAllowedExternal = allowedExternalPrefixes.some(prefix =>
          specifier.startsWith(prefix)
        );
        expect(
          isSibling || isAllowedExternal,
          `${file} has an unexpected import: ${specifier}`
        ).toBe(true);
      }
    }
  });
});
