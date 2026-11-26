// AURA-PALM-03-E1 -- production exclusion, isolation, frozen-engine preservation and output safety.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { planSelection, defaultLibrary, MODES, E1_ENGINE } from '../src/index.mjs';
import { E1, PKG, REPO, oracleDump, tmpdir } from './helpers.mjs';
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
    for (const d of ['.next/static/chunks', '.next/server/app', '.next/standalone/node_modules/pkg/dist', '.next/standalone/.next/server', 'public/assets']) fs.mkdirSync(path.join(t, d), { recursive: true });
    fs.writeFileSync(path.join(t, '.next/static/chunks/a.js'), 'console.log("clean")');
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
    for (const d of ['node_modules/p', 'migrations/0001', '.next/static', 'public']) fs.mkdirSync(path.join(t4, d), { recursive: true });
    fs.writeFileSync(path.join(t4, 'server.js'), 'x');
    assert.deepEqual(scanAll(t4).hits, []);
    for (const spot of ['node_modules/p/i.js', 'migrations/0001/migration.sql', 'public/x.txt', 'server.js']) {
      fs.writeFileSync(path.join(t4, spot), `${SENTINELS[4]}`);
      assert.equal(scanAll(t4).hits.length, 1, spot);
      fs.writeFileSync(path.join(t4, spot), 'clean');
    }
  } finally { fs.rmSync(t4, { recursive: true, force: true }); }
  assert.match(fs.readFileSync(GUARD, 'utf8'), /UNCONDITIONAL/);
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
    // reading.ts loads the ESM core through the CommonJS loader (one local require) -- nothing else may require
    if (path.basename(f) === 'reading.ts') s = s.replace("require('./engine-core.mjs')", '');
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|document\.|navigator\.|getUserMedia|console\.|process\.|node:fs|node:child_process|node:net|node:http|node:crypto|require\(|Date\.now|new Date|Math\.random|https?:\/\//.test(s), path.basename(f));
    assert.ok(!/prototype\/src/.test(s), `${path.basename(f)} imports the frozen G6 engine`);
  }
  const obs = fs.readFileSync(path.join(E1, 'src', 'observations.mjs'), 'utf8');
  assert.match(obs, /from '\.\.\/\.\.\/adapter\/feature-set-adapter\.mjs'/); // I1 contract validation only
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
