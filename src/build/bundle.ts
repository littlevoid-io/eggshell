import { build } from 'esbuild';

/** esbuild's ESM output needs a real `require` for the Node built-ins pino and express load dynamically. */
const REQUIRE_BANNER =
  "import { createRequire as __eggshellCreateRequire } from 'node:module';\n" +
  'const require = __eggshellCreateRequire(import.meta.url);\n';

/** Bundles eggshell's Electron main into one self-contained ESM file for the packaged app. */
export async function bundleShellMain(entryPath: string, outfile: string): Promise<void> {
  await build({
    entryPoints: [entryPath],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['electron'],
    banner: { js: REQUIRE_BANNER },
    logLevel: 'warning',
  });
}
