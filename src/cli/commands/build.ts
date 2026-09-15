import { parseArgs } from 'node:util';
import { loadCliConfig } from '../config-loader.js';
import { resolveCliRoots } from '../roots.js';
import { printUsage } from '../usage.js';
import { build } from '../../build/build.js';

interface ParsedBuildOptions {
  projectRoot: string;
  userDataDir?: string | undefined;
  help: boolean;
}

function parseBuildOptions(args: readonly string[]): ParsedBuildOptions {
  const { values } = parseArgs({
    args: [...args],
    options: {
      'project-root': { type: 'string' },
      'user-data-dir': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  });

  return {
    projectRoot: values['project-root'] || process.cwd(),
    userDataDir: values['user-data-dir'],
    help: Boolean(values.help),
  };
}

export async function runBuildCommand(args: readonly string[]): Promise<number> {
  const options = parseBuildOptions(args);
  if (options.help) {
    printUsage();
    return 0;
  }

  const config = await loadCliConfig(options.projectRoot);
  const roots = resolveCliRoots(options.projectRoot, config.productName, options.userDataDir);
  const result = await build({ roots, config });

  process.stdout.write(
    `Build completed successfully.\nExecutable: ${result.executablePath}\nManifest:   ${result.manifestPath}\n`
  );
  return 0;
}
