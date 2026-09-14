export type { Bounds, DisplaySnapshot, DisplayRoleRule } from './types.js';
export type {
  LayoutInput,
  LayoutResolution,
  WindowPlacement,
  LayoutProblem,
  LayoutProblemCode,
} from './types.js';
export { topologySignature } from './signature.js';
export { resolveLayout } from './resolve.js';
export { createWindowSupervisor } from './supervisor.js';
export type {
  SupervisorState,
  GivenUpReason,
  WindowSupervisor,
  WindowSupervisorOptions,
} from './supervisor.js';
export type { TouchProbe } from './probes/types.js';
export { noopTouchProbe } from './probes/noop.js';
export { createWindowsTouchProbe } from './probes/windows-touch.js';
export type {
  ExecFn,
  WindowsTouchProbe,
  WindowsTouchProbeOptions,
} from './probes/windows-touch.js';
