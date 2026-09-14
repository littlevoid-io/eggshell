/** Public surface of the plugin seam (T2.10). See ARCHITECTURE.md "Plugin seam". */

export type {
  ShellPlugin,
  ShellContext,
  WindowHandle,
  WindowRegistry,
  IpcInvocation,
  IpcHandler,
  IpcRegistrar,
  CommandHandler,
  CommandRegistrar,
  StatusPublisher,
  PluginFailure,
} from './types.js';

export { createShellContext } from './context.js';
export type { CreateShellContextOptions } from './context.js';

export { PluginRegistry } from './registry.js';
export type { PluginRegistryOptions } from './registry.js';
