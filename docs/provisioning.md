# Provisioning Hand-off

How a provisioning tool builds, finds, starts and supervises an eggshell app.

## Build

```sh
eggshell build --project-root <appDir>
```

- Stages a self-contained app folder under `<appDir>/.eggshell/package`: bundled Electron main, preload, overlay assets, dashboard UI, the resolved config (`eggshell.json`) and the consumer files matched by `build.files`.
- Packages it with electron-builder into `<appDir>/<build.output>/` (default `release/`). Files stay unpacked (`asar: false`) so child processes run from disk.
- Uses the Electron already installed with eggshell (`electronDist`); nothing is downloaded at build time.
- Writes `eggshell.launch.json` next to the executable.

## Launch manifest

```ts
interface LaunchManifest {
  manifestVersion: 1;
  appId: string; // reverse-DNS
  productName: string;
  version: string; // config.version, else the consumer package.json version, else 0.0.0
  executablePath: string; // absolute
  builtAt: string; // ISO 8601 UTC
  platform: string; // process.platform
  arch: string; // process.arch
}
```

New optional fields may appear without a version bump. Removing or renaming a field bumps `manifestVersion`.

## Start

```sh
eggshell start --project-root <appDir>
eggshell start --manifest <path>   # when release/ holds more than one build
```

- Refuses a manifest built for another platform or architecture.
- Runs the executable, relays its log output to the terminal, and exits with the app's exit code. `0` means a clean stop; anything else means restart or alert.
- The app quits on its own when the `eggshell start` process disappears.

## Runtime paths

- Config override: `<userData>/eggshell.deployment.json`, where `<userData>` is the per-app data directory for `appId` (on Windows `%LOCALAPPDATA%\<appId>\Data`). Objects deep-merge, arrays replace, the result re-validates.
- Logs: `<userData>/logs/eggshell.*.log`, rotating by size.
- Dashboard (when enabled): `http://<host>:<dashboard.port>/`, API under `/api`, optional `dashboard.token`.

## Distribution

eggshell is not on the public npm registry yet. Consume it as a local `file:` dependency; `eggshell init` writes that entry.
