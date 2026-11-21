// Build: bundles each entry point with esbuild and copies static files into dist/.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');

const options = {
  absWorkingDir: root,
  entryPoints: {
    background: 'src/background.ts',
    content: 'src/content.ts',
    'page-bridge': 'src/page-bridge.ts',
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'firefox128',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, 'manifest.json'), join(dist, 'manifest.json'));
cpSync(join(root, 'icons'), join(dist, 'icons'), { recursive: true });

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('watching src/ ...');
} else {
  await build(options);
}
