/**
 * Public exports for the `companion` plugin (T4.3).
 */

export { PLUGIN_ID, createCompanionPlugin } from './plugin.js';
export type { CompanionPluginOptions } from './plugin.js';
export { companionConfigSchema, validateCompanionConfig } from './schema.js';
export { CompanionStateMachine } from './state-machine.js';
export type { StateMachineInitialOptions } from './state-machine.js';
export { CompanionViewManager } from './view.js';
export type { CompanionViewManagerOptions } from './view.js';
export { detectLocalIp, buildCompanionUrl } from './network.js';
export type { BuildCompanionUrlOptions, NetworkInterfaceDirectory } from './network.js';
export { generateQrDataUrl } from './qr.js';
export type { QrCodeGenerator } from './qr.js';
export type { CompanionConfig, CompanionState } from './types.js';
