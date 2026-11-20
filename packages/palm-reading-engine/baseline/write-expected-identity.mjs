// AURA-PALM-G6-D0-R1.5 — writes baseline/R1_5_EXPECTED_IDENTITY.json at freeze time.
// Usage (from the R1.5 package root): node baseline/write-expected-identity.mjs <R1.3 package dir> <R1.1 package dir>
// The candidate-engine hashes are taken from the CURRENT prototype/src and REFUSED unless they equal the sealed R1.3
// frozen hash list; the baseline-engine hashes are REFUSED unless they equal the sealed R1.1 MANIFEST. Harness and
// fixture hashes are the frozen R1.5 files. The coverage contract names this file; the checker compares every
// campaign's recorded provenance AND the files under verification against it.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [r13, r11] = process.argv.slice(2).map((p) => path.resolve(p));
const K = await import(pathToFileURL(path.resolve('prototype/test/campaign-core.mjs')).href);
const parse = (f) => new Map(fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => { const [h, p] = l.split(/\s+/); return [p, h]; }));
const r13Frozen = parse(path.join(r13, 'baseline', 'R1_3_FROZEN_HASHES.txt'));
const r11Manifest = parse(path.join(r11, 'MANIFEST.sha256'));
const prov = (script) => K.provenanceOf({ candidate: path.resolve('prototype'), baseline: path.join(r11, 'prototype'), scripts: [path.resolve('baseline', script)] });
const pr = prov('differential.mjs'), pf = prov('fixture-campaigns.mjs');
const problems = [];
for (const [f, h] of Object.entries(pr.candidateEngine)) if (r13Frozen.get(`prototype/${f}`) !== h) problems.push(`candidate ${f} differs from R1.3 frozen hash`);
if (Object.keys(pr.candidateEngine).length !== [...r13Frozen.keys()].filter((f) => f.startsWith('prototype/src/')).length) problems.push('candidate engine file set differs from R1.3');
for (const [f, h] of Object.entries(pr.baselineEngine)) if (r11Manifest.get(`prototype/${f}`) !== h) problems.push(`baseline ${f} differs from the R1.1 manifest`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
const identity = { schema: 'r1.5-expected-identity/1', candidateEngine: pr.candidateEngine, baselineEngine: pr.baselineEngine, fixtures: pr.fixtures,
  harness: { random: pr.harness, fixture: pf.harness } };
fs.writeFileSync(path.resolve('baseline/R1_5_EXPECTED_IDENTITY.json'), JSON.stringify(identity, null, 1) + '\n');
console.log(JSON.stringify(identity, null, 1));
