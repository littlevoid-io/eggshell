# eggshell

CLI that owns the Electron process for kiosk installations. An exhibit repo holds one config file; eggshell handles windows, multi-display layout, child processes, logging, and packaging.

Status: pre-1.0, rebuilding the CLI and Electron layers. See [docs/architecture.md](docs/architecture.md) and [docs/provenance.md](docs/provenance.md).

## Quick start

```sh
npx eggshell init
npm run dev
```

## Commands

`eggshell <dev|build|start|doctor|init>`. Add `--help` to any command.

## Development

```sh
npm install
npm run typecheck
npm test
npm run lint
```

## License

MIT
