// AURA-PALM-G6-D0-R1.5 — random differential campaign: frozen R1.1 vs the candidate (engine byte-identical to R1.3).
// R1.5 (R1.4-RV-01/02): case generation, variant enumeration and per-case evaluation moved VERBATIM to
// prototype/test/campaign-core.mjs (shared with the contract verifier, which regenerates and re-evaluates every case).
// The campaign now writes one EVIDENCE RECORD per compared case (NDJSON, --records=<file>) and a PROVENANCE block
// (sha256 of both engines, the harness and the fixtures). Every count in the report is derived from those records
// (countsFromRecords) or from the generator; nothing in the report is accepted by the contract without re-derivation.
//
// Usage: node differential.mjs <R1.1 prototype> <candidate prototype> <targetDistinctEligible> <seed> --records=<file>
//        [--campaign=<id>] [--quick]
//   --campaign  report label (default random-<seed>); the contract binds each label to its seed and re-checks it.
//   --quick     marks the report as a quick (non-official) run; the official contract rejects quick reports.
// Prints one JSON report; exits 0 only if every internal check passes. Writes only the records file.
//
// GENERATOR / UNIQUENESS / BASELINE / INJECTION: unchanged from R1.4 (see test/campaign-core.mjs): mulberry32 (uint32,
// integer arithmetic); canonical-key de-duplication; R1.1 evaluated on every orientation variant (all 2^k for k ≤ 5,
// otherwise forward, all-reversed, every single reversal and 16 seeded masks); the candidate must equal its forward
// reading on every variant and must not upgrade the conservative MEET of R1.1 (test/oracle.mjs).
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const opt = (k) => (args.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || null;
const [p11, pc, targetArg, seedArg] = args.filter((a) => !a.startsWith('--'));
const recordsPath = opt('records');
if (!p11 || !pc || !recordsPath) { console.error('usage: differential.mjs <R1.1> <candidate> <target> <seed> --records=<file> [--campaign=<id>] [--quick]'); process.exit(2); }
const imp = (dir, f) => import(pathToFileURL(path.join(path.resolve(dir), f)).href);
const E11 = await imp(p11, 'src/engine.mjs'), EC = await imp(pc, 'src/engine.mjs');
const G = await imp(pc, 'src/geometry.mjs');
const O = await imp(pc, 'test/oracle.mjs');
const C = await imp(pc, 'test/coverage.mjs');
const K = await imp(pc, 'test/campaign-core.mjs');
const F = await imp(pc, 'fixtures/synthetic-fixtures.mjs');
const FIX = JSON.parse(fs.readFileSync(path.join(path.resolve(pc), 'fixtures', 'r1-3-constructed-boundary-fixtures.json'), 'utf8'));
const T0 = Date.now();
const TARGET = Number(targetArg || 6000), SEED = Number(seedArg || 1) >>> 0;
const CAMPAIGN = opt('campaign') || `random-${SEED}`;

const selfTest = O.oracleSelfTest();
const out = fs.openSync(recordsPath, 'w');
const counts = { generated: 0, rawDistinct: 0, rawDuplicates: 0, reversalMerged: 0, r11Evaluations: 0, r13Evaluations: 0, variantCoverageFailures: 0 };
const seenCanon = new Set(); const records = [];
const cap = TARGET * 6;
const stream = K.randomCaseStream(SEED, { F, FIX, C });
let eligible = 0;
while (eligible < TARGET && counts.generated < cap) {
  const c = stream.next().value; counts.generated++;
  if (c.rawNew) counts.rawDistinct++; else counts.rawDuplicates++;
  if (c.duplicate) { if (c.rawNew) counts.reversalMerged++; continue; }
  seenCanon.add(c.key);
  const vars = c.vars;
  const exp = K.expectedVariantSet(c.input, true);
  const got = new Set(vars.map((v) => JSON.stringify(v.input)));
  if (exp.exact ? got.size !== exp.keys.size || [...exp.keys].some((x) => !got.has(x)) : [...exp.keys].some((x) => !got.has(x))) counts.variantCoverageFailures++;
  const { record, rc, r11 } = K.evaluateCase({ ...c, vars }, records.length, { E11, EC, G, O, C });
  counts.r13Evaluations += rc.length; counts.r11Evaluations += r11.length; // evaluations actually performed
  records.push(record); fs.writeSync(out, JSON.stringify(record) + '\n');
  if (record.valid) eligible++;
}
fs.closeSync(out);
const derived = K.countsFromRecords(records);
Object.assign(counts, derived.counts);
counts.canonicalDistinct = seenCanon.size;
const upgrades = derived.upgrades;

const completed = counts.eligibleCanonicalDistinct >= TARGET;
const checks = {
  oracleSelfTest: selfTest.length === 0,
  distinctAudit: counts.canonicalDistinct === records.length && counts.comparedCases === records.length
    && counts.generated === counts.rawDistinct + counts.rawDuplicates && counts.canonicalDistinct === counts.rawDistinct - counts.reversalMerged,
  targetReached: completed,
  variantCoverage: counts.variantCoverageFailures === 0 && counts.r11Evaluations === counts.orientationVariants && counts.r13Evaluations === counts.orientationVariants,
  tieClassificationConsistency: counts.noopChangedTies === 0 && counts.outcomeRelevantNotObserved === 0,
  noViolations: Object.values(upgrades).every((n) => n === 0),
  reversalInvariant: counts.reversalMismatches === 0,
};
const here = fileURLToPath(import.meta.url);
const report = { campaign: CAMPAIGN, harness: 'R1.5 differential', generator: K.RANDOM_GENERATOR_ID, seed: SEED, target: TARGET, quick, cap, completed, durationMs: Date.now() - T0,
  counts, upgrades, reversalMismatches: counts.reversalMismatches, tieConsistencyFailures: counts.noopChangedTies, oracleSelfTestFailures: selfTest, checks,
  provenance: K.provenanceOf({ candidate: path.resolve(pc), baseline: path.resolve(p11), scripts: [here] }),
  records: { file: path.basename(recordsPath), schema: K.RECORD_SCHEMA, count: records.length, sha256: K.fileSha256(recordsPath), caseSetDigest: K.caseSetDigest(records) },
  pass: Object.values(checks).every(Boolean) };
console.log(JSON.stringify(report, null, 1));
process.exit(report.pass ? 0 : 1);
