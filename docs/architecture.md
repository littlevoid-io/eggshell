# Architecture

`eggshell` is an Electron kiosk-launcher consumed as a library: a consumer calls `launch(config)` from its own Electron main entry point and gets kiosk window management, child-process supervision, and optional plugins. It also builds a standalone executable with a discoverable launch manifest, for a provisioning tool to launch at logon.

## Explicit roots

The package makes no assumption about the consumer's directory layout. Every root is an explicit value, never discovered:

| Root           | Origin                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| `packageRoot`  | derived from `import.meta.url` only                                    |
| `projectRoot`  | required explicit input from the consumer                              |
| `userDataRoot` | required explicit input, normally Electron's `app.getPath('userData')` |

No upward filesystem search, no magic folder names, no `process.cwd()` outside the CLI entry point.

## Layers

Dependency arrows point one direction; a lower layer never imports a higher one.

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

Plugins (`src/plugins/**`) sit outside this stack and may import only `plugin-api`, `config`, `errors`, and `logging`. Nothing in the stack may import a plugin.

| Layer           | Responsibility                                                | Must not                                       |
| --------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| `config`        | zod schema, validation, deployment-override merge             | contain function values; read env vars         |
| `paths`         | explicit root resolution, containment checks                  | search the filesystem upward                   |
| `errors`        | typed error hierarchy carrying field paths                    | call `process.exit`                            |
| `logging`       | `Logger` interface + trivial implementations                  | hardcode a registry of named loggers or colors |
| `layout`        | pure display resolution + window supervision state machine    | perform any I/O or `await` in `resolve.ts`     |
| `process`       | port probing, argv spawn, readiness, restart policy, shutdown | join command + args into a shell string        |
| `plugin-api`    | the `ShellContext` seam plugins register into                 | import any plugin                              |
| `shell`         | bind the pure layers to Electron                              | make placement decisions of its own            |
| `cli` / `build` | thin wrappers over a throwing programmatic API                | be the only way to invoke a capability         |

## Invariants

Acceptance criteria, each enforced by lint or a test — not convention:

| #   | Invariant                                                                                  | Enforced by                                                        |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| I1  | No path is discovered by walking up the filesystem; all roots are explicit.                | `paths/roots.ts`, lint ban on `process.cwd()` outside `src/cli/**` |
| I2  | Child processes spawn with an argv array, never a shell string.                            | `process/spawn.ts`, lint ban on a `shell` property                 |
| I3  | No feature binds a non-loopback interface or grants a permission without explicit opt-in.  | schema refinements, default-value tests                            |
| I4  | Config is 100% JSON-serializable — no function values anywhere.                            | zod schema, JSON round-trip test                                   |
| I5  | Core has zero imports of any plugin, in either direction.                                  | lint import zones                                                  |
| I6  | No `process.exit()` in library code; only `src/cli/bin.ts` may exit.                       | lint ban                                                           |
| I7  | Validation failures name a specific field path.                                            | `ConfigError.issues`                                               |
| I8  | No nested `npm install` or on-demand compile at consumer build/dev time.                   | prebuilt plugin assets                                             |
| I9  | Layout resolution is pure — zero I/O, zero `await`.                                        | lint ban on `node:*` in `layout/resolve.ts`                        |
| I10 | Any platform-native probe is async, has an explicit timeout, and sits behind an interface. | `TouchProbe` interface                                             |

Layout resolution (I9) receives display/touch data as injected input rather than probing anything itself, and every platform-native probe (I10) is async with an explicit timeout behind a swappable interface — so a hung platform call or a display-change recovery loop can never block the process.

## Config layering

Exactly two layers, in order:

1. The consumer's code config, passed to `launch()`.
2. One optional JSON override file, at `config.deploymentOverridePath` or `<userDataRoot>/eggshell.deployment.json`.

The merged result is re-validated, so an override typo fails loudly with a field path rather than a black window. No environment variables, cascading `.env` files, CLI flags, or bare positional args feed config — the override file exists so a provisioning tool can retune a deployed machine without a rebuild.

## Plugin seam

```ts
interface ShellPlugin {
  id: string;
  setup(context: ShellContext): void | Promise<void>;
  teardown?(): void | Promise<void>;
}
```

`ShellContext` exposes the window, IPC, command, and status registries, plus `logger`, `roots`, and the plugin's own validated slice of `config.plugins[id]`. Plugins register into the context; core never reaches out to them. A plugin that throws during `setup` is isolated — logged, marked failed, and the shell continues.

## Toolchain

| Choice                                                     | Note                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| ESM-only, `nodenext`                                       | All relative imports carry explicit `.js` extensions.                                            |
| `tsc` only, no bundler                                     | A library needs none; per-file output tree-shakes cleanly.                                       |
| TypeScript pinned to 6.x                                   | typescript-eslint doesn't yet support TS 7's parser API; working lint outranks a newer compiler. |
| Electron as a peer dependency                              | The consumer owns the Electron version.                                                          |
| electron-builder as an optional peer, imported dynamically | Build-time only; must not bloat a runtime install.                                               |
