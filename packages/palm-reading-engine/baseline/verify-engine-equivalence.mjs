// AURA-PALM-G6-D0-R1.4 — interpretation-engine and detector-pin equivalence check (read-only).
// Usage (from the R1.4 package root): node baseline/verify-engine-equivalence.mjs <R1.3 package dir>
// Compares sha256 of every interpretation-engine file (prototype/src/*.mjs) against the R1.3 frozen hash list, checks
// the detector registry pins, and lists every R1.4 file that differs from R1.3 with its category.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const r13 = path.resolve(process.argv[2] || '../AURA_PALM_G6_D0_R1_3_CONSERVATIVE_CLAIM_AND_DIFFERENTIAL_INTEGRITY');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const frozen = new Map(fs.readFileSync(path.join(r13, 'baseline', 'R1_3_FROZEN_HASHES.txt'), 'utf8').trim().split('\n').map((l) => { const [h, f] = l.split(/\s+/); return [f, h]; }));
const engineFiles = fs.readdirSync('prototype/src').filter((f) => f.endsWith('.mjs')).map((f) => `prototype/src/${f}`).sort();
const engine = engineFiles.map((f) => ({ file: f, r13: frozen.get(f) || null, r14: sha(f) })).map((e) => ({ ...e, identical: e.r13 === e.r14 }));
const r13EngineFiles = [...frozen.keys()].filter((f) => f.startsWith('prototype/src/')).sort();
const sameEngineFileSet = JSON.stringify(r13EngineFiles) === JSON.stringify(engineFiles);
const S = await import(pathToFileURL(path.resolve('prototype/src/schema.mjs')).href);
const pins = Object.fromEntries(Object.keys(S.DETECTOR_REGISTRY).map((k) => [k, [...S.DETECTOR_REGISTRY[k].versions]]));
const expectedPins = { 'synthetic-fixture': ['0.1.0'], 'creases-directional-d1': ['frozen-d1'], 'creases-directional-d3b': ['D3B-C'] };
const pinsUnchanged = JSON.stringify(pins) === JSON.stringify(expectedPins);
// every R1.4 prototype/harness file vs R1.3: unchanged / modified / added, with category
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const r14Files = [...walk('prototype'), 'baseline/differential.mjs', 'baseline/build-constructed-fixtures.mjs', 'negative-controls/run-negative-controls.mjs'].sort();
const category = (f) => (f.startsWith('prototype/src/') ? 'interpretation-engine' : f.startsWith('prototype/test/') ? 'tests/oracle/coverage (harness)' : f.startsWith('prototype/fixtures/') ? 'fixtures' : f.startsWith('prototype/bin/') ? 'dev scripts' : 'harness');
const changes = r14Files.map((f) => ({ file: f, category: category(f), status: !frozen.has(f) ? 'added' : frozen.get(f) === sha(f) ? 'unchanged' : 'modified' })).filter((c) => c.status !== 'unchanged');
const removed = [...frozen.keys()].filter((f) => !r14Files.includes(f));
const engineChanged = changes.filter((c) => c.category === 'interpretation-engine');
const out = { engine, sameEngineFileSet, engineByteIdentical: engine.every((e) => e.identical) && sameEngineFileSet, pins, pinsUnchanged, changes, removed, engineChanged, pass: engine.every((e) => e.identical) && sameEngineFileSet && pinsUnchanged && engineChanged.length === 0 && removed.length === 0 };
console.log(JSON.stringify(out, null, 1));
process.exit(out.pass ? 0 : 1);
