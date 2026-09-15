# Provisioning Hand-off Contract

The contract between `eggshell`'s build output and an external provisioning tool that deploys, launches, and supervises the app.

## Artifact location

`build()` packages into `<projectRoot>/release/<platform-arch-subdir>/` and writes the launch manifest next to the executable, at `<projectRoot>/release/<platform-arch-subdir>/eggshell.launch.json`. The subdirectory name (`win-unpacked`, `mac`, ...) is decided by `electron-builder` per platform/arch — don't hardcode it. `eggshell start` locates the manifest itself by scanning `release/`'s immediate subdirectories (pass `--manifest-path` if more than one exists). `executablePath` inside the manifest is always absolute.

## Launch manifest schema

```ts
interface LaunchManifest {
  manifestVersion: 1;
  appId: string; // reverse-DNS, matches ShellConfig.appId
  productName: string; // matches ShellConfig.productName
  version: string; // from the consumer's package.json
  executablePath: string; // absolute
  builtAt: string; // ISO 8601 UTC
  platform: string; // process.platform
  arch: string; // process.arch
}
```

`manifestVersion` is a stability contract: additive fields don't bump it (ignore unrecognized fields); any removal/rename/type change requires a major bump.

## Startup invocation

Invoke via the CLI, not the binary directly:

```sh
eggshell start --project-root <projectRoot>
```

Flags: `--manifest-path <path>` (only needed with multiple manifests), `--user-data-dir <path>`.

**Exit code**: `0` on a clean stop (the app exited 0, or the CLI received `SIGINT`/`SIGTERM`); `1` on a crash, unexpected exit, external kill, or pre-launch validation failure. A provisioning tool should treat any non-zero exit as a restart/alert trigger.

`startProduction` refuses to launch a manifest built for a different platform/arch than the current machine (throws `LaunchError`).

## Distribution

Pre-publish, `private: true`, unscoped. Consume via a `file:` dependency until published under a scope.
