# eggshell — Roadmap

Electron kiosk-launcher shell, consumed as a library. Status column is maintained by the lead architect agent.

Status values: `todo` | `in-progress` | `done` | `blocked`

## Locked decisions

| Decision          | Choice                                                                                                | Rationale                                                                                                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Package layout    | Single package, multiple subpath exports (`eggshell`, `eggshell/cli`, `eggshell/plugins/<name>`)      | Requirement 5 (core never imports a plugin) is enforced by lint zones inside one package; a workspace adds publish/version orchestration for no current benefit. Consumers bundle their Electron main, so unused subpaths tree-shake away. |
| Module format     | ESM-only, `"type": "module"`, Node >= 20                                                              | Electron main supports ESM; no dual-build complexity.                                                                                                                                                                                      |
| TS config         | `module`/`moduleResolution`: `nodenext`, explicit `.js` import specifiers, TypeScript pinned to 6.x   | Correct resolution for an ESM-only published package. TypeScript 7 is pinned out because typescript-eslint throws on import under TS 7, which would leave every invariant below unenforced; working lint outranks a newer compiler.        |
| Build             | `tsc` only (js + d.ts)                                                                                | A library needs no bundler; per-file output tree-shakes cleanly.                                                                                                                                                                           |
| Tests             | vitest                                                                                                | Pure core layers are 100% unit-testable with fixtures.                                                                                                                                                                                     |
| Lint / boundaries | eslint 9 flat config + typescript-eslint + eslint-plugin-import-x                                     | One toolchain covers the banned-pattern rules, import zones, and cycle detection.                                                                                                                                                          |
| Formatting        | Prettier, house config (`trailingComma: es5`, `singleQuote`, `printWidth: 100`, `arrowParens: avoid`) | Matches sibling repos in the same parent folder. No `eslint-config-prettier` — typescript-eslint carries no formatting rules, so there is nothing to disable.                                                                              |
| Validation        | zod                                                                                                   | `issue.path` gives requirement 7's field paths for free; schema is the single source of truth, types inferred.                                                                                                                             |
| Electron          | `peerDependency` (+ devDependency for types)                                                          | The consumer owns the Electron version.                                                                                                                                                                                                    |
| electron-builder  | optional `peerDependency`, imported dynamically in `buildExhibit()`                                   | Build-only; must not bloat a runtime install.                                                                                                                                                                                              |
| Public entry name | `launch(config)`                                                                                      | Domain-neutral name, replacing the prior exhibit-specific name. See resolved decision 3 below.                                                                                                                                             |

## Deviations from the original six-phase plan

1. **Pure layout engine moved from Phase 3 into Phase 2.** The resolver and supervisor are dependency-free pure functions and `launch()` cannot be written correctly without them. Building `launch` first would mean rewriting it.
2. **Electron binding of `launch` moved from Phase 2 into Phase 3.** Phase 2 is now defined as _everything with zero Electron imports_, which makes all of it unit-testable without a display server.
3. **New Phase 0 (guardrails).** Requirements 2, 5 and 6 are invariants that rot silently; each gets an automated check before any code exists that could violate it.
4. **Four requirements added** beyond the original review, each a real unattended-installation failure mode: Electron `webPreferences` hardening + navigation guards (T3.2), single-instance lock (T3.5), crash/unresponsive watchdog (T3.6), graceful child shutdown (T2.9).
5. **Deployment override file added (T1.5).** Requirement 4 mandates a serializable schema specifically so a provisioning tool can override config without a rebuild; that feature was absent from the plan.

## Invariants (every task must preserve these)

| #   | Invariant                                                                                  | Enforced by                                                  |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| I1  | No path is discovered by walking up the filesystem. All roots are explicit inputs.         | T1.2, eslint ban on `process.cwd()` outside CLI              |
| I2  | Child processes spawn with an argv array, never a shell string.                            | T2.6, eslint ban on `shell: true`                            |
| I3  | No feature binds a non-loopback interface or grants a permission without explicit opt-in.  | T2.11, T4.2, default-value tests                             |
| I4  | Config is 100% JSON-serializable — no function values anywhere in the schema.              | T1.3, round-trip test                                        |
| I5  | Core has zero imports of any plugin, in either direction.                                  | T0.2 lint zones                                              |
| I6  | No `process.exit()` in library code; only `src/cli/bin.ts` may exit.                       | T0.2 eslint ban                                              |
| I7  | Validation failures name a specific field path.                                            | T1.4                                                         |
| I8  | No nested `npm install` or on-demand compile at consumer build/dev time.                   | T4.2, T5.1                                                   |
| I9  | Layout resolution is pure — zero I/O, zero `await`.                                        | T2.2, eslint ban on node builtins in `src/layout/resolve.ts` |
| I10 | Any platform-native probe is async, has an explicit timeout, and sits behind an interface. | T2.3                                                         |

---

## Phase 0 — Guardrails

| ID   | Task                            | Status |
| ---- | ------------------------------- | ------ |
| T0.1 | Toolchain scaffold              | done   |
| T0.2 | Automated invariant enforcement | done   |
| T0.3 | ARCHITECTURE.md decision record | done   |
| T0.4 | Formatting conventions          | done   |

### T0.1 — Toolchain scaffold

Create `package.json` (name `eggshell`, `"type": "module"`, `private: true` for now, Node >= 20 engines, scripts `build`/`typecheck`/`test`/`lint`), `tsconfig.json` (`nodenext`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `outDir: dist`, `rootDir: src`, `declaration`), `tsconfig.build.json`, `vitest.config.ts`, `.gitignore`, `.npmrc`, `src/index.ts` placeholder. Install latest deps: `zod`; dev: `typescript`, `vitest`, `@types/node`, `electron`, `eslint`, `typescript-eslint`, `eslint-plugin-import-x`. Electron as peer + dev dep.
**Verify:** `npm run typecheck`, `npm run build`, `npm test` all exit 0.

### T0.2 — Automated invariant enforcement

`eslint.config.mjs` flat config with: ban `process.exit` everywhere except `src/cli/bin.ts` (I6); ban object property `shell` on spawn calls via `no-restricted-syntax` (I2); ban `process.cwd()` outside `src/cli/**` (I1); import zones — nothing outside `src/plugins/**` may import `src/plugins/**`, and `src/plugins/**` may import only `src/plugin-api/**`, `src/config/**`, `src/errors.js`, `src/logging/**` (I5); `import-x/no-cycle`. Add `src/layout/resolve.ts` to a zone banning all `node:*` builtins (I9). Include a deliberately-violating fixture under a scratch path to prove each rule fires, then delete it.
**Verify:** `npm run lint` exits 0 on clean tree; each rule demonstrably fires (report the violation output).

### T0.3 — ARCHITECTURE.md

Record the locked decisions table, the invariant table, the layer diagram (config -> paths/errors/logging -> layout(pure) / process(pure) -> plugin-api -> shell(Electron) -> cli/build), and the rule that arrows never point backwards.
**Verify:** manual read; no code.

### T0.4 — Formatting conventions

Match the house conventions used by sibling repos in the same parent folder. `.prettierrc.json` copied verbatim (`semi`, `trailingComma: "es5"`, `singleQuote`, `printWidth: 100`, `tabWidth: 2`, `useTabs: false`, `bracketSpacing`, `arrowParens: "avoid"`) plus a `.prettierignore` excluding `node_modules/`, `dist/`, `coverage/`, `*.json`, `package-lock.json`. Scripts named to match the house set: `lint`, `lint:fix`, `format`, `format:check`, `typecheck`. `format` points at `prettier --write .` rather than the sibling repo's `eslint --fix` alias, because Prettier is the actual formatter here — a deliberate documented deviation. tsconfig additionally sets `forceConsistentCasingInFileNames`, `esModuleInterop`, `useDefineForClassFields`. ESLint uses the flat-config format as `eslint.config.mjs` (ESM `export default [...]`), skipping all Vue/Nuxt/Tailwind-specific plugins and using `typescript-eslint` as the base.
**Verify:** `npm run format:check` and `npm run typecheck` both exit 0; `.prettierrc.json` byte-matches the house values.

---

## Phase 1 — Config, paths, errors, logging

| ID   | Task                               | Status |
| ---- | ---------------------------------- | ------ |
| T1.1 | Error hierarchy                    | done   |
| T1.2 | Explicit path roots                | done   |
| T1.3 | Config schema (zod, JSON-only)     | done   |
| T1.4 | Config validation with field paths | done   |
| T1.5 | Deployment override layering       | done   |
| T1.6 | Pluggable logging interface        | done   |
| T1.7 | Public exports map                 | done   |

### T1.1 — Error hierarchy

`src/errors.ts`: `EggshellError` base (with `code`), subclasses `ConfigError` (carries `issues: {path: string, message: string}[]`), `LayoutError`, `ProcessError`, `BuildError`, `PluginError`. No `process.exit` (I6). Every error message is actionable and names the offending value.
**Verify:** unit test asserting `instanceof`, `code`, and that `ConfigError.message` renders all issue paths.

### T1.2 — Explicit path roots

`src/paths/roots.ts`: `ShellRoots = { packageRoot, projectRoot, userDataRoot }`; `resolveRoots(input)` where `packageRoot` derives only from `import.meta.url`, and `projectRoot`/`userDataRoot` are **required explicit inputs** — no filesystem walking, no magic folder names (I1). Throw `ConfigError` on a relative or empty path. Add `resolvePackageAsset(roots, relative)` and `resolveProjectPath(roots, relative)` that reject escaping their root.
**Verify:** unit tests covering absolute-path enforcement, traversal rejection (`../`), and that no `readdir`/`stat`/upward search occurs (assert by code review + no `node:fs` import).

### T1.3 — Config schema

`src/config/schema.ts` — zod schemas, JSON-primitives only (I4). Types inferred into `src/config/types.ts`.

```
ExhibitConfig {
  appId: string (reverse-dns pattern)
  productName: string
  version?: string
  windows: WindowConfig[]  (min 1)
  processes?: ProcessConfig[]
  display?: DisplayPolicy
  permissions?: PermissionPolicy
  logging?: LoggingConfig
  plugins?: Record<string, unknown>   // opaque per-plugin JSON, keyed by plugin id
  deploymentOverridePath?: string
}
WindowConfig { id, url, target: DisplayTarget, kiosk?, fullscreen?, bounds?: Bounds,
  backgroundColor?, zoomFactor?, showWhenReady?, required?, fallback?: 'primary'|'none'|'error' }
DisplayTarget = {kind:'primary'} | {kind:'index',index} | {kind:'role',role}
  | {kind:'matchLabel',pattern} | {kind:'spanAll'}
DisplayPolicy { roles?: Record<string, DisplayRoleRule>,
  supervisor?: {debounceMs, maxAttempts, verifyDelayMs, giveUpAfterMs},
  touchProbe?: {enabled, timeoutMs} }
ProcessConfig { id, command, args: string[], cwd?, env?: Record<string,string>,
  phase: 'dev'|'production'|'always',
  readiness?: {kind:'tcp',port} | {kind:'http',url,expectStatus?} | {kind:'log',pattern} | {kind:'delay',ms} | {kind:'none'},
  readinessTimeoutMs?, requirePortsFree?: number[],
  restart?: {policy:'never'|'onCrash'|'always', maxRestarts, backoffMs, backoffMultiplier, maxBackoffMs, resetAfterMs},
  shutdown?: {signal, graceMs} }
PermissionPolicy { default: 'deny', allow: [{origin, permissions: string[]}] }
```

There is **no** `shell` field and **no** `getBounds` callback — `bounds` is plain data, which is what unblocks T1.5. Unique-`id` refinements on `windows` and `processes`. Defaults declared in the schema, not applied ad-hoc at call sites.
**Verify:** a test that `JSON.parse(JSON.stringify(parsed))` deep-equals `parsed` for a maximal fixture config (I4), plus a test asserting the schema rejects a function value.

### T1.4 — Config validation

`src/config/validate.ts`: `validateConfig(input): ExhibitConfig` throwing `ConfigError` whose issues carry dotted field paths (`windows[1].target.kind`) (I7). Never exits, never warns-and-continues, never returns a partial config.
**Verify:** tests for a typo'd enum, a missing required field, a duplicate window id, and a bad `appId` — each asserting the exact field path string.

### T1.5 — Deployment override layering

`src/config/overrides.ts`: exactly **two** layers — the consumer's code config, then one optional override file. Path comes from `config.deploymentOverridePath` or defaults to `<userDataRoot>/eggshell.deployment.json`. No env vars, no CLI flags, no cascading `.env`, no positional args, no packaged-manifest field — the old code's five contradictory sources are explicitly out of scope. Deep-merge objects, replace arrays wholesale, then re-validate the merged result through T1.4 so an override typo fails loudly with a field path. Log at info which file was applied, or that none was found.
**Verify:** tests for no-file, valid override, malformed JSON (must throw `ConfigError` naming the file), and override-introduces-invalid-field (must report the field path). Assert array-replace not array-merge.

### T1.6 — Logging interface

`src/logging/logger.ts`: `Logger` interface (`debug|info|warn|error(message, fields?)`), `createChildLogger(logger, scope)`, `consoleLogger`, `noopLogger`. No fixed registry of named loggers or hardcoded colors in core — the consumer may pass any implementation. `fields` must be JSON-serializable.
**Verify:** unit test with a capturing logger asserting scope propagation and level pass-through.

### T1.7 — Public exports map

`package.json` `exports` for `.`, `./cli`, `./plugins/dashboard`, `./plugins/offline`, `./plugins/companion`, `./plugins/soak`; `bin.eggshell`; `files` allowlist. `src/index.ts` re-exports only the intended public surface (config types, errors, roots, logging, plugin-api). Each plugin subpath gets a stub `index.ts` so the map resolves.
**Verify:** `npm run build` then `node --input-type=module -e "await import('./dist/index.js')"` succeeds; `npx publint` (or equivalent) reports no exports errors.

---

## Phase 2 — Pure core (zero Electron imports)

| ID    | Task                                  | Status |
| ----- | ------------------------------------- | ------ |
| T2.1  | Display topology signature            | done   |
| T2.2  | Pure layout resolver                  | done   |
| T2.3  | Touch probe interface + Windows impl  | done   |
| T2.4  | Window supervisor state machine       | done   |
| T2.5  | Port availability probe               | done   |
| T2.6  | Safe argv spawn                       | done   |
| T2.7  | Readiness probes                      | done   |
| T2.8  | Process supervisor + restart policy   | done   |
| T2.9  | Graceful shutdown                     | done   |
| T2.10 | ShellContext + plugin registries      | done   |
| T2.11 | Permission + hardening policy (pure)  | done   |
| T2.12 | Touch-capability trust precedence fix | done   |

### T2.1 — Topology signature

`src/layout/signature.ts`: `DisplaySnapshot = {id, bounds, workArea, scaleFactor, rotation, internal, label}` (a plain-data mirror of Electron's `Display`, so nothing downstream imports Electron). `topologySignature(displays): string` — stable, order-independent, covering every field that could change a placement. This is the dedup key that kills failure mode (b): an event whose signature matches the last applied one is a no-op.
**Verify:** tests — reordering the array yields the same signature; changing `workArea` by 1px changes it; changing an irrelevant field does not.

### T2.2 — Pure layout resolver

`src/layout/resolve.ts`: `resolveLayout({displays, windows, roles?, touchDisplayIds?}): LayoutResolution` where
`LayoutResolution = {placements: WindowPlacement[], problems: LayoutProblem[]}`,
`WindowPlacement = {windowId, displayId: number|null, bounds, mode: 'kiosk'|'fullscreen'|'windowed', degradedFrom?: DisplayTarget}`,
`LayoutProblem = {windowId, code, severity, message, fieldPath}`.
Absolutely zero I/O and zero `await` (I9) — `touchDisplayIds` arrives as injected data, never probed here; this is the structural fix for the full-PC-lockout root cause. Problem codes must include `no-displays`, `target-unresolvable`, `role-unmatched`, `duplicate-target`, and `span-all-incompatible-with-kiosk`.
**Critical behaviour:** `{kind:'spanAll'}` combined with `kiosk: true` is a contradiction (kiosk snaps to one monitor). Resolve it **deterministically** — downgrade `mode` to `'windowed'` across the union bounds and emit a `warning` — and never emit an unsatisfiable target, because an unsatisfiable target is what the old code retried every 10s forever (failure mode a). Honour `required`/`fallback` per window.
**Verify:** fixture-driven tests for these topologies: single display; three displays; touch display absent (role unmatched -> fallback path); touch display present; span-all-under-kiosk contradiction; zero displays; two windows targeting the same display; `index` out of range. Assert a snapshot of `problems` for each.

### T2.3 — Touch probe

`src/layout/probes/types.ts`: `interface TouchProbe { detect(signal: AbortSignal): Promise<number[]> }`. `src/layout/probes/windows-touch.ts`: `createWindowsTouchProbe({timeoutMs, logger})` using **async** `execFile` with an `AbortSignal` timeout (I10). It must never throw into the layout path — on timeout/failure/non-Windows it resolves to `[]` and logs a warning. Cache the result, but the cache must never be invalidated synchronously from a display-changed handler, and a probe already in flight must be joined, not re-spawned. `src/layout/probes/noop.ts` returns `[]`.
**Verify:** tests with a fake exec that (a) hangs — assert `detect` resolves `[]` within `timeoutMs` and the child was aborted; (b) exits non-zero — assert `[]` plus one warning; (c) two concurrent `detect()` calls spawn exactly one child.

### T2.4 — Window supervisor state machine

`src/layout/supervisor.ts`: explicit states `settled | scheduled | applying | verifying | givenUp`. `createWindowSupervisor({clock, apply, verify, debounceMs, maxAttempts, verifyDelayMs, giveUpAfterMs, logger})` — all time and I/O injected so it tests deterministically with a fake clock. `onDisplaysChanged(displays)` must: drop the event if `topologySignature` is unchanged from the last settled topology (failure mode b); debounce coalescing bursts into one attempt; cap attempts; on exhaustion enter `givenUp`, log loudly at error, and **stop** — never retry forever (failure mode a). `givenUp` is only left on a genuinely new topology signature.
**Verify:** fake-clock tests — a burst of 20 identical events produces one apply; 20 differing events coalesce per debounce window; a permanently-failing `verify` reaches `givenUp` in exactly `maxAttempts` and logs once at error; no timer remains scheduled afterwards (assert the fake clock has zero pending timers); a new signature after `givenUp` re-arms.

### T2.5 — Port probe

`src/process/port.ts`: `isPortFree(port, host?): Promise<boolean>` and `assertPortsFree(ports, host?)` throwing `ProcessError` naming the port and, where discoverable, the holder. Defaults to `127.0.0.1`. Requirement 9's pre-spawn conflict detection.
**Verify:** test binding a real ephemeral server, asserting `false` for the taken port and `true` for a free one; assert `assertPortsFree` error message contains the port number.

### T2.6 — Safe spawn

`src/process/spawn.ts`: `spawnManaged({id, command, args, cwd, env, logger})` using `node:child_process.spawn` with an argv array and **`shell` never set** (I2). Reject a `command` containing shell metacharacters or whitespace with a `ProcessError` pointing at `args`. Normalise env (never inherit blindly — explicit allowlist merge over `process.env`). Capture stdout/stderr line-wise into the logger and expose a line stream for T2.7's log readiness probe.
**Verify:** a test asserting `spawn` is called with `(command, argsArray, options)` and `options.shell` is `undefined`; a test that `command: "node -e 1"` is rejected; an end-to-end test spawning `process.execPath` with `['-e','console.log("hi")']` and asserting the captured line.

### T2.7 — Readiness probes

`src/process/readiness.ts`: `waitForReadiness(probe, ctx): Promise<void>` for `tcp` | `http` | `log` | `delay` | `none`, each with an overall timeout throwing `ProcessError` naming the process id, probe kind and elapsed time. Poll with backoff; abort cleanly on shutdown via `AbortSignal`.
**Verify:** tests per kind — tcp against a real ephemeral listener; http against a real `node:http` server including a wrong-status case; log against a synthetic line stream; timeout path asserting the error message names the process id.

### T2.8 — Process supervisor

`src/process/supervisor.ts`: `createProcessSupervisor({configs, phase, logger, clock})` managing **many** processes (requirement 9 — no single hardcoded "server" slot, and no separate "dev server" concept: one `processes[]` filtered by `phase`). Per-process: `assertPortsFree` before spawn, spawn, await readiness, then apply the restart policy on exit — `never`/`onCrash`/`always` with exponential backoff, `maxBackoffMs` cap, `maxRestarts` cap, and `resetAfterMs` to clear the counter after a healthy run. Exhausting `maxRestarts` logs at error and surfaces a terminal status; it must not loop forever. Starts in config order and exposes per-process status for the status registry.
**Verify:** fake-clock tests — crash-loop reaches the cap and stops; backoff intervals match the expected sequence; `resetAfterMs` clears the counter; `policy: 'never'` does not restart; two processes both start and are both reported.

### T2.9 — Graceful shutdown

`src/process/shutdown.ts`: `shutdownAll(handles, {graceMs, logger})` — signal (`SIGTERM`, configurable), wait `graceMs`, then force-kill; on Windows use `taskkill /T` semantics so child trees die too. Reverse start order. Must be idempotent and must resolve even if a child ignores the signal. Rationale: orphaned children hold ports and then trip T2.5 on the next launch, which is how an installation ends up dead after a power blip.
**Verify:** tests — a child that exits on SIGTERM resolves before `graceMs`; a child that ignores it is force-killed and the function still resolves; calling twice is a no-op; assert no surviving process by pid.

### T2.10 — ShellContext + registries

`src/plugin-api/context.ts` and `src/plugin-api/registry.ts`. `interface ShellPlugin { id: string; setup(context: ShellContext): void | Promise<void>; teardown?(): void | Promise<void> }`. `ShellContext` exposes `windows`, `ipc`, `commands`, `status`, `logger`, `roots`, and the plugin's own validated config slice from `config.plugins[id]`. Core imports **nothing** from `src/plugins/**` (I5) and plugins import nothing from core internals — the dependency is one-way through this interface only. Registries must reject duplicate ids and reject registration after setup has closed. A plugin throwing in `setup` must be isolated: log at error, mark the plugin failed, and let the shell continue.
**Verify:** tests — register two fake plugins and assert both `setup` calls receive a context; duplicate id throws `PluginError`; a throwing plugin does not abort the others; a grep/test asserting zero imports of `src/plugins/` from anywhere outside it (this duplicates the lint zone deliberately).

### T2.11 — Permission + hardening policy (pure)

`src/shell/policy.ts` — pure, no Electron import: `evaluatePermission(policy, {origin, permission}): 'allow'|'deny'` with **default deny** and per-origin allow-list matching (exact origin, or explicit wildcard subdomain form; never a substring match) (I3). Plus `hardenedWebPreferences()` returning the baseline object (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`) and `isNavigationAllowed(allowedOrigins, url)`. Pure so it is fully unit-testable; T3.2 only wires it to Electron.
**Verify:** tests — default-deny for an unlisted origin; allow only the listed permission for a listed origin; `https://evil-example.com` must NOT match an allow entry for `https://example.com` (substring-match regression test); `file://` and `about:blank` handled explicitly.

### T2.12 — Touch-capability trust precedence fix

Surfaced by T2.3. `resolveLayout` was letting the injected probe result always win over Electron's per-display `touchSupport`. On Windows the probe's ids are WMI enumeration-order ordinals for digitizers, and no public API correlates them to Chromium's opaque `Display.id`, whereas `touchSupport` is reported natively against that exact id. The dangerous half was negative: a bogus ordinal could mark a display touch-capable even when Electron positively reported `unavailable`, silently landing a touch-targeted window on a non-touch monitor. `touchSupport` now wins wherever it expresses an opinion; the probe is consulted only for `'unknown'`. No new config flag — `display.touchProbe.enabled` already gates whether the probe runs, so "enabled" and "trusted" layer cleanly.
**Verify:** done — 6 tests including the negative-override regression and an end-to-end case where a misaligned probe ordinal must not beat `touchSupport`.

---

## Phase 3 — Electron integration

| ID   | Task                                              | Status |
| ---- | ------------------------------------------------- | ------ |
| T3.1 | Window manager (Electron binding of T2.2)         | todo   |
| T3.2 | Hardening + permissions wiring                    | todo   |
| T3.3 | Preload + IPC bridge                              | todo   |
| T3.4 | `launch()` orchestration                          | todo   |
| T3.5 | Single-instance lock                              | todo   |
| T3.6 | Crash / unresponsive watchdog                     | todo   |
| T3.7 | Display-change wiring (T2.4 to Electron `screen`) | todo   |

### T3.1 — Window manager

`src/shell/windows.ts`: `toDisplaySnapshots(electronDisplays)`, `createWindows(placements, ...)`, `applyPlacement(window, placement)` honouring `mode`. Kiosk locking (`setKiosk`, `setMenuBarVisibility(false)`, `setAlwaysOnTop`, block `Escape`/devtools in production). All geometry decisions come from T2.2 — this file contains no placement maths.
**Verify:** `npm run typecheck`; manual check via the Phase 6 example.

### T3.2 — Hardening wiring

`src/shell/hardening.ts`: apply `hardenedWebPreferences()`, `session.setPermissionRequestHandler` + `setPermissionCheckHandler` delegating to `evaluatePermission` (I3), `setWindowOpenHandler` -> deny, `will-navigate` guard, `webRequest` deny for non-allowlisted origins. Nothing is granted before config is validated.
**Verify:** typecheck + a unit test against fake Electron session objects asserting handlers deny by default.

### T3.3 — Preload + IPC bridge

`src/shell/preload.ts` built to `dist/preload.cjs`; a narrow `contextBridge` surface (no `ipcRenderer` exposure), channel names namespaced per plugin, and every inbound payload validated with zod before dispatch. Wire to `ShellContext.ipc`.
**Verify:** typecheck; unit test asserting an unregistered channel is rejected and a malformed payload throws with a field path.

### T3.4 — `launch()`

`src/shell/launch.ts`: validate config (T1.4) -> apply override (T1.5) -> resolve roots (T1.2) -> single-instance lock (T3.5) -> start `production`/`always` processes and await readiness (T2.8) -> async touch probe (T2.3) -> `resolveLayout` (T2.2) -> create windows (T3.1) -> harden (T3.2) -> run plugin `setup` (T2.10) -> arm supervisor (T3.7) and watchdog (T3.6). Throws on fatal config/process errors; never calls `process.exit` (I6). Registers shutdown (T2.9) on `before-quit`. Fatal layout problems must fail loudly rather than produce a black window.
**Verify:** typecheck + the Phase 6 example launching successfully.

### T3.5 — Single-instance lock

`app.requestSingleInstanceLock()`; a second instance focuses the existing windows and exits via the CLI layer, not from inside the library. Matters because a provisioning tool may install the startup task such that it fires twice at logon.
**Verify:** manual — launch the example twice, assert one instance.

### T3.6 — Watchdog

`src/shell/watchdog.ts`: handle `render-process-gone`, `child-process-gone`, `webContents.on('unresponsive')`, and load failures with a bounded reload policy (backoff + cap + loud give-up, mirroring T2.4's circuit breaker). The top real-world requirement for unattended displays.
**Verify:** unit tests with fake emitters asserting the reload cap and give-up log.

### T3.7 — Display-change wiring

Subscribe `screen.on('display-added'|'display-removed'|'display-metrics-changed')`, map to `toDisplaySnapshots`, feed T2.4's `onDisplaysChanged`. `apply`/`verify` are thin Electron adapters. The probe cache must not be invalidated synchronously here (the old code's lockup path).
**Verify:** typecheck + manual monitor unplug against the Phase 6 example.

---

## Phase 4 — Plugins

| ID   | Task                                      | Status |
| ---- | ----------------------------------------- | ------ |
| T4.1 | Offline-network overlay                   | todo   |
| T4.2 | Remote dashboard (localhost-only default) | todo   |
| T4.3 | Companion QR/info overlay                 | todo   |
| T4.4 | Soak-test fuzzer (dev-only)               | todo   |

### T4.1 — Offline overlay

`src/plugins/offline/`: detect loss of the configured reachability target (never assume internet; poll a configured URL/host), show an overlay `BrowserView`/window, auto-dismiss on recovery with hysteresis. Assets shipped prebuilt and resolved via `resolvePackageAsset` (I1, I8). Imports only `plugin-api` (I5).
**Verify:** unit tests on the pure state machine (flap suppression); manual via the example.

### T4.2 — Remote dashboard

`src/plugins/dashboard/`: HTTP server bound to `127.0.0.1` by default; exposing on a LAN interface requires **both** an explicit `host` opt-in **and** a non-empty token, enforced by schema refinement so a token-less LAN bind is a validation error, not a runtime warning (I3). Constant-time token comparison. Restart/quit endpoints require the token and are individually opt-in. Frontend is prebuilt and shipped as a static asset — no nested `npm install` or on-demand build (I8).
**Verify:** tests — default config binds loopback only (assert by connecting from a non-loopback address and failing); `host: '0.0.0.0'` without a token fails validation with a field path; a wrong token gets 401; no build step runs during consumer install.

### T4.3 — Companion overlay

`src/plugins/companion/`: small info/QR overlay, QR generated at runtime from a config URL via an established library. Assets via `resolvePackageAsset`.
**Verify:** unit test on QR payload construction; manual visual check.

### T4.4 — Soak test

`src/plugins/soak/`: seeded, reproducible interaction fuzzer (deterministic from a seed so a failure replays). Must refuse to run when `app.isPackaged` is true. Emits a report of actions and any crash.
**Verify:** unit test that the same seed yields the same action sequence; test that packaged mode throws.

---

## Phase 5 — Build, CLI, provisioning hand-off

| ID   | Task                                           | Status |
| ---- | ---------------------------------------------- | ------ |
| T5.1 | `buildExhibit()` via electron-builder Node API | todo   |
| T5.2 | Launch manifest (versioned)                    | todo   |
| T5.3 | `startDev()` / `startProduction()`             | todo   |
| T5.4 | `runDoctor()` diagnostics                      | todo   |
| T5.5 | CLI bin                                        | todo   |
| T5.6 | `init` scaffolder                              | todo   |

### T5.1 — `buildExhibit()`

`src/build/build.ts`: compose the electron-builder config **in memory** and call its programmatic Node API (requirement 10) — no generated/committed JSON config inside the package. All output paths derive from the caller's `projectRoot`, never from `packageRoot` (I1 — the old code wrote build output into its own dependency folder). `electron-builder` imported dynamically with a clear error if absent. Throws, never exits (I6).
**Verify:** run against the Phase 6 example; assert artifacts land under the example's own `dist`/`release` and that nothing was written inside `node_modules/eggshell`.

### T5.2 — Launch manifest

`src/build/manifest.ts`: write `eggshell.launch.json` next to the built executable containing `{manifestVersion: 1, appId, productName, version, executablePath, builtAt, platform, arch}`. `manifestVersion` is a stability contract because an external provisioning tool (ZipTie) consumes it — document that additive fields are minor, removals/renames require a version bump. Absolute `executablePath` so no convention-guessing.
**Verify:** test the writer against a temp dir + schema assertion; build the example and read the real manifest.

### T5.3 — dev / start

`src/build/dev.ts`, `src/build/start.ts`: `startDev()` runs `phase: 'dev'|'always'` processes and launches Electron against the consumer's compiled main; `startProduction()` launches the built executable. Programmatic, throwing API. No nested install/compile (I8).
**Verify:** run both against the Phase 6 example.

### T5.4 — `runDoctor()`

`src/build/doctor.ts`: returns a structured `DoctorReport` of checks — platform/arch, Electron resolvable, config validates, required ports free (T2.5), display count vs. configured targets, touch probe result, plugin asset presence, write access to `userDataRoot`, override file parse. Each check is `pass|warn|fail` with a remediation string. Suitable as a provisioning gate, so the CLI must set a non-zero exit on any `fail` (exit happens in `bin.ts` only, I6).
**Verify:** run against the example; force a failure (occupy a port) and assert the specific check fails with non-zero CLI exit.

### T5.5 — CLI bin

`src/cli/bin.ts` — the **only** file permitted to call `process.exit` (I6). Thin arg parsing over T5.1-T5.4; catches `EggshellError` and prints `code` + field paths, unknown errors with a stack. Commands: `dev`, `build`, `start`, `doctor`, `init`.
**Verify:** `npx eggshell doctor` exits 0 on a healthy example and non-zero on a forced failure; `--help` for each command.

### T5.6 — `init`

Scaffold a consumer project: `eggshell.config.ts`, an Electron main calling `launch`, tsconfig, scripts. Refuse to overwrite existing files.
**Verify:** run into a temp dir, then build and launch the scaffolded project.

---

## Phase 6 — Example exhibit & smoke harness

| ID   | Task                                | Status |
| ---- | ----------------------------------- | ------ |
| T6.1 | Example app skeleton                | todo   |
| T6.2 | Multi-window + touch-role layout    | todo   |
| T6.3 | Offline + dashboard plugins enabled | todo   |
| T6.4 | Build + manifest hand-off doc       | todo   |
| T6.5 | Soak run + CI smoke script          | todo   |

### T6.1 — Example skeleton

`examples/basic-exhibit/` — its own `package.json` depending on `eggshell` via `file:../..`, its own Electron main, local static pages (no network dependency). Proves the package works as a consumer sees it, including that no path is discovered by walking up (I1).
**Verify:** `npm run dev` in the example opens a window.

### T6.2 — Multi-window + touch role

Two windows: one `{kind:'role', role:'touch'}`, one `{kind:'primary'}`; plus a commented `spanAll` + kiosk case documenting the deliberate downgrade. Must behave correctly on a single-display dev machine via the fallback path.
**Verify:** run on a single-display machine (fallback) and, if available, a two-display machine.

### T6.3 — Plugins enabled

Enable offline overlay + dashboard (loopback, no token) and exercise the ShellContext registries.
**Verify:** overlay appears when the reachability target is blocked; dashboard reachable on `127.0.0.1` and refused from a LAN address.

### T6.4 — Manifest hand-off doc

`docs/provisioning.md`: the ZipTie contract — where `eggshell.launch.json` lands, its schema, versioning policy, and the recommended startup-task invocation. Include a real manifest from a real build.
**Verify:** manual read against an actual built artifact.

### T6.5 — Smoke script

A single `npm run smoke` at the repo root: lint, typecheck, unit tests, build the example, run `doctor`, assert the manifest, run a short seeded soak. This is the regression gate for every later change.
**Verify:** the script passes end-to-end from a clean clone.

---

## Open decisions needing a human call

Tracked in the lead architect's report; summarised here.

| #   | Question                                                                                                                                                                               | Recommendation                                                                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Package name / npm scope — `eggshell` is likely taken on the public registry                                                                                                           | Keep `eggshell` locally; plan a scope (`@<org>/eggshell`) before any publish                                                                                                                                                                |
| 2   | License                                                                                                                                                                                | MIT unless the venue work requires otherwise; currently unset                                                                                                                                                                               |
| 3   | Prior exhibit-specific entry-point name vs a domain-neutral name                                                                                                                       | **Resolved:** renamed to `launch`; "exhibit" is installation-domain vocabulary in a package sold as generic                                                                                                                                 |
| 4   | Soak: subpath export vs separate package                                                                                                                                               | Subpath now + a documented electron-builder exclusion; separate package only if the exclusion proves unreliable                                                                                                                             |
| 5   | Windows touch detection mechanism                                                                                                                                                      | Behind `TouchProbe`, so the choice is deferrable and swappable                                                                                                                                                                              |
| 6   | Schema defaults invented where the brief was silent: `window.kiosk: true`, `window.showWhenReady: true`, `window.fallback: 'primary'`, plus the supervisor/restart/touchProbe numerics | Reasonable but arbitrary, and now load-bearing behaviour. Worth a deliberate sign-off rather than inheritance by default                                                                                                                    |
| 7   | `window.url` accepts any non-empty string rather than a validated URL                                                                                                                  | Kept permissive so local file paths still work; `doctor` should warn instead. Revisit once window-loading semantics are fixed                                                                                                               |
| 8   | An explicit absolute `deploymentOverridePath` is not containment-checked, unlike every other path in the package                                                                       | Intentional — a provisioning tool may stage the file anywhere readable. Confirm this relaxation is acceptable                                                                                                                               |
| 9   | `display.label` is included in the topology signature and can change on a driver update without the physical layout changing                                                           | Required, because role rules match on it. Watch for driver-triggered re-applies in the field                                                                                                                                                |
| 10  | Ship the Windows touch probe at all? Post-T2.12 it can only break a tie when Electron reports `'unknown'`, and its ids are unverified WMI ordinals                                     | Recommend removing or keeping permanently default-off. A wrong answer fails silently (window on the wrong monitor); the honest `false` fails visibly via `role-unmatched`. It is already `enabled: false` by default, so this is not urgent |
| 11  | Grandchildren of a process that exits within `graceMs` are not swept and can keep holding ports                                                                                        | The real fix is a Windows job object with kill-on-close, which needs a native dependency. Decide whether that dependency is acceptable, or accept detection-only via the port pre-check and `doctor`                                        |
| 12  | Main→renderer push primitive for plugins (`windows.send`) is deliberately absent; `status` is pull-only                                                                                | Additive, so safe to defer. Design it against the offline overlay's real requirement in Phase 4 rather than guessing the shape now                                                                                                          |
| 13  | Naming consistency: `launch()` takes an `ExhibitConfig` and sits beside `buildExhibit()`/`loadExhibitConfig()`                                                                         | Only the entry point was approved for renaming. Decide whether `Exhibit` is the right domain noun before Phase 3 builds more API on it — cheap now, expensive later                                                                         |

## Progress log

| Commit    | Scope                                                                                   | Verified by                                                                                                                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3891c51` | T0.1, T0.3, T0.4 — toolchain, ARCHITECTURE.md, formatting conventions                   | `typecheck`, `build`, `test`, `format:check` all exit 0; typescript-eslint parser loads under the pinned TS 6.x                                                                                                                               |
| `30ffd96` | T0.2 — eslint invariant enforcement                                                     | all 10 invariant rules verified firing against on-disk fixtures; both intended exemptions (`process.exit` in `src/cli/bin.ts`, `process.cwd()` in `src/cli/**`) verified silent; `import-x/no-cycle` verified firing on a real two-file cycle |
| `d1cda71` | T1.1, T1.3, T1.6 — errors, config schema, logging seam                                  | 50 tests; I4 JSON round-trip on a maximal fixture; schema rejects function values                                                                                                                                                             |
| `ec08f9a` | T1.2, T1.4 — explicit path roots, config validation                                     | 83 tests; containment rejects `../` escapes and sibling-directory false positives; field paths asserted exactly                                                                                                                               |
| `9af7835` | T1.5, T2.1 — deployment overrides, topology signature                                   | 113 tests; array-replace and prototype-pollution guards; `colorDepth`/`displayFrequency` exclusion regression tests                                                                                                                           |
| `1ca15d7` | T2.2, T1.7 — pure layout resolver, public exports map                                   | 141 tests; pure-zone lint proven to reject `node:fs` and `async` in `resolve.ts`; all 8 problem codes emitted, none dead                                                                                                                      |
| `6f93015` | Owner decisions — MIT license, `eggshell` unscoped/private, `launchExhibit` → `launch`  | rename verified 0 remaining hits; package fields asserted                                                                                                                                                                                     |
| `a53d13a` | T2.4 — window supervisor                                                                | 179 tests; flap regression proven to fail against the pre-fix implementation                                                                                                                                                                  |
| `923f9dc` | T2.5, T2.6, T2.11 — port probe, safe spawn, permission policy                           | 226 tests; substring-match and lookalike-origin regressions; env-inheritance test                                                                                                                                                             |
| `a6d49ff` | I2 lint hardening                                                                       | two proven bypasses (aliased import, options-via-variable) now blocked, verified in a zone-overridden directory too                                                                                                                           |
| `e598f6d` | T2.7 — readiness probes                                                                 | 240 tests; abort and timeout paths assert zero pending timers                                                                                                                                                                                 |
| `f648f2a` | T2.3, T2.8, T2.10, T2.12 — touch probe, process supervisor, plugin seam, precedence fix | 303 tests; I5 verified by grep as well as lint; `dist/__testing__` absent                                                                                                                                                                     |
| `bc0a30b` | T2.9 — graceful shutdown, completing Phase 2                                            | 315 tests; shutdown-does-not-trigger-restart-policy test; suite still ~1.5s, so no real timers                                                                                                                                                |

### Notes carried forward

- `import-x/no-cycle` is a no-op on `.ts` files unless `import-x/extensions` includes `.ts` — it defaults to js/mjs/cjs and silently skips TypeScript. Both that setting and the nodenext `.js`-specifier resolver are configured in `eslint.config.mjs`; do not remove either.
- Agents working in this repo must Prettier-format only their own files (`npx prettier --write <paths>`), never repo-wide `npm run format`, which has already caused one cross-agent collision on concurrently-edited markdown.
- `.gitattributes` forces LF. Do not remove it; Prettier's default `endOfLine: "lf"` would otherwise fail `format:check` on a fresh Windows clone.
- zod v4 `.default(x)` substitutes `x` verbatim without re-running it through the inner schema, so nested defaults do NOT cascade. Nested defaults are derived via `Schema.parse({})`. Do not replace those with literals.
- zod v4 `unrecognized_keys` issues do not name the offending key in `issue.path` — the path points at the containing object and the key names sit in `issue.keys`. `formatIssuePath` alone is insufficient for that issue code; reuse `validate.ts`'s mapping.
- The zod schema _values_ are intentionally not exported from the package root, only the inferred types. Keeping them internal leaves the validation library swappable and prevents consumers bypassing `validateConfig`'s field-path errors.
- `topologySignature` deliberately excludes `colorDepth` and `displayFrequency` but includes `primary`. If placement logic ever becomes refresh-rate dependent, the supervisor upstream will swallow the events it needs — revisit the exclusion then, not before.
- `spanAll` downgrades to windowed for BOTH `kiosk` and `fullscreen`, because both snap to a single display in Electron. Do not restore kiosk-only handling.
- `duplicate-target` intentionally ignores placements with `displayId: null`, so two `spanAll` layers (background plus transparent overlay) do not warn. This exemption is deliberate.
- `bin` and the `./cli` subpath export are deliberately absent until Phase 5 — a `bin` entry pointing at a nonexistent script installs a broken CLI shim.
- Restart budgets in the process supervisor are tracked **per process id** and never shared, and the window supervisor's per-signature ledger works the same way. Both exist because a shared counter reset by activity about a _different_ subject is what defeated the original circuit breaker. Do not consolidate them into one counter.
- The I2 shell-spawn lint rule is deliberately blunt: no object literal anywhere under `src/**` may have a `shell` property. The narrow spawn-call-site form was bypassable via an aliased import or by building the options object in a variable. Do not "tidy" it back to the narrow form.
- Flat ESLint config **replaces** rather than merges a rule across matching blocks. Any new `no-restricted-syntax` selector must be added to every block that declares that rule, or it silently will not apply to those files.
- `touchSupport` beats the touch probe wherever it is not `'unknown'` (T2.12). Do not restore probe precedence.
- `shutdownAll` only sweeps a process tree on the force-kill path. Calling `taskkill` against an already-exited pid risks hitting a recycled pid, which is worse than doing nothing.
- `supervisor.dispose()` must be called before `shutdownAll`, never after or concurrently, or shutdown races the restart policy respawning what it just killed.
