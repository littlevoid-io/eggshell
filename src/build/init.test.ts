import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { scaffoldProject } from './init.js';
import { BuildError } from '../errors.js';
import { validateConfig } from '../config/validate.js';

describe('scaffoldProject', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eggshell-init-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates all expected files on a clean run with parseable content', async () => {
    const targetDir = path.join(tempDir, 'new-kiosk');
    const result = await scaffoldProject({ targetDir });

    expect(result.skippedFiles).toEqual([]);
    expect(result.createdFiles).toHaveLength(5);

    const configPath = path.join(targetDir, 'eggshell.config.ts');
    const mainPath = path.join(targetDir, 'src', 'main.ts');
    const pkgPath = path.join(targetDir, 'package.json');
    const tsconfigPath = path.join(targetDir, 'tsconfig.json');
    const gitignorePath = path.join(targetDir, '.gitignore');

    expect(result.createdFiles).toContain(configPath);
    expect(result.createdFiles).toContain(mainPath);
    expect(result.createdFiles).toContain(pkgPath);
    expect(result.createdFiles).toContain(tsconfigPath);
    expect(result.createdFiles).toContain(gitignorePath);

    const configRaw = await fs.readFile(configPath, 'utf8');
    expect(configRaw).toContain("appId: 'com.example.new-kiosk'");
    expect(configRaw).toContain("productName: 'new-kiosk'");
    expect(configRaw).toContain("target: { kind: 'primary' as const }");
    expect(configRaw).toContain('kiosk: true');

    const mainRaw = await fs.readFile(mainPath, 'utf8');
    expect(mainRaw).toContain(
      "import { launch, resolveRoots, systemClock } from 'eggshell';"
    );
    expect(mainRaw).toContain("appId: 'com.example.new-kiosk'");
    expect(mainRaw).toContain('resolveRoots({');

    const pkgRaw = await fs.readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    expect(pkg.name).toBe('new-kiosk');
    expect(pkg.type).toBe('module');
    expect(pkg.scripts).toEqual({
      dev: 'eggshell dev',
      build: 'eggshell build',
      start: 'eggshell start',
      doctor: 'eggshell doctor',
    });

    const tsconfigRaw = await fs.readFile(tsconfigPath, 'utf8');
    const tsconfig = JSON.parse(tsconfigRaw) as Record<string, unknown>;
    expect(tsconfig.compilerOptions).toBeDefined();

    const gitignoreRaw = await fs.readFile(gitignorePath, 'utf8');
    expect(gitignoreRaw).toContain('node_modules');
    expect(gitignoreRaw).toContain('dist');
  });

  it('scaffolds a config that validates against ShellConfig schema', async () => {
    const targetDir = path.join(tempDir, 'schema-check');
    await scaffoldProject({
      targetDir,
      appId: 'com.acme.custom-kiosk',
      productName: 'Acme Kiosk',
    });

    const literalConfig = {
      appId: 'com.acme.custom-kiosk',
      productName: 'Acme Kiosk',
      windows: [
        {
          id: 'main',
          url: 'about:blank',
          target: { kind: 'primary' as const },
          kiosk: true,
        },
      ],
    };
    const validated = validateConfig(literalConfig);
    expect(validated.appId).toBe('com.acme.custom-kiosk');
    expect(validated.windows[0]?.kiosk).toBe(true);
  });

  it('does not overwrite existing files when run twice', async () => {
    const targetDir = path.join(tempDir, 'idempotent-test');
    const firstRun = await scaffoldProject({ targetDir });
    expect(firstRun.createdFiles).toHaveLength(5);
    expect(firstRun.skippedFiles).toHaveLength(0);

    const configPath = path.join(targetDir, 'eggshell.config.ts');
    const mutatedContent = '// Mutated content for test\n';
    await fs.writeFile(configPath, mutatedContent, 'utf8');

    const secondRun = await scaffoldProject({ targetDir });
    expect(secondRun.createdFiles).toHaveLength(0);
    expect(secondRun.skippedFiles).toHaveLength(5);
    expect(secondRun.skippedFiles).toContain(configPath);

    const afterContent = await fs.readFile(configPath, 'utf8');
    expect(afterContent).toBe(mutatedContent);
  });

  it('creates targetDir if it does not exist yet', async () => {
    const nestedDir = path.join(tempDir, 'deeply', 'nested', 'project');
    const result = await scaffoldProject({ targetDir: nestedDir });
    expect(result.createdFiles).toHaveLength(5);
    const stat = await fs.stat(nestedDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('rejects a relative targetDir with BuildError', async () => {
    await expect(scaffoldProject({ targetDir: 'relative/path' })).rejects.toThrow(BuildError);
  });

  it('rejects an invalid appId with BuildError', async () => {
    const targetDir = path.join(tempDir, 'bad-app-id');
    await expect(scaffoldProject({ targetDir, appId: 'Invalid_App_Id!' })).rejects.toThrow(
      BuildError
    );
  });

  it('escapes a raw newline in productName so the generated files stay syntactically valid', async () => {
    const targetDir = path.join(tempDir, 'newline-product-name');
    await scaffoldProject({ targetDir, productName: 'Bad\nName' });

    const configRaw = await fs.readFile(path.join(targetDir, 'eggshell.config.ts'), 'utf8');
    expect(configRaw).toContain("productName: 'Bad\\nName'");
    expect(configRaw).not.toMatch(/productName: '[^']*\n[^']*'/);

    const mainRaw = await fs.readFile(path.join(targetDir, 'src', 'main.ts'), 'utf8');
    expect(mainRaw).toContain("productName: 'Bad\\nName'");
  });

  it('depends on the real local eggshell package via an absolute file: reference', async () => {
    const targetDir = path.join(tempDir, 'file-dependency-check');
    await scaffoldProject({ targetDir });

    const pkg = JSON.parse(
      await fs.readFile(path.join(targetDir, 'package.json'), 'utf8')
    ) as { dependencies: { eggshell: string } };
    expect(pkg.dependencies.eggshell.startsWith('file:')).toBe(true);
    expect(pkg.dependencies.eggshell).not.toBe('*');
    expect(path.isAbsolute(pkg.dependencies.eggshell.slice('file:'.length))).toBe(true);
  });
});
