import { z } from 'zod';
import { defaultsOf, nonEmptyString, positiveInt, positiveIntMs } from './primitives.js';

const displayRoleRuleSchema = z
  .object({
    labelPattern: nonEmptyString('display.roles[].labelPattern').optional(),
    index: z.number().int().nonnegative('display.roles[].index must be >= 0').optional(),
    internal: z.boolean().optional(),
    touchCapable: z.boolean().optional(),
  })
  .strict()
  .refine(rule => Object.values(rule).some(value => value !== undefined), {
    message: 'a display role rule must set at least one selector field',
  });

/** Field names match `TopologySupervisorOptions` 1:1 so they pass through without renaming. */
const supervisorPolicySchema = z
  .object({
    debounceMs: positiveIntMs('display.supervisor.debounceMs').default(300),
    maxAttemptsPerTopology: positiveInt('display.supervisor.maxAttemptsPerTopology').default(5),
    verifyDelayMs: positiveIntMs('display.supervisor.verifyDelayMs').default(500),
    giveUpAfterMs: positiveIntMs('display.supervisor.giveUpAfterMs').default(30_000),
    maxGlobalAttempts: positiveInt('display.supervisor.maxGlobalAttempts').default(20),
    globalRateWindowMs: positiveIntMs('display.supervisor.globalRateWindowMs').default(60_000),
  })
  .strict();

const touchProbePolicySchema = z
  .object({
    enabled: z.boolean().default(false),
    timeoutMs: positiveIntMs('display.touchProbe.timeoutMs').default(2000),
  })
  .strict();

export const displayPolicySchema = z
  .object({
    roles: z.record(z.string(), displayRoleRuleSchema).default({}),
    supervisor: supervisorPolicySchema.default(defaultsOf(supervisorPolicySchema)),
    touchProbe: touchProbePolicySchema.default(defaultsOf(touchProbePolicySchema)),
  })
  .strict();
