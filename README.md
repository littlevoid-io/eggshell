# eggshell

An Electron kiosk-launcher, consumed as a library. Import it, call `launch(config)` from your own Electron main entry point, and get kiosk window management, multi-display layout resolution, child-process supervision, and optional add-on features (offline overlay, remote dashboard, companion QR overlay, a dev-only soak-test fuzzer).

It also doubles as the startup executable an external Windows-provisioning tool launches at logon: `build()` emits a discoverable launch manifest, and `doctor` gives that tool a preflight health gate with a meaningful exit code. See [`docs/provisioning.md`](docs/provisioning.md) for that contract.

> **Status:** pre-publish, unscoped, `private: true`. Not on the public npm registry — the bare name `eggshell` is already taken by an unrelated package. Consume via a `file:` dependency until a scope is decided (see `ROADMAP.md`'s open decisions).

## Why

The predecessor this package was extracted from made one bad assumption — it located its own root by walking up the filesystem — and that produced five contradictory config sources, build output written into its own dependency folder, and a full-machine lockup traced to a synchronous, timeout-less platform probe. `eggshell` is a clean-room rebuild with one rule: **every root is an explicit input, never discovered.** See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full layer diagram, the invariants that enforce this, and the lockup post-mortem that shaped the layout engine.

## Quick start

Scaffold a new consumer project:

```sh
npx eggshell init my-kiosk
cd my-kiosk
npm install
npm run dev
```

Or wire it into an existing Electron main entry directly:

```ts
import { app, BrowserWindow, screen, ipcMain } from 'electron';
import { launch, resolveRoots, systemClock } from 'eggshell';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const eggshellIndex = fileURLToPath(import.meta.resolve('eggshell'));
const preloadPath = path.join(path.dirname(eggshellIndex), 'preload.cjs');

app.whenReady().then(async () => {
  const roots = resolveRoots({
    projectRoot: __dirname,
    userDataRoot: app.getPath('userData'),
  });

  const result = await launch({
    config: {
      appId: 'com.example.my-kiosk',
      productName: 'My Kiosk',
      windows: [
        { id: 'main', url: 'https://example.com', target: { kind: 'primary' }, kiosk: true },
      ],
    },
    roots,
    app,
    screen,
    ipcMain,
    browserWindowFactory: options => new BrowserWindow(options),
    preloadPath,
    clock: systemClock,
  });

  if (!result.launched) {
    console.log('did not launch:', result.reason);
  }
});
```

See [`examples/basic-kiosk`](examples/basic-kiosk) for a complete, real, buildable consumer — multi-window layout with a touch-role target, offline overlay, and remote dashboard all enabled.

## CLI

```
eggshell dev         Start in development mode
eggshell build       Package a standalone build (electron-builder)
eggshell start       Launch a built production app, supervising its exit code
eggshell doctor      Preflight diagnostics; exits non-zero on a real failure
eggshell init [dir]  Scaffold a new consumer project
```

Every command reads config from `eggshell.config.{ts,mjs,js}` in the target project root. Run any command with `--help` for its flags.

## Plugins

Each is a subpath export (`eggshell/plugins/<name>`), imported and passed to `launch({ plugins: [...] })` explicitly — nothing is enabled by default.

| Plugin      | What it does                                                                |
| ----------- | --------------------------------------------------------------------------- |
| `offline`   | Shows an overlay when the configured reachability target is unreachable     |
| `dashboard` | A small HTTP status/control server, loopback-only unless given a token      |
| `companion` | A QR-code overlay pointing at a companion URL                               |
| `soak`      | A seeded, reproducible interaction fuzzer; refuses to run in a packaged app |

## Development

```sh
npm install
npm run build       # compile + copy plugin assets
npm test             # vitest
npm run typecheck
npm run lint
npm run smoke        # the full regression gate: lint, typecheck, test, build the example, doctor, manifest, a seeded soak run
```

`ROADMAP.md` is the living spec and status document — every task's scope, verification criteria, and what was actually found and fixed while verifying it.

## License

MIT
