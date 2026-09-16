import type { z } from 'zod';
import type { shellConfigSchema } from './schema/index.js';

/** What `eggshell.config.ts` receives. */
export interface ConfigContext {
  /** Directory containing `eggshell.config.ts`. */
  readonly appDir: string;
  readonly isDev: boolean;
  readonly platform: NodeJS.Platform;
}

/** The consumer-authored shape: defaults not yet applied. */
export type ConfigInput = z.input<typeof shellConfigSchema>;

export type ConfigFactory = (context: ConfigContext) => ConfigInput | Promise<ConfigInput>;

/** Identity helper that types the factory in `eggshell.config.ts`. */
export function defineConfig(factory: ConfigFactory): ConfigFactory {
  return factory;
}
