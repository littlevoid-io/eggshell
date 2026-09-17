import { z } from 'zod';
import { boundsSchema, nonEmptyString } from './primitives.js';

export const displayTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('primary') }).strict(),
  z
    .object({
      kind: z.literal('index'),
      index: z
        .number()
        .int('target.index must be an integer')
        .nonnegative('target.index must be >= 0'),
    })
    .strict(),
  z.object({ kind: z.literal('role'), role: nonEmptyString('target.role') }).strict(),
  z.object({ kind: z.literal('matchLabel'), pattern: nonEmptyString('target.pattern') }).strict(),
  z.object({ kind: z.literal('spanAll') }).strict(),
]);

const backgroundColorSchema = z
  .string()
  .regex(
    /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
    'backgroundColor must be a hex color like "#000000", "#000", or "#000000ff"'
  );

export const windowConfigSchema = z
  .object({
    id: nonEmptyString('window.id'),
    url: nonEmptyString('window.url'),
    target: displayTargetSchema.default({ kind: 'primary' }),
    kiosk: z.boolean().default(true),
    fullscreen: z.boolean().default(false),
    borderless: z.boolean().default(false),
    autoHideMenuBar: z.boolean().default(true),
    bounds: boundsSchema.optional(),
    backgroundColor: backgroundColorSchema.optional(),
    /** Path relative to `appDir`. Falls back to the top-level `icon`. */
    icon: nonEmptyString('window.icon').optional(),
    zoomFactor: z
      .number()
      .positive('zoomFactor must be positive')
      .max(5, 'zoomFactor must be at most 5')
      .default(1),
    showWhenReady: z.boolean().default(true),
    required: z.boolean().default(false),
    fallback: z.enum(['primary', 'none', 'error']).default('primary'),
  })
  .strict();
