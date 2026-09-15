// @ts-check
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';

const PLUGIN_IMPORT_MESSAGE =
  'Core must not import a plugin; plugins register into ShellContext (I5).';
const PLUGIN_IMPORT_GROUP = [
  '**/plugins/**',
  './plugins/*',
  './plugins/**',
  '../plugins/*',
  '../plugins/**',
  '../../plugins/*',
  '../../plugins/**',
];

const PLUGIN_ZONE_MESSAGE =
  'Plugins may only depend on the plugin-api seam (I5): plugin-api, config, errors, logging. Core internals are off-limits.';
const PLUGIN_ELECTRON_MESSAGE =
  'Plugins may not import electron directly (I5b) -- reach Electron only through the ShellContext seam (windows, views, ...). The two narrow, deliberate exceptions are src/plugins/offline/probe.ts (net.isOnline(), no non-Electron equivalent) and src/plugins/soak/** (a fuzz-testing plugin that needs broad Electron access by design). import type is always allowed -- it carries no runtime capability.';

const SHELL_SPAWN_MESSAGE =
  'Child processes must never spawn through a shell (I2). Use an argv array via spawn/execFile, never a joined command string.';
const BROAD_SHELL_PROPERTY_MESSAGE =
  'No object literal may have a `shell` property (I2). `args` must be an argv array, never a joined command string, and process spawning must never enable a shell. This rule is intentionally blunt — it bans `shell` on any object literal anywhere, not just as a direct argument to a spawn call — because the narrower spawn-call-site selector was bypassable via an aliased import or by building the options object in a variable before passing it in.';
const EXEC_MESSAGE =
  'exec/execSync are shell-based by construction (I2). Use an argv array via spawn/execFile, never a joined command string.';
const EXIT_MESSAGE =
  'process.exit/process.abort is forbidden in library code (I6); only src/cli/bin.ts may exit. Throw an error instead.';
const CWD_MESSAGE =
  'process.cwd() is forbidden outside src/cli/** (I1). All roots are explicit inputs — see paths/roots.ts.';
const ENV_MESSAGE =
  'process.env is forbidden in src/config/**. Config comes from the consumer object plus one explicit override file, never environment variables.';
const PURE_LAYER_IO_MESSAGE =
  'This file is part of the pure layer (I9): zero I/O, no Node builtins.';
const PURE_LAYER_ASYNC_MESSAGE =
  'This file is part of the pure layer (I9): zero I/O, zero `await`. No async functions.';

const EXIT_SELECTOR = {
  selector:
    "CallExpression[callee.type='MemberExpression'][callee.object.name='process'][callee.property.name=/^(exit|abort)$/]",
  message: EXIT_MESSAGE,
};
const SHELL_PROPERTY_SELECTOR = {
  selector:
    ":matches(CallExpression[callee.name=/^(spawn|spawnSync|fork)$/], CallExpression[callee.property.name=/^(spawn|spawnSync|fork)$/]) > ObjectExpression > Property[key.name='shell']",
  message: SHELL_SPAWN_MESSAGE,
};
// Broad, deliberately blunt backstop for I2: bans a `shell` property on ANY
// object literal, regardless of whether/how it reaches a spawn call. Closes
// two proven bypasses of SHELL_PROPERTY_SELECTOR above: (1) importing spawn
// under an alias, since that selector only matches the literal callee names
// spawn/spawnSync/fork; (2) building the options object in a variable and
// passing the variable in, since that selector requires the ObjectExpression
// to be a direct child of the CallExpression. Kept alongside the narrower
// selector, which still fires first with a more specific message when it
// matches the direct-literal case.
const BROAD_SHELL_PROPERTY_SELECTOR = {
  selector: ":matches(Property[key.name='shell'], Property[key.value='shell'])",
  message: BROAD_SHELL_PROPERTY_MESSAGE,
};
const EXEC_MEMBER_SELECTOR = {
  selector:
    "CallExpression[callee.type='MemberExpression'][callee.object.name=/^(child_process|childProcess|cp)$/][callee.property.name=/^(exec|execSync)$/]",
  message: EXEC_MESSAGE,
};
const CWD_SELECTOR = {
  selector:
    "CallExpression[callee.type='MemberExpression'][callee.object.name='process'][callee.property.name='cwd']",
  message: CWD_MESSAGE,
};
const ENV_SELECTOR = {
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message: ENV_MESSAGE,
};
const PURE_LAYER_ASYNC_SELECTORS = [
  { selector: 'FunctionDeclaration[async=true]', message: PURE_LAYER_ASYNC_MESSAGE },
  { selector: 'FunctionExpression[async=true]', message: PURE_LAYER_ASYNC_MESSAGE },
  { selector: 'ArrowFunctionExpression[async=true]', message: PURE_LAYER_ASYNC_MESSAGE },
  { selector: 'AwaitExpression', message: PURE_LAYER_ASYNC_MESSAGE },
];

const EXEC_IMPORT_RESTRICTION = {
  paths: [
    { name: 'child_process', importNames: ['exec', 'execSync'], message: EXEC_MESSAGE },
    { name: 'node:child_process', importNames: ['exec', 'execSync'], message: EXEC_MESSAGE },
  ],
};

const PURE_LAYER_FILES = [
  'src/layout/resolve.ts',
  'src/layout/signature.ts',
  'src/shell/policy.ts',
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.vitest/**', 'release/**'],
  },

  // Root-level config/tooling files: lint as TypeScript/ESM but outside the
  // tsconfig project (they are not part of src's program) and outside all
  // src-specific architectural zones.
  {
    files: ['*.mjs', '*.ts'],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
  },

  // Baseline for all package source: typescript-eslint recommended + type-aware
  // no-floating-promises, import-x recommended, no-cycle, no-console.
  {
    files: ['src/**/*.ts'],
    extends: [tseslint.configs.recommended, importX.flatConfigs.recommended],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      // Resolves nodenext-style relative ".js" specifiers to their ".ts" sources.
      'import-x/resolver-next': [createTypeScriptImportResolver()],
      // import-x defaults to ['.js', '.mjs', '.cjs'] and silently ignores
      // ".ts" files otherwise, which would make import-x/no-cycle a no-op.
      'import-x/extensions': ['.ts', '.tsx', '.js', '.mjs', '.cjs'],
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      'import-x/no-cycle': 'error',
      'no-console': 'error',
    },
  },

  // I1/I2/I6 base: process.exit/abort, shell spawn options, exec member calls,
  // process.cwd() — applies to all of src/** by default.
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        EXIT_SELECTOR,
        SHELL_PROPERTY_SELECTOR,
        BROAD_SHELL_PROPERTY_SELECTOR,
        EXEC_MEMBER_SELECTOR,
        CWD_SELECTOR,
      ],
      'no-restricted-imports': ['error', EXEC_IMPORT_RESTRICTION],
    },
  },

  // I5a — nothing outside src/plugins/** may import a plugin.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/plugins/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          ...EXEC_IMPORT_RESTRICTION,
          patterns: [{ group: PLUGIN_IMPORT_GROUP, message: PLUGIN_IMPORT_MESSAGE }],
        },
      ],
    },
  },

  // I5b — src/plugins/** may only depend on the plugin-api seam.
  {
    files: ['src/plugins/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          ...EXEC_IMPORT_RESTRICTION,
          patterns: [
            {
              group: ['**/layout/**', '**/process/**', '**/shell/**', '**/build/**', '**/cli/**'],
              message: PLUGIN_ZONE_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  // I5b — plugins may not import electron directly; must use ShellContext (views, windows).
  {
    files: ['src/plugins/**/*.ts'],
    ignores: ['src/plugins/offline/probe.ts', 'src/plugins/offline/probe.test.ts', 'src/plugins/soak/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'electron', message: PLUGIN_ELECTRON_MESSAGE, allowTypeImports: true }],
        },
      ],
    },
  },

  // I1 exception — process.cwd() is the CLI's job.
  {
    files: ['src/cli/**/*.ts'],
    ignores: ['src/cli/bin.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        EXIT_SELECTOR,
        SHELL_PROPERTY_SELECTOR,
        BROAD_SHELL_PROPERTY_SELECTOR,
        EXEC_MEMBER_SELECTOR,
      ],
    },
  },

  // I6 exception — only src/cli/bin.ts may exit the process; it is also under
  // src/cli/**, so it keeps the I1 cwd exemption from the block above by not
  // re-adding the cwd selector here.
  {
    files: ['src/cli/bin.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        SHELL_PROPERTY_SELECTOR,
        BROAD_SHELL_PROPERTY_SELECTOR,
        EXEC_MEMBER_SELECTOR,
      ],
    },
  },

  // Config layer must not read the environment.
  {
    files: ['src/config/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        EXIT_SELECTOR,
        SHELL_PROPERTY_SELECTOR,
        BROAD_SHELL_PROPERTY_SELECTOR,
        EXEC_MEMBER_SELECTOR,
        CWD_SELECTOR,
        ENV_SELECTOR,
      ],
    },
  },

  // I9 — the pure layer is pure: zero I/O, zero `await`, plus the base I1/I2/I6
  // and I5a selectors it would otherwise inherit from the general src/** zone.
  {
    files: PURE_LAYER_FILES,
    rules: {
      'no-restricted-syntax': [
        'error',
        EXIT_SELECTOR,
        SHELL_PROPERTY_SELECTOR,
        BROAD_SHELL_PROPERTY_SELECTOR,
        EXEC_MEMBER_SELECTOR,
        CWD_SELECTOR,
        ...PURE_LAYER_ASYNC_SELECTORS,
      ],
      'no-restricted-imports': [
        'error',
        {
          ...EXEC_IMPORT_RESTRICTION,
          patterns: [
            { group: PLUGIN_IMPORT_GROUP, message: PLUGIN_IMPORT_MESSAGE },
            { group: ['node:*'], message: PURE_LAYER_IO_MESSAGE },
          ],
          paths: [
            ...EXEC_IMPORT_RESTRICTION.paths,
            { name: 'fs', message: PURE_LAYER_IO_MESSAGE },
            { name: 'path', message: PURE_LAYER_IO_MESSAGE },
            { name: 'child_process', message: PURE_LAYER_IO_MESSAGE },
            { name: 'net', message: PURE_LAYER_IO_MESSAGE },
            { name: 'http', message: PURE_LAYER_IO_MESSAGE },
            { name: 'os', message: PURE_LAYER_IO_MESSAGE },
          ],
        },
      ],
    },
  },

  // Test files: console output and Node builtins are fine there. The I5 plugin
  // zones and the I6 process.exit ban are deliberately NOT relaxed.
  {
    files: ['src/**/*.test.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // T1.6 — this file's entire purpose is writing to the console (the Logger
  // implementation backing `consoleLogger`), so it is the single legitimate
  // exception to the `no-console` ban above. Scoped to exactly this file, not
  // the whole `src/logging/` directory — core still logs only through the
  // injected `Logger` interface.
  {
    files: ['src/logging/console-logger.ts'],
    rules: {
      'no-console': 'off',
    },
  }
);
