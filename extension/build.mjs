// Build: bundles each entry point with esbuild and copies static files.
// - extension/dist/: the Firefox extension (its options page is a launcher
//   that opens the local web);
// - service/app/web/static/: the local web served by the service at
//   http://127.0.0.1:8765/ (onboarding + dashboard, same code as the old
//   options page; see src/platform/storage.ts and src/service-http.ts).
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const web = join(root, '..', 'service', 'app', 'web', 'static');
const watch = process.argv.includes('--watch');

const common = {
  absWorkingDir: root,
  bundle: true,
  format: 'iife',
  target: 'firefox128',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
};

const extension = {
  ...common,
  entryPoints: {
    background: 'src/background.ts',
    content: 'src/content.ts',
    'early-hold': 'src/early-hold.ts',
    'page-bridge': 'src/page-bridge.ts',
    options: 'src/launcher/main.ts',
    blocked: 'src/blocked/main.ts',
  },
  outdir: dist,
};

const webApp = {
  ...common,
  entryPoints: { app: 'src/options/main.ts' },
  outdir: web,
};

for (const dir of [dist, web]) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}
cpSync(join(root, 'manifest.json'), join(dist, 'manifest.json'));
for (const dir of [dist, web]) {
  cpSync(join(root, 'icons'), join(dir, 'icons'), { recursive: true });
  cpSync(join(root, 'options', 'options.css'), join(dir, 'options.css'));
}
for (const file of ['options.html', 'blocked.html']) cpSync(join(root, 'options', file), join(dist, file));
cpSync(join(root, 'options', 'web.html'), join(web, 'index.html'));

if (watch) {
  const contexts = await Promise.all([context(extension), context(webApp)]);
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('watching src/ ...');
} else {
  await Promise.all([build(extension), build(webApp)]);
}
