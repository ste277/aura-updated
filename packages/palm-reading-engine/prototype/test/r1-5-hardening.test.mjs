// AURA-PALM-G6-D0-R1.5 — coverage-contract provenance, oracle self-test, NC-44 loop control and tie-coverage tests.
// Harness and tests only; the interpretation engine is unchanged. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../src/engine.mjs';
import { polylineProblem, canonicalSequence, GEOMETRY_CONTRACT } from '../src/schema.mjs';
import * as G from '../src/geometry.mjs';
import * as O from './oracle.mjs';
import * as C from './coverage.mjs';
import * as K from './campaign-core.mjs';
import * as V from './campaign-verify.mjs';
import { independentUpgradeKinds, independentReversalInvariant, independentSelfTest } from './independent-oracle.mjs';
import * as F from '../fixtures/synthetic-fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PROTO = path.join(here, '..');
const load = (f) => JSON.parse(fs.readFileSync(path.join(PROTO, 'fixtures', f), 'utf8'));
const R13 = load('r1-3-constructed-boundary-fixtures.json');
const ASYM = load('r1-5-loop-order-asymmetric-fixtures.json');
const rev = (p) => [...p].reverse();
const byId = (id) => R13.fixtures.find((f) => f.id === id) || assert.fail(`fixture ${id} missing`);

// ---------------- R1.4-RV-03: oracle self-test covers summarize() ----------------
test('R1.5 ORACLE SELF-TEST: summarize() is exercised on literal readings with independently written expectations', () => {
  assert.deepEqual(O.oracleSelfTest(), []);
});

test('R1.5 INDEPENDENT ORACLE: agrees with the oracle on every constructed fixture orientation and flags a forced upgrade', () => {
  let n = 0;
  for (const fx of [...R13.fixtures, ...ASYM.fixtures]) {
    const vars = O.orientations(fx.input); const rs = vars.map(({ input }) => E.generateReading(input));
    const base = O.meet(rs.map(O.summarize));
    for (const r of rs) { assert.deepEqual(independentUpgradeKinds(r, rs), [...new Set(O.violations(O.summarize(r), base).map((v) => v.kind))].sort(), fx.id); n++; }
    assert.equal(independentReversalInvariant(rs), rs.every((r) => O.orderFree(r) === O.orderFree(rs[0])), fx.id);
  }
  assert.ok(n >= 900, `compared ${n}`);
  assert.deepEqual(independentSelfTest(), []);
  // positive control: a reading forced to 'clear' against a tentative baseline is flagged by both
  const fx = byId('A-ptc-length-tie-0.47005-0'); const r = E.generateReading(fx.input);
  const up = JSON.parse(JSON.stringify(r)); for (const s of up.sections) for (const it of s.items) it.tier = 'clear';
  assert.ok(independentUpgradeKinds(up, [r]).includes('confidence-upgrade'));
});

// ---------------- R1.4-SF-01: the loop-specific NC-44 control ----------------
test('R1.5 NC-44 LOOP CONTROL: an order-asymmetric loop (valid in exactly one single order) is invalid in every orientation', () => {
  // independent proof of the asymmetry: exact path-length arithmetic in each single order against the contract limit
  const lim = GEOMETRY_CONTRACT.maxTortuosity + GEOMETRY_CONTRACT.eps;
  const tort = (p) => { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y); return L / Math.hypot(p.at(-1).x - p[0].x, p.at(-1).y - p[0].y); };
  const seen = { canonicalValid: 0, reversedValid: 0 };
  assert.ok(ASYM.fixtures.length >= 4);
  for (const f of ASYM.fixtures) {
    const p = f.slot === 'PTC' ? f.input.creases.items[1].geometry.points : f.input.creases.items.at(-1).geometry.points;
    const c = canonicalSequence(p);
    const overC = tort(c) > lim, overR = tort(rev(c)) > lim;
    assert.notEqual(overC, overR, `${f.id}: must exceed the tortuosity limit in exactly one single order`);
    if (!overC) seen.canonicalValid++; else seen.reversedValid++;
    assert.equal(f.proof.canonicalOrderProblem, overC ? 'tortuous' : null, f.id); assert.equal(f.proof.reversedOrderProblem, overR ? 'tortuous' : null, f.id);
    // both-order validation: tortuous whichever order is supplied, and the whole reading is invalid in every orientation
    assert.equal(polylineProblem(p), 'tortuous', f.id); assert.equal(polylineProblem(rev(p)), 'tortuous', f.id);
    const outs = O.orientations(f.input).map(({ input }) => E.generateReading(input));
    for (const r of outs) { assert.equal(r.status, 'invalid-input', f.id); assert.equal(O.orderFree(r), O.orderFree(outs[0]), f.id); }
  }
  // both directions are covered: removing EITHER single-order check makes some fixture valid
  assert.ok(seen.canonicalValid >= 1 && seen.reversedValid >= 1, JSON.stringify(seen));
});

// ---------------- R1.4-RV-04: tie categories at campaign level ----------------
test('R1.5 TIES: tier-lowered, candidate-rank and outcome-unchanged categories on known fixtures; partition identities hold', () => {
  const sums = (fx) => fx.r11.map((o) => ({ valid: o.summary.valid, items: new Map(o.summary.items), declined: new Map(o.summary.declined) }));
  const cls = (id) => C.classifyTies(byId(id).input, E.generateReading(byId(id).input), G.describe, sums(byId(id)));
  for (const id of R13.fixtures.filter((f) => /^A-ptc-length-tie-0\.(47005|72995)/.test(f.id)).map((f) => f.id)) { const t = cls(id); assert.ok(t.tierLowered && t.outcomeRelevant && !t.harmless, id); }
  { const t = cls('D01-reviewer-tied-crease-alone'); assert.ok(t.candidateRank && t.outcomeRelevant, JSON.stringify(t)); }
  { const t = cls('D09-multiple-competitors'); assert.ok(t.candidateRank && t.outcomeUnchanged && !t.outcomeRelevant, JSON.stringify(t)); }
  { const t = cls('B-fate-length-tie-0.37995-0'); assert.ok(t.outcomeUnchanged && t.harmless, JSON.stringify(t)); }
  { const t = cls('A-ptc-length-plain-0.47'); assert.ok(!t.observed && !t.candidateRank && !t.outcomeUnchanged && !t.tierLowered); }
  let tl = 0;
  for (const fx of R13.fixtures) {
    const t = C.classifyTies(fx.input, E.generateReading(fx.input), G.describe, sums(fx));
    assert.ok(!t.outcomeRelevant || t.observed, `${fx.id}: outcome-relevant ⇒ observed`);
    assert.equal(t.harmless, t.observed && !t.outcomeRelevant, fx.id);
    assert.ok((!t.abstention && !t.tierLowered) || t.outcomeRelevant, fx.id);
    assert.equal(t.outcomeUnchanged, t.reconciledInTrace && !t.outcomeRelevant, fx.id);
    if (t.tierLowered) tl++;
  }
  assert.ok(tl >= 4, `tier-lowered fixtures: ${tl}`);
});

// ---------------- R1.4-RV-01/02: contract evidence, in memory ----------------
// The frozen R1.1 baseline engine is read from the hash-pinned vendored copy (vendor/…R1_1…, verified against the
// sealed R1.1 manifest); it is never modified. (G6-I1: re-pointed from the sibling sealed package.)
const GEN = K.RANDOM_GENERATOR_ID, FGEN = K.FIXTURE_GENERATOR_ID;
const CONTRACT = { id: 'unit', official: true, requireReverify: 'all', campaigns: [
  { id: 'random-11', kind: 'random', seed: 11, target: 40, generator: GEN, minCanonicalDistinct: 40, minEligible: 40, minOrientationComparisons: 300, minOutcome: { r11DisagreementCases: 0 } },
  { id: 'random-12', kind: 'random', seed: 12, target: 40, generator: GEN, minCanonicalDistinct: 40, minEligible: 40, minOrientationComparisons: 300 },
  { id: 'fixtures-boundary', kind: 'fixture', generator: FGEN, minCanonicalDistinct: 54, minEligible: 54, minOrientationComparisons: 490, minOutcome: { outcomeRelevantTies: 1, tierLoweredTies: 1 } }] };
const PROV = { candidateEngine: { 'src/x': '1' }, baselineEngine: { 'src/y': '2' }, harness: { 'baseline/z': '3' }, fixtures: { 'fixtures/w': '4' } };
const FIX = R13;
const ctxOf = (req) => ({ F, FIX, C, protoDir: PROTO, fixtureCount: req.kind === 'fixture' ? K.fixtureSet(req.id, PROTO).length : null });
const R11 = await import(new URL('../../vendor/AURA_PALM_G6_D0_R1_1_INPUT_AND_GEOMETRY_HARDENING/prototype/src/engine.mjs', import.meta.url).href);
const honest = { E11: R11, EC: E, G };
function build(req, engines = honest, seedOverride) {
  const records = []; const counts = { generated: 0, rawDistinct: 0, rawDuplicates: 0, reversalMerged: 0, variantCoverageFailures: 0 };
  const stream = req.kind === 'random' ? K.randomCaseStream(seedOverride ?? req.seed, { F, FIX, C }) : K.fixtureCaseStream(req.id, PROTO, { C });
  let eligible = 0;
  while (req.kind !== 'random' || eligible < req.target) {
    const s = stream.next(); if (s.done) break; const c = s.value; counts.generated++;
    if (c.rawNew) counts.rawDistinct++; else counts.rawDuplicates++;
    if (c.duplicate) { if (c.rawNew) counts.reversalMerged++; continue; }
    const { record } = K.evaluateCase(c, records.length, { E11: engines.E11, EC: engines.EC, G, O, C }); records.push(record); if (record.valid) eligible++;
  }
  const d = K.countsFromRecords(records); Object.assign(counts, d.counts, { r11Evaluations: d.counts.orientationVariants, r13Evaluations: d.counts.orientationVariants });
  const ok = Object.values(d.upgrades).every((n) => n === 0) && d.counts.reversalMismatches === 0;
  if (req.kind === 'fixture') counts.recordedR11Mismatches = 0;
  const report = { campaign: req.id, generator: req.generator, seed: req.kind === 'random' ? (seedOverride ?? req.seed) : null, target: req.kind === 'random' ? req.target : null, quick: false, completed: true,
    counts, upgrades: d.upgrades, reversalMismatches: d.counts.reversalMismatches, tieConsistencyFailures: 0, oracleSelfTestFailures: [], checks: { noViolations: ok, reversalInvariant: d.counts.reversalMismatches === 0 },
    provenance: JSON.parse(JSON.stringify(PROV)), records: { count: records.length, schema: K.RECORD_SCHEMA }, pass: ok };
  const e = { report, records, attestation: { campaign: req.id, argv: req.kind === 'random' ? ['p11', 'pc', String(req.target), String(seedOverride ?? req.seed)] : ['p11', 'pc', req.id], exitCode: ok ? 0 : 1, signal: null },
    provenanceActual: JSON.parse(JSON.stringify(PROV)), expectedIdentity: JSON.parse(JSON.stringify(PROV)) };
  return seal(e, req);
}
/** Recompute every hash and digest consistently (what a forger who rewrites files would do), then re-verify. */
function seal(e, req, { reverifyWith = honest } = {}) {
  if (e.records) { const nd = e.records.map((r) => JSON.stringify(r)).join('\n') + '\n'; e.actual = { ...(e.actual || {}), recordsSha256: K.sha256(nd) }; e.report.records.sha256 = e.actual.recordsSha256; e.report.records.caseSetDigest = K.caseSetDigest(e.records); }
  else e.actual = { ...(e.actual || {}), recordsSha256: null };
  e.actual.stderrSha256 = K.sha256('');
  e.actual.reportSha256 = K.sha256(JSON.stringify(e.report));
  if (e.attestation) Object.assign(e.attestation, { reportSha256: e.actual.reportSha256, recordsSha256: e.actual.recordsSha256, stderrSha256: e.actual.stderrSha256 });
  e.verification = e.records ? V.verifyCampaign(req, e.records, ctxOf(req), reverifyWith, 'all') : null;
  return e;
}
const reqOf = (id) => CONTRACT.campaigns.find((c) => c.id === id);
let GOOD = null;
const good = () => { GOOD ||= Object.fromEntries(CONTRACT.campaigns.map((r) => [r.id, build(r)])); return structuredClone(GOOD); };
const resync = (e) => { const d = K.countsFromRecords(e.records); Object.assign(e.report.counts, d.counts); e.report.upgrades = d.upgrades; e.report.records.count = e.records.length; };
const SELF = { oracle: O.oracleSelfTest(), independent: independentSelfTest() };
const checksOf = (ev) => V.checkCampaignEvidence(CONTRACT, { selfTests: SELF, ...ev });

test('R1.5 CONTRACT: a genuine campaign set passes only after regeneration and full re-evaluation', () => {
  const res = checksOf({ reports: good() });
  assert.deepEqual(res, { pass: true, failures: [] });
  const g = good(); for (const e of Object.values(g)) { assert.equal(e.verification.reverify.checked, e.records.length); assert.equal(e.verification.regen.mismatch, null); }
});

test('R1.5 CONTRACT: forged, failing, relabelled, truncated and incomplete campaign evidence is rejected for the intended reason', () => {
  const cases = {
    'inflated comparison count': ['counts-match-records', (s) => { s['random-11'].report.counts.orientationComparisons += 1000; seal(s['random-11'], reqOf('random-11')); }],
    'reduced comparison count (records and totals forged consistently)': ['seed-regeneration', (s) => { const e = s['random-11']; const r = e.records.find((x) => x.variants > 2); r.variants--; r.masks.pop(); resync(e); seal(e, reqOf('random-11')); }],
    'duplicated comparison records': ['records-unique', (s) => { const e = s['random-12']; e.records.push({ ...e.records[3], j: e.records.length }); resync(e); seal(e, reqOf('random-12')); }],
    'missing campaign records': ['records-present', (s) => { s['random-12'].records = null; s['random-12'].recordsError = 'no records file'; seal(s['random-12'], reqOf('random-12')); }],
    'truncated campaign output': ['report-parse', (s) => { s['random-11'].report = null; s['random-11'].reportError = 'unreadable report (Unexpected end of JSON input)'; }],
    'incorrect total': ['counts-match-records', (s) => { s['fixtures-boundary'].report.counts.canonicalDistinct -= 1; seal(s['fixtures-boundary'], reqOf('fixtures-boundary')); }],
    'failed campaign marked successful': ['report-pass', (s) => { s['random-11'].report.pass = false; seal(s['random-11'], reqOf('random-11')); }],
    'failed check hidden': ['report-checks', (s) => { s['random-11'].report.checks.noViolations = false; seal(s['random-11'], reqOf('random-11')); }],
    'one seed relabelled as another campaign': ['seed-regeneration', (s) => { const e = build(reqOf('random-12'), honest, 11); e.report.seed = 12; e.attestation.argv[3] = '12'; s['random-12'] = seal(e, reqOf('random-12')); }],
    'one seed relabelled (case sets identical)': ['distinct-case-sets', (s) => { const e = build(reqOf('random-12'), honest, 11); e.report.seed = 12; e.attestation.argv[3] = '12'; s['random-12'] = seal(e, reqOf('random-12')); }],
    'missing exit-status evidence': ['attestation-present', (s) => { s['random-11'].attestation = null; }],
    'non-zero exit status': ['exit-status', (s) => { s['random-11'].attestation.exitCode = 1; }],
    'wrong harness identity (recorded)': ['harness-identity', (s) => { s['random-11'].report.provenance.harness['baseline/z'] = 'f00d'; seal(s['random-11'], reqOf('random-11')); }],
    'wrong harness identity (files under verification)': ['harness-identity', (s) => { s['random-11'].provenanceActual.harness['baseline/z'] = 'f00d'; }],
    'incomplete campaign (records cut, totals forged)': ['stop-rule', (s) => { const e = s['random-12']; e.records = e.records.slice(0, -5); resync(e); seal(e, reqOf('random-12')); }],
    'unexpected campaign': ['unexpected-campaign', (s) => { s['random-99'] = s['random-11']; }],
    'missing tier-lowered coverage (count removed)': ['counts-match-records', (s) => { delete s['fixtures-boundary'].report.counts.tierLoweredTies; seal(s['fixtures-boundary'], reqOf('fixtures-boundary')); }],
    'missing tier-lowered coverage (record field removed)': ['records-schema', (s) => { const e = s['fixtures-boundary']; for (const r of e.records) delete r.ties.tierLowered; seal(e, reqOf('fixtures-boundary')); }],
    'incorrect tier-lowered count': ['counts-match-records', (s) => { s['fixtures-boundary'].report.counts.tierLoweredTies += 2; seal(s['fixtures-boundary'], reqOf('fixtures-boundary')); }],
    'outcome-relevant tie misclassified as harmless': ['record-reverify', (s) => { const e = s['fixtures-boundary']; const r = e.records.find((x) => x.ties.outcomeRelevant); Object.assign(r.ties, { outcomeRelevant: false, abstention: false, tierLowered: false, harmless: true, outcomeUnchanged: r.ties.reconciledInTrace }); resync(e); seal(e, reqOf('fixtures-boundary')); }],
    'missing point-order comparison for a relevant tie': ['tie-point-order', (s) => { const e = s['fixtures-boundary']; const r = e.records.find((x) => x.ties.outcomeRelevant); r.variants = 1; r.masks = [0]; resync(e); seal(e, reqOf('fixtures-boundary')); }],
  };
  for (const [name, [check, mut]] of Object.entries(cases)) {
    const s = good(); mut(s);
    const res = checksOf({ reports: s });
    assert.equal(res.pass, false, name);
    assert.ok(res.failures.some((f) => f.check === check), `${name}: expected ${check}, got ${JSON.stringify([...new Set(res.failures.map((f) => f.check))])}`);
  }
});

test('R1.5 CONTRACT: a genuinely failing campaign cannot be passed off by rewriting its report and records', () => {
  // a candidate that raises every tentative claim to clear: a real upgrade-producing campaign
  const upgraded = { generateReading: (inp) => { const r = JSON.parse(JSON.stringify(E.generateReading(inp))); if (r.status !== 'invalid-input') for (const s of r.sections) for (const it of s.items) it.tier = 'clear'; return r; } };
  const req = reqOf('fixtures-boundary');
  const bad = build(req, { E11: R11, EC: upgraded, G });
  assert.ok(bad.report.upgrades['confidence-upgrade'] > 0, 'the stand-in really upgrades');
  // forge: success verdict, clean checks, zero upgrades, records without upgrade kinds, exit 0, hashes rewritten
  bad.report.pass = true; bad.report.checks = { noViolations: true, reversalInvariant: true }; for (const r of bad.records) r.upgrades = [];
  resync(bad); bad.attestation.exitCode = 0; seal(bad, req);
  const s = good(); s['fixtures-boundary'] = bad;
  const res = checksOf({ reports: s });
  assert.equal(res.pass, false);
  assert.ok(res.failures.some((f) => f.check === 'record-reverify'), JSON.stringify(res.failures.map((f) => f.check)));
});

// ---------------- campaign core ----------------
test('R1.5 CAMPAIGN CORE: generation is deterministic, regenerable and seed-specific; expected variant sets are independent of the mask choice', () => {
  const keys = (seed, n) => { const s = K.randomCaseStream(seed, { F, FIX, C }); const out = []; for (let i = 0; i < n; i++) { const c = s.next().value; out.push(c.duplicate ? 'dup' : c.key); } return out; };
  assert.deepEqual(keys(1119, 60), keys(1119, 60));
  assert.notDeepEqual(keys(1119, 60), keys(2026, 60));
  // > 5 creases: sampled variants must include forward, all-reversed and every single reversal
  const s = K.randomCaseStream(77, { F, FIX, C }); let big = 0;
  for (let i = 0; i < 4000 && big < 5; i++) {
    const c = s.next().value; if (c.duplicate) continue;
    const k = c.input.creases.items.filter((x) => Array.isArray(x?.geometry?.points) && x.geometry.points.length >= 2).length;
    const exp = K.expectedVariantSet(c.input, true); const got = new Set(c.vars.map((v) => JSON.stringify(v.input)));
    for (const x of exp.keys) assert.ok(got.has(x), `${c.id}: required variant missing`);
    if (k > 5) { big++; assert.equal(exp.exact, false); } else assert.equal(got.size, exp.keys.size, c.id);
  }
  assert.ok(big >= 1, 'saw a > 5 crease case');
  // fixture campaigns enumerate all 2^k distinct variants, uncapped (R1.4-RV-07)
  for (const c of K.fixtureCaseStream('fixtures-competing', PROTO, { C })) if (!c.duplicate) assert.equal(c.vars.length, K.expectedVariantSet(c.input, false).keys.size, c.id);
});

test('R1.5 CONTRACT: tie consistency, recorded R1.1 readings and both oracle self-tests are re-derived by the checker, not taken from the report', () => {
  // (review F1) a candidate whose reconciliations change outcomes on which every R1.1 orientation agrees:
  // it drops every F-PTC-SLOPE claim and records a fake one-order-only abstention for it (genuine noop-changed ties)
  const noop = { generateReading: (inp) => { const r = JSON.parse(JSON.stringify(E.generateReading(inp))); if (r.status !== 'invalid-input') for (const sec of r.sections) { if (sec.items.some((it) => it.familyId === 'F-PTC-SLOPE')) { sec.items = sec.items.filter((it) => it.familyId !== 'F-PTC-SLOPE'); sec.quietOrderTies = [...(sec.quietOrderTies || []), { familyId: 'F-PTC-SLOPE', orderTie: { resolution: 'claim-in-one-order-only-abstained' } }]; } } return r; } };
  const req = reqOf('random-11'); const eng = { E11: R11, EC: noop, G };
  const e = build(req, eng); assert.ok(e.report.counts.noopChangedTies > 0, 'the stand-in really produces noop-changed ties');
  e.report.tieConsistencyFailures = 0; e.report.pass = true; seal(e, req, { reverifyWith: eng }); // forge only the self-report; records stay genuine
  assert.equal(e.verification.reverify.mismatches.length, 0, 'records agree with re-evaluation (only the verdict is forged)');
  let res = checksOf({ reports: { ...good(), 'random-11': e } });
  assert.ok(res.failures.some((f) => f.check === 'tie-consistency'), JSON.stringify(res.failures.map((f) => f.check)));
  // the same campaign with a CONSISTENT self-report (tieConsistencyFailures = the true non-zero count): only the
  // record-derived rule "noop-changed ties must be 0" can reject it (NC-82)
  e.report.tieConsistencyFailures = e.report.counts.noopChangedTies; seal(e, req, { reverifyWith: eng });
  res = checksOf({ reports: { ...good(), 'random-11': e } });
  assert.ok(res.failures.some((f) => f.check === 'tie-consistency' && /reconciliations changed an outcome/.test(f.detail)), JSON.stringify(res.failures));
  // a fixture file whose recorded R1.1 readings differ from live R1.1 (stand-in baseline drops the first claim)
  const r11x = { generateReading: (inp) => { const r = JSON.parse(JSON.stringify(R11.generateReading(inp))); if (r.status !== 'invalid-input') { const sec = r.sections.find((x) => x.items.length); if (sec) sec.items.shift(); } return r; } };
  const fq = reqOf('fixtures-boundary'); const fe = build(fq, { E11: r11x, EC: E, G }); seal(fe, fq, { reverifyWith: { E11: r11x, EC: E, G } });
  res = checksOf({ reports: { ...good(), 'fixtures-boundary': fe } });
  assert.ok(res.failures.some((f) => f.check === 'recorded-r11'), JSON.stringify([...new Set(res.failures.map((f) => f.check))]));
  // the checker re-runs both self-tests; a missing re-run or any self-test failure fails, whatever the reports say
  res = V.checkCampaignEvidence(CONTRACT, { reports: good() }); assert.ok(res.failures.some((f) => f.check === 'self-test-rerun'));
  res = V.checkCampaignEvidence(CONTRACT, { reports: good(), selfTests: { oracle: [{ name: 'x' }], independent: [] } }); assert.ok(res.failures.some((f) => f.check === 'oracle-self-test-rerun'));
  res = V.checkCampaignEvidence(CONTRACT, { reports: good(), selfTests: { oracle: [], independent: [{ name: 'y' }] } }); assert.ok(res.failures.some((f) => f.check === 'independent-oracle-self-test'));
  // a forged report-level tie-consistency count is rejected even when the records are clean
  const g = good(); g['random-12'].report.tieConsistencyFailures = 3; seal(g['random-12'], reqOf('random-12'));
  res = checksOf({ reports: g }); assert.ok(res.failures.some((f) => f.check === 'tie-consistency'));
});
