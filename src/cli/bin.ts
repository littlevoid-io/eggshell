#!/usr/bin/env node

import { formatCliError } from './error-format.js';
import { printUsage } from './usage.js';
import { runDevCommand } from './commands/dev.js';
import { runBuildCommand } from './commands/build.js';
import { runStartCommand } from './commands/start.js';
import { runDoctorCommand } from './commands/doctor.js';
import { runInitCommand } from './commands/init.js';

export function formatAndExitOnError(error: unknown): never {
  process.stderr.write(`${formatCliError(error)}\n`);
  process.exit(1);
}

function dispatchCommand(command: string, args: readonly string[]): Promise<number> {
  switch (command) {
    case 'dev':
      return runDevCommand(args);
    case 'build':
      return runBuildCommand(args);
    case 'start':
      return runStartCommand(args);
    case 'doctor':
      return runDoctorCommand(args);
    case 'init':
      return runInitCommand(args);
    default:
      printUsage(true);
      return Promise.resolve(1);
  }
}

async function runCli(argv: readonly string[]): Promise<number> {
  const [command, ...remaining] = argv;
  if (!command) {
    printUsage(true);
    return 1;
  }
  if (command === '--help' || command === '-h') {
    printUsage(false);
    return 0;
  }
  return dispatchCommand(command, remaining);
}

async function main(): Promise<void> {
  try {
    const exitCode = await runCli(process.argv.slice(2));
    process.exit(exitCode);
  } catch (error) {
    formatAndExitOnError(error);
  }
}

void main();
