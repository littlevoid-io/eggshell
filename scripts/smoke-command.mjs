import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function resolveNpmCommand() {
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) {
    return { command: process.execPath, args: [process.env.npm_execpath] };
  }
  const bundled = path.join(
    path.dirname(process.execPath),
    'node_modules',
    'npm',
    'bin',
    'npm-cli.js'
  );
  if (existsSync(bundled)) {
    return { command: process.execPath, args: [bundled] };
  }
  if (process.platform === 'win32') {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', 'npm'] };
  }
  return { command: 'npm', args: [] };
}

export function runCommand(command, args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        const detail = code !== null ? `exit code ${code}` : `signal ${signal}`;
        reject(new Error(`Command "${command} ${args.join(' ')}" failed with ${detail}`));
      }
    });
  });
}

export function runNpm(scriptName, cwd = process.cwd()) {
  const npm = resolveNpmCommand();
  return runCommand(npm.command, [...npm.args, 'run', scriptName], cwd);
}

export function runTsc(projectConfigFile, cwd = process.cwd()) {
  const tscPath = path.resolve(cwd, 'node_modules', 'typescript', 'bin', 'tsc');
  return runCommand(process.execPath, [tscPath, '-p', projectConfigFile], cwd);
}

export function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export async function waitForProcessDead(pid, timeoutMs = 3000) {
  if (!pid) return;
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (isProcessAlive(pid)) {
    throw new Error(`Process ${pid} remained alive after shutdown`);
  }
}
