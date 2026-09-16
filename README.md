# eggshell

CLI that owns the Electron process for kiosk installations. An exhibit repo holds one config file; eggshell handles windows, multi-display layout, child processes, logging, overlays, a remote dashboard and packaging.

Docs: [architecture](docs/architecture.md), [provenance and test checklist](docs/provenance.md), [provisioning hand-off](docs/provisioning.md).

## Quick start

Until eggshell is published, link the local checkout once:

```sh
cd <eggshell checkout> && npm install && npm run build && npm link
```

Then in the app repo:

```sh
npm link @littlevoid/eggshell   # symlinks node_modules/@littlevoid/eggshell to the checkout
eggshell init            # writes eggshell.config.ts, package scripts, .gitignore, public/index.html
npm run dev
```

`init` derives `appId` (`local.<folder>`, replace it with e.g. `littlevoid.<name>`; any two-plus dotted lowercase segments work) and `productName` from the folder name unless `--app-id` / `--product-name` are given, and records `@littlevoid/eggshell` as a dev dependency. Do not run `npm install` in the app repo before it is published. Rebuilding the checkout (`npm run build`) is picked up by the link immediately.

`eggshell.config.ts`:

```ts
import { defineConfig } from '@littlevoid/eggshell';

export default defineConfig(({ appDir, isDev }) => ({
  appId: 'com.example.mural',
  productName: 'Mural',
  windows: [{ id: 'main', url: isDev ? 'http://localhost:3000' : 'public/index.html' }],
  processes: [
    {
      id: 'server',
      command: 'node',
      args: ['dist/server.js'],
      phase: 'production',
      readiness: { kind: 'tcp', port: 3001 },
    },
  ],
  dashboard: { enabled: true },
}));
```

A window `url` without a scheme is a file path relative to the config file.

## Commands

| Command           | Does                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------- |
| `eggshell init`   | Adds eggshell to the current directory. Never overwrites existing keys.               |
| `eggshell dev`    | Runs `dev`/`always` processes, opens the kiosk, colors logs, prints the dashboard QR. |
| `eggshell build`  | Packages into `release/` with electron-builder and writes a launch manifest.          |
| `eggshell start`  | Runs the packaged executable from the manifest and relays its exit code.              |
| `eggshell doctor` | Prints the resolved config with defaults, paths and Electron version.                 |

Add `--help` for flags.

## Config sections

Required: `appId`, `productName`, `windows`. Everything else is optional; `eggshell doctor` shows the resolved defaults.

| Section              | Default | Purpose                                                                 |
| -------------------- | ------- | ----------------------------------------------------------------------- |
| `processes`          |         | Child servers per phase with readiness checks and restarts              |
| `display`            |         | Display roles, touch probe, topology supervisor tuning                  |
| `logging`            | on      | Rotating file log under the app's user data directory                   |
| `keybindings`        | on      | `ctrl+q` quit, `shift+o` offline, `shift+c` cursor, `shift+?` companion |
| `cursor`             | auto    | Hidden in kiosk mode                                                    |
| `browserPermissions` | on      | Chromium permission allow-list (media, camera, microphone)              |
| `chromiumFlags`      | on      | Kiosk switches, `force-device-scale-factor=1`                           |
| `offline`            | on      | Overlay after the network has been gone for `timeoutMs`                 |
| `companion`          | off     | QR overlay pointing to a LAN URL                                        |
| `dashboard`          | off     | HTTP status/control API, live log console, web UI                       |
| `chromeExtensions`   | off     | Unpacked extensions to load                                             |
| `soak`               | off     | Seeded random interaction for long test runs (dev only)                 |
| `build`              |         | Output dir, files to copy, extraResources, `dir` or `nsis`              |

## Renderer API

The preload exposes `window.eggshell`:

- `invoke(channel, ...args)`: `app:quit`, `blackout:show`, `blackout:hide`, `state-sync:update`, `state-sync:send-event`, `state-sync:request-current`, `offline:status`, `companion:status`, `soak:status`.
- `on(channel, listener)`: `state-sync:on-update`, `state-sync:on-event`, `state-sync:on-request-current`.
- `log.debug|info|warn|error(message, fields)`: lands in the shell log. Plain `console.*` is forwarded too.

## Development

```sh
npm install
npm run build        # library + dashboard UI
npm run typecheck && npm test && npm run lint
npm run dev:ui       # dashboard UI with HMR against a running kiosk on :3005
```

## License

MIT
