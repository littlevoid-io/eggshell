/**
 * Renderer-side half of the IPC bridge (T3.3). Loaded as Electron's
 * `webPreferences.preload` under `sandbox: true` and `contextIsolation:
 * true` (see `hardening.ts#createHardenedWindowOptions`), which is why this
 * file is deliberately minimal:
 *
 * - **Imports `electron` only.** A sandboxed preload runs before the
 *   renderer's own module graph and with a polyfilled `require` that only
 *   resolves a handful of built-ins (see the build note below) -- pulling
 *   in the rest of this package here would drag core code into a context
 *   that sits directly behind untrusted, possibly remote, page content.
 *   `IPC_BRIDGE_CHANNEL` below is therefore a duplicated literal, not an
 *   import from `ipc-bridge.ts`: if the two ever drift, every call rejects
 *   loudly as an unknown channel on the main-process side (a clear failure
 *   the moment it happens), never a silent hang.
 * - **Never exposes `ipcRenderer` itself.** Handing untrusted content a
 *   function that can invoke an arbitrary channel name would let it
 *   dispatch into any plugin's registered handler, not just the ones meant
 *   for it -- see `ipc-bridge.ts`'s module doc for the allow-listing this
 *   would otherwise bypass entirely. The only surface exposed is
 *   `window.eggshell.invoke(channel, ...args)`, which always forwards
 *   through the one well-known bridge channel.
 *
 * ---
 *
 * ## Build note (T3.3)
 *
 * Electron has supported an ESM preload (`.mjs`, under `sandbox: true` +
 * `contextIsolation: true`) since v28 -- comfortably below this package's
 * `electron >=44.0.0` peer floor. That would let this file build straight
 * through the package's normal ESM `tsc` pipeline. It is nonetheless built
 * to CommonJS (`dist/preload.cjs`, per `ROADMAP.md`'s T3.3 entry and the
 * path `hardening.test.ts` already exercises) for a reason specific to this
 * package, not to Electron's own ceiling:
 *
 * `webPreferences.preload` takes a single file path with no companion
 * `type` hint, and Electron's ESM preload loader determines module kind
 * from the file *extension* alone -- it ignores the nearest `package.json`
 * `"type"` field on purpose (documented on electronjs.org/docs/latest/
 * tutorial/esm), so a `.mjs` extension is mandatory for the ESM path to
 * engage at all. This package's `tsc`-under-`nodenext` build ties output
 * extension to input extension (`.ts` -> `.js`, never `.cjs`/`.mjs`), and
 * this file must stay named `preload.ts` (a hard constraint of this task),
 * so producing a real `.mjs` would require either renaming the source (not
 * available here) or a second bespoke emit step regardless. Given a second
 * step is unavoidable either way, CommonJS is the simpler and more
 * conservative of the two: it is the format sandboxed preloads have
 * supported unmodified since Electron 20, needs no extension-based
 * loader-selection subtlety, and sidesteps the ESM path's own documented
 * caveat that a `Content-Length: 0` response body can let the page load
 * race ahead of an async preload. `package.json`'s `build` script therefore
 * runs a second, CommonJS-targeted `tsc` invocation over this one file and
 * renames its output to `dist/preload.cjs`; `tsconfig.build.json` excludes
 * this file from the main ESM emit so no unused `dist/shell/preload.js`
 * ships alongside it. See both files for the exact commands.
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Must equal `IPC_BRIDGE_CHANNEL` in `ipc-bridge.ts`. See the module doc
 * above for why this is a duplicated literal rather than an import.
 */
const IPC_BRIDGE_CHANNEL = 'eggshell:ipc';

/** The entire renderer-facing surface. Deliberately just this one method. */
export interface EggshellBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

const eggshellBridge: EggshellBridge = {
  invoke: (channel, ...args) => ipcRenderer.invoke(IPC_BRIDGE_CHANNEL, { channel, args }),
};

contextBridge.exposeInMainWorld('eggshell', eggshellBridge);
