# Architecture

`eggshell` is an Electron kiosk-launcher you use as a library: call `launch(config)` from your own Electron main file, and it handles window management and process supervision, with plugins available if you need them. It can also build a standalone executable and write a launch manifest alongside it, so a separate provisioning tool can find and start your app on its own.

## Roots

Eggshell resolves three root paths, always passed in explicitly rather than found by searching the filesystem:

| Root           | Where it comes from                                                |
| -------------- | ------------------------------------------------------------------ |
| `packageRoot`  | figured out automatically from eggshell's own location             |
| `projectRoot`  | you provide this                                                   |
| `userDataRoot` | you provide this too, usually Electron's `app.getPath('userData')` |

## Layers

Each layer only depends on the ones below it, never the other way around:

```
cli / build          electron-builder, manifest, doctor, dev/start
      |
shell                Electron: BrowserWindow, session, app lifecycle
      |
plugin-api           ShellContext + registries (the only plugin seam)
      |
layout   process     pure: resolver, supervisor state machines, spawn, readiness
      |
config  paths  errors  logging      pure: zod schema, explicit roots, Logger interface
```

Plugins (`src/plugins/**`) live outside this stack and can only import from `plugin-api`, `config`, `errors`, and `logging`.

| Layer           | What it's for                                                       |
| --------------- | ------------------------------------------------------------------- |
| `config`        | validating config with zod, merging in deployment overrides         |
| `paths`         | resolving roots, checking paths stay contained                      |
| `errors`        | a typed error hierarchy that always names a field path              |
| `logging`       | a simple `Logger` interface, plus basic implementations             |
| `layout`        | working out window placement, and the state machine that applies it |
| `process`       | checking ports, spawning processes, readiness checks, restarts      |
| `plugin-api`    | the `ShellContext` seam that plugins hook into                      |
| `shell`         | wiring the pure layers up to real Electron APIs                     |
| `cli` / `build` | thin command-line wrappers over the library's own functions         |

## Reliability

A few properties fall out of how things are built:

- Validation errors always name the exact field that's wrong, so a typo in your config gives you a clear message instead of a mysterious failure.
- Config is plain, JSON-serializable data — there's no way to pass a function into it, and no environment variables or CLI flags feed into it either. The only other input is one optional JSON override file (at `config.deploymentOverridePath`, or `<userDataRoot>/eggshell.deployment.json` by default), meant for a provisioning tool to adjust a deployed machine without rebuilding. It goes through the same validation as regular config.
- Anything that checks the OS (like probing for a touch-capable display) runs asynchronously with a real timeout, so a slow or hanging OS call can never freeze the app.
- Child processes are spawned as an argv array, never a shell string, and nothing binds to a non-loopback network interface without an explicit opt-in.

## Plugin seam

```ts
interface ShellPlugin {
  id: string;
  setup(context: ShellContext): void | Promise<void>;
  teardown?(): void | Promise<void>;
}
```

A plugin gets a `ShellContext` with access to windows, IPC, commands, status, a logger, the resolved roots, and its own slice of config (`config.plugins[id]`). If a plugin's `setup` throws, that one plugin is marked failed and logged, and everything else keeps running.

## Toolchain

| Choice                                                   | Why                                                                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| ESM only, `nodenext` module resolution                   | Relative imports need explicit `.js` extensions as a result.                                                      |
| Just `tsc`, no bundler                                   | A library doesn't need one, and per-file output tree-shakes cleanly for consumers.                                |
| TypeScript pinned to 6.x                                 | typescript-eslint doesn't support TS 7's parser yet, and working lint matters more than a newer compiler for now. |
| Electron as a peer dependency                            | Your project controls which Electron version you're on.                                                           |
| electron-builder as an optional peer, loaded dynamically | It's only needed at build time, so it shouldn't bloat a normal install.                                           |
