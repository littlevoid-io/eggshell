import { readFileSync } from 'node:fs';
import { intro, isCancel, outro, select, spinner } from '@clack/prompts';
import chalk from 'chalk';
import { execaSync } from 'execa';

function run(cmd, args) {
  try {
    return execaSync(cmd, args, { stdio: 'pipe' }).stdout.trim();
  } catch (err) {
    const message = err.stderr || err.stdout || err.message;
    throw new Error(`${cmd} ${args.join(' ')} failed: ${message}`);
  }
}

function computeNextVersion(version, type) {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function verifyGitState() {
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'develop') {
    throw new Error(`Releases must start from "develop". Current: "${branch}"`);
  }
  const status = run('git', ['status', '--porcelain']);
  if (status.length > 0) {
    throw new Error('Working directory has uncommitted changes.');
  }
}

async function promptVersion(currentVersion) {
  const options = ['patch', 'minor', 'major'].map(type => ({
    value: type,
    label: `${type} (${computeNextVersion(currentVersion, type)})`,
  }));
  const choice = await select({
    message: `Current version is ${chalk.green(currentVersion)}. Select next version:`,
    options,
  });
  if (isCancel(choice)) {
    outro(chalk.yellow('Release cancelled.'));
    process.exit(0);
  }
  return computeNextVersion(currentVersion, choice);
}

function executeReleaseGitFlow(nextVersion, branch) {
  run('git', ['checkout', '-b', branch]);
  run('npm', ['version', nextVersion, '--no-git-tag-version']);
  run('git', ['add', 'package.json', 'package-lock.json']);
  run('git', ['commit', '-m', `chore(release): v${nextVersion}`]);
  run('git', ['checkout', 'main']);
  run('git', ['merge', branch, '--no-edit']);
  run('git', ['tag', `v${nextVersion}`]);
  run('git', ['checkout', 'develop']);
  run('git', ['merge', 'main', '--no-edit']);
  run('git', ['push', 'origin', 'main']);
  run('git', ['push', 'origin', 'develop']);
  run('git', ['push', 'origin', '--tags']);
}

function cleanupBranch(branch) {
  try {
    run('git', ['branch', '-d', branch]);
  } catch {
    // Best-effort local branch cleanup
  }
}

async function main() {
  intro(chalk.cyan('Eggshell Release Orchestrator'));
  try {
    verifyGitState();
  } catch (err) {
    outro(chalk.red(err.message));
    process.exit(1);
  }
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const nextVersion = await promptVersion(pkg.version);
  const branch = `release/v${nextVersion}`;
  const s = spinner();
  s.start(`Executing Git Flow for v${nextVersion}...`);
  try {
    executeReleaseGitFlow(nextVersion, branch);
    cleanupBranch(branch);
    s.stop(chalk.green(`v${nextVersion} merged and pushed to GitHub!`));
    outro(chalk.green('Release flow completed. GitHub Actions will handle OIDC staged publish.'));
  } catch (err) {
    s.stop(chalk.red('Release failed.'));
    console.error(chalk.red(err.message));
    try {
      run('git', ['checkout', 'develop']);
    } catch {
      // Best-effort recovery
    }
    process.exit(1);
  }
}

main();
