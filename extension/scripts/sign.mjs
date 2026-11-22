// Signs dist/ as an UNLISTED add-on on AMO (needed to install permanently in
// regular Firefox and to force-install it with policies.json). Reads
// AMO_JWT_ISSUER / AMO_JWT_SECRET from the repo-root .env (or the environment)
// and passes them to web-ext as WEB_EXT_API_KEY / WEB_EXT_API_SECRET env vars,
// so they never appear on the command line or in the output.
//
// web-ext >= 8: `web-ext sign --channel=unlisted` uses the AMO submission API
// (v5) and downloads the signed .xpi into --artifacts-dir once approved
// (unlisted versions are signed automatically, usually within minutes).
// Every submission needs a NEW `version` in manifest.json.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const extDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(extDir, '..', '.env');
const distDir = join(extDir, 'dist');
const artifactsDir = join(extDir, 'web-ext-artifacts');
const APPROVAL_TIMEOUT_MS = 20 * 60_000;

function readDotEnv(path) {
  if (!existsSync(path)) return {};
  const vars = {};
  for (const line of readFileSync(path, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
}

function xpis() {
  if (!existsSync(artifactsDir)) return new Map();
  return new Map(readdirSync(artifactsDir).filter((f) => f.endsWith('.xpi')).map((f) => [f, statSync(join(artifactsDir, f)).mtimeMs]));
}

const dotenv = readDotEnv(envPath);
const issuer = process.env.AMO_JWT_ISSUER || dotenv.AMO_JWT_ISSUER;
const secret = process.env.AMO_JWT_SECRET || dotenv.AMO_JWT_SECRET;
if (!issuer || !secret) {
  console.error(`Missing AMO_JWT_ISSUER / AMO_JWT_SECRET (looked in ${envPath} and the environment).`);
  process.exit(1);
}
if (!existsSync(join(distDir, 'manifest.json'))) {
  console.error('dist/ is not built: run `npm run build` (npm run sign does it).');
  process.exit(1);
}
const { version } = JSON.parse(readFileSync(join(distDir, 'manifest.json'), 'utf8'));
console.log(`Signing version ${version} (unlisted). AMO rejects a version that was already submitted: bump manifest.json first.`);

const before = xpis();
const webExt = join(extDir, 'node_modules', 'web-ext', 'bin', 'web-ext.js');
const result = spawnSync(
  process.execPath,
  [
    webExt,
    'sign',
    '--channel=unlisted',
    '--source-dir',
    distDir,
    '--artifacts-dir',
    artifactsDir,
    `--approval-timeout=${APPROVAL_TIMEOUT_MS}`,
    '--no-config-discovery',
  ],
  {
    cwd: extDir,
    stdio: 'inherit',
    env: { ...process.env, WEB_EXT_API_KEY: issuer, WEB_EXT_API_SECRET: secret },
  },
);
const fresh = [...xpis()].filter(([file, mtime]) => before.get(file) !== mtime).map(([file]) => file);
if (result.status === 0 && fresh.length) {
  console.log(`Signed: ${fresh.map((f) => join('web-ext-artifacts', f)).join(', ')} (install.ps1 picks the newest .xpi).`);
}
process.exit(result.status ?? 1);
