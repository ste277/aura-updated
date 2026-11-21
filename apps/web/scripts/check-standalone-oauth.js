#!/usr/bin/env node
// AURA-MCP-02-I2a-R2 (B1) -- post-build runtime guard for the DEPLOYABLE server.
//
// Starts the `output: 'standalone'` server exactly the way deploy/Dockerfile
// runs it (`node server.js` from a directory holding only .next/standalone
// plus .next/static) and checks that every disabled OAuth route answers 404
// and /api/mcp never accepts a token.
//
//   node scripts/check-standalone-oauth.js                (from apps/web, after `next build`)
//   node scripts/check-standalone-oauth.js --standalone <dir> [--static <dir>]
//
// Why a copy: run in place, Node's module resolution walks up from
// apps/web/.next/standalone into apps/web/node_modules and the repo root, so
// a package missing from the traced output (B1: @modelcontextprotocol/server,
// HTTP 500 ERR_MODULE_NOT_FOUND) is silently found and the bug is masked.
// `next start` from the repo masks it the same way. The copy lives in the OS
// temp dir, outside any node_modules tree, like /app in the Docker image.
//
// Every run uses synthetic values only and listens on 127.0.0.1.
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const standaloneDir = path.resolve(argValue('--standalone') ?? '.next/standalone');
const staticDir = path.resolve(argValue('--static') ?? '.next/static');

const OAUTH_PATHS = [
  ['GET', '/.well-known/oauth-authorization-server'],
  ['GET', '/.well-known/openid-configuration'],
  ['GET', '/oauth/authorize?client_id=synthetic&response_type=code'],
  ['GET', '/oauth/jwks'],
  ['POST', '/oauth/token'],
  ['POST', '/oauth/revoke'],
  ['GET', '/oauth/interaction/synthetic-uid'],
  ['POST', '/oauth/interaction/synthetic-uid/confirm'],
  ['GET', '/api/oauth/oauth/jwks'],
  ['GET', '/api/oauth/.well-known/openid-configuration'],
  ['GET', '/api/oauth/.well-known/oauth-authorization-server'],
];

const SYNTHETIC_SECRET = 'standalone-check-synthetic-secret-0123456789';
const localOptIns = (port) => ({
  AURA_MCP_AUTH_MODE: 'local-dev',
  AURA_MCP_REMOTE_ENABLED: '1',
  AURA_MCP_RESOURCE_URL: `http://127.0.0.1:${port}/api/mcp`,
  AURA_MCP_AUTHORIZATION_SERVER: `http://127.0.0.1:${port}`,
  AUTH_SECRET: SYNTHETIC_SECRET,
});

// expectMcp: status /api/mcp must return for a Bearer token and for no token.
const SCENARIOS = [
  { name: 'Docker defaults (NODE_ENV=production, remote MCP off)', env: () => ({ NODE_ENV: 'production', AUTH_SECRET: SYNTHETIC_SECRET }), expectMcp: 404 },
  { name: 'Production + every local opt-in', env: (p) => ({ NODE_ENV: 'production', ...localOptIns(p) }), expectMcp: 401 },
  { name: 'every local opt-in + runtime NODE_ENV=test', env: (p) => ({ NODE_ENV: 'test', ...localOptIns(p) }), expectMcp: 401 },
  { name: 'Preview-like (VERCEL=1, VERCEL_ENV=preview) + every local opt-in', env: (p) => ({ NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'preview', ...localOptIns(p) }), expectMcp: 401 },
];

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function isolatedCopy() {
  if (!fs.existsSync(path.join(standaloneDir, 'server.js'))) {
    throw new Error(`no server.js in ${standaloneDir} -- run \`next build\` (output: 'standalone') first`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-standalone-oauth-'));
  fs.cpSync(standaloneDir, dir, { recursive: true, verbatimSymlinks: true });
  if (fs.existsSync(staticDir)) fs.cpSync(staticDir, path.join(dir, '.next', 'static'), { recursive: true });
  return dir;
}

async function waitForServer(origin, child, logs) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early (code ${child.exitCode}): ${logs.join('').slice(-800)}`);
    try {
      await fetch(`${origin}/api/mcp`, { method: 'GET' });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error('server did not start within 60s');
}

async function status(origin, method, p, headers = {}) {
  const res = await fetch(origin + p, { method, headers, redirect: 'manual' });
  await res.arrayBuffer();
  return res.status;
}

async function runScenario(dir, scenario) {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const env = { PATH: process.env.PATH, HOME: os.tmpdir(), PORT: String(port), HOSTNAME: '127.0.0.1', NEXT_TELEMETRY_DISABLED: '1', ...scenario.env(port) };
  const logs = [];
  const child = spawn(process.execPath, ['server.js'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));
  const failures = [];
  try {
    await waitForServer(origin, child, logs);
    for (const [method, p] of OAUTH_PATHS) {
      const st = await status(origin, method, p);
      if (st !== 404) failures.push(`${method} ${p} -> ${st} (expected 404)`);
    }
    const mcpHeaders = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    const body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}';
    for (const [label, headers] of [['Bearer token', { ...mcpHeaders, authorization: 'Bearer synthetic-standalone-check-token' }], ['no token', mcpHeaders]]) {
      const res = await fetch(`${origin}/api/mcp`, { method: 'POST', headers, body });
      await res.arrayBuffer();
      if (res.status !== scenario.expectMcp) failures.push(`POST /api/mcp (${label}) -> ${res.status} (expected ${scenario.expectMcp})`);
    }
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
  }
  const log = logs.join('');
  for (const marker of ['ERR_MODULE_NOT_FOUND', 'Cannot find package', 'Cannot find module']) {
    if (log.includes(marker)) failures.push(`server log contains "${marker}"`);
  }
  return failures;
}

(async () => {
  const dir = isolatedCopy();
  let failed = 0;
  try {
    for (const scenario of SCENARIOS) {
      const failures = await runScenario(dir, scenario);
      if (failures.length) {
        failed += failures.length;
        console.log(`FAIL ${scenario.name}`);
        for (const f of failures) console.log(`       ${f}`);
      } else {
        console.log(`OK   ${scenario.name}: ${OAUTH_PATHS.length} OAuth paths 404, /api/mcp ${scenario.expectMcp}`);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (failed) {
    console.error(`\nStandalone OAuth check FAILED (${failed} problem(s)).`);
    process.exit(1);
  }
  console.log(`\nStandalone OAuth check passed: ${SCENARIOS.length} scenarios, isolated copy of ${path.relative(process.cwd(), standaloneDir) || standaloneDir}.`);
})().catch((err) => {
  console.error(`Standalone OAuth check FAILED: ${err.message}`);
  process.exit(1);
});
