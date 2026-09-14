export { evaluatePermission, hardenedWebPreferences, isNavigationAllowed } from './policy.js';
export type { PermissionRequest } from './policy.js';
export {
  applyNavigationGuards,
  applyPermissionHandlers,
  applyWebRequestFilter,
  createHardenedWindowOptions,
} from './hardening.js';

export {
  applyKioskLock,
  applyPlacement,
  createWindowRegistry,
  createWindows,
  toDisplaySnapshots,
} from './windows.js';
export type {
  BrowserWindowFactory,
  KioskLockOptions,
  ManagedWindow,
  WindowSpec,
} from './windows.js';

export { IPC_BRIDGE_CHANNEL, MAX_ENVELOPE_BYTES, registerIpcBridge } from './ipc-bridge.js';
export type { IpcBridgeHandle, IpcDispatcher, RegisterIpcBridgeOptions } from './ipc-bridge.js';
