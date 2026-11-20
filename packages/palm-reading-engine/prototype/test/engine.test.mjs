// G6-D0 — reading engine behaviour, provenance, uncertainty and negative controls (synthetic only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReading } from '../src/engine.mjs';
import { FAMILIES } from '../src/rules.mjs';
import { lintText, PROHIBITED_PATTERNS, DISCLAIMER } from '../src/policy.mjs';
import * as F from '../fixtures/synthetic-fixtures.mjs';

const items = (r) => r.sections.flatMap((s) => s.items);
const rulesOf = (r) => items(r).flatMap((i) => i.interpretations.map((x) => x.ruleId)).sort();
const allRuleIds = new Set(FAMILIES.flatMap((f) => f.variants.map((v) => v.id)));

test('determinism: identical input → byte-identical output, repeatedly', () => {
  for (const [k, mk] of Object.entries(F.SAMPLE_FIXTURES)) {
    const a = JSON.stringify(generateReading(mk()));
    for (let i = 0; i < 5; i++) assert.equal(JSON.stringify(generateReading(mk())), a, k);
  }
});

test('determinism: crease order does not change interpretations', () => {
  const f = F.strong(); const g = F.strong(); g.creases.items.reverse();
  assert.deepEqual(rulesOf(generateReading(f)), rulesOf(generateReading(g)));
  const h = F.strong(); h.creases.items[1].geometry.points.reverse();
  assert.deepEqual(rulesOf(generateReading(f)), rulesOf(generateReading(h)), 'point order must not matter');
});

test('engine does not mutate input and returns a frozen reading', () => {
  const f = F.strong(); const snap = JSON.stringify(f);
  const r = generateReading(f);
  assert.equal(JSON.stringify(f), snap);
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.sections[0]));
});

test('every reading carries the disclaimer, versions and synthetic flag', () => {
  for (const mk of Object.values(F.SAMPLE_FIXTURES)) {
    const r = generateReading(mk());
    assert.equal(r.disclaimer.text, DISCLAIMER.text);
    assert.equal(r.synthetic, true);
    assert.ok(r.versions.engine && r.versions.ruleset && r.versions.policy && r.versions.featureSchema);
    assert.match(r.readingId, /^rd_[0-9a-f]{16}$/);
  }
});

test('strong evidence covers all four domains', () => {
  const r = generateReading(F.strong());
  assert.equal(r.status, 'interpreted');
  for (const s of r.sections) assert.equal(s.status, 'interpreted', s.domain);
});

test('provenance: every interpretation traces to a documented rule and to observed creases', () => {
  for (const [k, mk] of Object.entries(F.SAMPLE_FIXTURES)) {
    const input = mk(); const ids = new Set(input.creases.items.map((c) => c.id));
    for (const it of items(generateReading(input))) {
      for (const x of it.interpretations) assert.ok(allRuleIds.has(x.ruleId), `${k}: unknown rule ${x.ruleId}`);
      assert.ok(it.evidence.creaseIds.length > 0, `${k}: no evidence`);
      for (const id of it.evidence.creaseIds) assert.ok(ids.has(id), `${k}: evidence references non-input crease ${id}`);
      assert.ok(typeof it.evidence.measuredValue === 'number' && Number.isFinite(it.evidence.measuredValue));
      assert.equal(it.provenance.guideDerived, false);
      assert.equal(it.provenance.reviewStatus, 'PENDING_HUMAN_REVIEW');
      assert.match(it.provenance.authoredBy, /G6-D0/);
      assert.ok(it.excludedClaims.includes('lifespan or longevity'));
      assert.ok(it.uncertainty.length >= 1, 'every interpretation states its uncertainty');
    }
  }
});

test('weak evidence never produces "clear" wording', () => {
  const r = generateReading(F.weak());
  assert.ok(items(r).length > 0);
  for (const it of items(r)) { assert.equal(it.tier, 'tentative'); for (const x of it.interpretations) assert.match(x.interpretation, /^Some palmistry traditions might/); }
});

test('research detectors (uncalibrated) are capped at tentative even with user confirmation', () => {
  const r = generateReading(F.d3bUserConfirmed());
  assert.ok(items(r).length > 0);
  for (const it of items(r)) { assert.equal(it.tier, 'tentative'); assert.ok(it.evidence.capsApplied.includes('basis-capped')); }
});

test('refusal: poor quality, low scan confidence and palm-not-facing decline the whole reading', () => {
  const q = generateReading(F.poorQuality());
  assert.equal(q.status, 'declined'); assert.equal(q.decline.reason, 'quality-not-accepted'); assert.equal(q.sections.length, 0);
  const s = F.base({ scan: 0.3 }); assert.equal(generateReading(s).decline.reason, 'scan-confidence-low');
  const p = F.base(); p.capture.orientation.palmFacing = false; assert.equal(generateReading(p).decline.reason, 'palm-not-facing');
});

test('refusal: unlabelled research-detector polylines are not interpreted', () => {
  const r = generateReading(F.d1Unclassified());
  assert.equal(r.status, 'declined'); assert.equal(items(r).length, 0);
  assert.deepEqual(r.unclassifiedCreaseIds, ['cand1', 'cand2', 'cand3']);
  for (const s of r.sections) for (const d of s.declined) assert.equal(d.reason, 'unclassified');
});

test('invalid input yields an invalid-input reading with errors and no interpretation', () => {
  const f = F.base(); f.creases.source.detector = 'unknown-x';
  const r = generateReading(f);
  assert.equal(r.status, 'invalid-input'); assert.ok(r.errors.length); assert.equal(r.sections.length, 0);
  assert.equal(generateReading(undefined).status, 'invalid-input');
});

test('conflicting features: class collisions and recorded conflicts are declined, not resolved by guessing', () => {
  const r = generateReading(F.contradictory());
  const fams = items(r).map((i) => i.familyId);
  for (const id of ['F-PTC-SLOPE', 'F-PTC-LENGTH', 'F-DTC-RISE', 'F-DTC-BRANCHES', 'F-PTC-TC-ORIGIN']) assert.ok(!fams.includes(id), id);
  const declined = r.sections.flatMap((s) => s.declined);
  assert.ok(declined.some((d) => d.familyId === 'F-PTC-SLOPE' && d.reason === 'conflict' && d.creaseIds.includes('c-ptc2')));
  assert.ok(declined.some((d) => d.familyId === 'F-DTC-RISE' && d.reason === 'conflict'));
});

test('ambiguous identity is declined for the ambiguous crease only', () => {
  const r = generateReading(F.ambiguousIdentity());
  const fams = items(r).map((i) => i.familyId);
  assert.ok(!fams.includes('F-PTC-SLOPE')); assert.ok(fams.includes('F-DTC-RISE'));
});

test('contradictory evidence within a crease lowers the tier', () => {
  const f = F.base(); f.creases.items[1].branches = [{ atT: 0.5, direction: 'proximal', lengthNorm: 0.2 }];
  const it = items(generateReading(f)).find((i) => i.familyId === 'F-PTC-SLOPE');
  assert.equal(it.tier, 'tentative'); assert.ok(it.evidence.contradiction);
});

test('multiple possible interpretations are shown together, capped at tentative', () => {
  const r = generateReading(F.multipleInterpretations());
  const slope = items(r).find((i) => i.familyId === 'F-PTC-SLOPE');
  assert.deepEqual(slope.interpretations.map((x) => x.ruleId), ['P-PTC-BALANCED', 'P-PTC-SLOPING']);
  assert.equal(slope.tier, 'tentative'); assert.equal(slope.multiplePossibilities, true);
  const rise = items(r).find((i) => i.familyId === 'F-DTC-RISE');
  assert.deepEqual(rise.interpretations.map((x) => x.ruleId), ['R-DTC-STRAIGHT', 'R-DTC-GENTLE']);
});

test('hypothesis feature (central longitudinal crease) never reaches clear', () => {
  const it = items(generateReading(F.strong())).find((i) => i.familyId === 'F-CENTRAL-LONGITUDINAL');
  assert.equal(it.tier, 'tentative'); assert.equal(it.provenance.hypothesisFeature, true);
});

// ---------- Negative controls ----------

test('NEGATIVE CONTROL: missing creases are never fabricated', () => {
  const r = generateReading(F.missingMajor());
  const all = items(r);
  assert.ok(all.every((i) => !i.evidence.anatomicalClasses.includes('TC')), 'no TC-based interpretation');
  assert.ok(all.every((i) => !i.evidence.creaseIds.includes('c-tc')));
  const tcObs = r.observations.find((o) => o.crease === 'TC');
  assert.equal(tcObs.status, 'missing'); assert.equal(tcObs.descriptors, null); assert.equal(tcObs.evidenceScore, null);
  const declined = r.sections.flatMap((s) => s.declined).filter((d) => d.crease === 'TC');
  assert.ok(declined.length >= 3);
  for (const d of declined) assert.match(d.text, /means nothing about you/);
});

test('NEGATIVE CONTROL: removing any crease never adds an interpretation (monotonic evidence)', () => {
  const full = new Set(rulesOf(generateReading(F.strong())));
  const f0 = F.strong();
  for (let i = 0; i < f0.creases.items.length; i++) {
    const f = F.strong(); f.creases.items.splice(i, 1);
    for (const id of rulesOf(generateReading(f))) assert.ok(full.has(id), `removing crease ${i} produced new rule ${id}`);
  }
});

test('NEGATIVE CONTROL: low-confidence observations never become definite conclusions', () => {
  const r = generateReading(F.lowConfidence());
  assert.equal(items(r).length, 0); assert.equal(r.status, 'declined');
  for (let c = 0.0; c < 0.5; c += 0.05) {
    const g = generateReading(F.base({ conf: c, scan: 0.9 }));
    assert.equal(items(g).length, 0, `conf ${c}`);
  }
  for (let c = 0.5; c < 0.75; c += 0.05) {
    for (const it of items(generateReading(F.base({ conf: c, scan: 0.9 })))) assert.notEqual(it.tier, 'clear', `conf ${c}`);
  }
});

test('NEGATIVE CONTROL: scan confidence bounds every crease (high crease confidence cannot override a weak scan)', () => {
  const f = F.base({ conf: 0.99, scan: 0.6 });
  for (const it of items(generateReading(f))) { assert.equal(it.tier, 'tentative'); assert.ok(it.evidence.evidenceScore <= 0.6); }
});

test('NEGATIVE CONTROL: absent hypothesis crease yields no meaning', () => {
  const r = generateReading(F.base());
  const d = r.sections.flatMap((s) => s.declined).find((x) => x.familyId === 'F-CENTRAL-LONGITUDINAL');
  assert.ok(d); assert.match(d.absentNote, /carries no meaning/);
});

// ---------- Unsupported claims ----------

test('all rule text and all generated readings pass the prohibited-claim lint', () => {
  for (const f of FAMILIES) for (const v of f.variants) for (const s of [v.observe, v.text, v.reflect]) if (s) assert.deepEqual(lintText(s, v.id), [], `${v.id}: ${s}`);
  for (const mk of Object.values(F.SAMPLE_FIXTURES)) assert.doesNotThrow(() => generateReading(mk()));
});

test('prohibited-claim lint catches deterministic, medical, lifespan, wealth and relationship-outcome claims', () => {
  const bad = ['You will meet someone new.', 'This guarantees success.', 'A long life is shown.', 'This may indicate a disease.',
    'You are destined for wealth.', 'Marriage is likely around 30.', 'Studies show palm lines reflect personality.', 'This is accurate.'];
  for (const s of bad) assert.ok(lintText(s, 'x').length > 0, s);
  assert.equal(PROHIBITED_PATTERNS.length >= 8, true);
});

test('a rule with prohibited text is a hard failure, not a silent output', () => {
  const v = FAMILIES.find((f) => f.id === 'F-PTC-LENGTH').variants.find((x) => x.id === 'P-PTC-LONG');
  const orig = v.text;
  try {
    v.text = 'someone who will definitely achieve career success';
    assert.throws(() => generateReading(F.strong()), (e) => e.code === 'PROHIBITED_CLAIM');
  } finally { v.text = orig; }
  assert.doesNotThrow(() => generateReading(F.strong()));
});

test('REGRESSION (found in G6-D0 testing): display rounding never lifts evidence across a tier threshold', () => {
  assert.equal(items(generateReading(F.base({ conf: 0.49996, scan: 0.9 }))).length, 0, '0.49996 must stay insufficient');
  for (const it of items(generateReading(F.base({ conf: 0.74996, scan: 0.9 })))) assert.equal(it.tier, 'tentative', '0.74996 must stay tentative');
});
