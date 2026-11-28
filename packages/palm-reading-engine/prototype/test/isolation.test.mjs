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

// AURA-PALM-D6-I1 (owner-approved, ticket 50368) -- ONE exact exception: the development-gated scanner may import the
// E1 reading interface (NOT the G6-D0 prototype) with exactly this one line. Only that line is removed from only that
// file before the unchanged pattern is applied, so any other reading-engine reference in it -- and every reference in
// any other file, and every G6-D0 / palm-g6 reference anywhere -- is still a violation. The file is not exempt.
const APPROVED_E1_IMPORT = Object.freeze({
  file: 'apps/web/components/palm-scan/PalmImageInput.tsx',
  line: "import { generateConfirmedScannerReading } from '../../../../packages/palm-reading-engine/e1/src/reading';",
});
const ISOLATION_PATTERN = /AURA_PALM_G6_D0|palm-g6|reading-engine|g6d0/i;
/** Files (repo-relative) outside the engine package whose text references the engine, after the one approved line. */
function isolationViolations(files) {
  const hits = [];
  for (const [rel, text] of files) {
    if (path.resolve(REPO, rel).startsWith(PKG + path.sep)) continue;
    let t = text;
    if (rel === APPROVED_E1_IMPORT.file) {
      const lines = t.split('\n');
      const k = lines.findIndex((l) => l === APPROVED_E1_IMPORT.line);
      if (k >= 0) { lines.splice(k, 1); t = lines.join('\n'); }
    }
    if (ISOLATION_PATTERN.test(t)) hits.push(rel);
  }
  return hits;
}
function productionFiles() {
  const out = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.next', '.next-dev', '.git', 'dist', 'build', '.turbo'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(m?[jt]sx?|json)$/.test(e.name)) out.set(path.relative(REPO, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8'));
    }
  };
  for (const d of ['apps', 'packages']) if (fs.existsSync(path.join(REPO, d))) walk(path.join(REPO, d));
  return out;
}

test('no production code imports or references the G6-D0 prototype', () => {
  // G6-I1: the engine package itself is the only place allowed to name the engine; every other file under apps/ and
  // packages/ (all production code) must not import or reference it -- except the one approved E1 line above.
  assert.deepEqual(isolationViolations(productionFiles()), []);
});

test('D6-I1: the one-line exception is exact -- every other reference is still detected (negative controls)', () => {
  const files = productionFiles();
  const scanner = files.get(APPROVED_E1_IMPORT.file);
  assert.ok(scanner && scanner.split('\n').filter((l) => l === APPROVED_E1_IMPORT.line).length === 1, 'the approved line is present exactly once');
  const variant = (rel, text) => { const m = new Map(files); m.set(rel, text); return isolationViolations(m); };
  // 1. an unauthorised E1 import in another app file
  assert.deepEqual(variant('apps/web/components/PalmistryView.tsx', `${files.get('apps/web/components/PalmistryView.tsx')}\n${APPROVED_E1_IMPORT.line.replace('../../../../', '../../../')}`), ['apps/web/components/PalmistryView.tsx']);
  assert.deepEqual(variant('apps/web/lib/new-helper.ts', APPROVED_E1_IMPORT.line), ['apps/web/lib/new-helper.ts']);
  // 2. an additional reading-engine reference in the scanner itself (the file is not exempt)
  assert.deepEqual(variant(APPROVED_E1_IMPORT.file, `${scanner}\nconst e1 = require('../../../../packages/palm-reading-engine/e1/src/packaged.mjs');`), [APPROVED_E1_IMPORT.file]);
  assert.deepEqual(variant(APPROVED_E1_IMPORT.file, `${scanner}\n${APPROVED_E1_IMPORT.line}`), [APPROVED_E1_IMPORT.file]); // a duplicate of the approved line
  assert.deepEqual(variant(APPROVED_E1_IMPORT.file, scanner.replace(APPROVED_E1_IMPORT.line, `${APPROVED_E1_IMPORT.line} // altered`)), [APPROVED_E1_IMPORT.file]); // an altered line (no longer the exact approved line)
  // 3. a G6-D0 prototype reference, in the scanner or elsewhere
  assert.deepEqual(variant(APPROVED_E1_IMPORT.file, `${scanner}\nimport { generateReading } from '../../../../packages/palm-reading-engine/prototype/src/engine.mjs';`), [APPROVED_E1_IMPORT.file]);
  assert.deepEqual(variant('apps/web/app/page.tsx', `${files.get('apps/web/app/page.tsx')}\n// see AURA_PALM_G6_D0`), ['apps/web/app/page.tsx']);
  assert.deepEqual(variant('apps/web/lib/x.ts', "export const id = 'palm-g6';"), ['apps/web/lib/x.ts']);
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
