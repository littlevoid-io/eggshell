# AGENTS.md

## Project overview

eggshell is a CLI that owns the Electron main process for kiosk installations. A consumer app holds one `eggshell.config.ts` file; `eggshell dev|build|start|doctor|init` does the rest — no consumer Electron main, no preload, no plugins.

Read [docs/architecture.md](docs/architecture.md) before making a structural change: it defines the layer boundaries, the config sections and their defaults, and the four invariants enforced by lint/tests. [docs/provenance.md](docs/provenance.md) tracks what was ported from the original shell this was rebuilt from and its test coverage. [docs/provisioning.md](docs/provisioning.md) covers deployment hand-off.

This is a monorepo: the root package is the eggshell CLI/library (published as `@littlevoid/eggshell`), and `ui/dashboard/` is an npm workspace (Vue 3, TypeScript, Tailwind 4, Vite) for the dashboard web UI. The project is pre-1.0 (`0.1.0`, `"private": true`) — breaking changes to unreleased APIs don't need back-compat shims.

## Dev environment tips

- Node >= 20, ESM only (`"type": "module"`); relative imports need an explicit `.js` extension even though the source is TypeScript.
- `npm install` at the root also installs the `ui/dashboard` workspace.
- To test against a real consumer app via `npm link`, rebuild the library after every change: `npm run build:lib`. The link picks up a rebuilt `dist/` immediately; it does not watch.
- `npm run dev:ui` runs the dashboard UI with HMR, proxying `/api` to a running kiosk's dashboard port.

## Verification matrix

Select the minimal verification tier matching `git diff --name-only`:

| Tier | Change scope | Applicable files | Required commands |
|---|---|---|---|
| **0** | Docs & non-runtime | `*.md`, `docs/**`, assets, `.gitignore` | None. Skip all builds and tests. |
| **1** | Single module / unit | `src/layout/**`, `src/config/**`, `src/process/**` | `npx vitest run <path-to-test>` (targeted test) |
| **2** | Dashboard UI | `ui/dashboard/**` | `npm run build:ui` (runs `vue-tsc --noEmit`) |
| **3** | Cross-cutting / PR gate | Multi-package, core contracts, dependencies | `npm run typecheck ; npm run lint ; npm test` |
| **4** | Pre-release build | Root `package.json`, release prep | `npm run build ; npm run format:check` |

### Verification rules

- **Fast-path exemption:** Never run tests, typechecks, or linters when touching only Tier 0 files.
- **Targeted test execution:** Run single-file tests (`npx vitest run <file>`) during iteration instead of the full ~460 test suite.
- **Dashboard isolation:** Edits inside `ui/dashboard/**` only require `npm run build:ui`. Do not run root `npm run typecheck` or full `npm test`.
- **Full gate trigger:** Run Tier 3 only when preparing PRs, modifying dependencies, or touching cross-layer contracts.

## Code style guidelines

- Layers point one way only: `cli -> shell -> layout/process -> config/paths/errors/logging`. `src/layout` and `src/process` never import Electron or anything Electron-touching.
- `src/layout/resolve.ts` and `src/layout/signature.ts` must stay pure: no `node:*`/`electron` imports, no `await`. Enforced by ESLint (`pure-core` block in `eslint.config.mjs`).
- Child processes always spawn through `execa` with an argv array. No `shell:` option, `exec`, or `execSync` (`argv-spawn`).
- `process.exit` only appears in `src/cli/bin.ts` (`cli-exits`).
- Validated config must round-trip through `JSON.stringify` unchanged (`config-data`; checked by a vitest test, not ESLint).
- Size limits, enforced by ESLint: 150 lines per file (`max-lines`), 20 lines per function (`max-lines-per-function`), nesting depth 3 (`max-depth`). Split into a sibling module rather than disabling the rule.
- Prefer an established library over hand-rolled code — see the library table in [docs/architecture.md](docs/architecture.md). The only hand-rolled state machines are the layout resolver, the topology supervisor and the process restart backoff; those have fake-clock tests and no adequate library covers a hidden-clock state machine.
- No `eslint-disable` or `@ts-ignore` without explaining why in the commit message.
- Comment only the non-obvious "why" (a hidden constraint, a cited upstream issue, a workaround). Don't restate what the code already says.

## Testing instructions

- Tests live next to the source file they cover (`foo.ts` / `foo.test.ts`), using Vitest.
- `src/config`, `src/layout`, and `src/process` are the pure core and are tested thoroughly.
- `src/shell/**` (the Electron-touching layer) is intentionally lighter on unit tests: code that just wires up a real `BrowserWindow`/`webContents` isn't unit-tested. Only pure logic pulled out of that layer (e.g. `isKioskEscape`) gets a test — don't force a unit test onto imperative Electron wiring; verify it by running the app instead.
- To verify Electron-side behavior that can't be unit-tested: `node dist/cli/bin.js dev --project-root <a consumer app>` (or `npm link` a scratch app) and read the shell's own structured logs rather than assuming success.

## Release instructions

- Release from `develop` branch with a clean working tree: `npm run release`.
- The CLI prompts for a SemVer bump, creates the release branch, bumps versions, merges to `main`, tags, merges back to `develop`, and pushes to GitHub.
- GitHub Actions (`.github/workflows/release.yml`) builds the package, creates the GitHub Release with the tarball, and runs `npm stage publish` via npm Trusted Publisher (OIDC).
- Approve the staged release on [npmjs.com](https://www.npmjs.com) or via `npm stage approve <stage-id>`.

## PR instructions

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`) — check `git log` for the established tone.
- Run the appropriate tier from the verification matrix before committing. Don't commit with failing checks.
- Keep commits scoped to one logical change; split unrelated fixes into separate commits.
