/**
 * The default `TouchProbe` (T2.3). Resolves to `[]` unconditionally and
 * never runs any platform code — a consumer must explicitly opt in to
 * `createWindowsTouchProbe` (or supply their own `TouchProbe`) to get any
 * touch detection at all. This is deliberate: the predecessor's lockup
 * (ARCHITECTURE.md, "The lockup that justifies the layout design", cause 3)
 * came from platform-probe code running unconditionally in a shared path: no
 * eggshell consumer should get that behaviour merely by existing.
 */
import type { TouchProbe } from './types.js';

export const noopTouchProbe: TouchProbe = {
  detect: () => Promise.resolve([]),
};
