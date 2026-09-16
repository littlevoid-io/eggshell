// @ts-check
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';

// Rules are named after docs/architecture.md#rules. Everything else is baseline lint.

const PURE_CORE_FILES = ['src/layout/resolve.ts', 'src/layout/signature.ts'];

const cliExits = {
  selector: "CallExpression[callee.object.name='process'][callee.property.name=/^(exit|abort)$/]",
  message: 'cli-exits: only src/cli/bin.ts may exit. Throw an error instead.',
};

const argvSpawn = [
  {
    selector: ":matches(Property[key.name='shell'], Property[key.value='shell'])",
    message: 'argv-spawn: no `shell` option anywhere. Spawn with execa and an argv array.',
  },
  {
    selector:
      'CallExpression[callee.object.name=/^(child_process|childProcess|cp)$/][callee.property.name=/^(exec|execSync)$/]',
    message: 'argv-spawn: exec/execSync run through a shell. Use execa with an argv array.',
  },
];

const argvSpawnImports = {
  paths: ['child_process', 'node:child_process'].map(name => ({
    name,
    importNames: ['exec', 'execSync'],
    message: 'argv-spawn: exec/execSync run through a shell. Use execa with an argv array.',
  })),
};

const pureCoreMessage = 'pure-core: placement is a pure function. No I/O, no Electron, no await.';
const pureCore = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']
  .map(type => ({ selector: `${type}[async=true]`, message: pureCoreMessage }))
  .concat({ selector: 'AwaitExpression', message: pureCoreMessage });

const sizeLimits = {
  'max-lines': ['warn', { max: 150, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': ['warn', { max: 20, skipBlankLines: true, skipComments: true }],
  'max-depth': ['warn', 3],
};

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'release/**', 'ui/**'] },

  // Root tooling files: no tsconfig project.
  {
    files: ['*.mjs', '*.ts'],
    extends: [tseslint.configs.recommended],
    languageOptions: { parserOptions: { projectService: false } },
  },

  // Baseline for src.
  {
    files: ['src/**/*.ts', 'src/**/*.cts'],
    extends: [tseslint.configs.recommended, importX.flatConfigs.recommended],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver()],
      'import-x/extensions': ['.ts', '.tsx', '.js', '.mjs', '.cjs'],
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      'import-x/no-cycle': 'error',
      'no-console': 'error',
      'no-restricted-syntax': ['error', cliExits, ...argvSpawn],
      'no-restricted-imports': ['error', argvSpawnImports],
      ...sizeLimits,
    },
  },

  // The sandboxed preload ships as CommonJS.
  {
    files: ['src/**/*.cts'],
    rules: { '@typescript-eslint/no-require-imports': ['error', { allowAsImport: true }] },
  },

  // cli-exits: the one file allowed to exit.
  {
    files: ['src/cli/bin.ts'],
    rules: { 'no-restricted-syntax': ['error', ...argvSpawn] },
  },

  // pure-core.
  {
    files: PURE_CORE_FILES,
    rules: {
      'no-restricted-syntax': ['error', cliExits, ...argvSpawn, ...pureCore],
      'no-restricted-imports': [
        'error',
        {
          ...argvSpawnImports,
          patterns: [{ group: ['node:*', 'electron'], message: pureCoreMessage }],
        },
      ],
    },
  },

  // Tests and the console sink may write to the console; tests are exempt from size limits.
  {
    files: ['src/**/*.test.ts', 'src/logging/console-logger.ts'],
    rules: {
      'no-console': 'off',
      'max-lines': 'off',
      'max-lines-per-function': 'off',
    },
  }
);
