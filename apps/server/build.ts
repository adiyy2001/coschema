import { build } from 'esbuild';
import { resolve } from 'node:path';

export const DEFAULT_OUTFILE = resolve(import.meta.dirname, 'dist/main.mjs');

export async function buildServer(outfile = DEFAULT_OUTFILE): Promise<string> {
  await build({
    entryPoints: [resolve(import.meta.dirname, 'src/main.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    external: ['pg-native'],
    sourcemap: true,
    logLevel: 'warning',
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  });
  return outfile;
}

if (import.meta.main) {
  await buildServer();
}
