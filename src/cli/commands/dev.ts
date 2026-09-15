import { parseArgs } from 'node:util';
import path from 'node:path';
import { loadCliConfig } from '../config-loader.js';
import { resolveCliRoots } from '../roots.js';
import { waitForTermination, terminationExitCode } from '../termination.js';
import { printUsage } from '../usage.js';
import { startDev } from '../../build/dev.js';

interface ParsedDevOptions {
  projectRoot: string;
  entry: string;
  userDataDir?: string | undefined;
  help: boolean;
}

function parseDevOptions(args: readonly string[]): ParsedDevOptions {
  const { values } = parseArgs({
    args: [...args],
    options: {
      'project-root': { type: 'string' },
      entry: { type: 'string' },
      'user-data-dir': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  });

  const projectRoot = values['project-root'] || process.cwd();
  const entry = values.entry || path.join('dist', 'main.js');
  return {
    projectRoot,
    entry,
    userDataDir: values['user-data-dir'],
    help: Boolean(values.help),
  };
}

export async function runDevCommand(args: readonly string[]): Promise<number> {
  const options = parseDevOptions(args);
  if (options.help) {
    printUsage();
    return 0;
  }

  const config = await loadCliConfig(options.projectRoot);
  const roots = resolveCliRoots(options.projectRoot, config.productName, options.userDataDir);
  const entryPath = path.isAbsolute(options.entry)
    ? options.entry
    : path.resolve(roots.projectRoot, options.entry);

  const handle = await startDev({ roots, entryPath, config });
  process.stdout.write(`Started dev session for "${config.productName}" (pid: ${handle.process.pid}).\n`);
  const result = await waitForTermination(handle);
  return terminationExitCode(result);
}
