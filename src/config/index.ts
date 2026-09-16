export * from './schema/index.js';
export type * from './types.js';
export { defineConfig } from './factory.js';
export type { ConfigContext, ConfigFactory, ConfigInput } from './factory.js';
export { validateConfig, formatIssuePath } from './validate.js';
export { DEFAULT_OVERRIDE_FILENAME, resolveOverridePath, loadShellConfig } from './overrides.js';
export type { LoadShellConfigOptions } from './overrides.js';
