// Signs dist/ as an UNLISTED add-on on AMO (needed to install permanently in
// regular Firefox). Reads AMO_JWT_ISSUER / AMO_JWT_SECRET from the repo-root
// .env (or the environment) and passes them to web-ext via env vars, so they
// never appear on the command line.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const extDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(extDir, '..', '.env');

function readDotEnv(path) {
  if (!existsSync(path)) return {};
  const vars = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
}

const dotenv = readDotEnv(envPath);
const issuer = process.env.AMO_JWT_ISSUER || dotenv.AMO_JWT_ISSUER;
const secret = process.env.AMO_JWT_SECRET || dotenv.AMO_JWT_SECRET;
if (!issuer || !secret) {
  console.error(`Missing AMO_JWT_ISSUER / AMO_JWT_SECRET (looked in ${envPath} and the environment).`);
  process.exit(1);
}

const webExt = join(extDir, 'node_modules', 'web-ext', 'bin', 'web-ext.js');
const result = spawnSync(
  process.execPath,
  [webExt, 'sign', '--channel=unlisted', '--source-dir', 'dist', '--artifacts-dir', 'web-ext-artifacts'],
  {
    cwd: extDir,
    stdio: 'inherit',
    env: { ...process.env, WEB_EXT_API_KEY: issuer, WEB_EXT_API_SECRET: secret },
  },
);
process.exit(result.status ?? 1);
