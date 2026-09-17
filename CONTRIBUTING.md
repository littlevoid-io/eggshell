# Contributing to eggshell

## Prerequisites

- Node >= 20
- ESM only (`"type": "module"`)

## Setup

```sh
npm install
npm run build
```

## Local Testing with Consumer App

Link the local build to test changes in an exhibit app:

```sh
# In eggshell checkout
npm link

# In the consumer app repository
npm link @littlevoid/eggshell
```

Rebuild after modifying eggshell source. Linked apps pick up changes from `dist/` immediately:

```sh
npm run build:lib
```

To run the dashboard web UI with HMR (proxies `/api` to port 3005):

```sh
npm run dev:ui
```

## Validation Gate

Run all checks before committing:

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

## Code Guidelines

- **Architecture Layers**: Flow is strictly one-way: `cli -> shell -> layout/process -> config/paths/errors/logging`.
- **Pure Core**: `src/layout/resolve.ts` and `src/layout/signature.ts` must remain pure (no Node/Electron imports, no async).
- **Spawn**: Spawn child processes using `execa` with argv arrays only (no `shell: true`).
- **Limits**: Maximum 150 lines per file, 20 lines per function, nesting depth 3.
- **Commits**: Follow Conventional Commits format (`feat:`, `fix:`, `refactor:`, `chore:`).
