# eggshell

Electron kiosk-launcher library: window management, multi-display layout, process supervision, plugins, and a CLI — call `launch(config)` from your Electron main.

> Pre-publish, unscoped, `private: true`. Consume via a `file:` dependency.

## Quick start

```sh
npx eggshell init my-kiosk && cd my-kiosk && npm install && npm run dev
```

See [`examples/basic-kiosk`](examples/basic-kiosk) for a full consumer.

## Features

- Kiosk window management with multi-display layout resolution (roles, fallbacks, span-all)
- Child-process supervision with restart policies and readiness probes
- Build + launch-manifest generation for provisioning hand-off
- `doctor` preflight diagnostics
- Plugins (opt-in): `offline` overlay, `dashboard` (remote status/control), `companion` (QR overlay), `soak` (fuzzer)

## CLI

`eggshell <dev|build|start|doctor|init>` — reads `eggshell.config.{ts,mjs,js}`, `--help` per command.

## How it works

Every root (`projectRoot`, `userDataRoot`) is an explicit input — nothing is discovered by walking the filesystem. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for layering/invariants, [`ROADMAP.md`](ROADMAP.md) for spec/status, [`docs/provisioning.md`](docs/provisioning.md) for the build-manifest contract.

## Development

```sh
npm install && npm run build && npm run smoke
```

## License

MIT
