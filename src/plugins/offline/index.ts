/**
 * Public exports for the `offline` plugin (T4.1).
 */

export { PLUGIN_ID, createOfflinePlugin } from './plugin.js';
export type { OfflinePluginOptions } from './plugin.js';
export { offlineConfigSchema, validateOfflineConfig } from './schema.js';
export { OfflineStateMachine } from './state-machine.js';
export { ReachabilityProbe } from './probe.js';
export type { ReachabilityProbeOptions } from './probe.js';
export { OverlayViewManager } from './view.js';
export type { OverlayViewManagerOptions } from './view.js';
export type { OfflineOverlayConfig, OfflineOverlayState, StateListener } from './types.js';
