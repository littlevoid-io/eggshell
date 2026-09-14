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

export { createWatchdog } from './watchdog.js';
export type {
  Watchdog,
  WatchdogOptions,
  WatchdogWindowState,
  WatchdogWindowStatus,
} from './watchdog.js';

export { acquireSingleInstanceLock } from './single-instance.js';
export type {
  AcquireSingleInstanceLockOptions,
  SecondInstanceHandler,
  SecondInstanceInfo,
  SingleInstanceApp,
  SingleInstanceLockResult,
} from './single-instance.js';

export { createDisplayEventBridge } from './display-events.js';
export type {
  DisplayEventBridge,
  DisplayEventBridgeOptions,
  SupervisorTuning,
} from './display-events.js';

export { launch } from './launch.js';
export type { LaunchApp, LaunchOptions, LaunchResult } from './launch.js';
