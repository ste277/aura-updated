// AURA-PALM-G6-D0-R1.5 — constructed-fixture campaigns (same report and evidence-record schema as the differential).
// Usage: node fixture-campaigns.mjs <R1.1 prototype> <candidate prototype> <campaign-id> --records=<file>
//   fixtures-boundary  (R1.3 constructed: length ties, plain boundaries, fate-length ties, centre ties)
//   fixtures-competing (R1.3 constructed: competing-crease cases D01–D10b)
//   fixtures-loop      (R1.4 loop/tortuous fixtures + R1.5 order-asymmetric loop fixtures + R1.3 validity fixtures)
//   fixtures-adapter   (G6-I1: frozen D1 synthetic detector output through adapter/feature-adapter.mjs, run live)
// R1.5: cases come from test/campaign-core.mjs fixtureCaseStream (all 2^k variants, de-duplicated, uncapped —
// R1.4-RV-07); evaluation and evidence records as in the differential; the R1.1 readings recorded in fixture files
// must equal live R1.1. Exit 0 only if all internal checks pass. Writes only the records file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (k) => (args.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || null;
const [p11, pc, campaign] = args.filter((a) => !a.startsWith('--'));
const recordsPath = opt('records');
if (!p11 || !pc || !campaign || !recordsPath) { console.error('usage: fixture-campaigns.mjs <R1.1> <candidate> <campaign-id> --records=<file>'); process.exit(2); }
const imp = (dir, f) => import(pathToFileURL(path.join(path.resolve(dir), f)).href);
const E11 = await imp(p11, 'src/engine.mjs'), EC = await imp(pc, 'src/engine.mjs');
const G = await imp(pc, 'src/geometry.mjs');
const O = await imp(pc, 'test/oracle.mjs'); const C = await imp(pc, 'test/coverage.mjs'); const K = await imp(pc, 'test/campaign-core.mjs');
const T0 = Date.now();
if (!K.FIXTURE_CAMPAIGNS.includes(campaign)) { console.error(`unknown campaign ${campaign}`); process.exit(2); }

const selfTest = O.oracleSelfTest();
const out = fs.openSync(recordsPath, 'w');
const counts = { generated: 0, rawDistinct: 0, rawDuplicates: 0, reversalMerged: 0, r11Evaluations: 0, r13Evaluations: 0, variantCoverageFailures: 0, recordedR11Mismatches: 0 };
const seenCanon = new Set(); const records = [];
const ser = (s) => JSON.stringify({ valid: s.valid, items: [...s.items].sort(), declined: [...s.declined].sort() });
for (const c of K.fixtureCaseStream(campaign, pc, { C })) {
  counts.generated++;
  if (c.rawNew) counts.rawDistinct++; else counts.rawDuplicates++;
  if (c.duplicate) { if (c.rawNew) counts.reversalMerged++; continue; }
  seenCanon.add(c.key);
  const exp = K.expectedVariantSet(c.input, false);
  const got = new Set(c.vars.map((v) => JSON.stringify(v.input)));
  if (got.size !== exp.keys.size || [...exp.keys].some((x) => !got.has(x))) counts.variantCoverageFailures++;
  const { record, sums, rc, r11 } = K.evaluateCase(c, records.length, { E11, EC, G, O, C });
  counts.r13Evaluations += rc.length; counts.r11Evaluations += r11.length; // evaluations actually performed
  if (c.fixture.r11) for (const o of c.fixture.r11) { const i = c.vars.findIndex((v) => v.mask === o.mask); const rec = { valid: o.summary.valid, items: new Map(o.summary.items), declined: new Map(o.summary.declined) }; if (i < 0 || ser(sums[i]) !== ser(rec)) counts.recordedR11Mismatches++; }
  records.push(record); fs.writeSync(out, JSON.stringify(record) + '\n');
}
fs.closeSync(out);
const derived = K.countsFromRecords(records);
Object.assign(counts, derived.counts);
counts.canonicalDistinct = seenCanon.size;
const upgrades = derived.upgrades;
const checks = { oracleSelfTest: selfTest.length === 0,
  distinctAudit: counts.canonicalDistinct === records.length && counts.generated === counts.rawDistinct + counts.rawDuplicates && counts.canonicalDistinct === counts.rawDistinct - counts.reversalMerged,
  variantCoverage: counts.variantCoverageFailures === 0 && counts.r11Evaluations === counts.orientationVariants && counts.r13Evaluations === counts.orientationVariants,
  recordedR11MatchesLive: counts.recordedR11Mismatches === 0, tieClassificationConsistency: counts.noopChangedTies === 0 && counts.outcomeRelevantNotObserved === 0,
  noViolations: Object.values(upgrades).every((n) => n === 0), reversalInvariant: counts.reversalMismatches === 0 };
const here = fileURLToPath(import.meta.url);
const report = { campaign, harness: 'R1.5 fixture campaigns', generator: K.FIXTURE_GENERATOR_ID, seed: null, target: null, quick: false,
  completed: counts.comparedCases === counts.canonicalDistinct && counts.canonicalDistinct > 0, durationMs: Date.now() - T0,
  counts, upgrades, reversalMismatches: counts.reversalMismatches, tieConsistencyFailures: counts.noopChangedTies, oracleSelfTestFailures: selfTest, checks,
  provenance: K.provenanceOf({ candidate: path.resolve(pc), baseline: path.resolve(p11), scripts: [here] }),
  records: { file: path.basename(recordsPath), schema: K.RECORD_SCHEMA, count: records.length, sha256: K.fileSha256(recordsPath), caseSetDigest: K.caseSetDigest(records) },
  pass: Object.values(checks).every(Boolean) };
console.log(JSON.stringify(report, null, 1));
process.exit(report.pass ? 0 : 1);
