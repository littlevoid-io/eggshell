import { parseArgs } from 'node:util';
import path from 'node:path';
import { loadCliConfig } from '../config-loader.js';
import { resolveCliRoots } from '../roots.js';
import { findLaunchManifest } from '../manifest-search.js';
import { waitForTermination, terminationExitCode } from '../termination.js';
import { printUsage } from '../usage.js';
import { startProduction } from '../../build/start.js';

interface ParsedStartOptions {
  projectRoot: string;
  manifestPath?: string | undefined;
  userDataDir?: string | undefined;
  help: boolean;
}

function parseStartOptions(args: readonly string[]): ParsedStartOptions {
  const { values } = parseArgs({
    args: [...args],
    options: {
      'project-root': { type: 'string' },
      'manifest-path': { type: 'string' },
      'user-data-dir': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  });

  return {
    projectRoot: values['project-root'] || process.cwd(),
    manifestPath: values['manifest-path'],
    userDataDir: values['user-data-dir'],
    help: Boolean(values.help),
  };
}

async function resolveManifestPath(projectRoot: string, givenPath?: string): Promise<string> {
  if (givenPath) {
    return path.isAbsolute(givenPath) ? givenPath : path.resolve(projectRoot, givenPath);
  }
  return findLaunchManifest(projectRoot);
}

export async function runStartCommand(args: readonly string[]): Promise<number> {
  const options = parseStartOptions(args);
  if (options.help) {
    printUsage();
    return 0;
  }

  const config = await loadCliConfig(options.projectRoot);
  const roots = resolveCliRoots(options.projectRoot, config.productName, options.userDataDir);
  const manifestPath = await resolveManifestPath(roots.projectRoot, options.manifestPath);

  const handle = await startProduction({ roots, manifestPath, config });
  process.stdout.write(`Started production app "${config.productName}" (pid: ${handle.process.pid}).\n`);
  const result = await waitForTermination(handle);
  return terminationExitCode(result);
}
