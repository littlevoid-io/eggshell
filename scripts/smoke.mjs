import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { runNpm } from './smoke-command.mjs';
import {
  createExampleConfig,
  compileExample,
  runExampleDoctor,
  assertLaunchManifest,
  prepareSoakFiles,
  runSeededSoak,
} from './smoke-example.mjs';

const repoRoot = process.cwd();
const exampleProjectRoot = path.join(repoRoot, 'examples', 'basic-kiosk');
const exampleDistDir = path.join(exampleProjectRoot, 'dist');
const exampleReleaseDir = path.join(exampleProjectRoot, 'release');
const completedSteps = [];

async function step(stepName, fn) {
  process.stdout.write(`\n=== Step: ${stepName} ===\n`);
  await fn();
  completedSteps.push(stepName);
  process.stdout.write(`PASS: ${stepName}\n`);
}

async function cleanArtifacts(tempDir) {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
  await fs.rm(exampleReleaseDir, { recursive: true, force: true }).catch(() => {});
  await fs.rm(exampleDistDir, { recursive: true, force: true }).catch(() => {});
}

async function runToolchainSteps() {
  await step('lint', () => runNpm('lint', repoRoot));
  await step('typecheck', () => runNpm('typecheck', repoRoot));
  await step('test', () => runNpm('test', repoRoot));
  await step('build eggshell', () => runNpm('build', repoRoot));
}

async function runExampleSteps(eggshell, roots, config) {
  let buildResult;
  await step('build example', async () => {
    buildResult = await eggshell.build({ roots, config });
  });
  await step('run doctor', () => runExampleDoctor(eggshell, roots, config));
  await step('assert manifest', () => assertLaunchManifest(eggshell, buildResult.manifestPath));
}

async function runSoakStep(eggshell, tempDir, reportPath) {
  await step('run soak', async () => {
    const tempUserData = await prepareSoakFiles(exampleProjectRoot, tempDir, reportPath);
    const soakRoots = eggshell.resolveRoots({
      projectRoot: exampleProjectRoot,
      userDataRoot: tempUserData,
    });
    await runSeededSoak(
      eggshell,
      soakRoots,
      path.join(exampleDistDir, 'main.js'),
      tempUserData,
      reportPath
    );
  });
}

function printSummary() {
  process.stdout.write('\n=== Smoke Test Summary ===\n');
  for (const completed of completedSteps) {
    process.stdout.write(`  [PASS] ${completed}\n`);
  }
  process.stdout.write(`All ${completedSteps.length} smoke steps passed successfully.\n`);
}

async function runSmoke() {
  let tempDir;
  let exitCode = 0;
  try {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eggshell-smoke-'));
    const reportPath = path.join(tempDir, 'soak-report.json');

    await runToolchainSteps();
    const eggshell = await import(pathToFileURL(path.join(repoRoot, 'dist', 'index.js')).href);
    await compileExample(repoRoot);

    const baseRoots = eggshell.resolveRoots({
      projectRoot: exampleProjectRoot,
      userDataRoot: path.join(tempDir, 'default-user-data'),
    });
    const exampleConfig = createExampleConfig(exampleProjectRoot);

    await runExampleSteps(eggshell, baseRoots, exampleConfig);
    await runSoakStep(eggshell, tempDir, reportPath);

    printSummary();
  } catch (error) {
    exitCode = 1;
    process.stderr.write(
      `\nFAIL: Smoke test failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
  } finally {
    await cleanArtifacts(tempDir);
    process.exit(exitCode);
  }
}

await runSmoke();
