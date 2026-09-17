# eggshell

CLI that owns the Electron process for kiosk installations. An exhibit repo holds one config file; eggshell handles windows, multi-display layout, child processes, logging, overlays, a remote dashboard and packaging.

Docs: [architecture](docs/architecture.md), [provenance and test checklist](docs/provenance.md), [provisioning hand-off](docs/provisioning.md), [contributing](CONTRIBUTING.md).

## Quick start

In an exhibit app repository:

```sh
npm install -D @littlevoid/eggshell
npx eggshell init
npm run dev
```

`eggshell.config.ts`:

```ts
import { defineConfig } from '@littlevoid/eggshell';

export default defineConfig(({ appDir, isDev }) => ({
  appId: 'com.example.my-app',
  productName: 'My App',
  windows: [{ id: 'main', url: isDev ? 'http://localhost:5173' : 'dist/index.html' }],
  processes: [
    {
      id: 'vite',
      command: 'npm',
      args: ['run', 'dev:vite'],
      phase: 'dev',
      readiness: { kind: 'tcp', port: 5173 },
    },
  ],
  dashboard: { enabled: true },
  companion: { enabled: true },
  build: {
    files: ['dist/**'],
  },
}));
```

Paths in `url` resolve relative to `eggshell.config.ts`.

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

| Section              | Default | Purpose                                                                                                         |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| `processes`          |         | Child servers per phase with readiness checks and restarts                                                      |
| `display`            |         | Display roles, touch probe, topology supervisor tuning                                                          |
| `logging`            | on      | Rotating file log under the app's user data directory                                                           |
| `keybindings`        | on      | `ctrl+q` quit, `ctrl+shift+i` devtools, `ctrl+shift+o` offline, `ctrl+shift+c` cursor, `ctrl+shift+?` companion |
| `cursor`             | auto    | Hidden in kiosk mode                                                                                            |
| `browserPermissions` | on      | Chromium permission allow-list (media, camera, microphone)                                                      |
| `chromiumFlags`      | on      | Kiosk switches, `force-device-scale-factor=1`                                                                   |
| `offline`            | on      | Overlay after the network has been gone for `timeoutMs`                                                         |
| `companion`          | off     | QR overlay pointing to a LAN URL                                                                                |
| `dashboard`          | off     | HTTP status/control API, live log console, web UI                                                               |
| `chromeExtensions`   | off     | Unpacked extensions to load                                                                                     |
| `soak`               | off     | Seeded random interaction for long test runs (dev only)                                                         |
| `build`              |         | Output dir, files to copy, extraResources, `dir` or `nsis`                                                      |

## Keyboard shortcuts

The shell captures shortcuts across all managed windows (`keybindings` config section):

| Shortcut                       | Command            | Action                   |
| ------------------------------ | ------------------ | ------------------------ |
| `Ctrl+Q` / `Cmd+Q`             | `app.quit`         | Quit application         |
| `Ctrl+Shift+I` / `Cmd+Shift+I` | `devtools.toggle`  | Toggle DevTools          |
| `Ctrl+Shift+O` / `Cmd+Shift+O` | `offline.toggle`   | Toggle offline overlay   |
| `Ctrl+Shift+C` / `Cmd+Shift+C` | `cursor.toggle`    | Toggle cursor visibility |
| `Ctrl+Shift+?` / `Cmd+Shift+?` | `companion.toggle` | Toggle companion overlay |

## Renderer API

The preload exposes `window.eggshell`:

- `invoke(channel, ...args)`: `app:quit`, `blackout:show`, `blackout:hide`, `state-sync:update`, `state-sync:send-event`, `state-sync:request-current`, `offline:status`, `companion:status`, `soak:status`.
- `on(channel, listener)`: `state-sync:on-update`, `state-sync:on-event`, `state-sync:on-request-current`. Returns an unsubscribe function `() => void`.
- `log.debug|info|warn|error(message, fields)`: lands in the shell log. Plain `console.*` is forwarded too.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for full development, linking, and testing instructions.

```sh
npm install
npm run build        # library + dashboard UI
npm run typecheck
npm test
npm run lint
npm run dev:ui       # dashboard UI with HMR against a running kiosk on :3005
```

## License

MIT
