import { z } from 'zod';

export const nonEmptyString = (label: string) => z.string().min(1, `${label} must not be empty`);

export const positiveInt = (label: string): z.ZodNumber =>
  z.number().int(`${label} must be an integer`).positive(`${label} must be a positive number`);

export const positiveIntMs = (label: string): z.ZodNumber =>
  z
    .number()
    .int(`${label} must be an integer number of milliseconds`)
    .positive(`${label} must be a positive number of milliseconds`);

export const portNumber = (label: string) =>
  z
    .number()
    .int(`${label} must be an integer`)
    .min(1, `${label} must be between 1 and 65535`)
    .max(65535, `${label} must be between 1 and 65535`);

/** Reverse-DNS: two or more dot-separated lowercase alphanumeric segments with interior hyphens. */
export const APP_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
export const APP_ID_MESSAGE =
  'appId must be reverse-DNS style, e.g. "com.example.my-kiosk": two or more ' +
  'dot-separated segments, each lowercase letters/digits with interior hyphens ' +
  'only (no leading/trailing dot or hyphen, no uppercase, no underscore)';

export const boundsSchema = z
  .object({
    x: z.number().int('bounds.x must be an integer'),
    y: z.number().int('bounds.y must be an integer'),
    width: z
      .number()
      .int('bounds.width must be an integer')
      .positive('bounds.width must be positive'),
    height: z
      .number()
      .int('bounds.height must be an integer')
      .positive('bounds.height must be positive'),
  })
  .strict();

/** A section that is on unless the consumer turns it off. */
export const enabledByDefault = z.boolean().default(true);
/** A section that stays off until the consumer turns it on. */
export const disabledByDefault = z.boolean().default(false);

/** Parses `{}` through `schema` so nested defaults cascade instead of being hand-copied. */
export const defaultsOf = <T extends z.ZodTypeAny>(schema: T): z.output<T> => schema.parse({});
