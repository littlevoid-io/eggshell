import { z } from 'zod';
import { defaultsOf, nonEmptyString, portNumber, positiveIntMs } from './primitives.js';

const readinessSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('tcp'), port: portNumber('readiness.port') }).strict(),
    z
      .object({
        kind: z.literal('http'),
        url: nonEmptyString('readiness.url'),
        expectStatus: z
          .number()
          .int('readiness.expectStatus must be an integer')
          .min(100, 'readiness.expectStatus must be a valid HTTP status code')
          .max(599, 'readiness.expectStatus must be a valid HTTP status code')
          .optional(),
      })
      .strict(),
    z.object({ kind: z.literal('log'), pattern: nonEmptyString('readiness.pattern') }).strict(),
    z.object({ kind: z.literal('delay'), ms: positiveIntMs('readiness.ms') }).strict(),
    z.object({ kind: z.literal('none') }).strict(),
  ])
  .default({ kind: 'none' });

const restartPolicySchema = z
  .object({
    policy: z.enum(['never', 'onCrash', 'always']).default('onCrash'),
    maxRestarts: z.number().int('restart.maxRestarts must be an integer').nonnegative().default(5),
    backoffMs: positiveIntMs('restart.backoffMs').default(500),
    backoffMultiplier: z.number().min(1, 'restart.backoffMultiplier must be >= 1').default(2),
    maxBackoffMs: positiveIntMs('restart.maxBackoffMs').default(30_000),
    resetAfterMs: positiveIntMs('restart.resetAfterMs').default(60_000),
  })
  .strict();

const shutdownPolicySchema = z
  .object({
    signal: nonEmptyString('shutdown.signal').default('SIGTERM'),
    graceMs: positiveIntMs('shutdown.graceMs').default(5000),
  })
  .strict();

export const processConfigSchema = z
  .object({
    id: nonEmptyString('process.id'),
    command: nonEmptyString('process.command'),
    args: z.array(z.string()).default([]),
    cwd: nonEmptyString('process.cwd').optional(),
    env: z.record(z.string(), z.string()).optional(),
    phase: z.enum(['dev', 'production', 'always']).default('always'),
    readiness: readinessSchema,
    readinessTimeoutMs: positiveIntMs('readinessTimeoutMs').default(30_000),
    requirePortsFree: z.array(portNumber('requirePortsFree[]')).default([]),
    restart: restartPolicySchema.default(defaultsOf(restartPolicySchema)),
    shutdown: shutdownPolicySchema.default(defaultsOf(shutdownPolicySchema)),
  })
  .strict();
