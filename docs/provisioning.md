# Provisioning Hand-off Contract

This document defines the hand-off contract between `eggshell`'s build output and an external provisioning tool responsible for deploying, launching, and supervising kiosk applications on Windows machines.

## 1. Artifact Location & Discovery

When `build()` (`src/build/build.ts`) packages an application, it outputs build artifacts into:

```text
<projectRoot>/release/<platform-arch-subdir>/
```

Next to the built application executable, `build()` writes the launch manifest:

```text
<projectRoot>/release/<platform-arch-subdir>/eggshell.launch.json
```

### Path Resolution Rules

- **Unpredictable subdirectory name**: The exact subdirectory name under `release/` (for example, `win-unpacked`, `win-arm64-unpacked`, `mac`, `linux-unpacked`) is determined by `electron-builder` based on target platform and architecture. External tools must not hardcode this directory name.
- **Bounded discovery**: The `eggshell start` CLI command's `findLaunchManifest` (`src/cli/manifest-search.ts`) scans the immediate subdirectories of `<projectRoot>/release/` for `eggshell.launch.json`. If multiple manifests are found, `--manifest-path` must be passed explicitly.
- **Absolute executable path**: The manifest contains `executablePath` as an absolute, canonical filesystem path. Consumers do not need to guess executable names, extensions, or directory structures.

## 2. Launch Manifest Schema

The manifest is written and validated against `manifestSchema` (`src/build/manifest.ts`) via `zod`:

```typescript
export interface LaunchManifest {
  manifestVersion: 1; // Integer schema version literal
  appId: string; // Reverse-DNS application identifier (e.g. "com.example.basic-kiosk")
  productName: string; // Human-readable application name (matches executable base name)
  version: string; // Application version string from consumer package.json
  executablePath: string; // Absolute canonical path to the executable
  builtAt: string; // ISO 8601 UTC timestamp of the build run
  platform: string; // Target OS identifier (e.g. "win32")
  arch: string; // Target CPU architecture (e.g. "x64")
}
```

### Field Definitions

| Field             | Type     | Description                                                |
| ----------------- | -------- | ---------------------------------------------------------- |
| `manifestVersion` | `1`      | Schema version. Required integer literal.                  |
| `appId`           | `string` | Reverse-DNS identifier matching `ShellConfig.appId`.       |
| `productName`     | `string` | Product name matching `ShellConfig.productName`.           |
| `version`         | `string` | Version string from the consumer project's `package.json`. |
| `executablePath`  | `string` | Absolute filesystem path to the launchable executable.     |
| `builtAt`         | `string` | UTC build timestamp in ISO 8601 format.                    |
| `platform`        | `string` | Target platform (`process.platform`, e.g. `'win32'`).      |
| `arch`            | `string` | Target architecture (`process.arch`, e.g. `'x64'`).        |

## 3. Versioning Policy

The `manifestVersion` field is a stability contract for external tooling:

- **Additive changes**: New optional fields may be added without incrementing `manifestVersion`. External provisioning tools must ignore unrecognized fields.
- **Breaking changes**: Any removal, rename, or type change of existing fields requires a major bump of `manifestVersion` (e.g., `1` -> `2`).
- External tooling can rely on `manifestVersion: 1` preserving this exact structural contract.

## 4. Recommended Startup Invocation

External provisioning tools (such as Windows Scheduled Tasks or startup tasks) should invoke the application via `eggshell start` rather than calling the binary directly:

```powershell
npx eggshell start --project-root <projectRoot>
```

Or via a consumer `package.json` script:

```json
{
  "scripts": {
    "start": "eggshell start"
  }
}
```

### Command Flags

- `--project-root <path>`: Project directory containing `eggshell.config.*` and `release/` (defaults to current working directory).
- `--manifest-path <path>`: Optional explicit path to `eggshell.launch.json` if multiple manifests exist.
- `--user-data-dir <path>`: Optional custom Electron `userData` directory.

### Exit Code Contract

`runStartCommand` (`src/cli/commands/start.ts`) supervises the running application and translates child process termination into meaningful CLI exit codes:

- **`0` (Clean stop)**: The supervised application exited cleanly (exit code `0`), or the CLI process received an intentional termination signal (`SIGINT` or `SIGTERM`) from the operator or supervisor.
- **`1` (Crash / unexpected exit)**: The supervised application crashed, exited with a non-zero status, was externally terminated without signal handling, or failed pre-launch validation.

External provisioning tools should use exit code `0` to indicate normal shutdown and exit code `1` (or any non-zero exit) to trigger alert or restart workflows.

### Platform & Architecture Guard

`startProduction` (`src/build/start.ts`) validates that `manifest.platform === process.platform` and `manifest.arch === process.arch`. If an attempt is made to start a build targeting a different OS or CPU architecture, `startProduction` throws an explicit `LaunchError` and exits non-zero before launching.

### Package Distribution Note

`eggshell` is currently private and pre-publish (`"private": true` in `package.json`). The unscoped package name is held on the public npm registry; consumer projects consume eggshell via local `file:` dependencies. An `@<org>/eggshell` scope will be established prior to public registry publication. Do not assume `eggshell` can be resolved from public npm without local linking.

## 5. Real Manifest Output

The following is the real, verbatim output of building `examples/basic-kiosk` (`examples/basic-kiosk/package.json`) on 2026-09-15 on Windows (`win32`/`x64`):

```json
{
  "manifestVersion": 1,
  "appId": "com.example.basic-kiosk",
  "productName": "Basic Kiosk Example",
  "version": "1.0.0",
  "executablePath": "C:\\Users\\ben\\Documents\\Repos\\eggshell\\examples\\basic-kiosk\\release\\win-unpacked\\Basic Kiosk Example.exe",
  "builtAt": "2026-09-15T13:27:15.309Z",
  "platform": "win32",
  "arch": "x64"
}
```
