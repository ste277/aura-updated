// G6-D0 — isolation, privacy and content-provenance guards (synthetic only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateReading } from '../src/engine.mjs';
import { FAMILIES } from '../src/rules.mjs';
import { SAMPLE_FIXTURES } from '../fixtures/synthetic-fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'src');
// G6-I1: the engine now lives at packages/palm-reading-engine/prototype, one level deeper than in the evidence packages.
const REPO = path.resolve(here, '..', '..', '..', '..'); // repository root
const PKG = path.resolve(here, '..', '..'); // packages/palm-reading-engine
const srcFiles = fs.readdirSync(SRC).filter((f) => f.endsWith('.mjs')).map((f) => [f, fs.readFileSync(path.join(SRC, f), 'utf8')]);
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

test('engine source imports only sibling modules and node:crypto', () => {
  for (const [f, s] of srcFiles) {
    const specs = [...s.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] || m[2] || m[3]);
    for (const sp of specs) assert.ok(sp === 'node:crypto' || /^\.\/[a-z-]+\.mjs$/.test(sp), `${f} imports ${sp}`);
  }
});

test('engine source has no network, storage, camera, MediaPipe, clock or randomness access', () => {
  const forbidden = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /navigator\./, /getUserMedia/, /localStorage/, /sessionStorage/, /indexedDB/,
    /mediapipe\b(?!-hands')/i, /@mediapipe/, /\bprocess\.env/, /Date\.now|new Date\(/, /Math\.random/, /node:fs|['"]fs['"]/, /node:https?|['"]https?['"]/, /node:net|child_process/,
    /apps\/web|packages\//, /\beval\s*\(|new Function\(/];
  for (const [f, s] of srcFiles) for (const re of forbidden) assert.ok(!re.test(stripComments(s)), `${f} matches ${re}`);
});

test('runtime: generating every sample performs no network or filesystem writes', () => {
  const calls = [];
  const origFetch = globalThis.fetch;
  const wrapped = ['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile', 'mkdirSync', 'createWriteStream', 'openSync'];
  const orig = Object.fromEntries(wrapped.map((k) => [k, fs[k]]));
  globalThis.fetch = (...a) => { calls.push(['fetch', a[0]]); throw new Error('network blocked'); };
  for (const k of wrapped) fs[k] = (...a) => { calls.push([k, a[0]]); throw new Error('fs write blocked'); };
  try {
    for (const mk of Object.values(SAMPLE_FIXTURES)) generateReading(mk());
  } finally {
    globalThis.fetch = origFetch; for (const k of wrapped) fs[k] = orig[k];
  }
  assert.deepEqual(calls, []);
});

test('no production code imports or references the G6-D0 prototype', () => {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.next', '.git', 'dist', 'build', '.turbo'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(m?[jt]sx?|json)$/.test(e.name)) {
        const s = fs.readFileSync(p, 'utf8');
        if (/AURA_PALM_G6_D0|palm-g6|reading-engine|g6d0/i.test(s)) hits.push(path.relative(REPO, p));
      }
    }
  };
  // G6-I1: the engine package itself is the only place allowed to name the engine; every other file under apps/ and
  // packages/ (all production code) must not import or reference it.
  for (const d of ['apps', 'packages']) if (fs.existsSync(path.join(REPO, d))) walk(path.join(REPO, d));
  assert.deepEqual(hits.filter((h) => !path.resolve(REPO, h).startsWith(PKG + path.sep)), []);
});

test('prototype lives outside production import paths', () => {
  // G6-I1: the engine now sits in packages/palm-reading-engine (owner-approved location), so "outside production
  // import paths" is enforced by what makes a path a production import path: no app or other package depends on it,
  // no TypeScript path alias or webpack alias resolves to it, and nothing outside the package imports it (above).
  const rel = path.relative(REPO, SRC);
  assert.equal(rel.split(path.sep).slice(0, 2).join('/'), 'packages/palm-reading-engine', rel);
  const manifests = [];
  const find = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', '.next', '.git'].includes(e.name)) continue; const q = path.join(d, e.name); if (e.isDirectory()) { if (path.resolve(q) !== PKG) find(q); } else if (/^(package\.json|tsconfig[\w.-]*\.json|next\.config\.[cm]?js)$/.test(e.name)) manifests.push(q); } };
  find(REPO);
  for (const m of manifests) assert.ok(!/palm-reading-engine|reading-engine-prototype/.test(fs.readFileSync(m, 'utf8')), `${path.relative(REPO, m)} must not depend on, alias or bundle the engine`);
  assert.ok(manifests.some((m) => m.endsWith(path.join('apps', 'web', 'package.json'))), 'the web app manifest was scanned');
});

test('content provenance: no rule text overlaps the paused guide (≥ 6 consecutive words) or uses its entry ids', () => {
  const guidePath = path.join(REPO, 'packages', 'palmistry', 'src', 'content.ts');
  assert.ok(fs.existsSync(guidePath), 'paused guide must be present to run this check');
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const guideStrings = [...fs.readFileSync(guidePath, 'utf8').matchAll(/(['"`])((?:\\.|(?!\1).){20,})\1/g)].map((m) => norm(m[2]));
  const grams = new Set();
  for (const w of guideStrings) for (let i = 0; i + 6 <= w.length; i++) grams.add(w.slice(i, i + 6).join(' '));
  const ruleText = FAMILIES.flatMap((f) => [f.feature, f.absentNote, ...f.variants.flatMap((v) => [v.observe, v.text, v.reflect])]).filter(Boolean);
  const readingText = Object.values(SAMPLE_FIXTURES).map((mk) => JSON.stringify(generateReading(mk())));
  for (const t of [...ruleText, ...readingText]) {
    const w = norm(t);
    for (let i = 0; i + 6 <= w.length; i++) assert.ok(!grams.has(w.slice(i, i + 6).join(' ')), `overlap: "${w.slice(i, i + 6).join(' ')}"`);
  }
  const guideIds = ['ayurlekha', 'dhanamatrlekha', 'pitrlekha', 'urdhvarekha', 'yava', 'matsya', 'shankha', 'chatra', 'vedi', 'zysk'];
  const all = srcFiles.map(([, s]) => stripComments(s).toLowerCase()).join('\n'); // provenance comments may name sources
  for (const id of guideIds) assert.ok(!all.includes(id), `engine source references guide id ${id}`);
});
