#!/usr/bin/env node
// AURA-PALM-03-E1-R6 -- isolated startup smoke check of the ACTUAL shipped server artifact.
//
//   node scripts/check-artifact-startup.js [apps/web]      the standalone web build (CI web-build job): the located
//                                                          standalone app root, with .next/static and public/
//                                                          placed beside it exactly as the Docker image does
//   node scripts/check-artifact-startup.js --tree <dir>    an assembled runtime tree (Docker release-tree stage, /app)
//
// The artifact is copied into a fresh temporary directory with no node_modules anywhere above it, and its generated
// server.js is started there with a minimal non-production environment (no database, no secrets, no external
// services, telemetry off, bound to 127.0.0.1 on a free port). A resolution hook aborts the process if ANY module
// resolves outside the copied artifact, so a missing file can never be satisfied by the workspace or the host. The
// check passes only when the server serves the build's own static manifest (/_next/static/<BUILD_ID>/_buildManifest.js)
// as a COMPLETE response before ONE monotonic deadline (R7: every attempt is bounded by the remaining budget and
// cancelled at expiry; a response completing after the deadline, or headers alone, never count; retries cannot
// extend it); a startup error, an early exit, an out-of-artifact resolution or a timeout fails (exit 1). The
// server is then terminated (SIGTERM, then SIGKILL) and the copy removed. The check never modifies the artifact.
//
// It proves the standalone server starts from its own files. It does not prove hosted (Vercel) runtime completeness:
// Vercel deploys its own serverless output, which is verified by the build guards and the hosted deployment itself.
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const { BUILD_ID_RE, findStandaloneApps } = require('./check-palm-e1-bundle.js');

const TIMEOUT_MS = Number(process.env.AURA_STARTUP_TIMEOUT_MS) > 0 ? Number(process.env.AURA_STARTUP_TIMEOUT_MS) : 60000;
class StartupFailure extends Error {}
const fail = (msg) => { throw new StartupFailure(msg); };
const readId = (dir) => { try { const id = fs.readFileSync(path.join(dir, '.next/BUILD_ID'), 'utf8').trim(); return BUILD_ID_RE.test(id) ? id : null; } catch { return null; } };

function assemble(args, tmp) {
  if (args[0] === '--tree') {
    const src = args[1] ? path.resolve(args[1]) : null;
    if (!src || !fs.existsSync(path.join(src, 'server.js'))) fail('--tree needs a directory containing server.js');
    const app = path.join(tmp, 'app');
    fs.cpSync(src, app, { recursive: true, verbatimSymlinks: true });
    return { app, boundary: app, label: src };
  }
  const web = args[0] ? path.resolve(args[0]) : path.resolve(__dirname, '..');
  const id = readId(web);
  if (!id) fail(`no valid .next/BUILD_ID under ${web} -- run \`next build\` first`);
  const { matching } = findStandaloneApps(web, '.next/standalone', id);
  if (matching.length !== 1) fail(`expected exactly one standalone app root under ${path.join(web, '.next/standalone')}; found ${matching.length}`);
  const rel = path.relative(path.join(web, '.next/standalone'), matching[0]);
  fs.cpSync(path.join(web, '.next/standalone'), path.join(tmp, 'standalone'), { recursive: true, verbatimSymlinks: true });
  const app = path.join(tmp, 'standalone', rel);
  fs.cpSync(path.join(web, '.next/static'), path.join(app, '.next/static'), { recursive: true });
  if (fs.existsSync(path.join(web, 'public'))) fs.cpSync(path.join(web, 'public'), path.join(app, 'public'), { recursive: true });
  return { app, boundary: path.join(tmp, 'standalone'), label: `${path.join(web, '.next/standalone', rel)} (+ .next/static, public)` };
}

/** No node_modules directory may exist above the copied artifact: otherwise Node's lookup could escape it. */
function assertIsolated(boundary) {
  for (let d = path.dirname(path.resolve(boundary)); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'node_modules'))) fail(`cannot isolate the artifact: ${path.join(d, 'node_modules')} exists above it`);
    if (path.dirname(d) === d) return;
  }
}

/** The error lines first (e.g. "Cannot find module './require-hook'"), then the tail of the server output. */
const summarize = (out) => { const lines = out.trim().split('\n'); const key = lines.filter((l) => /Error|Cannot find|resolved outside/.test(l)).slice(0, 6); return [...key, '  ...', ...lines.slice(-8)].join('\n'); };
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const { performance } = require('perf_hooks');

/**
 * R7: one readiness attempt, bounded by the REMAINING readiness budget (a hard total timer, not a socket idle timeout:
 * trickled data cannot keep it alive). Resolves { status, bytes, completedAt } only when the WHOLE response body has
 * been received ('end'); response headers alone never count. When the budget runs out the request is aborted and the
 * attempt resolves null. `now` is the monotonic clock used for completedAt.
 */
function requestWithin(url, budgetMs, now = () => performance.now()) {
  return new Promise((resolve) => {
    if (!(budgetMs > 0)) { resolve(null); return; }
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const req = http.get(url, { agent: false }, (res) => {
      let n = 0;
      res.on('data', (c) => { n += c.length; });
      res.on('end', () => settle({ status: res.statusCode, bytes: n, completedAt: now() }));
      res.on('error', () => settle(null));
      res.on('aborted', () => settle(null));
    });
    const timer = setTimeout(() => { req.destroy(new Error('readiness budget exhausted')); settle(null); }, budgetMs);
    req.on('error', () => settle(null));
  });
}

/**
 * R7: readiness under ONE monotonic deadline, fixed when called. Every attempt gets at most the remaining budget and
 * is cancelled when it expires; retries and pauses are clipped to the deadline, so they can never extend it; a
 * response is accepted only if it is a complete HTTP 200 with a non-empty body that COMPLETED by the deadline.
 * Returns { ready: response } or { ready: null, reason: 'deadline' | 'exited' }. Clock, sleep, request and liveness
 * are injectable for deterministic tests.
 */
async function waitForReadiness({ url, budgetMs, now = () => performance.now(), request = requestWithin, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), alive = () => true, retryMs = 250 }) {
  const deadline = now() + budgetMs;
  let attempts = 0;
  for (;;) {
    if (!alive()) return { ready: null, reason: 'exited', attempts };
    const remaining = deadline - now();
    if (!(remaining > 0)) return { ready: null, reason: 'deadline', attempts };
    attempts++;
    const r = await request(url, remaining, now);
    if (r && r.status === 200 && r.bytes > 0 && r.completedAt <= deadline) return { ready: r, attempts };
    if (!alive()) return { ready: null, reason: 'exited', attempts };
    const left = deadline - now();
    if (!(left > 0)) return { ready: null, reason: 'deadline', attempts };
    await sleep(Math.min(retryMs, left));
  }
}

/** R7: stop the server -- SIGTERM, then SIGKILL after `graceMs` -- and wait until it has really exited. */
async function terminate(child, graceMs = 5000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
  let grace;
  const done = await Promise.race([exited.then(() => true), new Promise((r) => { grace = setTimeout(() => r(false), graceMs); })]);
  clearTimeout(grace); // never leave the grace timer holding the process open
  if (!done) { try { child.kill('SIGKILL'); } catch { /* already gone */ } await exited; }
}

async function main() {
  const args = process.argv.slice(2);
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aura-startup-')));
  let child = null;
  // R7: on success, timeout, crash or any other failure the server is terminated and awaited, then the copy removed
  const cleanup = async () => { await terminate(child); fs.rmSync(tmp, { recursive: true, force: true }); };
  try {
    const { app, boundary, label } = assemble(args, tmp);
    assertIsolated(boundary);
    const id = readId(app);
    if (!id) fail(`the artifact has no valid .next/BUILD_ID (${label})`);
    const realBoundary = fs.realpathSync(boundary); // the whole copied artifact (nested layouts resolve from ancestors inside it)
    // The resolution hook lives OUTSIDE the artifact copy; it only observes resolutions, it never resolves anything.
    const hook = path.join(tmp, 'resolution-guard.cjs');
    fs.writeFileSync(hook, `'use strict';
const Module = require('module'), fs = require('fs'), path = require('path');
const ROOT = ${JSON.stringify(realBoundary)} + path.sep, builtin = new Set(Module.builtinModules);
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  const out = orig.call(this, request, ...rest);
  if (typeof out === 'string' && path.isAbsolute(out) && !builtin.has(out) && !out.startsWith('node:')) {
    let real = out; try { real = fs.realpathSync(out); } catch { /* reported below */ }
    if (!real.startsWith(ROOT)) { fs.writeSync(2, '[artifact-startup] resolved outside the artifact: ' + request + ' -> ' + real + '\\n'); process.exit(97); }
  }
  return out;
};
`);
    const port = await freePort();
    const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: tmp, TMPDIR: tmp, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', PORT: String(port), HOSTNAME: '127.0.0.1', NODE_PATH: '' };
    let output = '';
    child = spawn(process.execPath, ['-r', hook, 'server.js'], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (c) => { output += c; });
    child.stderr.on('data', (c) => { output += c; });
    const started = performance.now();
    const url = `http://127.0.0.1:${port}/_next/static/${id}/_buildManifest.js`;
    const alive = () => child.exitCode === null && child.signalCode === null;
    const { ready, reason } = await waitForReadiness({ url, budgetMs: TIMEOUT_MS, alive });
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    if (!ready) {
      fail(`${reason === 'exited' ? `the server exited (code ${child.exitCode}${child.signalCode ? `, ${child.signalCode}` : ''})` : `no complete readiness response within the ${TIMEOUT_MS} ms deadline`} -- ${label}\n${summarize(output)}`);
    }
    await terminate(child);
    if (/resolved outside the artifact/.test(output)) fail(`a module resolved outside the artifact -- ${label}\n${output.trim()}`);
    console.log(`[artifact-startup] OK: the generated server.js started from ${label} in isolation and served its build manifest (HTTP 200, ${ready.bytes} bytes) in ${secs}s; terminated cleanly.`);
  } finally { await cleanup(); }
}

module.exports = { waitForReadiness, requestWithin, terminate };

if (require.main === module) {
  main().catch((e) => { console.error(`[artifact-startup] FAIL: ${e instanceof StartupFailure ? e.message : String(e?.stack ?? e)}`); process.exitCode = 1; });
}
