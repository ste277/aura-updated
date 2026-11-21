// AURA-PALM-G6-D0-R1.5 — protected-source verification and change inventory (read-only).
// Usage (from the R1.5 package root): node baseline/verify-protected-and-changes.mjs <R1.3 pkg> <R1.4 pkg> <R1.1 pkg>
// Checks: (1) the 7 interpretation-engine files equal the R1.3 frozen hashes AND the sealed R1.4 package; (2) detector
// pins unchanged; (3) the R1.1 comparison baseline prototype equals the sealed R1.1 MANIFEST; (4) lists every R1.5
// prototype / baseline / negative-controls file that differs from the sealed R1.4 package (modified / added / removed)
// with its category. Exit 0 only if (1)-(3) hold and no change is in the engine category.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [r13, r14, r11] = process.argv.slice(2).map((p) => path.resolve(p));
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const parse = (f) => new Map(fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => { const [h, p] = l.split(/\s+/); return [p, h]; }));
const walk = (d, base = d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), base) : [path.relative(base, path.join(d, e.name))])) : []);
const r13Frozen = parse(path.join(r13, 'baseline', 'R1_3_FROZEN_HASHES.txt'));
const r14Manifest = parse(path.join(r14, 'MANIFEST.sha256'));
const r11Manifest = parse(path.join(r11, 'MANIFEST.sha256'));
const engineFiles = fs.readdirSync('prototype/src').filter((f) => f.endsWith('.mjs')).sort().map((f) => `prototype/src/${f}`);
const engine = engineFiles.map((f) => ({ file: f, sha256: sha(f), r13: r13Frozen.get(f) === sha(f), r14: r14Manifest.get(f) === sha(f) }));
const sameSet = JSON.stringify(engineFiles) === JSON.stringify([...r13Frozen.keys()].filter((f) => f.startsWith('prototype/src/')).sort());
const S = await import(pathToFileURL(path.resolve('prototype/src/schema.mjs')).href);
const pins = Object.fromEntries(Object.keys(S.DETECTOR_REGISTRY).map((k) => [k, [...S.DETECTOR_REGISTRY[k].versions]]));
const pinsUnchanged = JSON.stringify(pins) === JSON.stringify({ 'synthetic-fixture': ['0.1.0'], 'creases-directional-d1': ['frozen-d1'], 'creases-directional-d3b': ['D3B-C'] });
const r11Files = walk(path.join(r11, 'prototype')).map((f) => `prototype/${f}`).sort();
const r11Baseline = r11Files.map((f) => ({ file: f, ok: r11Manifest.get(f) === sha(path.join(r11, f)) }));
const r11Unchanged = r11Baseline.every((x) => x.ok) && [...r11Manifest.keys()].filter((f) => f.startsWith('prototype/')).every((f) => r11Files.includes(f));
const category = (f) => (f.startsWith('prototype/src/') ? 'interpretation-engine' : f.startsWith('prototype/test/') ? 'tests / oracle / harness modules' : f.startsWith('prototype/fixtures/') ? 'fixtures' : f.startsWith('prototype/') ? 'prototype (other)' : f.startsWith('negative-controls/') ? 'negative-control harness' : 'baseline scripts / contracts');
const mine = [...walk('prototype').map((f) => `prototype/${f}`), ...walk('baseline').map((f) => `baseline/${f}`), ...walk('negative-controls').map((f) => `negative-controls/${f}`)].filter((f) => !f.startsWith('baseline/campaigns/')).sort();
const theirs = [...r14Manifest.keys()].filter((f) => /^(prototype|baseline|negative-controls)\//.test(f) && !f.startsWith('baseline/campaigns/')).sort();
const changes = [...mine.filter((f) => !r14Manifest.has(f)).map((f) => ({ file: f, status: 'added' })), ...mine.filter((f) => r14Manifest.has(f) && r14Manifest.get(f) !== sha(f)).map((f) => ({ file: f, status: 'modified' })), ...theirs.filter((f) => !mine.includes(f)).map((f) => ({ file: f, status: 'removed (kept in the sealed R1.4 package)' }))].map((c) => ({ ...c, category: category(c.file) })).sort((a, b) => a.file.localeCompare(b.file));
const engineChanged = changes.filter((c) => c.category === 'interpretation-engine');
const out = { engine, engineByteIdenticalToR13: engine.every((e) => e.r13) && sameSet, engineByteIdenticalToR14: engine.every((e) => e.r14), pins, pinsUnchanged, r11BaselineFiles: r11Baseline.length, r11Unchanged, changes, engineChanged,
  pass: engine.every((e) => e.r13 && e.r14) && sameSet && pinsUnchanged && r11Unchanged && engineChanged.length === 0 };
console.log(JSON.stringify(out, null, 1));
process.exit(out.pass ? 0 : 1);
