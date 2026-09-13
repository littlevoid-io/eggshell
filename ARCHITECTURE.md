# eggshell — Architecture

`eggshell` is an Electron kiosk-launcher shell consumed as a **library**. A consumer project imports it and calls `launch(config)` from its own Electron main entry point, and gets kiosk window management, child-process supervision, and optional add-on features. It is also designed to be the executable that an external Windows-provisioning tool launches as a startup task at logon, which is why the build emits a discoverable manifest and ships a `doctor` diagnostics command.

## The one rule that shapes everything

**The package makes no assumption whatsoever about the consumer's directory layout.**

The predecessor codebase located its own root by walking up the filesystem until it found a folder literally named `shell`, and assumed every app it launched was a sibling folder in the same monorepo. That single assumption produced five contradictory config sources, build output written into the dependency's own folder, and asset paths that only resolved inside one specific repo.

Every root is therefore an explicit value, never a discovered one:

| Root           | Origin                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| `packageRoot`  | derived from `import.meta.url` only                                    |
| `projectRoot`  | required explicit input from the consumer                              |
| `userDataRoot` | required explicit input, normally Electron's `app.getPath('userData')` |

No upward search. No magic folder names. No `process.cwd()` outside the CLI entry point.

## Layers

Dependency arrows point in one direction only. A lower layer never imports a higher one.

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

Plugins (`src/plugins/**`) sit **outside** this stack. They may import only `plugin-api`, `config`, `errors`, and `logging`. Nothing in the stack may import a plugin.

## Why each layer exists

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

These are acceptance criteria, not preferences. Each one exists because its violation caused a concrete, diagnosed failure in the predecessor codebase.

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

## The lockup that justifies the layout design

A reported full-machine freeze in the predecessor had three stacked causes, and the layout layer is shaped specifically to make each one structurally impossible:

1. **An unsatisfiable target retried forever.** "Span all displays" under kiosk mode snaps to a single monitor, so the target could never be satisfied, and recovery retried every 10 seconds indefinitely. _Fix:_ the resolver detects the contradiction and deterministically downgrades it, emitting a warning. It can never emit a target that cannot be satisfied. The supervisor additionally has a capped attempt count and a circuit breaker.
2. **Recovery re-triggering itself.** Applying recovery perturbed monitor work-area, which fired the OS display-changed event again, with no debounce or dedup — an unbounded cascade of scheduled retries. _Fix:_ a topology signature. An event whose signature matches the last settled topology is dropped as a no-op, and bursts are debounced into one attempt.
3. **The actual freeze: a synchronous, timeout-less child-process call** to a platform touch-detection probe, whose cache was invalidated by every display-changed event from cause 2 — blocking the whole process's event loop with no recovery short of a power cycle. _Fix:_ `resolveLayout` is a pure function that receives `touchDisplayIds` as **injected data**. It cannot probe anything. The probe itself is async, behind the `TouchProbe` interface, with an `AbortSignal` timeout, and resolves to an empty array on failure rather than throwing into the layout path.

The general principle: **decisions are pure functions over injected data; I/O happens at the edges and is always cancellable.**

## Config layering

Exactly two layers, in this order:

1. The consumer's code config, passed to `launch()`.
2. One optional JSON override file, at `config.deploymentOverridePath` or `<userDataRoot>/eggshell.deployment.json`.

The merged result is re-validated, so an override typo fails loudly with a field path rather than producing a black window.

Deliberately **not** sources of config: environment variables, cascading `.env` files, CLI flags, bare positional arguments, packaged-manifest fields. The predecessor had five such sources with contradictory precedence — including an environment variable _losing_ to a committed `.env` file. The override file exists so a provisioning tool can retune a deployed machine without a rebuild; that is the only reason the schema is constrained to serializable data.

## Plugin seam

```
interface ShellPlugin {
  id: string;
  setup(context: ShellContext): void | Promise<void>;
  teardown?(): void | Promise<void>;
}
```

`ShellContext` exposes the window, IPC, command and status registries, plus `logger`, `roots`, and the plugin's own validated slice of `config.plugins[id]`. Plugins register _into_ the context; core never reaches out to them. A plugin that throws during `setup` is isolated — logged, marked failed, and the shell continues.

This is what makes each plugin genuinely omittable. In the predecessor, the core window manager imported two supposedly-optional overlays directly, so no build could exclude them.

## Toolchain notes

| Choice                                                     | Note                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESM-only, `nodenext`                                       | All relative imports carry explicit `.js` extensions.                                                                                                                                                                                                                             |
| `tsc` only, no bundler                                     | A library needs none; per-file output tree-shakes cleanly.                                                                                                                                                                                                                        |
| TypeScript pinned to 6.x                                   | TypeScript 7's parser API is not yet supported by typescript-eslint, which throws on import under TS 7. Since the architecture above is enforced by lint rules rather than convention, working lint outranks a newer compiler. Revisit when typescript-eslint ships TS 7 support. |
| Electron as a peer dependency                              | The consumer owns the Electron version.                                                                                                                                                                                                                                           |
| electron-builder as an optional peer, imported dynamically | Build-time only; must not bloat a runtime install.                                                                                                                                                                                                                                |
