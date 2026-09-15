import { parseArgs } from 'node:util';
import path from 'node:path';
import { printUsage } from '../usage.js';
import { scaffoldProject, type ScaffoldResult } from '../../build/init.js';

interface ParsedInitOptions {
  targetDir: string;
  productName?: string | undefined;
  appId?: string | undefined;
  help: boolean;
}

function parseInitOptions(args: readonly string[]): ParsedInitOptions {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: {
      'product-name': { type: 'string' },
      'app-id': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: true,
  });

  const targetDir = positionals[0] ? path.resolve(positionals[0]) : process.cwd();
  return {
    targetDir,
    productName: values['product-name'],
    appId: values['app-id'],
    help: Boolean(values.help),
  };
}

function formatScaffoldSummary(targetDir: string, result: ScaffoldResult): string {
  const lines = [`Scaffolded project in "${targetDir}":`];
  if (result.createdFiles.length > 0) {
    lines.push('  Created:');
    for (const file of result.createdFiles) {
      lines.push(`    + ${path.relative(targetDir, file)}`);
    }
  }
  if (result.skippedFiles.length > 0) {
    lines.push('  Skipped existing:');
    for (const file of result.skippedFiles) {
      lines.push(`    - ${path.relative(targetDir, file)}`);
    }
  }
  return lines.join('\n');
}

export async function runInitCommand(args: readonly string[]): Promise<number> {
  const options = parseInitOptions(args);
  if (options.help) {
    printUsage();
    return 0;
  }

  const scaffoldOptions = {
    targetDir: options.targetDir,
    ...(options.productName !== undefined ? { productName: options.productName } : {}),
    ...(options.appId !== undefined ? { appId: options.appId } : {}),
  };
  const result = await scaffoldProject(scaffoldOptions);

  process.stdout.write(`${formatScaffoldSummary(options.targetDir, result)}\n`);
  return 0;
}
