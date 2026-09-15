import { parseArgs } from 'node:util';
import { loadCliConfig } from '../config-loader.js';
import { resolveCliRoots } from '../roots.js';
import { printUsage } from '../usage.js';
import { runDoctor } from '../../build/doctor.js';
import type { DoctorCheck, DoctorReport } from '../../build/doctor/types.js';

interface ParsedDoctorOptions {
  projectRoot: string;
  userDataDir?: string | undefined;
  help: boolean;
}

function parseDoctorOptions(args: readonly string[]): ParsedDoctorOptions {
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

function formatCheck(check: DoctorCheck): string {
  const statusTag = `[${check.status.toUpperCase()}]`;
  const lines = [`${statusTag.padEnd(7)} ${check.name}: ${check.message}`];
  if (check.remediation && check.status !== 'pass') {
    lines.push(`        Remediation: ${check.remediation}`);
  }
  return lines.join('\n');
}

function formatReport(report: DoctorReport): string {
  const checkLines = report.checks.map(formatCheck);
  const summary = `Overall status: [${report.overallStatus.toUpperCase()}] (${report.checks.length} checks evaluated)`;
  return [...checkLines, '', summary].join('\n');
}

export async function runDoctorCommand(args: readonly string[]): Promise<number> {
  const options = parseDoctorOptions(args);
  if (options.help) {
    printUsage();
    return 0;
  }

  const config = await loadCliConfig(options.projectRoot);
  const roots = resolveCliRoots(options.projectRoot, config.productName, options.userDataDir);
  const report = await runDoctor({ roots, config });

  process.stdout.write(`${formatReport(report)}\n`);
  return report.overallStatus === 'fail' ? 1 : 0;
}
