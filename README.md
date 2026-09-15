# Egg Shell 🐣

A library for building Electron kiosk apps. It handles window management, multi-display layout, and process supervision, and comes with a CLI and a few optional plugins. Call `launch(config)` from your Electron main file and it takes care of the rest.

> This package isn't published to npm yet — it's still private while things settle. To use it now, add it to your project as a local `file:` dependency instead of installing it normally.

## Quick start

```sh
npx eggshell init my-kiosk
cd my-kiosk
npm install
npm run dev
```

Check out [`examples/basic-kiosk`](examples/basic-kiosk) for a working example.

## Features

- Kiosk window management, including multi-display layout with roles and fallbacks
- Supervises your app's child processes, restarting them and checking readiness as needed
- Builds your app and generates a launch manifest, so a separate provisioning tool can pick it up
- A `doctor` command that checks your setup before you deploy
- Optional plugins: an offline overlay, a remote status/control dashboard, a QR-code companion overlay, and an interaction fuzzer for soak testing

## CLI

`eggshell <dev|build|start|doctor|init>` reads your `eggshell.config.{ts,mjs,js}` file. Add `--help` to any command to see its options.

## How it works

You always tell eggshell where things are — it never goes looking for a project root on its own. See [`docs/architecture.md`](docs/architecture.md) for how it's put together, and [`docs/provisioning.md`](docs/provisioning.md) if you're hooking up an external provisioning tool.

## Development

```sh
npm install && npm run build && npm run smoke
```

## License

MIT
