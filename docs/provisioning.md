# Provisioning Hand-off

How an external provisioning tool can find, launch, and supervise an app built with eggshell.

## Where the build ends up

`build()` packages your app into `<projectRoot>/release/<platform-arch-subdir>/`, and writes a launch manifest right next to the executable, at `<projectRoot>/release/<platform-arch-subdir>/eggshell.launch.json`. That subdirectory name (`win-unpacked`, `mac`, and so on) is chosen by `electron-builder` depending on the platform and architecture, so don't hardcode it — `eggshell start` already knows to look for the manifest by checking `release/`'s immediate subdirectories itself. If it finds more than one, pass `--manifest-path` to say which one you mean. Whatever it finds, the manifest's `executablePath` is always an absolute path, so you never have to guess.

## The launch manifest

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

Think of `manifestVersion` as a promise: new optional fields can be added without bumping it, so it's safe to just ignore fields you don't recognize. If a field is ever removed, renamed, or changes type, that's a breaking change and the version number goes up.

## Starting the app

Use the CLI rather than launching the executable directly:

```sh
eggshell start --project-root <projectRoot>
```

You can also pass `--manifest-path <path>` if you need to point at a specific manifest, or `--user-data-dir <path>` to change where Electron stores user data.

**Exit codes matter here.** A `0` means the app stopped cleanly — either it exited on its own with code 0, or the CLI got a `SIGINT`/`SIGTERM` and shut it down gracefully. Anything else (a crash, an unexpected exit, being killed externally, or failing to launch at all) comes back as `1`. Treat any non-zero exit as a sign to restart or raise an alert.

One more safety net: if you try to run a manifest that was built for a different platform or architecture than the machine you're on, `startProduction` refuses to launch it and throws a `LaunchError` instead.

## A note on distribution

This package isn't on the public npm registry yet — it's still private. Until it's published under a proper scope, consume it as a local `file:` dependency.
