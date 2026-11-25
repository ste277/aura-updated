// AURA-PALM-03-E1 -- production exclusion, isolation, frozen-engine preservation and output safety.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { composeFromObservations, MODES, E1_ENGINE } from '../src/index.mjs';
import { E1, PKG, REPO, oracleDump, tmpdir } from './helpers.mjs';
const composeSyn = (obs, opts = {}) => composeFromObservations(obs, { synthetic: true, ...opts });

const read = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['node_modules', '.next', '.git'].includes(e.name) ? [] : read(path.join(d, e.name))) : [path.join(d, e.name)]));
const code = (files) => files.filter((f) => /\.(m?[jt]sx?|c?js|json)$/.test(f));
const GUARD = path.join(REPO, 'apps', 'web', 'scripts', 'check-palm-e1-bundle.js');

test('G1 E1 bundle guard: every sentinel occurs in the E1 source/catalogue and nowhere else under apps/ or packages/; the scan detects each', async () => {
  const { SENTINELS, scan } = await import(pathToFileURL(GUARD).href);
  assert.ok(SENTINELS.length >= 5);
  const e1Text = code([...read(path.join(E1, 'src')), ...read(path.join(E1, 'library'))]).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const s of SENTINELS) assert.ok(e1Text.includes(s), `sentinel not in E1: ${s}`);
  const others = code(['apps', 'packages'].flatMap((d) => read(path.join(REPO, d)))).filter((f) => !path.resolve(f).startsWith(E1 + path.sep) && path.resolve(f) !== GUARD);
  for (const f of others) { const t = fs.readFileSync(f, 'utf8'); for (const s of SENTINELS) assert.ok(!t.includes(s), `sentinel ${s} also in ${path.relative(REPO, f)}`); }
  const tmp = tmpdir('guard');
  try {
    fs.mkdirSync(path.join(tmp, '.next', 'static'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.next', 'static', 'a.js'), 'console.log("clean")');
    assert.deepEqual(scan(tmp), []);
    for (const s of SENTINELS) { fs.writeFileSync(path.join(tmp, '.next', 'static', 'b.js'), `var x=${JSON.stringify(s)}`); assert.equal(scan(tmp).length, 1, s); }
    // a serialised catalogue or a rendered reading would be caught
    fs.writeFileSync(path.join(tmp, '.next', 'static', 'b.js'), JSON.stringify(composeSyn({ 'lines.life': { provenance: 'user-confirmed', value: 'present' } })));
    assert.ok(scan(tmp).length >= 1);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
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
    const s = fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|document\.|navigator\.|getUserMedia|console\.|process\.|node:fs|node:child_process|node:net|node:http|require\(|Date\.now|new Date|Math\.random|https?:\/\//.test(s), path.basename(f));
    assert.ok(!/prototype\/src/.test(s), `${path.basename(f)} imports the frozen G6 engine`);
  }
  const obs = fs.readFileSync(path.join(E1, 'src', 'observations.mjs'), 'utf8');
  assert.match(obs, /from '\.\.\/\.\.\/adapter\/feature-set-adapter\.mjs'/); // I1 contract validation only
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

test('G5 output safety over all 5,760 derivations: no prohibited wording, no forecast, tentative only, no numeric confidence', () => {
  const BANNED = /\b(die|dies|death|lifespan|life span|live long|long life|longevity|rich|wealth|money|marri|husband|wife|children|sons|daughter|fertil|caste|varṇa|varna|health|illness|disease|accident|misfortune|guarantee|will become|you will|destined|fate)\w*/i;
  const FUT = /\b(you will|you'll|will (be|have|find|meet|become|get)|going to|your future|in the future)\b/i;
  let items = 0;
  for (const s of oracleDump().sweep) for (const mode of MODES) {
    const r = composeSyn(s.inputs, { mode });
    assert.equal(r.tierCeiling, 'tentative'); assert.equal(r.publicationApproved, false); assert.equal(r.contentStatus, 'UNREVIEWED_RESEARCH_CONTENT');
    for (const n of r.notAssessed) assert.ok(!BANNED.test(n.wording) && !FUT.test(n.wording), n.wording);
    for (const sec of r.sections) for (const it of sec.items) {
      items++;
      const t = Object.values(it.text).join(' ');
      assert.ok(!BANNED.test(t) && !FUT.test(t), `${it.recordId}: ${t}`);
      assert.ok(it.text.reflection.trim().endsWith('?'));
      assert.equal(it.confidence.tier, 'tentative'); assert.equal(it.confidence.displayRule, 'never-as-confidence');
      assert.equal(it.reviewStatus, 'UNREVIEWED_RESEARCH_CONTENT');
      assert.ok(!Object.values(it.confidence).some((v) => typeof v === 'number'));
      assert.ok(it.sources.length > 0 && it.supportingFeatures.length > 0);
    }
  }
  assert.ok(items > 10000, `items checked: ${items}`);
});
