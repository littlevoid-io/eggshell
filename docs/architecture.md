# Architecture

eggshell is a CLI that owns the Electron process for kiosk installations. An exhibit repo contains one config file; `eggshell dev|build|start|doctor` does the rest.

## Consumer contract

Files eggshell touches in an exhibit repo:

| File                 | Written by `eggshell init`                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `eggshell.config.ts` | Created. The only eggshell-specific file.                                                                                         |
| `package.json`       | Scripts `dev`, `build`, `start`, `doctor` and `devDependencies.eggshell` added if absent. Existing keys are reported and skipped. |
| `.gitignore`         | `release/`, `.eggshell/` appended if missing.                                                                                     |

No consumer Electron main, no preload path, no root resolution. eggshell ships its own main.

## Config

```ts
// eggshell.config.ts
export default ({ appDir, isDev }) => ({
  appId: 'com.example.mural',
  productName: 'Mural',
  windows: [{ id: 'main', url: isDev ? 'http://localhost:3000' : 'http://localhost:3001' }],
});
```

- Factory input: `{ appDir, isDev, platform }`. Conditionals live in the consumer's code.
- Factory output: plain JSON data, validated by zod. Errors name the field path.
- Required: `appId`, `productName`, `windows`. Every other section is optional and off when absent.
- One optional post-factory layer: a deployment override JSON file at `<userData>/eggshell.deployment.json`. Objects deep-merge, arrays replace, result re-validates.
- No env vars, no CLI flags feed the config.

Sections map one-to-one onto features:

| Section              | Feature                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `windows`            | Placement (`target`, `kiosk`, `fullscreen`, `borderless`, `bounds`), hardening, menu bar, icon |
| `processes`          | Child servers per phase (`dev`, `production`, `always`), readiness, restart                    |
| `display`            | Roles, touch probe, topology supervisor tuning                                                 |
| `logging`            | File sink with rotation, level, directory                                                      |
| `keybindings`        | Key → command list (quit, toggle cursor/offline/companion)                                     |
| `cursor`             | Initial visibility                                                                             |
| `chromeExtensions`   | Unpacked extension paths, relative to `appDir`                                                 |
| `chromiumFlags`      | Chromium command-line switches appended at startup                                             |
| `offline`            | Connectivity probe and overlay                                                                 |
| `companion`          | QR overlay pointing to a LAN URL                                                               |
| `dashboard`          | HTTP control API, live log stream, static UI                                                   |
| `soak`               | Soak test: random UI interaction (monkey testing) for a set duration                           |
| `browserPermissions` | Chromium permission requests (`getUserMedia`, notifications, ...) allow-list                   |
| `build`              | Packaging: output dir, consumer files to copy, extraResources, `dir` or `nsis` target          |

### Defaults

On by default when a feature needs no input and has no external surface. Off when it binds a port, needs a URL, or is a test tool. `enabled: false` turns a default-on section off.

| Section                                              | Default                                                                                                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `logging`                                            | On. Rotating file in `<userData>/logs`, 10 MB x 5 files.                                                                                       |
| `keybindings`                                        | On. `ctrl+q` quit, `shift+o` offline, `shift+c` cursor, `shift+?` companion.                                                                   |
| `cursor`                                             | Derived: hidden when `kiosk: true`, visible otherwise.                                                                                         |
| `offline`                                            | On. Electron `net.isOnline()`, no port.                                                                                                        |
| `browserPermissions`                                 | On. Allow `media`, `camera`, `microphone`; deny the rest.                                                                                      |
| `dashboard`, `companion`, `soak`, `chromeExtensions` | Off.                                                                                                                                           |
| `chromiumFlags`                                      | On. Kiosk switches: `force-device-scale-factor=1`, no pinch, no background throttling, GPU rasterization. `remote-debugging-port` in dev only. |

`eggshell doctor` prints the fully resolved config with defaults applied.

## Layers

```
cli          argv parsing, config loading (tsx), spawn Electron, terminal output (colors, QR)
  |
shell        Electron main: windows, features, IPC, keybindings, dashboard server
  |
layout   process     pure: resolver, topology supervisor, spawn, readiness, shutdown
  |
config   paths   errors   logging     pure: zod schema, roots, error types, Logger interface
```

Arrows point down only. `layout` and `process` never import Electron.

| Directory     | Purpose                                                               |
| ------------- | --------------------------------------------------------------------- |
| `src/config`  | Schema, validation, override merge                                    |
| `src/paths`   | `appDir`, `userData`, `packageRoot`; containment checks               |
| `src/errors`  | `ConfigError`, `LayoutError`, `ProcessError`, `BuildError`            |
| `src/logging` | `Logger` interface, console + file (rotating) implementations         |
| `src/layout`  | Display snapshot, layout resolution, topology supervisor, touch probe |
| `src/process` | Port check, argv spawn, readiness, restart supervisor, tree shutdown  |
| `src/shell`   | Electron main and one subdirectory per config section                 |
| `src/cli`     | `bin.ts` plus one file per command                                    |

## Rules

Four rules. Each is one ESLint block in `eslint.config.mjs`, named by the label below.

| Rule          | Statement                                                                                                                                              | Check       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| `pure-core`   | `src/layout/resolve.ts` and `src/layout/signature.ts` import no `node:*` or `electron` and contain no `await`. Placement is a pure function of inputs. | ESLint zone |
| `argv-spawn`  | Child processes go through `execa` with an argv array. `shell:` option, `exec`, `execSync` are banned.                                                 | ESLint rule |
| `cli-exits`   | `process.exit` only in `src/cli/bin.ts`.                                                                                                               | ESLint rule |
| `config-data` | Validated config round-trips through `JSON.stringify` unchanged.                                                                                       | One vitest  |

Size rules apply everywhere: `max-lines` 150, `max-lines-per-function` 20, `max-depth` 3.

## Logging

One pino stream fans out to three sinks: stdout as JSON lines (the CLI colors them per scope), rotating file (`pino-roll`), dashboard SSE.

Renderer output reaches the same stream two ways, both always on:

- `webContents` `console-message` events, logged under `renderer:<windowId>`. No app changes needed.
- `window.eggshell.log.{debug,info,warn,error}(message, fields)` from the preload, for structured logs.

## Libraries

Hand-rolled code is limited to the layout resolver, topology signature, and the two supervisors' state transitions. Everything else uses a library.

| Problem                | Library                                                        |
| ---------------------- | -------------------------------------------------------------- |
| argv                   | `meow`                                                         |
| spawn                  | `execa`                                                        |
| tree kill              | `fkill`                                                        |
| wait for port / http   | `wait-on`                                                      |
| port free check        | `detect-port`                                                  |
| timeout                | `p-timeout`                                                    |
| logging                | `pino`, `pino-roll`                                            |
| terminal color         | `chalk`                                                        |
| http                   | `express`                                                      |
| deep merge             | `deepmerge` (arrays replace)                                   |
| TS config load         | `tsx`                                                          |
| package.json edit      | `read-pkg`, `write-pkg`                                        |
| per-app data directory | `env-paths`                                                    |
| QR                     | `qrcode`                                                       |
| validation             | `zod`                                                          |
| packaging              | `electron-builder`, `esbuild` (bundles the main), `tinyglobby` |

Restart backoff and the topology debounce stay hand-rolled: both are state machines with fake-clock tests, and `p-retry` / `p-debounce` take no injected clock.

## Dashboard UI

- npm workspace `ui/dashboard/`: Vue 3, TypeScript, Tailwind 4, Vite.
- `vite build` emits `dist/dashboard-ui/`; eggshell's `build` script runs it. The dashboard server serves that folder.
- HMR while developing eggshell: `npm run dev -w ui/dashboard`, Vite proxies `/api` to a running kiosk's dashboard port.
- Consumers never build it. Offline and companion overlays are single static HTML files.

## Reliability

- Layout targets resolve deterministically. An unsatisfiable target degrades once (`fallback`) and logs; it is never retried in a loop.
- Display-change events are deduplicated by topology signature, debounced, and capped in attempts. Exhaustion stops with an error log.
- OS probes (touch detection) are async with a timeout and never run inside a display-change handler.
- Child processes exit as a tree on shutdown (`taskkill /T` on Windows).
- Nothing binds a non-loopback interface unless the config section says so.

## Toolchain

| Choice                                               | Why                                                                                                                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESM only, `nodenext`                                 | Electron main supports ESM; relative imports carry `.js`.                                                                                                      |
| `tsc` for eggshell, `tsx` for config loading         | No bundler. Consumer config is TypeScript without a build step.                                                                                                |
| TypeScript 6.x                                       | typescript-eslint has no TS 7 parser yet.                                                                                                                      |
| Electron + electron-builder as eggshell dependencies | One download at `npm install eggshell`; binary resolved from eggshell's own package. Apps pin Electron via the eggshell version. `doctor` verifies the binary. |
| Dashboard UI prebuilt in eggshell                    | Consumer never runs a nested build.                                                                                                                            |
