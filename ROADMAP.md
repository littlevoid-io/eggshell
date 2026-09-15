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
| electron-builder  | optional `peerDependency`, imported dynamically in `build()`                                          | Build-only; must not bloat a runtime install.                                                                                                                                                                                              |
| Public entry name | `launch(config)`                                                                                      | Domain-neutral name, replacing the prior installation-domain-specific name. See resolved decision 3 below.                                                                                                                                 |

## Deviations from the original six-phase plan

1. **Pure layout engine moved from Phase 3 into Phase 2.** The resolver and supervisor are dependency-free pure functions and `launch()` cannot be written correctly without them. Building `launch` first would mean rewriting it.
2. **Electron binding of `launch` moved from Phase 2 into Phase 3.** Phase 2 is now defined as _everything with zero Electron imports_, which makes all of it unit-testable without a display server.
3. **New Phase 0 (guardrails).** Requirements 2, 5 and 6 are invariants that rot silently; each gets an automated check before any code exists that could violate it.
4. **Four requirements added** beyond the original review, each a real unattended-installation failure mode: Electron `webPreferences` hardening + navigation guards (T3.2), single-instance lock (T3.5), crash/unresponsive watchdog (T3.6), graceful child shutdown (T2.9).
5. **Deployment override file added (T1.5).** Requirement 4 mandates a serializable schema specifically so a provisioning tool can override config without a rebuild; that feature was absent from the plan.
6. **T6.1 (example app skeleton) moved ahead of Phase 5.** T5.1, T5.3, and T5.4's own verify steps all say "run against the Phase 6 example" — but Phase 6 came after Phase 5 in task order, so those verify steps had no real target the first time through. Building `examples/basic-kiosk/` first gives every Phase 5 task something real to build/launch/diagnose against, rather than verifying by unit test and mock alone against a consumer shape nothing has actually exercised yet.

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
ShellConfig {
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

`src/config/validate.ts`: `validateConfig(input): ShellConfig` throwing `ConfigError` whose issues carry dotted field paths (`windows[1].target.kind`) (I7). Never exits, never warns-and-continues, never returns a partial config.
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

| ID    | Task                                       | Status |
| ----- | ------------------------------------------ | ------ |
| T2.1  | Display topology signature                 | done   |
| T2.2  | Pure layout resolver                       | done   |
| T2.3  | Touch probe interface + Windows impl       | done   |
| T2.4  | Window supervisor state machine            | done   |
| T2.5  | Port availability probe                    | done   |
| T2.6  | Safe argv spawn                            | done   |
| T2.7  | Readiness probes                           | done   |
| T2.8  | Process supervisor + restart policy        | done   |
| T2.9  | Graceful shutdown                          | done   |
| T2.10 | ShellContext + plugin registries           | done   |
| T2.11 | Permission + hardening policy (pure)       | done   |
| T2.12 | Touch-capability trust precedence fix      | done   |
| T2.13 | Close the orphaned-grandchild shutdown gap | done   |

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

### T2.13 — Close the orphaned-grandchild shutdown gap

`shutdownAll` swept a process tree only on the force-kill escalation path, so a supervised process that exited on its own within `graceMs` left its grandchildren alive, still holding TCP ports. The next launch's port pre-check then fails and the installation is dead until someone visits the venue. The module correctly refused to `taskkill` an already-exited pid, since Windows recycles pids and an unrelated process could inherit the number — so "always taskkill" was not an available fix.

Fixed with **no new dependency** by moving the tree-kill to signal time (`taskkill /PID <pid> /T`), keeping `/T /F` as the escalation. This is safe from pid recycling for the same reason the existing force path is: the pid is confirmed alive at the moment it is used. POSIX keeps real `SIGTERM` → `SIGKILL` semantics, where `graceMs` genuinely buys cleanup time; it is not degraded to match Windows.

Rejected: a real Win32 Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) is the theoretically correct primitive, but a registry investigation found **no maintained npm package wrapping it** — zero real hits. Corroborating evidence: `tree-kill` has ~35M weekly downloads and still shells out to `taskkill /T /F`. Hand-rolling via `koffi` is possible but its own issue tracker documents repeated Electron/asar packaging failures, and `@vscode/windows-process-tree` always compiles from source via node-gyp and only enumerates rather than kills. For a library every consumer pays that install cost, which is not worth it here.
**Verify:** empirical PoC measuring `taskkill /T` versus `/T /F` against a real parent-plus-grandchild holding a port, before implementing; plus a named regression test that a process exiting within `graceMs` still has its tree swept.

---

## Phase 3 — Electron integration

| ID   | Task                                              | Status |
| ---- | ------------------------------------------------- | ------ |
| T3.1 | Window manager (Electron binding of T2.2)         | done   |
| T3.2 | Hardening + permissions wiring                    | done   |
| T3.3 | Preload + IPC bridge                              | done   |
| T3.4 | `launch()` orchestration                          | done   |
| T3.5 | Single-instance lock                              | done   |
| T3.6 | Crash / unresponsive watchdog                     | done   |
| T3.7 | Display-change wiring (T2.4 to Electron `screen`) | done   |

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

`src/shell/launch.ts`: single-instance lock (T3.5) -> resolve roots (T1.2) -> validate config (T1.4) -> apply override (T1.5) -> start `production`/`always` processes and await readiness (T2.8) -> async touch probe (T2.3) -> `resolveLayout` (T2.2) -> create windows (T3.1) -> harden (T3.2) -> run plugin `setup` (T2.10) -> arm supervisor (T3.7) and watchdog (T3.6). Throws on fatal config/process errors; never calls `process.exit` (I6). Registers shutdown (T2.9) on `before-quit`. Fatal layout problems must fail loudly rather than produce a black window.

The lock comes first because it is a single synchronous call and the only gate that stops a second instance from doing any other work: taking it before config validation prevents a second instance from reading a deployment override file the provisioning tool may be mid-write, and makes a duplicate launch always fail the same way instead of surfacing a spurious config error that disguises the real cause.

Implementation requirements:

- Electron does **not** terminate the instance that loses the lock. It keeps a live event loop and whatever it already opened until something calls `app.quit()`. `launch()` must return a clearly-typed "did not launch" outcome and `bin.ts` must quit promptly, or an unattended machine leaks a process.
- `acquireSingleInstanceLock` must be called before `app.whenReady()`, since `second-instance` is only emitted after `ready` and a listener attached late can miss an early duplicate launch.
- Electron's `screen` module must NOT be touched before `app.whenReady()` — it throws. Display wiring therefore happens after ready, while the lock happens before it.
- `registerIpcBridge` must be called **exactly once process-wide**, never inside a per-window loop; Electron throws on a duplicate `ipcMain.handle` for the same channel.
- The IPC allow-list must be passed as a live getter (`() => registry.listIpcChannels()`), never an array computed once, because plugins register channels during `setup()` which runs after windows are created.
- `windowIdForWebContents` needs a `WeakMap<WebContents, string>` populated as each window is constructed, and mutable afterwards in case a plugin creates its own window.
- Shutdown ordering: `watchdog.disarm()` and `supervisor.dispose()` must both run **before** `shutdownAll`, or the watchdog resurrects windows and the restart policy respawns processes while shutdown is trying to stop them.

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

### What assembling Phase 3 revealed

Phase 2 was built as pure, independently-testable modules and Phase 3 wired them to Electron. Three defects existed only in the seams between modules that were each individually correct with thorough tests, and none was reachable without writing the real caller:

1. **`ProcessSupervisor` and `shutdownAll` did not compose.** The supervisor owned the process handles; shutdown needed them; nothing exposed them. `launch()` initially worked around it with an external tracking wrapper. Closed by `getHandles()`.
2. **The IPC allow-list was snapshotted before any plugin could register a channel.** The single-bridge-channel design existed specifically to avoid that ordering race, and the eager allow-list reintroduced it one layer up. Every test passed a hardcoded list, so the tests agreed with the code and both were wrong.
3. **The `app.whenReady()` seam is contradictory by nature.** One constraint requires work before ready, another forbids it. Each module only ever saw its own side.

The lesson for Phases 4-6: integration tasks are where cross-module defects surface, so the first real caller of any pair of modules should be treated as a design review of both, not merely as assembly.

---

### Process note: T4.2 was reverted (2026-09-14)

A first attempt at T4.2 (commit `cb45863`, reverted at `5381d09`) was built by directly reading and porting code from `cannes-villa-2026-demos` — including copying its prebuilt dashboard UI bundle byte-for-byte into `src/plugins/dashboard/assets/`. That repo is off-limits entirely: not just "don't write to it," but **don't read it, port from it, or treat it as reference material at all**. This whole package is a clean-room build — every requirement it needs to satisfy is already distilled into this file and the architecture notes above; the old repo exists only as the historical source of those lessons, already extracted, not something any task here should open. T4.1 (offline overlay) is the model to follow: built from this spec alone, no borrowed code or assets. Redo T4.2 the same way.

---

## Phase 4 — Plugins

| ID   | Task                                      | Status |
| ---- | ----------------------------------------- | ------ |
| T4.1 | Offline-network overlay                   | done   |
| T4.2 | Remote dashboard (localhost-only default) | done   |
| T4.3 | Companion QR/info overlay                 | done   |
| T4.4 | Soak-test fuzzer (dev-only)               | done   |

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

| ID   | Task                                    | Status |
| ---- | --------------------------------------- | ------ |
| T5.1 | `build()` via electron-builder Node API | done   |
| T5.2 | Launch manifest (versioned)             | done   |
| T5.3 | `startDev()` / `startProduction()`      | done¹  |
| T5.4 | `runDoctor()` diagnostics               | done   |
| T5.5 | CLI bin                                 | done   |
| T5.6 | `init` scaffolder                       | done   |

### T5.1 — `build()`

`src/build/build.ts`: compose the electron-builder config **in memory** and call its programmatic Node API (requirement 10) — no generated/committed JSON config inside the package. All output paths derive from the caller's `projectRoot`, never from `packageRoot` (I1 — the old code wrote build output into its own dependency folder). `electron-builder` imported dynamically with a clear error if absent. Throws, never exits (I6).
**Verify:** run against the Phase 6 example; assert artifacts land under the example's own `dist`/`release` and that nothing was written inside `node_modules/eggshell`.

### T5.2 — Launch manifest

`src/build/manifest.ts`: write `eggshell.launch.json` next to the built executable containing `{manifestVersion: 1, appId, productName, version, executablePath, builtAt, platform, arch}`. `manifestVersion` is a stability contract because an external provisioning tool (ZipTie) consumes it — document that additive fields are minor, removals/renames require a version bump. Absolute `executablePath` so no convention-guessing.
**Verify:** test the writer against a temp dir + schema assertion; build the example and read the real manifest.

### T5.3 — dev / start

`src/build/dev.ts`, `src/build/start.ts`: `startDev()` runs `phase: 'dev'|'always'` processes and launches Electron against the consumer's compiled main; `startProduction()` launches the built executable. Programmatic, throwing API. No nested install/compile (I8).
**Verify:** run both against the Phase 6 example.

¹ Unit-tested (mocked spawn/electron resolution, 593 tests) and reviewed twice (two independent passes, findings reconciled against the real code — see T7.3). Live verification — actually launching a real Electron window via `startDev()` against `examples/basic-kiosk/` — was deliberately **not** done in this session: a real Electron launch here coincided with a full machine crash under concurrent memory pressure (multiple background build/review jobs running at once), and the user chose to defer live verification rather than risk repeating it. Tracked as T7.3. Do the live run manually, alone, before relying on this in production.

### T5.4 — `runDoctor()`

`src/build/doctor.ts`: returns a structured `DoctorReport` of checks — platform/arch, Electron resolvable, config validates, required ports free (T2.5), display count vs. configured targets, touch probe result, plugin asset presence, write access to `userDataRoot`, override file parse. Each check is `pass|warn|fail` with a remediation string. Suitable as a provisioning gate, so the CLI must set a non-zero exit on any `fail` (exit happens in `bin.ts` only, I6).
**Verify:** run against the example; force a failure (occupy a port) and assert the specific check fails with non-zero CLI exit.

**Done.** All 9 checks run concurrently via `Promise.all`, each wrapped in `safelyRunCheck` with a 10s default timeout (`DoctorOptions.checkTimeoutMs`) racing the check's promise so a hung probe fails loudly instead of freezing the report forever. `checkConfigValidates`'s validated config (schema defaults applied) is threaded into the remaining 8 checks instead of the raw input.

A delegated review (flash tier) against the first implementation found, and a follow-up fix job confirmed fixed: `extractProcessPorts` (in `checks/ports.ts`) now parses a port out of `readiness.url` for `kind: 'http'` entries via the `URL` constructor (falling back to the scheme default port), not just `kind: 'tcp'` — verified live against a real port conflict on a port that appears _only_ in an http readiness URL; `findOccupiedPorts` no longer conflates "port checker rejected" with "port occupied" — a rejection surfaces as its own distinct "could not check port N" failure; `checkUserDataWriteAccess` no longer fails the whole check when the probe write succeeds but best-effort `unlink` cleanup fails.

Two further bugs were found independently — not by the delegated review — via my own live testing and manual code reading: `checkUserDataWriteAccess` originally failed on a merely-missing (but creatable) `userDataRoot`, which is the common case on a fresh machine before Electron's `app.getPath('userData')` has ever run; fixed by adding `fs.mkdir(root, { recursive: true })` before the write probe. Separately, `displays.ts`'s Windows PowerShell fallback (`queryWindowsDisplayCount`) had **no timeout at all** on its `execFile` call — the exact unbounded-child-process failure mode that originally justified this whole package's display-resolution design (see T2.3, T7.1). Fixed with `{ timeout: 3000, windowsHide: true }`. Neither of these was caught by either the delegated review or unit tests; both were found only by actually running the doctor against `examples/basic-kiosk/` and by reading every check file by hand.

### T5.5 — CLI bin

`src/cli/bin.ts` — the **only** file permitted to call `process.exit` (I6). Thin arg parsing over T5.1-T5.4; catches `EggshellError` and prints `code` + field paths, unknown errors with a stack. Commands: `dev`, `build`, `start`, `doctor`, `init`.
**Verify:** `npx eggshell doctor` exits 0 on a healthy example and non-zero on a forced failure; `--help` for each command.

**Done.** Five commands (`dev`, `build`, `start`, `doctor`, `init`), each a thin wrapper split into its own file under `src/cli/commands/`, plus shared helpers (`config-loader.ts` locates and dynamically imports `eggshell.config.{ts,mjs,js}` through `validateConfig()`; `roots.ts` derives a per-platform default `userDataRoot` from `productName`, mirroring Electron's own `app.getPath('userData')` convention; `manifest-search.ts` locates `eggshell.launch.json` via a single non-recursive scan of `<projectRoot>/release/`'s immediate subdirectories; `error-format.ts`/`termination.ts`/`usage.ts`). `package.json`'s `bin` and `./cli` export are now wired (deliberately deferred until this task, per the earlier note in this file).

Found and fixed one real bug during my own live verification, after the implementation job that wrote this timed out mid-report before reaching its own end-to-end check: `dev`/`start` always returned CLI exit code 0 regardless of whether the supervised app actually crashed, because `waitForTermination` discarded the child's real `ProcessExit`. Since this package's entire purpose is being a startup executable a provisioning tool (ZipTie) can monitor, a wrong exit code on crash is a real correctness bug. Fixed so a deliberate stop (SIGINT/SIGTERM to the CLI itself) or a clean exit (code 0) is CLI exit 0, and anything else (a nonzero code, or an external kill) is 1.

Live-verified end to end: built the real CLI, ran `init` to scaffold a fresh consumer, `npm install`ed it for real, ran `doctor` against it twice — once clean (all 9 real checks against this actual machine, overall `WARN`, exit 0) and once with a real port forced into conflict (the specific check `FAIL`s, overall `FAIL`, exit 1) — and confirmed global `--help`, per-command `--help`, no-command, and an unknown flag all exit and route stdout/stderr correctly.

### T5.6 — `init`

Scaffold a consumer project: `eggshell.config.ts`, an Electron main calling `launch`, tsconfig, scripts. Refuse to overwrite existing files.
**Verify:** run into a temp dir, then build and launch the scaffolded project.

**Done.** `scaffoldProject(options)` writes `eggshell.config.ts`, `src/main.ts`, `package.json`, `tsconfig.json`, `.gitignore` into `options.targetDir`; existing files are reported in `skippedFiles`, never overwritten. `appId`/`productName` default from the target directory's basename; `appId` is validated against the reverse-DNS pattern.

Two real bugs were found only through live verification, neither caught by unit tests or the delegated review: the generated `package.json` originally depended on `"eggshell": "*"` — but `eggshell` is squatted on the public npm registry by an unrelated, unmaintained package, so a real `npm install` in a scaffolded project silently installed the wrong package instead of failing loudly. Fixed by deriving the real local package root via `import.meta.url` (mirroring `roots.ts`'s `derivePackageRoot`) and depending on `file:<absolute-package-root>` instead — verified live end to end: rebuilt eggshell, scaffolded into a fresh temp directory, ran a real `npm install`, confirmed `node_modules/eggshell` was the real local package with real exports, and confirmed `tsc --noEmit` passes against the scaffolded project's generated `main.ts`. Separately, `toSingleQuotedLiteral` escaped backslashes and single quotes but not raw newlines, so a `productName` containing an embedded newline produced a syntactically invalid `eggshell.config.ts`/`main.ts` — confirmed via a real parse attempt, fixed by also escaping `\n`/`\r`.

---

## Phase 6 — Example kiosk & smoke harness

| ID   | Task                                | Status |
| ---- | ----------------------------------- | ------ |
| T6.1 | Example app skeleton                | done   |
| T6.2 | Multi-window + touch-role layout    | done   |
| T6.3 | Offline + dashboard plugins enabled | done   |
| T6.4 | Build + manifest hand-off doc       | done   |
| T6.5 | Soak run + CI smoke script          | done   |

### T6.1 — Example skeleton

`examples/basic-kiosk/` — its own `package.json` depending on `eggshell` via `file:../..`, its own Electron main, local static pages (no network dependency). Proves the package works as a consumer sees it, including that no path is discovered by walking up (I1).
**Verify:** `npm run dev` in the example opens a window.

### T6.2 — Multi-window + touch role

Two windows: one `{kind:'role', role:'touch'}`, one `{kind:'primary'}`; plus a commented `spanAll` + kiosk case documenting the deliberate downgrade. Must behave correctly on a single-display dev machine via the fallback path.
**Verify:** run on a single-display machine (fallback) and, if available, a two-display machine.

**Done.** `examples/basic-kiosk` now launches two windows: `main` (`{kind:'primary'}`, unchanged) and `touch` (`{kind:'role', role:'touch'}`, `fallback: 'primary'`, backed by a new `display.roles.touch = {touchCapable: true}` policy). The `spanAll`+`kiosk` contradiction is documented as an inert object literal with a comment, not a third active window.

Live-verified on this machine's real (non-touch) 2-display hardware: `role-unmatched` fires for the touch target exactly as expected, falls back to `primary`, both windows render distinct real content at their own non-overlapping bounds. Found and fixed while verifying: the delegated implementation's own documentation-only `spanAll` literal didn't typecheck in the example's own separate `tsc` build (it was typed against `WindowConfig`, the schema's fully-resolved _output_ type, while written as a partial literal — invisible to the repo root's own `npm run typecheck`, which doesn't compile `examples/**`). Also found, while reviewing this task's diff, that `launch()` itself never called `loadURL` anywhere — the delegated implementation had worked around this with a per-consumer `loadURL` call in `main.ts`; the real fix belongs in the library (see `dbfcab8`), so that workaround was removed once the core fix landed.

### T6.3 — Plugins enabled

Enable offline overlay + dashboard (loopback, no token) and exercise the ShellContext registries.
**Verify:** overlay appears when the reachability target is blocked; dashboard reachable on `127.0.0.1` and refused from a LAN address.

**Done.** `examples/basic-kiosk` registers both plugins via `launch({ plugins: [createOfflinePlugin(), createDashboardPlugin()] })`, with `plugins.offline`/`plugins.dashboard` config slices; dashboard stays on its default `127.0.0.1` host, no token.

Live-verified against a real running instance: `GET http://127.0.0.1:3005/api/status` returned real live status JSON (including both T6.2 windows with their real loaded `file://` URLs); a real TCP connect to this machine's actual LAN IP on port 3005 got a real `ECONNREFUSED`, proving genuine loopback binding, not just configuration; `result.pluginRegistry.getFailures()` returned `[]` after a real launch, directly proving neither plugin's `setup()` threw (no visual overlay check was possible from the CLI, but this is stronger, direct evidence than inferring from a log line).

### T6.4 — Manifest hand-off doc

`docs/provisioning.md`: the ZipTie contract — where `eggshell.launch.json` lands, its schema, versioning policy, and the recommended startup-task invocation. Include a real manifest from a real build.
**Verify:** manual read against an actual built artifact.

**Done.** Covers artifact location/discovery (the unpredictable per-platform `release/` subdirectory, hence the CLI's bounded scan), the real `LaunchManifest` schema, the `manifestVersion` versioning policy, the recommended `eggshell start` invocation and its exit-code contract, the platform/arch guard, and the package's current pre-publish distribution state.

Two issues found and fixed during my own verification, not caught by the implementing job's own self-report: every source cross-reference used an absolute `file://` URL scoped to that task's own git worktree path, which would have been wrong the moment it merged — replaced with plain repo-relative code spans. More significantly, the doc's "real manifest output" example presented specific verbatim JSON including a timestamp, but no `eggshell.launch.json` existed anywhere on disk in that worktree by the time I checked — only a real, fully-packaged `release/win-unpacked/` directory with real Electron binaries (so `build()` had genuinely run; the manifest-writing step's own output was just gone by the time I looked, and the doc's own instructions to confirm `release/` isn't left untracked may have been misread as a cleanup step). Rather than trust unverifiable content, I reproduced a fresh real `build()` call independently in the main repo (not the worktree, so the example's `executablePath` is the real path this doc will actually ship at) and replaced the example with that verified-on-disk content.

### T6.5 — Smoke script

A single `npm run smoke` at the repo root: lint, typecheck, unit tests, build the example, run `doctor`, assert the manifest, run a short seeded soak. This is the regression gate for every later change.
**Verify:** the script passes end-to-end from a clean clone.

**Done, completing Phase 6.** `scripts/smoke.mjs` (+ `smoke-command.mjs`/`smoke-example.mjs`) runs all 8 steps, failing loudly on the first real failure, with full cleanup in a `finally` (build artifacts and the temp soak directory) so a failed run never poisons the next. The soak step injects `createSoakPlugin()` into the example without touching its committed source, via a temporary compiled-output patch plus a deployment-override file (T1.5) carrying the real plugin config — `startDev()`'s own `config` parameter cannot do this, since it only ever reads `config.processes`.

Live-verified for real, twice in a row: both runs built the example, ran all 9 doctor checks against real hardware, validated a real manifest, and completed a real 5-action seeded soak with 0 crashes — with `git status` and a real process check confirming full cleanup after each run. One dead-code finding from my own review, fixed: the implementing job also built and passed a duplicate, unused `soakConfig` to `startDev()`, which does nothing there (the deployment-override file was already the real mechanism) — removed.

---

## Open decisions needing a human call

Tracked in the lead architect's report; summarised here.

| #   | Question                                                                                                                                                                                                                    | Recommendation                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Package name / npm scope — `eggshell` is likely taken on the public registry                                                                                                                                                | Keep `eggshell` locally; plan a scope (`@<org>/eggshell`) before any publish                                                                                                                                                                                                |
| 2   | License                                                                                                                                                                                                                     | MIT unless the venue work requires otherwise; currently unset                                                                                                                                                                                                               |
| 3   | Prior installation-domain-specific entry-point name vs a domain-neutral name                                                                                                                                                | **Resolved:** renamed to `launch`; the old name was installation-domain vocabulary in a package sold as generic                                                                                                                                                             |
| 4   | Soak: subpath export vs separate package                                                                                                                                                                                    | Subpath now + a documented electron-builder exclusion; separate package only if the exclusion proves unreliable                                                                                                                                                             |
| 5   | Windows touch detection mechanism                                                                                                                                                                                           | Behind `TouchProbe`, so the choice is deferrable and swappable                                                                                                                                                                                                              |
| 6   | Schema defaults invented where the brief was silent: `window.kiosk: true`, `window.showWhenReady: true`, `window.fallback: 'primary'`, plus the supervisor/restart/touchProbe numerics                                      | Reasonable but arbitrary, and now load-bearing behaviour. Worth a deliberate sign-off rather than inheritance by default                                                                                                                                                    |
| 7   | `window.url` accepts any non-empty string rather than a validated URL                                                                                                                                                       | Kept permissive so local file paths still work; `doctor` should warn instead. Revisit once window-loading semantics are fixed                                                                                                                                               |
| 8   | An explicit absolute `deploymentOverridePath` is not containment-checked, unlike every other path in the package                                                                                                            | Intentional — a provisioning tool may stage the file anywhere readable. Confirm this relaxation is acceptable                                                                                                                                                               |
| 9   | `display.label` is included in the topology signature and can change on a driver update without the physical layout changing                                                                                                | Required, because role rules match on it. Watch for driver-triggered re-applies in the field                                                                                                                                                                                |
| 10  | Ship the Windows touch probe at all? Post-T2.12 it can only break a tie when Electron reports `'unknown'`, and its ids are unverified WMI ordinals                                                                          | **Still open, non-urgent.** Keep default-off. T7.1 tracks the investigation into whether a WMI-ordinal-to-`Display.id` correlation exists at all, which is what would settle keep-versus-remove. Already `enabled: false` by default, so nothing is blocked in the meantime |
| 11  | Grandchildren of a process that exits within `graceMs` are not swept and can keep holding ports                                                                                                                             | **Resolved:** a zero-dependency `taskkill /T`-at-signal-time fix was chosen over a Win32 job-object/FFI implementation, since no maintained job-object npm package exists. T2.13 implements it                                                                              |
| 12  | Main→renderer push primitive for plugins (`windows.send`) is deliberately absent; `status` is pull-only                                                                                                                     | Additive, so safe to defer. Design it against the offline overlay's real requirement in Phase 4 rather than guessing the shape now                                                                                                                                          |
| 13  | Naming consistency: `launch()` takes a `ShellConfig` and sits beside `build()`/`loadShellConfig()`                                                                                                                          | **Resolved:** `ShellConfig`. Pairs with the already-established `ShellRoots`/`ShellContext`/`ShellPlugin` and the `src/shell/` directory; `KioskConfig` was rejected because `kiosk` is already a boolean field on `WindowConfig`                                           |
| 14  | The IPC allow-list is currently one global list shared by every window. Once a companion/dashboard overlay gets its own trusted `BrowserWindow` alongside a main window showing remote content, a per-window list is needed | Not yet blocking — there is only one window today. Revisit when the first plugin creates its own window in Phase 4; `windowIdForWebContents` is already per-call, so the shape allows it                                                                                    |

## Progress log

| Commit    | Scope                                                                                                  | Verified by                                                                                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3891c51` | T0.1, T0.3, T0.4 — toolchain, ARCHITECTURE.md, formatting conventions                                  | `typecheck`, `build`, `test`, `format:check` all exit 0; typescript-eslint parser loads under the pinned TS 6.x                                                                                                                                                                             |
| `30ffd96` | T0.2 — eslint invariant enforcement                                                                    | all 10 invariant rules verified firing against on-disk fixtures; both intended exemptions (`process.exit` in `src/cli/bin.ts`, `process.cwd()` in `src/cli/**`) verified silent; `import-x/no-cycle` verified firing on a real two-file cycle                                               |
| `d1cda71` | T1.1, T1.3, T1.6 — errors, config schema, logging seam                                                 | 50 tests; I4 JSON round-trip on a maximal fixture; schema rejects function values                                                                                                                                                                                                           |
| `ec08f9a` | T1.2, T1.4 — explicit path roots, config validation                                                    | 83 tests; containment rejects `../` escapes and sibling-directory false positives; field paths asserted exactly                                                                                                                                                                             |
| `9af7835` | T1.5, T2.1 — deployment overrides, topology signature                                                  | 113 tests; array-replace and prototype-pollution guards; `colorDepth`/`displayFrequency` exclusion regression tests                                                                                                                                                                         |
| `1ca15d7` | T2.2, T1.7 — pure layout resolver, public exports map                                                  | 141 tests; pure-zone lint proven to reject `node:fs` and `async` in `resolve.ts`; all 8 problem codes emitted, none dead                                                                                                                                                                    |
| `6f93015` | Owner decisions — MIT license, `eggshell` unscoped/private, old domain-specific launch name → `launch` | rename verified 0 remaining hits; package fields asserted                                                                                                                                                                                                                                   |
| `a53d13a` | T2.4 — window supervisor                                                                               | 179 tests; flap regression proven to fail against the pre-fix implementation                                                                                                                                                                                                                |
| `923f9dc` | T2.5, T2.6, T2.11 — port probe, safe spawn, permission policy                                          | 226 tests; substring-match and lookalike-origin regressions; env-inheritance test                                                                                                                                                                                                           |
| `a6d49ff` | I2 lint hardening                                                                                      | two proven bypasses (aliased import, options-via-variable) now blocked, verified in a zone-overridden directory too                                                                                                                                                                         |
| `e598f6d` | T2.7 — readiness probes                                                                                | 240 tests; abort and timeout paths assert zero pending timers                                                                                                                                                                                                                               |
| `f648f2a` | T2.3, T2.8, T2.10, T2.12 — touch probe, process supervisor, plugin seam, precedence fix                | 303 tests; I5 verified by grep as well as lint; `dist/__testing__` absent                                                                                                                                                                                                                   |
| `bc0a30b` | T2.9 — graceful shutdown, completing Phase 2                                                           | 315 tests; shutdown-does-not-trigger-restart-policy test; suite still ~1.5s, so no real timers                                                                                                                                                                                              |
| `49fe0a6` | Domain-neutral rename — `ExhibitConfig` → `ShellConfig`                                                | zero remaining matches repo-wide; 315 tests unchanged; 19 runtime exports, no schema values leaked                                                                                                                                                                                          |
| `246f443` | T2.13 — signal-time process-tree sweep                                                                 | measured PoC: `taskkill /T` without `/F` errors and leaves the port held; `/T /F` frees it                                                                                                                                                                                                  |
| `806cd22` | T3.1, T3.2 — Electron window manager and hardening wiring                                              | 353 tests; windowed-mode clears kiosk+fullscreen in asserted order; zero policy logic duplicated into the adapter                                                                                                                                                                           |
| `1723631` | T3.3 — preload and IPC bridge                                                                          | 372 tests; allow-list ordering race caught in review and fixed; `dist/preload.cjs` verified real CommonJS                                                                                                                                                                                   |
| `85f9efc` | T3.5, T3.6 — single-instance lock and crash watchdog                                                   | 391 tests; per-window reload ledgers plus a global ceiling; `unresponsive` grace armed once per hang so a permanently frozen page cannot dodge the deadline                                                                                                                                 |
| `00a6ac7` | T3.7 — display-event wiring, plus supervisor tuning exposed in config                                  | 410 tests; probe-not-called-from-event-path regression test; 2px verify tolerance                                                                                                                                                                                                           |
| `912997f` | T3.4 — `launch()` orchestration, completing Phase 3                                                    | 423 tests; ordering tests for the `whenReady()` seam, single-instance short-circuit, and shutdown race                                                                                                                                                                                      |
| `0d8273d` | `ProcessSupervisor.getHandles()` — closes the T2.8/T2.9 composition gap                                | 430 tests; handle currency across restarts; liveness keyed to spawn, not readiness                                                                                                                                                                                                          |
| `b1936d8` | T5.4 — `runDoctor()` preflight diagnostics                                                             | 621 tests; live-verified http-readiness port extraction against a real port conflict; independently-found userDataRoot and PowerShell-timeout bugs fixed and re-verified                                                                                                                    |
| `ae98792` | T5.6 — `scaffoldProject()` init scaffolder                                                             | 629 tests; live end-to-end npm install + tsc against a real scaffolded project; independently-found npm-registry-name-squatting and newline-escaping bugs fixed and re-verified                                                                                                             |
| `b203eb9` | T5.5 — CLI bin, completing Phase 5                                                                     | 654 tests; live end-to-end init+install+doctor(pass/fail via forced port conflict)+--help against a real scaffolded consumer; independently-found dev/start-always-exits-0-on-crash bug fixed and re-verified                                                                               |
| `dbfcab8` | Core fix: `launch()` never called `loadURL` - every window was permanently blank                       | 656 tests; live-verified against examples/basic-kiosk with a temporary did-finish-load probe (reverted, not committed) - `document.title` now reads real content instead of blank; found while reviewing a parallel T6.2 worktree's own per-consumer workaround for the same underlying gap |
| `4031a0d` | T6.2 — multi-window + touch-role layout                                                                | 656 tests; live-verified role-unmatched -> primary fallback on real non-touch hardware, both windows rendering distinct real content; independently-found example-only tsc error and a redundant loadURL workaround fixed/removed                                                           |
| `9b30001` | T6.4 — provisioning hand-off doc                                                                       | 656 tests; independently-found and fixed worktree-scoped absolute links and an unverifiable manifest example - replaced with a freshly reproduced, on-disk-verified real build() manifest                                                                                                   |
| `330533e` | T6.3 — offline + dashboard plugins enabled                                                             | 656 tests; live-verified real dashboard HTTP status response, real LAN-bind refusal (ECONNREFUSED), and getFailures() == [] proving both plugins' setup() succeeded                                                                                                                         |
| `1e2b703` | T6.5 — `npm run smoke`, completing Phase 6                                                             | 656 tests; ran the full 8-step smoke suite for real twice in a row (build+doctor+manifest+seeded soak), confirmed full artifact cleanup and no orphaned processes after each run; removed a dead unused parameter found during my own review                                                |

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
- `registerIpcBridge` must be called **exactly once process-wide**, never inside a per-window loop — Electron throws on a duplicate `ipcMain.handle` for the same channel. The `windowIdForWebContents` indirection is what makes one handler correct for N windows.
- The IPC allow-list must be passed as a **live getter** (`() => registry.listIpcChannels()`), never a literal computed once. Plugins register channels during `setup()`, which runs after windows are created, so a snapshot is always empty. The type accepts a plain array just as happily, so this cannot be caught at compile time.
- `windowIdForWebContents` needs a `WeakMap<WebContents, string>` populated at window construction, and mutable afterwards if a plugin's `setup()` can create its own window.
- The IPC allow-list is a gate **independent** of whether a channel is registered. Plugin channels serve the shell's own trusted overlays; the main window may show remote content. Do not collapse the two.
- `applyKioskLock` cannot block OS-level shortcuts (Alt+Tab, Ctrl+Alt+Del, the Windows key) — `before-input-event` does not reach them. Window hardening is not machine lockdown; that is the provisioning tool's job.
- `resolveLayout`'s bounds arithmetic assumes uniform DIP points per Electron's documented model. Untested on mixed-DPI multi-monitor rigs.
- Electron's `requestingOrigin` exists only on the synchronous permission **check** handler, not the request handler, which carries `requestingUrl`. Each handler has its own origin-determination fallback; neither may fall back to `webContents.getURL()`, which returns the top frame and would be the iframe bypass.
- `launch()` has ordered work on **both sides** of `app.whenReady()`, and it is not optional: the single-instance lock must be acquired before ready (a late `second-instance` listener misses an early duplicate launch), while `screen` throws if touched before ready. Do not "tidy" all setup to one side.
- `ProcessSupervisor.getHandles()` keys handle liveness to **spawn** success, not readiness. Gating on readiness would hide a process whose readiness probe timed out while its OS process still runs, making it invisible to `shutdownAll` and orphaning a port.
- Fatal (`error`-severity) layout problems throw before any window is created, and `display-events.ts` applies the same rule to later re-resolutions. One policy at startup and in steady state, so no window is ever silently black.
- The supervisor's Tier 2 options are `maxGlobalAttempts`/`globalRateWindowMs`, matching `watchdog.ts`. The word "window" never means a time span in this codebase — it means a `BrowserWindow`.
- `buildWindows()` in `launch.ts` calls `window.native.loadURL(windowConfig.url)` itself (fire-and-forget, rejection caught and logged) — a consumer's own `main.ts` must never call `loadURL` a second time on a window `launch()` created, that would be a redundant/conflicting navigation. This was missing entirely until `dbfcab8`; if a window ever appears blank again, check this exact call is still present before assuming the bug is somewhere else.

---

## Phase 7 — Backlog (non-blocking)

Tracked work that blocks nothing and is deliberately not scheduled.

| ID   | Task                                                             | Status |
| ---- | ---------------------------------------------------------------- | ------ |
| T7.1 | Investigate WMI-ordinal to Electron `Display.id` correlation     | todo   |
| T7.2 | Diagnose intermittent `src/process/` test failure                | todo   |
| T7.3 | Live-verify `startDev()`/`startProduction()` against the example | done   |
| T7.4 | Soak fuzzer: viewport sizing and single-window targeting         | todo   |

### T7.1 — Investigate WMI-ordinal to Electron `Display.id` correlation

Investigation, not implementation. The Windows touch probe returns WMI `Win32_PointingDevice` enumeration-order ordinals, and no known public API correlates them to Chromium's opaque, session-scoped `Display.id`. T2.12 confined the probe to acting only as a tiebreaker when Electron reports `touchSupport: 'unknown'`, which makes this non-urgent.

Worth establishing: whether WMI enumeration order is stable and matchable against Electron's display enumeration on real multi-monitor hardware; whether a different Windows API (monitor EDID/device-instance paths, `SetupAPI`, `Win32_DesktopMonitor`, `Win32_PnPEntity` associations) carries a correlation Chromium also exposes; and whether Electron's own `touchSupport` is simply sufficient in practice, which would let the probe be deleted outright.

Deliverable is a written finding plus a recommendation to keep, fix, or remove the probe — **not** a speculative implementation. If no reliable correlation exists, removing the probe is a legitimate and preferred outcome.
**Verify:** a written finding backed by observation on real multi-monitor touch hardware, not inference.

### T7.2 — Diagnose intermittent `src/process/` test failure

Caught while verifying T4.4 (unrelated to it — soak touches none of `src/process/`): `npm test` failed once in 18 consecutive runs, a `ProcessError` assertion mentioning `'my-proc'`, message content not captured before it passed again on retry. Not reproduced in 17 further runs. Smells like a timing-sensitive test (a real timer or real port rather than a fake clock) rather than a logic bug, but that's inference, not a finding.

**Verify:** reproduce reliably (loop `npm test` with output captured on failure, or run the suspect file alone many times with `--reporter=verbose`), identify the exact test and assertion, then fix the flake at its source (almost certainly: inject a fake clock/deterministic port the way the rest of `src/process/` already does) rather than retrying past it.

### T7.3 — Live-verify `startDev()`/`startProduction()` against the example

T5.3 was unit-tested (mocked spawn/Electron resolution) and independently reviewed twice, but never actually run end-to-end. Done in isolation (nothing else running) after the earlier crash: **both work**, but `startProduction()` initially failed hard — a real, confirmed, blocking bug neither review pass caught.

`startProduction()` threw `ProcessError: command "...\Basic Kiosk Example.exe" contains whitespace ...` — `spawnManaged`'s own I2 safety guard (`assertSafeCommand` in `src/process/spawn.ts`) rejected the built executable's own path, because electron-builder's default `<productName>.exe` naming contains a space and the guard's original whitespace check made no exception for a real, existing file. The guard's own doc comment inadvertently proved the bug: it cited `C:\Program Files\node\node.exe` as an example of "a real path that must remain usable" while justifying excluding backslash/colon — that exact example path contains a space and would have been rejected by the guard's own code.

**Fixed**: `assertSafeCommand` now only rejects whitespace when the literal path does _not_ exist as a real file on disk (`existsSync`); genuine shell metacharacters are still always rejected unconditionally. A new regression test copies a real executable to a path with a space and confirms it's now accepted, alongside the existing test proving `"node -e 1"` (a real mashed-together mistake, not a real file) is still correctly rejected. Re-verified live after the fix: `startProduction()` launches the real built `.exe` and `handle.stop()` cleanly terminates it, confirmed via Task Manager (no orphaned process). `startDev()` worked on the first attempt.

The soak fuzzer (T4.4) was also live-verified in this pass: real synthetic actions were generated and dispatched via `executeJavaScript`, and a real report with real recorded actions was produced. See T7.4 for two lower-severity gaps found during that check.

### T7.4 — Soak fuzzer: viewport sizing and single-window targeting

Found live-testing T4.4 against a real 800×600 window: the report's recorded actions included coordinates like `(1694, 921)`, well outside the actual window. `ActionGenerator` (`src/plugins/soak/generator.ts`) defaults to a hardcoded 1920×1080 viewport unless the caller overrides `viewportWidth`/`viewportHeight` — but `plugin.ts` never wires the real target window's actual bounds through, so every window smaller (or larger, or a different aspect ratio) than 1920×1080 gets synthetic clicks aimed partly outside its own content, landing on `document.body` via `buildActionScript`'s fallback instead of varied real elements.

Separately, `executor.ts`'s `findTargetWindows`/`executeFuzzStep` always fuzzes only `targets[0]` — if `targetWindowIds` names several windows (or none, and several exist), only the first ever receives synthetic input; the others are never exercised.

Neither is a safety or correctness bug — the fuzzer runs, produces a real report, and never crashes because of this — but both reduce how much of a real multi-window/non-1920×1080 kiosk install (exactly this project's actual target shape) actually gets fuzzed.

**Verify:** query each target window's real `getContentBounds()` and pass it into the generator (per-window if bounds differ), and rotate `executeFuzzStep` across all resolved targets rather than only the first. Re-run the live check from T7.3 against a non-default window size and confirm generated coordinates stay within the real bounds, and that a multi-window config exercises more than one window.
