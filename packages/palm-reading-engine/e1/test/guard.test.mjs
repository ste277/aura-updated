// AURA-PALM-03-E1 -- production exclusion, isolation, frozen-engine preservation and output safety.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { planSelection, defaultLibrary, MODES, E1_ENGINE } from '../src/index.mjs';
import { E1, PKG, REPO, oracleDump, tmpdir, writeArtifactFixture, FIXTURE_BUILD_ID } from './helpers.mjs';
const composeSyn = (obs, opts = {}) => planSelection(defaultLibrary(), obs, { synthetic: true, ...opts });

const read = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['node_modules', '.next', '.git'].includes(e.name) ? [] : read(path.join(d, e.name))) : [path.join(d, e.name)]));
const code = (files) => files.filter((f) => /\.(m?[jt]sx?|c?js|json)$/.test(f));
const GUARD = path.join(REPO, 'apps', 'web', 'scripts', 'check-palm-e1-bundle.js');

test('G1 E1 bundle guard: sentinels are unique to E1; every shipped location is scanned (R3); failures are closed', async () => {
  const { SENTINELS, SCAN_DIRS, scan, scanAll } = await import(pathToFileURL(GUARD).href);
  assert.ok(SENTINELS.length >= 5);
  assert.deepEqual(SCAN_DIRS, ['.next/static', '.next/server', '.next/standalone', 'public']);
  const e1Text = code([...read(path.join(E1, 'src')), ...read(path.join(E1, 'library'))]).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const s of SENTINELS) assert.ok(e1Text.includes(s), `sentinel not in E1: ${s}`);
  const others = code(['apps', 'packages'].flatMap((d) => read(path.join(REPO, d)))).filter((f) => !path.resolve(f).startsWith(E1 + path.sep) && path.resolve(f) !== GUARD);
  for (const f of others) { const t = fs.readFileSync(f, 'utf8'); for (const s of SENTINELS) assert.ok(!t.includes(s), `sentinel ${s} also in ${path.relative(REPO, f)}`); }
  const fresh = () => {
    const t = tmpdir('guard');
    writeArtifactFixture(t, 'web-build'); // R4: a complete artifact, so only the planted content decides
    for (const d of ['.next/standalone/node_modules/pkg/dist', '.next/standalone/.next/server', 'public/assets']) fs.mkdirSync(path.join(t, d), { recursive: true });
    fs.writeFileSync(path.join(t, 'public/assets/logo.svg'), '<svg/>');
    return t;
  };
  const clean = fresh();
  try { const r = scan(clean); assert.deepEqual([r.hits, r.errors], [[], []]); assert.ok(r.files >= 2); } finally { fs.rmSync(clean, { recursive: true, force: true }); }
  // a marker planted independently in each shipped location, with assorted extensions (not only .js)
  const spots = ['.next/static/chunks/x.css', '.next/server/app/x.rsc', '.next/standalone/server.js', '.next/standalone/node_modules/pkg/dist/x.cjs', '.next/standalone/node_modules/pkg/x.wasm', '.next/standalone/.next/server/x.map', 'public/assets/x.json', 'public/x.png', 'public/x'];
  for (const spot of spots) for (const s of [SENTINELS[0], SENTINELS[2], SENTINELS[5]]) {
    const t = fresh();
    try {
      fs.writeFileSync(path.join(t, spot), Buffer.concat([Buffer.from([0, 255, 1]), Buffer.from(`var x=${JSON.stringify(s)}`), Buffer.from([0])]));
      const r = scan(t);
      assert.equal(r.hits.length, 1, `${spot} / ${s}`);
      assert.equal(r.hits[0].file, spot);
    } finally { fs.rmSync(t, { recursive: true, force: true }); }
  }
  // a text-free plan or a catalogue fragment would be caught too
  const t2 = fresh();
  try {
    fs.writeFileSync(path.join(t2, 'public/plan.json'), JSON.stringify(composeSyn({ 'lines.life': { provenance: 'user-confirmed', value: 'present' } })));
    assert.ok(scan(t2).hits.length >= 1);
  } finally { fs.rmSync(t2, { recursive: true, force: true }); }
  // symlinks: inside the scanned tree -> followed and scanned; leaving it -> scan error (fail closed)
  const t3 = fresh(), outside = tmpdir('outside');
  try {
    fs.writeFileSync(path.join(outside, 'leak.js'), `var x=${JSON.stringify(SENTINELS[1])}`);
    fs.symlinkSync(outside, path.join(t3, '.next/standalone/node_modules/linked'));
    const r = scan(t3);
    assert.ok(r.errors.some((e) => /symlink leaves the scanned tree/.test(e)), JSON.stringify(r.errors));
    fs.rmSync(path.join(t3, '.next/standalone/node_modules/linked'));
    fs.mkdirSync(path.join(t3, '.next/standalone/real'));
    fs.writeFileSync(path.join(t3, '.next/standalone/real/i.js'), `var x=${JSON.stringify(SENTINELS[1])}`);
    fs.symlinkSync(path.join(t3, '.next/standalone/real'), path.join(t3, '.next/standalone/node_modules/inside'));
    assert.ok(scan(t3).hits.length >= 1);
  } finally { fs.rmSync(t3, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
  // --tree mode (Docker runtime tree): everything under the directory, including migrations and node_modules
  const t4 = tmpdir('tree');
  try {
    writeArtifactFixture(t4, 'docker-release-tree');
    fs.mkdirSync(path.join(t4, 'node_modules/p'), { recursive: true });
    assert.deepEqual([scanAll(t4).hits, scanAll(t4).errors], [[], []]);
    for (const spot of ['node_modules/p/i.js', 'migrations/0001_init/migration.sql', 'public/x.txt', 'server.js']) {
      fs.writeFileSync(path.join(t4, spot), `${SENTINELS[4]}`);
      assert.equal(scanAll(t4).hits.length, 1, spot);
      fs.writeFileSync(path.join(t4, spot), 'clean');
    }
  } finally { fs.rmSync(t4, { recursive: true, force: true }); }
  assert.match(fs.readFileSync(GUARD, 'utf8'), /UNCONDITIONAL/);
});

test('G1b R4 positive artifact verification: missing, empty, incomplete, malformed or unreadable required output fails closed', async () => {
  const { scan, scanAll, REQUIRED, checkStructure } = await import(pathToFileURL(GUARD).href);
  assert.deepEqual(Object.keys(REQUIRED).sort(), ['docker-release-tree', 'web-build']);
  const errs = (target, t) => (target === 'web-build' ? scan(t) : scanAll(t)).errors;
  for (const target of ['web-build', 'docker-release-tree']) {
    // the independent witnesses: an empty tree, and an empty .next/static with all else missing
    const e = tmpdir('g1b'), s0 = tmpdir('g1b');
    try {
      assert.ok(errs(target, e).length > 0, `${target}: empty tree must fail`);
      fs.mkdirSync(path.join(s0, '.next/static'), { recursive: true });
      assert.ok(errs(target, s0).length > 0, `${target}: empty .next/static only must fail`);
    } finally { fs.rmSync(e, { recursive: true, force: true }); fs.rmSync(s0, { recursive: true, force: true }); }
    // a complete fixture passes; removing or emptying ANY single required file makes it fail
    const t = tmpdir('g1b');
    const required = writeArtifactFixture(t, target);
    try {
      assert.deepEqual(checkStructure(t, target), [], target);
      for (const rel of required) {
        const full = path.join(t, rel), body = fs.readFileSync(full);
        fs.rmSync(full);
        assert.ok(errs(target, t).length > 0, `${target}: missing ${rel} must fail`);
        fs.writeFileSync(full, '');
        assert.ok(errs(target, t).length > 0, `${target}: empty ${rel} must fail`);
        fs.writeFileSync(full, body);
      }
      assert.deepEqual(checkStructure(t, target), [], `${target} restored`);
      // malformed or inconsistent content
      const mutate = (rel, body, why) => { const full = path.join(t, rel), old = fs.readFileSync(full); fs.writeFileSync(full, body); assert.ok(checkStructure(t, target).length > 0, `${target}: ${why}`); fs.writeFileSync(full, old); };
      mutate('.next/BUILD_ID', 'x y', 'malformed build id');
      mutate('.next/BUILD_ID', 'otherBuild0001', 'build id without its static manifest');
      mutate('public/manifest.json', '{not json', 'malformed manifest JSON');
      mutate('.next/server/app-paths-manifest.json', '{}', 'empty manifest object');
      if (target === 'web-build') mutate('.next/standalone/.next/BUILD_ID', 'otherBuild0001', 'standalone build id differs');
      // an empty chunk directory, an empty server app tree, and (Docker) a migration without its SQL
      fs.rmSync(path.join(t, '.next/static/chunks/a.js')); fs.writeFileSync(path.join(t, '.next/static/chunks/a.css'), 'x');
      assert.ok(checkStructure(t, target).some((x) => /\.js file under \.next\/static\/chunks/.test(x)), `${target}: no JS chunk`);
      fs.rmSync(path.join(t, '.next/static/chunks/a.css')); fs.writeFileSync(path.join(t, '.next/static/chunks/a.js'), 'x');
      if (target === 'docker-release-tree') {
        fs.mkdirSync(path.join(t, 'migrations/0002_empty'));
        assert.ok(checkStructure(t, target).some((x) => /0002_empty/.test(x)), 'migration directory without migration.sql');
        fs.rmSync(path.join(t, 'migrations/0002_empty'), { recursive: true });
        fs.rmSync(path.join(t, 'migrations/0001_init'), { recursive: true });
        assert.ok(checkStructure(t, target).some((x) => /no migrations/.test(x)), 'no migrations');
      }
      // an unreadable required file (skipped when running as root, which can read anything)
      if (process.getuid?.() !== 0) {
        const full = path.join(t, '.next/server/webpack-runtime.js');
        fs.chmodSync(full, 0o000);
        try { assert.ok(checkStructure(t, target).some((x) => /unreadable/.test(x)), `${target}: unreadable required file`); } finally { fs.chmodSync(full, 0o644); }
      }
    } finally { fs.rmSync(t, { recursive: true, force: true }); }
  }
  // R4 (Vercel): a monorepo trace root nests the standalone app (.next/standalone/apps/web/server.js) and keeps
  // node_modules and package.json at the standalone root; the app root is located, not assumed
  const v = tmpdir('g1b-vercel');
  try {
    writeArtifactFixture(v, 'web-build');
    const sa = path.join(v, '.next/standalone');
    fs.mkdirSync(path.join(sa, 'apps/web'), { recursive: true });
    for (const n of ['server.js', '.next']) fs.renameSync(path.join(sa, n), path.join(sa, 'apps/web', n));
    assert.deepEqual(checkStructure(v, 'web-build'), []);
    fs.writeFileSync(path.join(sa, 'apps/web/.next/BUILD_ID'), 'otherBuild0001');
    assert.ok(checkStructure(v, 'web-build').some((x) => /exactly one standalone app root/.test(x)), 'nested root with another build id');
    fs.writeFileSync(path.join(sa, 'apps/web/.next/BUILD_ID'), FIXTURE_BUILD_ID);
    fs.mkdirSync(path.join(sa, 'apps/other/.next'), { recursive: true });
    fs.writeFileSync(path.join(sa, 'apps/other/server.js'), 'x'); fs.writeFileSync(path.join(sa, 'apps/other/.next/BUILD_ID'), FIXTURE_BUILD_ID);
    assert.ok(checkStructure(v, 'web-build').some((x) => /found 2/.test(x)), 'two candidate app roots are ambiguous');
    fs.rmSync(path.join(sa, 'apps/other'), { recursive: true });
    fs.rmSync(path.join(sa, 'node_modules'), { recursive: true });
    assert.ok(checkStructure(v, 'web-build').some((x) => /node_modules\/next\/package\.json/.test(x)), 'no Next runtime anywhere up the standalone tree');
  } finally { fs.rmSync(v, { recursive: true, force: true }); }
  // the CLI fails closed on both witnesses (exit 1), and passes a complete tree
  const run = (args) => spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8' });
  const e = tmpdir('g1b-cli'), w = tmpdir('g1b-cli'), d = tmpdir('g1b-cli');
  try {
    assert.equal(run(['--tree', e]).status, 1);
    fs.mkdirSync(path.join(e, '.next/static'), { recursive: true });
    assert.equal(run([e]).status, 1);
    writeArtifactFixture(w, 'web-build'); writeArtifactFixture(d, 'docker-release-tree');
    assert.equal(run([w]).status, 0, run([w]).stderr);
    assert.equal(run(['--tree', d]).status, 0, run(['--tree', d]).stderr);
    assert.equal(FIXTURE_BUILD_ID.length >= 8, true);
  } finally { for (const x of [e, w, d]) fs.rmSync(x, { recursive: true, force: true }); }
});

test('G1c R5 executable runtime completeness: the Next startup modules named by server.js must resolve INSIDE the artifact', async () => {
  const { checkStructure } = await import(pathToFileURL(GUARD).href);
  const START = 'node_modules/next/dist/server/lib/start-server.js', MAIN = 'node_modules/next/dist/server/next.js';
  const layouts = [
    ['web-build flat', 'web-build', (t) => { writeArtifactFixture(t, 'web-build'); return '.next/standalone/'; }],
    ['web-build nested (Vercel)', 'web-build', (t) => { writeArtifactFixture(t, 'web-build'); const sa = path.join(t, '.next/standalone'); fs.mkdirSync(path.join(sa, 'apps/web'), { recursive: true }); for (const n of ['server.js', '.next']) fs.renameSync(path.join(sa, n), path.join(sa, 'apps/web', n)); return '.next/standalone/'; }],
    ['docker-release-tree', 'docker-release-tree', (t) => { writeArtifactFixture(t, 'docker-release-tree'); return ''; }],
  ];
  for (const [name, target, make] of layouts) {
    const fresh = () => { const t = tmpdir('g1c'); const pre = make(t); return { t, pre }; };
    const errsOf = (t) => checkStructure(t, target);
    let { t, pre } = fresh();
    try {
      assert.deepEqual(errsOf(t), [], name);
      // the R4 independent witness: package metadata present, startup module removed
      fs.rmSync(path.join(t, pre + START));
      assert.ok(errsOf(t).some((x) => /startup entry for next\/dist\/server\/lib\/start-server is missing/.test(x)), `${name}: missing start-server`);
      fs.writeFileSync(path.join(t, pre + START), '');
      assert.ok(errsOf(t).some((x) => /start-server is empty/.test(x)), `${name}: empty start-server`);
      fs.writeFileSync(path.join(t, pre + START), 'x');
      fs.rmSync(path.join(t, pre + MAIN));
      assert.ok(errsOf(t).some((x) => /startup entry for next is missing/.test(x)), `${name}: missing next main`);
      fs.writeFileSync(path.join(t, pre + MAIN), 'x');
      assert.deepEqual(errsOf(t), [], `${name} restored`);
      // a host/workspace copy of Next OUTSIDE the boundary must not satisfy the check
      const hostNext = `${t}-host-next`;
      fs.renameSync(path.join(t, pre + 'node_modules/next'), hostNext);
      const outside = target === 'web-build' ? path.join(t, 'node_modules') : path.join(path.dirname(t), `${path.basename(t)}-host`, 'node_modules');
      fs.mkdirSync(outside, { recursive: true }); fs.cpSync(hostNext, path.join(outside, 'next'), { recursive: true });
      const res = target === 'web-build' ? errsOf(t) : checkStructure(t, target);
      assert.ok(res.some((x) => /does not resolve from .* within/.test(x)), `${name}: resolved from outside the artifact: ${JSON.stringify(res)}`);
      fs.rmSync(outside, { recursive: true, force: true }); if (target !== 'web-build') fs.rmSync(path.dirname(outside), { recursive: true, force: true });
      // a symlinked Next whose real files are outside the boundary
      fs.symlinkSync(hostNext, path.join(t, pre + 'node_modules/next'));
      assert.ok(errsOf(t).some((x) => /resolves outside the shipped artifact/.test(x)), `${name}: symlink escape`);
    } finally { fs.rmSync(t, { recursive: true, force: true }); fs.rmSync(`${t}-host-next`, { recursive: true, force: true }); }
    // server.js that names no Next startup dependency, and a Next with an exports map
    ({ t, pre } = fresh());
    try {
      const appServer = name.includes('nested') ? '.next/standalone/apps/web/server.js' : pre + 'server.js';
      fs.writeFileSync(path.join(t, appServer), "require('path')\n");
      assert.ok(errsOf(t).some((x) => /cannot identify the Next startup dependency/.test(x)), `${name}: no startup dependency`);
      fs.writeFileSync(path.join(t, appServer), "require('next')\nrequire('next/dist/server/lib/start-server')\n");
      fs.writeFileSync(path.join(t, pre + 'node_modules/next/package.json'), '{"name":"next","main":"./dist/server/next.js","exports":{".":"./x.js"}}');
      assert.ok(errsOf(t).some((x) => /exports map/.test(x)), `${name}: exports map`);
    } finally { fs.rmSync(t, { recursive: true, force: true }); }
  }
});

test('G1d R6 isolated startup smoke: the generated server must start from its own artifact and serve its manifest', () => {
  const SMOKE = path.join(REPO, 'apps', 'web', 'scripts', 'check-artifact-startup.js');
  const B = FIXTURE_BUILD_ID;
  // a runnable miniature of a Next standalone artifact: server.js -> next -> require-hook, and start-server
  const runnable = (base) => {
    const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), body); };
    put('server.js', "require('next')\nconst { startServer } = require('next/dist/server/lib/start-server')\nstartServer()\n");
    put('.next/BUILD_ID', B);
    put('node_modules/next/package.json', '{"name":"next","main":"./dist/server/next.js"}');
    put('node_modules/next/dist/server/next.js', "require('./require-hook')\nmodule.exports = {}\n");
    put('node_modules/next/dist/server/require-hook.js', 'module.exports = 1\n');
    put('node_modules/next/dist/server/lib/start-server.js', "require('../next')\nexports.startServer = () => { const fs = require('fs'), path = require('path'); const id = fs.readFileSync(path.join(process.cwd(), '.next/BUILD_ID'), 'utf8').trim(); require('http').createServer((q, s) => { if (q.url === '/_next/static/' + id + '/_buildManifest.js') s.end('self.__BUILD_MANIFEST={}'); else { s.statusCode = 404; s.end(); } }).listen(+process.env.PORT, process.env.HOSTNAME); }\n");
  };
  const run = (args, env = {}) => spawnSync(process.execPath, [SMOKE, ...args], { encoding: 'utf8', env: { ...process.env, AURA_STARTUP_TIMEOUT_MS: '8000', ...env } });
  // Docker-tree layout
  const t = tmpdir('g1d');
  try {
    runnable(t);
    let r = run(['--tree', t]);
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /\[artifact-startup\] OK/);
    assert.ok(!fs.existsSync(path.join(t, '.next/cache')), 'the artifact itself is never modified');
    // the R5 independent witness: a transitive startup module missing while both direct entries remain
    fs.renameSync(path.join(t, 'node_modules/next/dist/server/require-hook.js'), path.join(t, 'rh.bak'));
    r = run(['--tree', t]);
    assert.equal(r.status, 1); assert.match(r.stderr, /the server exited/); assert.match(r.stderr, /require-hook/);
    fs.renameSync(path.join(t, 'rh.bak'), path.join(t, 'node_modules/next/dist/server/require-hook.js'));
    // a module that resolves OUTSIDE the artifact (symlinked from elsewhere) is refused by the resolution hook
    const outside = tmpdir('g1d-out');
    fs.writeFileSync(path.join(outside, 'require-hook.js'), 'module.exports = 1\n');
    fs.rmSync(path.join(t, 'node_modules/next/dist/server/require-hook.js'));
    fs.symlinkSync(path.join(outside, 'require-hook.js'), path.join(t, 'node_modules/next/dist/server/require-hook.js'));
    r = run(['--tree', t]);
    assert.equal(r.status, 1); assert.match(r.stderr, /resolved outside the artifact/);
    fs.rmSync(path.join(t, 'node_modules/next/dist/server/require-hook.js')); fs.rmSync(outside, { recursive: true, force: true });
    fs.writeFileSync(path.join(t, 'node_modules/next/dist/server/require-hook.js'), 'module.exports = 1\n');
    // a server that crashes, and one that never becomes ready
    fs.writeFileSync(path.join(t, 'server.js'), "require('next'); throw new Error('startup failed')\n");
    r = run(['--tree', t]); assert.equal(r.status, 1); assert.match(r.stderr, /startup failed/);
    fs.writeFileSync(path.join(t, 'server.js'), "require('next'); setInterval(() => {}, 1000)\n");
    r = run(['--tree', t], { AURA_STARTUP_TIMEOUT_MS: '1500' }); assert.equal(r.status, 1); assert.match(r.stderr, /no readiness within/);
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
  // web-build layouts: flat (CI, Docker build stage) and nested (Vercel-style), with node_modules at the standalone root
  for (const nested of [false, true]) {
    const w = tmpdir('g1d-web');
    try {
      fs.mkdirSync(path.join(w, '.next/static', B), { recursive: true });
      fs.writeFileSync(path.join(w, '.next/BUILD_ID'), B);
      fs.writeFileSync(path.join(w, `.next/static/${B}/_buildManifest.js`), 'x');
      const sa = path.join(w, '.next/standalone');
      runnable(sa);
      if (nested) { fs.mkdirSync(path.join(sa, 'apps/web'), { recursive: true }); for (const n of ['server.js', '.next']) fs.renameSync(path.join(sa, n), path.join(sa, 'apps/web', n)); }
      let r = run([w]);
      assert.equal(r.status, 0, `${nested ? 'nested' : 'flat'}: ${r.stderr}`);
      fs.rmSync(path.join(sa, 'node_modules/next/dist/server/require-hook.js'));
      r = run([w]);
      assert.equal(r.status, 1, nested ? 'nested witness' : 'flat witness'); assert.match(r.stderr, /require-hook/);
    } finally { fs.rmSync(w, { recursive: true, force: true }); }
  }
});

test('G2 nothing outside the engine package imports or names E1; no manifest, alias or config resolves to it', () => {
  const outside = code(['apps', 'packages'].flatMap((d) => read(path.join(REPO, d)))).filter((f) => !path.resolve(f).startsWith(PKG + path.sep) && path.resolve(f) !== GUARD);
  const hits = outside.filter((f) => /palm-reading-engine\/e1|aura\.palm\.e1|composeFromObservations|generateE1Reading/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(hits.map((f) => path.relative(REPO, f)), []);
  const manifests = read(REPO).filter((f) => /(^|\/)(package\.json|tsconfig[\w.-]*\.json|next\.config\.[cm]?js)$/.test(f) && !f.includes(`${path.sep}node_modules${path.sep}`) && !path.resolve(f).startsWith(PKG + path.sep));
  for (const m of manifests) assert.ok(!/palm-reading-engine/.test(fs.readFileSync(m, 'utf8')), `${path.relative(REPO, m)} references the engine package`);
});

test('G3 E1 source has no network, storage, console, camera, process, file-system, clock or randomness access', () => {
  for (const f of read(path.join(E1, 'src'))) {
    let s = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // R5: reading.ts (the pipeline) loads the E1 modules and the I1 contract adapter through the CommonJS loader --
    // exactly these local requires, nothing else
    if (path.basename(f) === 'reading.ts') {
      const allowedRequires = ["require('./identity.mjs')", "require('./packaged.mjs')", "require('./compose.mjs')", "require('./construction.mjs')", "require('./descriptors.mjs')", "require('./grid.mjs')", "require('../../adapter/feature-set-adapter.mjs')"];
      assert.deepEqual([...s.matchAll(/require\([^)]*\)/g)].map((m) => m[0]).sort(), [...allowedRequires].sort(), 'reading.ts requires');
      for (const r of allowedRequires) s = s.replace(r, '');
    }
    // R4 (F2): packaged.mjs reads exactly its two vendored library files once, as bytes, and checks their digests --
    // only these two imports and this one read are allowed; no other file-system or crypto use anywhere.
    if (path.basename(f) === 'packaged.mjs') {
      for (const allowed of ["import { readFileSync } from 'node:fs';", "import { createHash } from 'node:crypto';", 'readFileSync(new URL(`../library/${name}.json`, import.meta.url))']) {
        assert.equal(s.split(allowed).length, 2, `packaged.mjs: expected exactly one ${allowed}`);
        s = s.replace(allowed, '');
      }
      assert.deepEqual([...s.matchAll(/readPinned\('([a-z]+)'/g)].map((m) => m[1]), ['catalogue', 'schema']);
      assert.ok(!/readFileSync|createHash\(\)\.update\(\w+\)\.digest\('hex'\)[\s\S]*createHash/.test(s), 'packaged.mjs: one read only');
    }
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|document\.|navigator\.|getUserMedia|console\.|process\.|node:fs|node:child_process|node:net|node:http|node:crypto|require\(|Date\.now|new Date|Math\.random|https?:\/\//.test(s), path.basename(f));
    assert.ok(!/prototype\/src/.test(s), `${path.basename(f)} imports the frozen G6 engine`);
  }
  const pipeline = fs.readFileSync(path.join(E1, 'src', 'reading.ts'), 'utf8');
  assert.match(pipeline, /require\('\.\.\/\.\.\/adapter\/feature-set-adapter\.mjs'\)/); // I1 contract validation only
  assert.match(fs.readFileSync(path.join(E1, 'src', 'reading.ts'), 'utf8'), /from '\.\.\/\.\.\/\.\.\/\.\.\/apps\/web\/lib\/palm-analysis\/features'/); // the I1 builder, nothing else from apps
  assert.equal(E1_ENGINE.syntheticOnly, true);
});

test('G4 frozen G6 engine, I1 adapter and the approved educational guide are byte-identical to main (7b80f98)', () => {
  const EXPECTED = {
    'packages/palm-reading-engine/prototype/src': '70509d44bf9d1261d9ab989b86fa07b755d4926801416914a72ffa2efda5a0b0',
    'packages/palm-reading-engine/adapter': '2a864efb9bb504acf1d4c3041c5b2b7e183c604f154949098230574dfa592b3a',
    'packages/palmistry/src': '500e991a7755925b959cab09137e8f9e0a0162f988be9a4455288762cfdd26cd',
  };
  for (const [d, want] of Object.entries(EXPECTED)) {
    const files = read(path.join(REPO, d)).map((f) => path.relative(REPO, f)).sort();
    const h = crypto.createHash('sha256');
    for (const f of files) { h.update(`${f}\0`); h.update(fs.readFileSync(path.join(REPO, f))); }
    assert.equal(h.digest('hex'), want, d);
  }
  assert.match(fs.readFileSync(path.join(REPO, 'packages/palmistry/src/review-status.json'), 'utf8'), /"status":\s*"APPROVED"/);
});

test('G5 every emittable record passes the all-fields wording check; the plan over all 5,760 derivations carries no text', () => {
  const BANNED = /\b(die|dies|death|lifespan|life span|live long|long life|longevity|rich|wealth|money|marri|husband|wife|children|sons|daughter|fertil|caste|varṇa|varna|health|illness|disease|accident|misfortune|guarantee|will become|you will|destined|fate)\w*/i;
  const FUT = /\b(you will|you'll|will (be|have|find|meet|become|get)|going to|your future|in the future)\b/i;
  const lib = defaultLibrary();
  for (const id of lib.initialIds) for (const v of Object.values(lib.byId[id].userFacing)) { assert.equal(typeof v, 'string', id); assert.ok(!BANNED.test(v) && !FUT.test(v), `${id}: ${v}`); }
  for (const r of Object.values(lib.reasons)) assert.ok(!BANNED.test(r.wording) && !FUT.test(r.wording), r.code);
  let n = 0;
  for (const s of oracleDump().sweep) for (const mode of MODES) { const r = composeSyn(s.inputs, { mode }); assert.ok(!/"text"|"wording"/.test(JSON.stringify(r))); n++; }
  assert.equal(n, 5760);
});
