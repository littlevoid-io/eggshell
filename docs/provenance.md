# Provenance

Maps every field-tested feature of the original shell (`cannes-villa-2026-demos/shell`) to its eggshell location. Doubles as the manual test checklist: each row's "Test" column is executed before a release.

Status: `ported` (behavior carried over) | `rewritten` (new implementation, same intent) | `todo` | `dropped` (with reason).

## Startup and CLI

| Original                                                            | eggshell                                                                    | Status    | Test                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------- |
| `electron.config.ts` factory `({appDir,isDev})`                     | `eggshell.config.ts` via `defineConfig`, loaded by `src/cli/load-config.ts` | rewritten | `eggshell doctor` prints resolved config; typo yields field path |
| `--app=` / `EXHIBIT_APP` / `.env` resolution                        | Config file location = `appDir`                                             | dropped   | Multiple sources caused ambiguity; one file is the source        |
| `scripts/dev.ts` (tsc watch + Vite + Electron)                      | `eggshell dev` (`src/cli/commands/dev.ts`)                                  | rewritten | Vite process starts, window loads after readiness                |
| `scripts/build.ts` (electron-builder per app)                       | `eggshell build`                                                            | rewritten | `release/win-unpacked/<Product>.exe` runs                        |
| `scripts/startPackaged.ts`                                          | `eggshell start`                                                            | rewritten | Launches built exe, exits with app exit code                     |
| `PARENT_PID` watchdog (quit when runner dies)                       | `src/shell/lifecycle.ts` `watchParent`                                      | rewritten | Kill `eggshell dev` terminal; Electron exits within 2 s          |
| `applyExhibitFlags` (Chromium command-line switches)                | `src/shell/chromium-flags.ts`                                               | ported    | `force-device-scale-factor=1` visible in `chrome://version`      |
| `keepDisplayAwake` (powerSaveBlocker)                               | `src/shell/lifecycle.ts`                                                    | ported    | Display stays on past OS sleep timeout                           |
| `setupPermissions` (Chromium permission requests: media/camera/mic) | `browserPermissions` section                                                | rewritten | `getUserMedia` succeeds without prompt                           |
| `remote-debugging-port=9223` in dev                                 | `src/shell/chromium-flags.ts`                                               | ported    | `chrome://inspect` finds the window                              |

## Windows and layout

| Original                                       | eggshell                                                                 | Status    | Test                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------ | --------- | ------------------------------------------------------------ |
| `WindowManager` create/lock/focus              | `src/shell/windows/create.ts`                                            | rewritten | Kiosk window opens, always-on-top, no context menu           |
| `layoutRole` touch/primary/largest/span-all    | `windows[].target` kinds                                                 | rewritten | Each target kind places on the expected display              |
| `windowsTouchQuery` (PowerShell probe)         | `src/layout/probes/windows-touch.ts`                                     | rewritten | Touch display resolves; hang resolves to `[]` within timeout |
| `layoutRecovery` (re-apply on display change)  | `src/layout/supervisor.ts` wired by `src/shell/windows/topology.ts`      | rewritten | Unplug/replug monitor: layout re-applies once, no loop       |
| Periodic layout check (setInterval)            | Topology signature dedup                                                 | dropped   | Caused retry-forever; replaced by event + attempt cap        |
| `compatibility` GPU/vsync/spanning checks      | `eggshell doctor`                                                        | rewritten | Doctor reports GPU list and spanning warnings                |
| `before-input-event` keybindings               | `keybindings` section, `src/shell/keybindings.ts`                        | rewritten | `ctrl+q` quits; `shift+c` toggles cursor                     |
| `keybindings.json` defaults                    | `keybindingsSchema` defaults                                             | ported    | Absent section still quits on `ctrl+q`                       |
| Cursor toggle (`applyCursorToWindows`)         | `cursor` section, `src/shell/cursor.ts`                                  | rewritten | Cursor hidden at start when `cursor.visible: false`          |
| Blackout window (`app:blackout:show/hide` IPC) | `src/shell/blackout.ts` via `blackout:show/hide` IPC                     | ported    | IPC fades to black and back                                  |
| Window icon (`iconPath`, `public/ui/icon.png`) | `windows[].icon`, `icon` section                                         | todo      | Taskbar and exe show the app icon                            |
| `state-sync:*` IPC broadcast between windows   | `src/shell/channels.ts`, `window.eggshell.invoke/on`                     | rewritten | Two windows exchange state via preload API                   |
| `app:quit` IPC                                 | `src/shell/channels.ts`                                                  | ported    | Renderer can request quit                                    |
| Renderer console → main log                    | `src/shell/renderer-logs.ts` (`console-message` + `window.eggshell.log`) | rewritten | `console.error` in page appears in log file                  |

## Processes

| Original                               | eggshell                        | Status    | Test                                                          |
| -------------------------------------- | ------------------------------- | --------- | ------------------------------------------------------------- |
| `ServerManager` spawn + `wait-on` port | `src/process` spawn + readiness | rewritten | Window waits for `tcp` readiness; timeout is a `ProcessError` |
| `killProcessTree` via `taskkill /T /F` | `src/process/shutdown.ts`       | rewritten | Grandchild `node` process gone after quit                     |
| `killProcessOnPort` before dev start   | `requirePortsFree`              | rewritten | Occupied port fails early with port number                    |
| Restart on crash                       | `processes[].restart`           | rewritten | Kill server; restarts with backoff, gives up at `maxRestarts` |

## Logging

| Original                                 | eggshell                                                               | Status    | Test                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------- | --------- | ----------------------------------------------------------- |
| pino + pino-roll rotating file log       | `logging` section, `src/logging/file-stream.ts`, `src/shell/logger.ts` | ported    | Log file rotates at configured size; old files pruned       |
| chalk per-module colored terminal output | `src/cli/log-format.ts`                                                | rewritten | Dev terminal shows `[shell]`, `[layout]` in distinct colors |
| Log listener fan-out (dashboard stream)  | `src/logging/broadcast.ts` -> dashboard SSE                            | rewritten | Dashboard log console updates live                          |
| `FORCE_COLOR=1`                          | chalk auto-detects the CLI tty; Electron emits JSON, the CLI colors it | dropped   | Colors survive when Electron is a child process             |

## Features

| Original                                                           | eggshell                                                                            | Status    | Test                                                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------- |
| Offline overlay (`is-online`, React UI)                            | `offline` section, `src/shell/offline/`, `assets/offline.html` as a WebContentsView | rewritten | Disable network: overlay appears; re-enable: overlay hides                  |
| Companion overlay (QR to LAN URL)                                  | `companion` section, `src/shell/companion/`, `assets/companion.html`                | rewritten | Overlay QR scans to reachable URL                                           |
| Soak testing (gremlins.js random UI interaction)                   | `soak` section, `src/shell/soak/` (seeded random clicks/keys/scroll, report JSON)   | rewritten | Random taps/keys run for configured duration; report written                |
| Dashboard server (express, port 3005)                              | `dashboard` section, `src/shell/dashboard/`                                         | rewritten | `GET /status` returns windows and processes                                 |
| Dashboard `GET /logs-stream` (SSE)                                 | `src/shell/dashboard/sse.ts`                                                        | rewritten | Browser log console streams new lines                                       |
| Dashboard `POST /reload-windows`                                   | `dashboard`                                                                         | rewritten | Windows reload                                                              |
| Dashboard `POST /focus-windows`                                    | `dashboard`                                                                         | rewritten | Windows come to front                                                       |
| Dashboard `POST /recalculate-layout`                               | `src/shell/dashboard/router.ts` -> topology reapply                                 | rewritten | Layout re-applies                                                           |
| Dashboard `POST /toggle-offline`                                   | `src/shell/dashboard/router.ts`                                                     | rewritten | Overlay toggles                                                             |
| Dashboard `POST /toggle-companion`                                 | `src/shell/dashboard/router.ts`                                                     | rewritten | Overlay toggles                                                             |
| Dashboard `POST /restart-app`                                      | `POST /api/restart` (`app.relaunch`)                                                | rewritten | App relaunches                                                              |
| Dashboard React UI (LogConsole, DisplayLayout, ConfirmationDialog) | Prebuilt UI in `dist/dashboard-ui`                                                  | todo      | UI loads at `http://<host>:<port>/`; confirm dialogs on destructive actions |
| `printDashboardQR` to terminal                                     | `src/cli/dashboard-qr.ts`                                                           | ported    | QR printed once dashboard is up; scans to dashboard URL                     |
| `ExtensionManager` (unpacked Chrome extensions)                    | `chromeExtensions` section                                                          | todo      | Extension listed in `chrome://extensions`                                   |
| Vite dev server for dashboard/offline UIs                          | Prebuilt assets                                                                     | dropped   | Nested builds at consumer dev time removed                                  |

## eggshell-only additions

Kept from the first port because they fix field incidents or close unattended-installation gaps.

| Feature                                  | Location                     | Test                                                     |
| ---------------------------------------- | ---------------------------- | -------------------------------------------------------- |
| Deterministic layout resolver + problems | `src/layout/resolve.ts`      | Fixture tests; `spanAll` + `kiosk` degrades to windowed  |
| Topology supervisor with attempt cap     | `src/layout/supervisor.ts`   | Fake-clock tests; `givenUp` state reached and logged     |
| Deployment override file                 | `src/config/overrides.ts`    | Override changes a URL without rebuild                   |
| Single-instance lock                     | `src/shell/lifecycle`        | Second launch focuses the first                          |
| Crash / unresponsive watchdog            | `src/shell/watchdog`         | Kill renderer: window reloads                            |
| Launch manifest for provisioning         | `eggshell build`             | `release/eggshell.manifest.json` names the exe           |
| `eggshell doctor`                        | `src/cli/commands/doctor.ts` | Reports config, ports, displays, touch, user-data access |
