// AURA-PALM-G6-D0-R1.3 — conservative claim eligibility, conflict preservation, validity in both orders.
// Uses CONSTRUCTED fixtures (fixtures/r1-3-constructed-boundary-fixtures.json, built by
// baseline/build-constructed-fixtures.mjs) that carry the frozen R1.1 reading for every point orientation, so the
// no-upgrade oracle (test/oracle.mjs) is applied against R1.1 without R1.1 being present. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateReading, selectVariants } from '../src/engine.mjs';
import { polylineProblem, DETECTOR_REGISTRY } from '../src/schema.mjs';
import { describe as describeGeom } from '../src/geometry.mjs';
import { THRESHOLDS, TENTATIVE_CAP } from '../src/policy.mjs';
import { FAMILIES } from '../src/rules.mjs';
import { summarize, meet, violations, orientations, orderFree, oracleSelfTest } from './oracle.mjs';
import { checkFixtureDisagreementConsistency, r11OrientationsDisagree } from './coverage.mjs'; // R1.4

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', 'r1-3-constructed-boundary-fixtures.json'), 'utf8'));
const deserial = (s) => ({ valid: s.valid, items: new Map(s.items), declined: new Map(s.declined) });
const items = (r) => r.sections.flatMap((s) => s.items);
const fam = (r, id) => items(r).find((i) => i.familyId === id);
const quiet = (r) => r.sections.flatMap((s) => s.quiet);
const central = (r) => r.observations.find((o) => o.crease === 'CENTRAL_LONGITUDINAL');
const byCat = (c) => FIX.fixtures.filter((f) => f.category === c);
const rev = (p) => [...p].reverse();

/** The family whose tie a length-tie fixture targets, and its orderTie result in a reading. */
const tieFamily = (fx) => (fx.category === 'fate-length-tie' ? 'F-CENTRAL-LONGITUDINAL' : 'F-PTC-LENGTH');
function orderTieOf(r, familyId) {
  const it = fam(r, familyId); if (it) return { kind: 'item', tie: it.evidence.orderTie, it };
  for (const s of r.sections) {
    const q = s.declined.find((d) => d.familyId === familyId); if (q) return { kind: 'declined', reason: q.reason };
  }
  return { kind: 'quiet', tie: undefined };
}

test('R1.3 ORACLE: the no-upgrade oracle classifies all of its self-test cases correctly', () => {
  assert.deepEqual(oracleSelfTest(), []);
});

test('R1.3 FIXTURES: every constructed fixture provably reaches its intended condition (no random discovery)', () => {
  const min = { 'length-tie': 24, 'length-plain': 12, 'fate-length-tie': 6, 'centre-tie': 4, competing: 11, validity: 10 };
  for (const [c, n] of Object.entries(min)) assert.ok(byCat(c).length >= n, `${c}: ${byCat(c).length} < ${n}`);
  for (const fx of FIX.fixtures) {
    if (fx.category === 'length-tie') { const p = fx.input.creases.items[1].geometry.points; assert.deepEqual(describeGeom(p).orderTies.lengthNorm, fx.proof.lengthNorm, fx.id); }
    if (fx.category === 'fate-length-tie') { const p = fx.input.creases.items.at(-1).geometry.points; assert.deepEqual(describeGeom(p).orderTies.lengthNorm, fx.proof.lengthNorm, fx.id); }
    if (fx.category === 'centre-tie') { const p = fx.input.creases.items.at(-1).geometry.points; assert.deepEqual(describeGeom(p).orderTies.centroidX, fx.proof.centroidX, fx.id); }
    if (fx.proof.r11Problems) assert.notEqual(fx.proof.r11Problems[0], fx.proof.r11Problems[1], `${fx.id}: R1.1 validity must be order-dependent`);
    if (fx.category === 'length-plain') assert.equal(fx.proof.orderTies, null, fx.id);
  }
  // R1.4 (R1.3-RV-04): the vacuous `assert.ok(fx.r11.length >= 2)` (always true: every fixture has ≥ 1 crease, so ≥ 2
  // orientations) is REPLACED by an observable property: R1.3 changes an outcome only where R1.1's orientations really
  // disagree, and every fixture claiming order-dependent R1.1 validity really has disagreeing orientations.
  const consistency = checkFixtureDisagreementConsistency(FIX.fixtures, generateReading, describeGeom);
  assert.deepEqual(consistency, [], `R1.1 disagreement consistency: ${JSON.stringify(consistency)}`);
  const disagreeing = FIX.fixtures.filter((fx) => r11OrientationsDisagree(fx.r11.map((o) => o.summary))).length;
  assert.equal(disagreeing, 26, `fixtures whose R1.1 orientations disagree (independently counted by the R1.3 reviewer: 26 of 75), got ${disagreeing}`);
  // In-test negative control: corrupt one outcome-changing fixture so its recorded R1.1 orientations all agree → the
  // check must report it (proves the assertion can fail on the defect it targets).
  const victim = FIX.fixtures.find((fx) => fx.proof.r11Problems);
  const corrupted = FIX.fixtures.map((fx) => (fx === victim ? { ...fx, r11: fx.r11.map((o) => ({ ...o, summary: fx.r11[0].summary })) } : fx));
  assert.ok(checkFixtureDisagreementConsistency(corrupted, generateReading, describeGeom).some((v) => v.id === victim.id), 'the consistency check must detect a fixture whose R1.1 orientations wrongly agree');
});

test('R1.3 NO-UPGRADE: for every constructed fixture and every orientation, R1.3 is never more permissive than the meet of R1.1 over all orientations', () => {
  let checked = 0;
  for (const fx of FIX.fixtures) {
    const base = meet(fx.r11.map((o) => deserial(o.summary)));
    for (const { input } of orientations(fx.input)) {
      const v = violations(summarize(generateReading(input)), base);
      assert.deepEqual(v, [], `${fx.id}: ${JSON.stringify(v)}`); checked++;
    }
  }
  assert.ok(checked >= 150, `checked ${checked}`);
});

test('R1.3 REVERSAL: every orientation of every constructed fixture gives the identical reading (except the input fingerprint)', () => {
  for (const fx of FIX.fixtures) {
    const outs = orientations(fx.input).map(({ input }) => orderFree(generateReading(input)));
    for (const o of outs) assert.equal(o, outs[0], fx.id);
  }
});

test('R1.3 RV-02: claim/no-claim length ties abstain; claim/claim ties keep only the common reading at tentative; RV-07 same-reading ties are unchanged', () => {
  const seen = new Set();
  for (const fx of [...byCat('length-tie'), ...byCat('fate-length-tie')]) {
    const f = tieFamily(fx); const r = generateReading(fx.input); const o = orderTieOf(r, f);
    const base = meet(fx.r11.map((x) => deserial(x.summary)));
    if (o.kind === 'declined') { seen.add(`declined:${o.reason}`); continue; } // declined for an unrelated gate (e.g. no central candidate)
    const tie = o.kind === 'item' ? o.tie : quietTie(r, f);
    if (o.kind !== 'item' && tie) { const x = findQuietTie(r, f); assert.equal(tie.resolution, x.resolution, `${fx.id}: traced quiet tie`); assert.deepEqual(tie.selections, x.selections, fx.id); }
    if (!tie) continue;
    const [a, b] = tie.selections; seen.add(tie.resolution);
    if (tie.resolution === 'claim-in-one-order-only-abstained') {
      assert.ok((a.variants.length === 0) !== (b.variants.length === 0) || a.variants.filter((x) => b.variants.includes(x)).length === 0, fx.id);
      assert.equal(fam(r, f), undefined, `${fx.id}: abstains`); assert.ok(quiet(r).includes(f), `${fx.id}: reported as quiet`);
    } else if (tie.resolution === 'common-reading-tentative') {
      assert.equal(o.it.tier, 'tentative', fx.id); assert.ok(o.it.evidence.capsApplied.includes('order-tie'));
      const common = a.variants.filter((x) => b.variants.includes(x)); assert.deepEqual(o.it.interpretations.map((x) => x.ruleId), common, fx.id);
    } else if (tie.resolution === 'same-reading-in-both-orders') {
      assert.deepEqual(a, b, fx.id);
      if (o.it) assert.equal(o.it.tier, base.items.get(f)?.tier, `${fx.id}: RV-07 — no tie-specific change`);
    } else assert.equal(tie.resolution, 'no-claim-in-either-order', fx.id);
  }
  for (const want of ['claim-in-one-order-only-abstained', 'common-reading-tentative', 'same-reading-in-both-orders']) assert.ok(seen.has(want), `decision-table row exercised: ${want} (${[...seen]})`);
});
/** The orderTie the engine traced for a quiet (abstained) family: sections[].quietOrderTies (R1.3). */
const quietTie = (r, f) => r.sections.flatMap((s) => s.quietOrderTies || []).find((q) => q.familyId === f)?.orderTie;
/** Independent recomputation of a quiet tie from the observation descriptors (cross-check of the traced value). */
function findQuietTie(r, f) {
  const cls = f === 'F-PTC-LENGTH' ? 'PTC' : 'CENTRAL_LONGITUDINAL';
  const d = r.observations.find((o) => o.crease === cls)?.descriptors; const tv = d?.orderTies?.lengthNorm; if (!tv) return undefined;
  const family = FAMILIES.find((x) => x.id === f); const s1 = selectVariants(family, tv[0]), s2 = selectVariants(family, tv[1]);
  const a = { variants: s1.variants.map((x) => x.id), ambiguous: s1.ambiguous }, b = { variants: s2.variants.map((x) => x.id), ambiguous: s2.ambiguous };
  const resolution = JSON.stringify(a) === JSON.stringify(b) ? 'same-reading-in-both-orders' : a.variants.filter((x) => b.variants.includes(x)).length ? 'common-reading-tentative' : (a.variants.length || b.variants.length ? 'claim-in-one-order-only-abstained' : 'no-claim-in-either-order');
  return { selections: [a, b], resolution };
}

test('R1.3 RV-02: the decision-table rows SHORT/no-claim, LONG/no-claim and fate-present/no-claim all abstain', () => {
  const rows = { 'SHORT/no-claim': 'P-PTC-SHORT', 'LONG/no-claim': 'P-PTC-LONG', 'FATE/no-claim': 'C-FATE-PRESENT' };
  const hit = {};
  for (const fx of [...byCat('length-tie'), ...byCat('fate-length-tie')]) {
    const f = tieFamily(fx); const r = generateReading(fx.input); const t = quietTie(r, f) ?? fam(r, f)?.evidence.orderTie;
    if (!t || t.resolution !== 'claim-in-one-order-only-abstained') continue;
    const claim = [...t.selections[0].variants, ...t.selections[1].variants][0];
    for (const [row, id] of Object.entries(rows)) if (claim === id) { hit[row] = (hit[row] || 0) + 1; assert.equal(fam(r, f), undefined, `${fx.id}: ${row} must abstain`); }
  }
  for (const row of Object.keys(rows)) assert.ok(hit[row] >= 1, `${row} exercised (${JSON.stringify(hit)})`);
});

test('R1.3 RV-02: SHORT/LONG cannot arise from a 4-dp length tie (ranges 0.5 and 0.7 are 0.2 apart); generic rule would abstain', () => {
  const f = FAMILIES.find((x) => x.id === 'F-PTC-LENGTH');
  for (let v = 0.40; v <= 0.80; v += 0.00007) {
    const a = selectVariants(f, v).variants.map((x) => x.id), b = selectVariants(f, v + 0.0001).variants.map((x) => x.id);
    assert.ok(!(a.includes('P-PTC-SHORT') && b.includes('P-PTC-LONG')) && !(a.includes('P-PTC-LONG') && b.includes('P-PTC-SHORT')));
  }
});

test('R1.3 RV-01: competing creases — a tied candidate always takes part in conflict detection and is traced', () => {
  for (const fx of byCat('competing')) {
    const r = generateReading(fx.input);
    if (fx.expect === 'conflict') {
      const c = central(r); assert.equal(c.status, 'conflict', fx.id); assert.equal(fam(r, 'F-CENTRAL-LONGITUDINAL'), undefined, fx.id);
      assert.ok(c.creaseIds.length >= 2, fx.id);
      const tiedMinor = fx.input.creases.items.some((x) => x.identity.anatomicalClass === 'MINOR' && describeGeom(x.geometry.points).orderTies?.centroidX);
      if (tiedMinor) assert.ok(Array.isArray(c.centreOrderTieCandidates) && c.centreOrderTieCandidates.length >= 1, `${fx.id}: the tied competitor must be traced`);
      for (const t of c.centreOrderTieCandidates || []) { assert.equal(t.participatedInConflictDetection, true); assert.equal(t.outcome, 'competing-candidate-in-conflict'); assert.ok(c.creaseIds.includes(t.creaseId), `${fx.id}: tied candidate listed among competitors`); }
    }
    if (fx.expect === 'centre-tie-sole') {
      const c = central(r); assert.equal(c.status, 'not-observed', fx.id); assert.equal(fam(r, 'F-CENTRAL-LONGITUDINAL'), undefined);
      assert.equal(c.centreOrderTieCandidates.length, 1); assert.equal(c.centreOrderTieCandidates[0].outcome, 'excluded-centre-order-tie');
      assert.deepEqual(c.tieExcludedCreaseIds, [c.centreOrderTieCandidates[0].creaseId]);
    }
    if (fx.expect === 'fate-tentative') assert.equal(fam(r, 'F-CENTRAL-LONGITUDINAL').tier, 'tentative', fx.id);
    if (fx.expect === 'invalid') assert.equal(r.status, 'invalid-input', fx.id);
  }
  const ids = byCat('competing').map((f) => f.id.split('-')[0]);
  for (const want of ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10a', 'D10b']) assert.ok(ids.includes(want), `regression case ${want} present`);
});

test('R1.3 RV-01: conflict-based abstention in ANY R1.1 orientation never becomes a fate-line claim', () => {
  for (const fx of FIX.fixtures) {
    const r11Conflict = fx.r11.some((o) => o.summary.declined.some(([f, reason]) => f === 'F-CENTRAL-LONGITUDINAL' && reason === 'conflict'));
    if (r11Conflict) for (const { input } of orientations(fx.input)) assert.equal(fam(generateReading(input), 'F-CENTRAL-LONGITUDINAL'), undefined, fx.id);
  }
});

test('R1.3 RV-03: a crease invalid in either order is invalid; validity and the reported code are identical in both orders and under repeated reversal', () => {
  for (const fx of byCat('validity').concat(byCat('competing'))) {
    const r = generateReading(fx.input);
    if (fx.expect === 'invalid' || fx.expect === 'invalid-truncated') assert.equal(r.status, 'invalid-input', fx.id);
    if (fx.expect === 'valid') assert.notEqual(r.status, 'invalid-input', fx.id);
    if (fx.expect === 'invalid-truncated') { assert.ok(r.errorCount > 50); assert.equal(r.errors.length, 51); assert.equal(r.errors.at(-1).code, 'errors-truncated'); assert.ok(r.errors.some((e) => e.code === 'unknown-field')); }
    for (const c of fx.input.creases.items) {
      const p = c.geometry.points; assert.equal(polylineProblem(p), polylineProblem(rev(p)), fx.id); assert.equal(polylineProblem(p), polylineProblem(rev(rev(p))), fx.id);
    }
    if (fx.proof.r11Problems) {
      assert.equal(r.status, 'invalid-input', `${fx.id}: invalid in one R1.1 order → invalid`);
      assert.ok(r.errors.some((e) => e.code === 'invalid-geometry'));
    }
  }
});

test('R1.3 PLAIN BOUNDARIES: values just below, at and above each 4-dp cut-off without a tie behave exactly like R1.1', () => {
  for (const fx of byCat('length-plain')) {
    const base = meet(fx.r11.map((o) => deserial(o.summary)));
    const s = summarize(generateReading(fx.input));
    assert.deepEqual([...s.items].sort(), [...base.items].sort(), fx.id);
  }
});

test('R1.3 PRESERVED: thresholds, tentative cap and detector pins are unchanged', () => {
  assert.equal(THRESHOLDS.clear, 0.75); assert.equal(THRESHOLDS.tentative, 0.5); assert.equal(TENTATIVE_CAP, 0.74);
  const pins = Object.fromEntries(Object.keys(DETECTOR_REGISTRY).map((k) => [k, [...DETECTOR_REGISTRY[k].versions]]));
  assert.deepEqual(pins, { 'synthetic-fixture': ['0.1.0'], 'creases-directional-d1': ['frozen-d1'], 'creases-directional-d3b': ['D3B-C'] });
  assert.equal(FAMILIES.length, 9); assert.deepEqual([...new Set(FAMILIES.map((f) => f.domain))], ['personality', 'relationships', 'career', 'lifeDirection']);
});
