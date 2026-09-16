#!/usr/bin/env node
import meow from 'meow';
import { runBuild } from './commands/build.js';
import { runDev } from './commands/dev.js';
import { runDoctor } from './commands/doctor.js';
import { runInit } from './commands/init.js';
import { runStart } from './commands/start.js';
import { formatError } from './output.js';

const cli = meow(
  `
  Usage
    $ eggshell <command> [options]

  Commands
    init     Add eggshell.config.ts and package scripts to the current directory
    dev      Start dev-phase processes and open the kiosk
    build    Package the app with electron-builder into build.output
    start    Run the packaged executable named by the launch manifest
    doctor   Print the resolved config and environment

  Options
    --project-root <dir>    Directory containing eggshell.config.ts (default: cwd)
    --app-id <id>           init: reverse-DNS app id
    --product-name <name>   init: display name
    --production            doctor: resolve the config with isDev = false
    --manifest <path>       start: launch manifest to use instead of searching build.output
`,
  {
    importMeta: import.meta,
    flags: {
      projectRoot: { type: 'string' },
      appId: { type: 'string' },
      productName: { type: 'string' },
      production: { type: 'boolean', default: false },
      manifest: { type: 'string' },
    },
  }
);

const COMMANDS: Record<string, (flags: typeof cli.flags) => Promise<number>> = {
  init: runInit,
  dev: runDev,
  build: runBuild,
  start: runStart,
  doctor: runDoctor,
};

async function main(): Promise<number> {
  const [command] = cli.input;
  const run = command ? COMMANDS[command] : undefined;
  if (!run) {
    cli.showHelp(command ? 1 : 0);
    return 1;
  }
  return run(cli.flags);
}

main().then(
  code => process.exit(code),
  error => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(1);
  }
);
