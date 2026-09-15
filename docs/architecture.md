# Architecture

`eggshell` is an Electron kiosk-launcher you use as a library: call `launch(config)` from your own Electron main file, and it handles window management and process supervision, with plugins available if you need them. It can also build a standalone executable and write a launch manifest alongside it, so a separate provisioning tool can find and start your app on its own.

## Explicit roots

Eggshell never guesses at your project's layout — you always tell it where things live:

| Root           | Where it comes from                                                |
| -------------- | ------------------------------------------------------------------ |
| `packageRoot`  | figured out automatically from eggshell's own location             |
| `projectRoot`  | you provide this                                                   |
| `userDataRoot` | you provide this too, usually Electron's `app.getPath('userData')` |

There's no searching up the folder tree, no relying on a particular folder name, and no reading `process.cwd()` outside the CLI.

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

Plugins (`src/plugins/**`) live outside this stack — they can only import from `plugin-api`, `config`, `errors`, and `logging`, and nothing in the stack imports a plugin.

| Layer           | What it's for                                                       | What it avoids                                       |
| --------------- | ------------------------------------------------------------------- | ---------------------------------------------------- |
| `config`        | validating config with zod, merging in deployment overrides         | function values in config; reading env vars          |
| `paths`         | resolving roots, checking paths stay contained                      | walking up the filesystem                            |
| `errors`        | a typed error hierarchy that always names a field path              | calling `process.exit`                               |
| `logging`       | a simple `Logger` interface, plus basic implementations             | a hardcoded registry of loggers or colors            |
| `layout`        | working out window placement, and the state machine that applies it | doing any I/O or `await`ing anything in `resolve.ts` |
| `process`       | checking ports, spawning processes, readiness checks, restarts      | building a shell string instead of an argv array     |
| `plugin-api`    | the `ShellContext` seam that plugins hook into                      | importing any plugin itself                          |
| `shell`         | wiring the pure layers up to real Electron APIs                     | making its own placement decisions                   |
| `cli` / `build` | thin command-line wrappers over the library's own functions         | being the only way to do something                   |

## Invariants

A handful of rules the codebase enforces with lint rules or tests, not just convention:

| #   | Rule                                                                                         | How it's enforced                                                     |
| --- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| I1  | No path is ever discovered by walking up the filesystem — all roots are explicit.            | `paths/roots.ts`, a lint rule banning `process.cwd()` outside the CLI |
| I2  | Child processes are always spawned with an argv array, never a shell string.                 | `process/spawn.ts`, a lint rule banning a `shell` option              |
| I3  | Nothing binds to a non-loopback interface or grants a permission without an explicit opt-in. | schema checks, default-value tests                                    |
| I4  | Config is plain, JSON-serializable data — never contains functions.                          | the zod schema, a JSON round-trip test                                |
| I5  | The core never imports a plugin, in either direction.                                        | lint import rules                                                     |
| I6  | Only `src/cli/bin.ts` is allowed to call `process.exit()`.                                   | a lint rule                                                           |
| I7  | Every validation failure names the exact field that's wrong.                                 | `ConfigError.issues`                                                  |
| I8  | No nested `npm install` or on-the-fly compiling when a consumer builds or runs their app.    | plugin assets are prebuilt                                            |
| I9  | Layout resolution is a pure function — no I/O, nothing async.                                | a lint rule banning Node built-ins in `layout/resolve.ts`             |
| I10 | Any check that touches the OS is async, has a real timeout, and sits behind an interface.    | the `TouchProbe` interface                                            |

Layout resolution gets display and touch info handed to it rather than looking it up itself, and any check that does touch the OS runs async with a real timeout, hidden behind a small interface. That combination means a slow or hanging OS call can never freeze the rest of the app.

## Config layering

There are exactly two layers, applied in order:

1. The config object you pass to `launch()`.
2. One optional JSON file that can override it — at `config.deploymentOverridePath`, or `<userDataRoot>/eggshell.deployment.json` by default.

The merged result goes through the same validation as regular config, so a typo in the override file gives you a clear error instead of a blank window. There's deliberately no other way to configure eggshell — no environment variables, no `.env` files, no CLI flags feeding into it. The override file exists specifically so a provisioning tool can adjust a deployed machine's config without rebuilding anything.

## Plugin seam

```ts
interface ShellPlugin {
  id: string;
  setup(context: ShellContext): void | Promise<void>;
  teardown?(): void | Promise<void>;
}
```

A plugin gets a `ShellContext` with access to windows, IPC, commands, status, a logger, the resolved roots, and its own slice of config (`config.plugins[id]`). Plugins only ever register into this context — the core never reaches into a plugin directly. If a plugin's `setup` throws, that one plugin is marked failed and logged, and everything else keeps running.

## Toolchain

| Choice                                                   | Why                                                                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| ESM only, `nodenext` module resolution                   | Relative imports need explicit `.js` extensions as a result.                                                      |
| Just `tsc`, no bundler                                   | A library doesn't need one, and per-file output tree-shakes cleanly for consumers.                                |
| TypeScript pinned to 6.x                                 | typescript-eslint doesn't support TS 7's parser yet, and working lint matters more than a newer compiler for now. |
| Electron as a peer dependency                            | Your project controls which Electron version you're on.                                                           |
| electron-builder as an optional peer, loaded dynamically | It's only needed at build time, so it shouldn't bloat a normal install.                                           |
