// AURA-PALM-G6-D0-R1 — regression tests for the five G6-D0 MAJOR findings (RV-01..RV-05 = R1-F1..R1-F5).
// Synthetic feature objects only. No images, no network, no file writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateReading } from '../src/engine.mjs';
import { validateFeatures, DETECTOR_REGISTRY, LANDMARK_REGISTRY, ownLookup, RESERVED_IDS, polylineProblem } from '../src/schema.mjs';
import { FAMILIES, DOMAINS } from '../src/rules.mjs';
import { lintText, THRESHOLDS } from '../src/policy.mjs';
import * as F from '../fixtures/synthetic-fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const items = (r) => r.sections.flatMap((s) => s.items);
const declined = (r) => r.sections.flatMap((s) => s.declined);
const fam = (r, id) => items(r).find((i) => i.familyId === id);
const dec = (r, id) => declined(r).find((d) => d.familyId === id);
const rulesOf = (r) => items(r).flatMap((i) => i.interpretations.map((x) => x.ruleId)).sort();
const shape = (r) => items(r).map((i) => [i.familyId, i.tier, i.interpretations.map((x) => x.ruleId), i.evidence.measuredValue]);
const at = (f, id) => f.creases.items.find((c) => c.id === id);
const DIRECTION_FAMILIES = FAMILIES.filter((f) => f.frame.direction).map((f) => f.id);
const SCALE_FAMILIES = FAMILIES.filter((f) => f.frame.scale).map((f) => f.id);
const noThrow = (mk) => { let r; assert.doesNotThrow(() => { r = generateReading(mk()); }); return r; };
const errCodes = (r) => (r.errors || []).map((e) => e.code);

/** Walk every user-facing string the reading contains and lint it (independent of the engine's own finalize()). */
function userTexts(r) {
  const out = [];
  const keys = new Set(['observation', 'interpretation', 'reflection', 'uncertainty', 'text', 'note', 'title', 'detail', 'absentNote']);
  const visit = (v, k) => {
    if (typeof v === 'string') { if (keys.has(k)) out.push(v); }
    else if (Array.isArray(v)) v.forEach((x) => visit(x, k));
    else if (v && typeof v === 'object') for (const kk of Object.keys(v)) if (!['evidence', 'provenance', 'excludedClaims', 'versions', 'disclaimer'].includes(kk)) visit(v[kk], kk);
  };
  visit(r, '$');
  return out;
}
const assertNoProhibitedText = (r) => { for (const t of userTexts(r)) assert.deepEqual(lintText(t, 'r1-test'), [], t); };

// =====================================================================================
// R1-F1 — unsafe crease identifiers (RV-01)
// =====================================================================================

test('R1-F1: identifier "death" (and other claim-like words) never crashes the engine and is treated as an opaque id', () => {
  for (const id of ['death', 'rich', 'certain', 'die', 'lottery', 'marriage', 'diagnosis', 'destined']) {
    const r1 = noThrow(() => { const f = F.d1Unclassified(); f.creases.items[0].id = id; return f; });
    assert.equal(r1.status, 'declined'); assert.ok(r1.unclassifiedCreaseIds.includes(id));
    const r2 = noThrow(() => { const f = F.base(); f.creases.items[0].id = id; return f; });
    assert.equal(r2.status, 'interpreted', id);
    // Valid opaque ids keep existing behaviour: identical interpretations to the original id.
    assert.deepEqual(shape(r2), shape(generateReading(F.base())), id);
    // Trace references remain valid: the renamed crease is the evidence.
    assert.ok(fam(r2, 'F-DTC-RISE').evidence.creaseIds.includes(id));
    assertNoProhibitedText(r2);
  }
});

test('R1-F1: empty, wrongly typed, over-long, punctuated, Unicode and whitespace ids get a controlled invalid-input reading', () => {
  const bad = ['', ' ', 'a b', ' a', 'a ', '\ta', 'a\n', 'a.b', 'a/b', 'a;b', "a'b", 'a"b', 'a\\b', '<x>', '-a', '_a', 'déath', 'тест', 'a​', 'ａｂｃ', '😀',
    'a'.repeat(33), 'a'.repeat(100000), 42, 0, null, undefined, true, {}, [], ['c-dtc'], 1n, Symbol('x'), () => 'x', new String('c-dtc')];
  for (const id of bad) {
    const r = noThrow(() => { const f = F.base(); f.creases.items[0].id = id; return f; });
    assert.equal(r.status, 'invalid-input', String(typeof id === 'symbol' ? 'symbol' : id).slice(0, 40));
    // R1.1 narrow update (documented in R1_1_REGRESSION_RESULTS.md): non-JSON ids (BigInt, Symbol, function, boxed String)
    // are now rejected earlier by the input snapshot with unsupported-value / unsupported-shape instead of invalid / unhashable-input.
    assert.ok(['invalid', 'unhashable-input', 'unsupported-value', 'unsupported-shape'].some((c) => errCodes(r).includes(c)), String(typeof id === 'symbol' ? 'symbol' : id).slice(0, 40));
    assert.equal(items(r).length, 0, 'invalid ids select no rule');
  }
  // 32 characters is the documented maximum and remains valid.
  const ok = noThrow(() => { const f = F.base(); f.creases.items[0].id = 'a'.repeat(32); return f; });
  assert.equal(ok.status, 'interpreted');
});

test('R1-F1: duplicate ids are rejected; reserved ids (object internals) are rejected case-insensitively', () => {
  const d = noThrow(() => { const f = F.base(); f.creases.items[1].id = 'c-dtc'; return f; });
  assert.equal(d.status, 'invalid-input'); assert.ok(errCodes(d).includes('duplicate'));
  for (const id of ['constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'ToString', 'CONSTRUCTOR', '__proto__', '__defineGetter__']) {
    const r = noThrow(() => { const f = F.base(); f.creases.items[0].id = id; return f; });
    assert.equal(r.status, 'invalid-input', id);
    assert.ok(errCodes(r).includes('reserved-id') || errCodes(r).includes('invalid'), id);
  }
  assert.ok(RESERVED_IDS.includes('constructor') && RESERVED_IDS.includes('__proto__') && RESERVED_IDS.includes('tostring'));
});

test('R1-F1: conflict ids are identifier-checked too (no prototype names, no non-strings)', () => {
  for (const ids of [['__proto__'], ['constructor'], [42], [''], [null], ['a b']]) {
    const r = noThrow(() => { const f = F.base(); f.creases.conflicts = [{ ids, kind: 'overlap' }]; return f; });
    assert.equal(r.status, 'invalid-input', JSON.stringify(ids));
  }
});

test('R1-F1: error messages never echo the offending identifier or disclose implementation details', () => {
  for (const id of ['death', 'a'.repeat(40), 'constructor', 'déath', '<script>']) {
    const f = F.base(); f.creases.items[0].id = id; f.creases.items[1].id = id === 'death' ? 'death' : 'c-ptc';
    const r = generateReading(f);
    if (r.status !== 'invalid-input') continue;
    for (const e of r.errors) {
      assert.ok(!e.msg.includes(id), `message echoes id: ${e.msg}`);
      assert.ok(!/TypeError|RangeError|\.mjs|at \w+ \(|undefined|prototype/i.test(e.msg), `message discloses internals: ${e.msg}`);
    }
  }
});

test('R1-F1: unreadable or unhashable payloads give a controlled invalid-input reading, never an exception', () => {
  const getter = noThrow(() => { const f = F.base(); Object.defineProperty(f.creases.items[0], 'id', { get() { throw new Error('boom'); }, enumerable: true }); return f; });
  assert.equal(getter.status, 'invalid-input'); assert.deepEqual(errCodes(getter), ['unreadable-input']);
  const cyclic = noThrow(() => { const f = F.base(); f.extra = {}; f.extra.self = f.extra; return f; });
  // R1.1 narrow update: the closed schema (RV-09/RV-10) rejects the unknown top-level key before its cyclic contents are
  // ever read, so the code is unknown-field instead of unhashable-input. Cycles inside contract fields: r1-1 tests.
  assert.equal(cyclic.status, 'invalid-input'); assert.deepEqual(errCodes(cyclic), ['unknown-field']);
  const big = noThrow(() => { const f = F.base(); f.extra = 10n; return f; });
  assert.equal(big.status, 'invalid-input');
  // deterministic even for unhashable payloads
  const mk = () => { const f = F.base(); f.extra = {}; f.extra.self = f.extra; return f; };
  assert.equal(JSON.stringify(generateReading(mk())), JSON.stringify(generateReading(mk())));
});

// =====================================================================================
// R1-F2 — prototype-property collisions (RV-02)
// =====================================================================================

const PROTO_NAMES = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__defineGetter__', '__lookupGetter__'];

test('R1-F2: prototype-property detector names fail safely as unknown detectors (crease and landmark sources)', () => {
  for (const d of PROTO_NAMES) {
    const r = noThrow(() => { const f = F.base(); f.creases.source.detector = d; return f; });
    assert.equal(r.status, 'invalid-input', d); assert.ok(errCodes(r).includes('unknown-detector'), d); assert.equal(items(r).length, 0);
    const l = noThrow(() => { const f = F.base(); f.landmarks.source.detector = d; return f; });
    assert.equal(l.status, 'invalid-input', d); assert.ok(errCodes(l).includes('unknown-landmark-detector'), d);
  }
});

test('R1-F2: prototype names in versions and enum fields cannot redirect lookups', () => {
  const cases = [
    (f) => { f.creases.source.version = '__proto__'; },
    (f) => { f.creases.source.version = 'constructor'; },
    (f) => { f.landmarks.source.version = 'toString'; },
    (f) => { f.creases.items[0].detection.confidenceBasis = '__proto__'; },
    (f) => { f.creases.items[0].detection.confidenceBasis = 'constructor'; },
    (f) => { f.creases.items[0].identity.classSource = 'toString'; },
    (f) => { f.creases.items[0].identity.anatomicalClass = '__proto__'; },
    (f) => { f.creases.items[0].identity.anatomicalClass = 'constructor'; },
    (f) => { f.capture.quality.status = 'valueOf'; },
    (f) => { f.capture.quality.issues = ['constructor']; },
    (f) => { f.capture.handedness.value = 'constructor'; },
    (f) => { f.scanConfidence.basis = '__proto__'; },
    (f) => { f.creases.expectedButMissing = ['constructor']; },
    (f) => { f.creases.conflicts = [{ ids: ['c-dtc'], kind: '__proto__' }]; },
  ];
  for (const mut of cases) {
    const r = noThrow(() => { const f = F.base(); mut(f); return f; });
    assert.equal(r.status, 'invalid-input', mut.toString()); assert.equal(items(r).length, 0);
  }
});

test('R1-F2: registries are null-prototype tables read through own-property lookups; valid names still resolve', () => {
  for (const reg of [DETECTOR_REGISTRY, LANDMARK_REGISTRY]) {
    assert.equal(Object.getPrototypeOf(reg), null);
    for (const n of PROTO_NAMES) assert.equal(ownLookup(reg, n), undefined, n);
  }
  assert.equal(ownLookup(DETECTOR_REGISTRY, 42), undefined);
  assert.equal(ownLookup(DETECTOR_REGISTRY, 'synthetic-fixture').status, 'synthetic');
  assert.equal(ownLookup(DETECTOR_REGISTRY, 'creases-directional-d1').status, 'research-experimental');
  assert.equal(generateReading(F.base()).status, 'interpreted');
  assert.equal(generateReading(F.d1Unclassified()).status, 'declined');
  assert.equal(generateReading(F.d3bUserConfirmed()).status, 'interpreted');
});

test('R1-F2: engine source never indexes an externally keyed table with a computed key', () => {
  const src = fs.readdirSync(path.join(here, '..', 'src')).map((f) => fs.readFileSync(path.join(here, '..', 'src', f), 'utf8')).join('\n');
  const tables = ['DETECTOR_REGISTRY', 'LANDMARK_REGISTRY', 'BASIS_CAP', 'STATUS_CAP', 'CLASS_SOURCE_CAP', 'DECLINE_TEXT', 'EXTRA_DECLINE_TEXT', 'UNCERTAINTY_NOTES'];
  for (const t of tables) {
    const computed = [...src.matchAll(new RegExp(`\\b${t}\\[(?!['"])`, 'g'))];
    assert.equal(computed.length, 0, `${t}[<computed>] found; use ownLookup()`);
  }
});

// =====================================================================================
// R1-F3 — gapsBridged is preprocessing metadata, not a break (RV-03)
// =====================================================================================

const withTC = (continuity, mk = F.base) => () => { const f = mk(); at(f, 'c-tc').continuity = continuity; return f; };
const noBreakClaim = (r) => {
  assert.ok(!rulesOf(r).includes('L-TC-CHAPTERS'), 'no break-based interpretation');
  assert.ok(!userTexts(r).some((t) => /shows one or more breaks/.test(t)), 'no break observation sentence');
};

test('R1-F3: gapsBridged = 0, 1, 2 and large values never produce a break-based interpretation', () => {
  for (const g of [0, 1, 2, 3, 50, 1000]) {
    const r = noThrow(withTC({ gapsBridged: g, breaks: 0 }));
    noBreakClaim(r);
    // and it is not treated as an in-crease contradiction either
    assert.equal(fam(r, 'F-PTC-TC-ORIGIN').tier, 'clear', `gapsBridged ${g}`);
    const tc = r.observations.find((o) => o.crease === 'TC');
    assert.equal(tc.preprocessing.gapsBridged, g); assert.equal(tc.preprocessing.usedForInterpretation, false);
    assertNoProhibitedText(r);
  }
});

test('R1-F3: missing gapsBridged is accepted (metadata is optional); missing breaks declines the break rule', () => {
  const r = noThrow(withTC({ breaks: 0 }));
  assert.equal(r.status, 'interpreted');
  assert.equal(r.observations.find((o) => o.crease === 'TC').preprocessing.gapsBridged, null);
  const m = noThrow(withTC({ gapsBridged: 4 }));
  const d = dec(m, 'F-TC-BREAKS');
  assert.equal(d.reason, 'feature-not-observed'); noBreakClaim(m);
  assert.deepEqual(d.excludedInputs.map((x) => [x.field, x.value]), [['continuity.gapsBridged', 4]]);
  const n = noThrow(withTC({ gapsBridged: 4, breaks: null }));
  assert.equal(dec(n, 'F-TC-BREAKS').reason, 'feature-not-observed');
});

test('R1-F3: invalid continuity metadata is rejected with a controlled reading', () => {
  for (const ct of [{ gapsBridged: -1, breaks: 0 }, { gapsBridged: 1.5, breaks: 0 }, { gapsBridged: '2', breaks: 0 }, { gapsBridged: NaN, breaks: 0 },
    { gapsBridged: 1001, breaks: 0 }, { gapsBridged: 0, breaks: -1 }, { gapsBridged: 0, breaks: '1' }, null, 'x', []]) {
    const r = noThrow(withTC(ct));
    assert.equal(r.status, 'invalid-input', JSON.stringify(ct)); assert.equal(items(r).length, 0);
  }
});

test('R1-F3: conflicting synthetic observations — the observed break count, not gapsBridged, decides', () => {
  noBreakClaim(generateReading(withTC({ gapsBridged: 5, breaks: 0 })()));
  const r = generateReading(withTC({ gapsBridged: 0, breaks: 2 })());
  const it = fam(r, 'F-TC-BREAKS');
  assert.deepEqual(it.interpretations.map((x) => x.ruleId), ['L-TC-CHAPTERS']);
  assert.equal(it.tier, 'tentative', 'break family is held at tentative (no validated break detector)');
  assert.equal(it.evidence.measuredValue, 2);
  assert.deepEqual(it.evidence.excludedInputs.map((x) => [x.field, x.value]), [['continuity.gapsBridged', 0]]);
  assert.equal(it.provenance.hypothesisFeature, true);
  // break-based contradiction on the arc comes from observed breaks only
  const arcG = fam(generateReading(withTC({ gapsBridged: 9, breaks: 0 }, F.strong)()), 'F-TC-ARC');
  assert.equal(arcG.tier, 'clear'); assert.equal(arcG.evidence.contradiction, null);
  const arcB = fam(generateReading(withTC({ gapsBridged: 0, breaks: 2 }, F.strong)()), 'F-TC-ARC');
  assert.equal(arcB.tier, 'tentative'); assert.ok(arcB.evidence.contradiction);
});

test('R1-F3: a research detector cannot supply breaks; its gapsBridged never becomes a break', () => {
  const unsupported = noThrow(() => { const f = F.d3bUserConfirmed(); at(f, 'c-tc').continuity = { gapsBridged: 0, breaks: 1 }; return f; });
  assert.equal(unsupported.status, 'invalid-input'); assert.ok(errCodes(unsupported).includes('unsupported-capability'));
  const r = noThrow(() => { const f = F.d3bUserConfirmed(); at(f, 'c-tc').continuity = { gapsBridged: 3, breaks: 0 }; return f; });
  assert.equal(dec(r, 'F-TC-BREAKS').reason, 'feature-unsupported'); noBreakClaim(r);
  assert.equal(r.observations.find((o) => o.crease === 'TC').breakObservation, 'unsupported');
  assert.equal(ownLookup(DETECTOR_REGISTRY, 'creases-directional-d1').capabilities.observesBreaks, false);
  assert.equal(ownLookup(DETECTOR_REGISTRY, 'creases-directional-d3b').capabilities.observesBreaks, false);
});

test('R1-F3: multiple creases with different preprocessing metadata keep it as metadata only', () => {
  const f = F.strong();
  at(f, 'c-dtc').continuity = { gapsBridged: 3, breaks: 0 }; at(f, 'c-ptc').continuity = { gapsBridged: 0, breaks: 0 }; at(f, 'c-tc').continuity = { gapsBridged: 7, breaks: 0 };
  const r = generateReading(f);
  assert.deepEqual(shape(r), shape(generateReading(F.strong())), 'preprocessing metadata changes no interpretation');
  assert.deepEqual(r.observations.filter((o) => o.preprocessing).map((o) => [o.crease, o.preprocessing.gapsBridged]), [['DTC', 3], ['PTC', 0], ['TC', 7], ['CENTRAL_LONGITUDINAL', 0]]);
  noBreakClaim(r); assertNoProhibitedText(r);
});

test('R1-F3: no rule reads gapsBridged; no lifespan, health or deterministic text in break-related output', () => {
  for (const fm of FAMILIES) for (const fn of [fm.value, fm.contradictedBy]) assert.ok(!fn.toString().includes('gapsBridged'), fm.id);
  for (const ct of [{ gapsBridged: 9, breaks: 3 }, { gapsBridged: 0, breaks: 1 }, { gapsBridged: 2, breaks: 0 }]) {
    const r = generateReading(withTC(ct)());
    assertNoProhibitedText(r);
    for (const t of userTexts(r)) assert.ok(!/accident|illness|danger|death|lifespan|when\b/i.test(t), t);
    const b = fam(r, 'F-TC-BREAKS');
    if (b) for (const ex of ['lifespan or longevity', 'health, illness or medical conditions', 'accidents, illness or dangerous periods', 'timing of events']) assert.ok(b.excludedClaims.includes(ex));
  }
});

// =====================================================================================
// R1-F4 — unknown handedness / orientation must not yield unsupported "clear" (RV-04)
// =====================================================================================

const withCapture = (mut, mk = F.strong) => () => { const f = mk(); mut(f); return f; };
const noDirectionInterpretations = (r) => { for (const id of DIRECTION_FAMILIES) assert.equal(fam(r, id), undefined, `${id} must not be interpreted`); };

test('R1-F4: known handedness and orientation keep the G6-D0 behaviour (control)', () => {
  const r = generateReading(F.strong());
  assert.equal(r.frame.directionReliable, true); assert.equal(r.frame.scaleReliable, true);
  for (const id of ['F-PTC-SLOPE', 'F-PTC-LENGTH', 'F-DTC-RISE', 'F-PTC-TC-ORIGIN', 'F-TC-ARC']) assert.equal(fam(r, id).tier, 'clear', id);
});

test('R1-F4: unknown handedness declines every direction-dependent rule; handedness-independent rules stay eligible', () => {
  const r = generateReading(withCapture((f) => { f.capture.handedness = { value: 'unknown', source: 'unknown' }; })());
  noDirectionInterpretations(r);
  for (const id of DIRECTION_FAMILIES) { const d = dec(r, id); assert.equal(d.reason, 'frame-unreliable', id); assert.ok(d.frameReasons.includes('handedness-unknown')); }
  assert.equal(fam(r, 'F-PTC-LENGTH').tier, 'clear', 'length in palm widths does not depend on handedness');
  assert.equal(r.frame.handedness.value, 'unknown', 'missing handedness is never replaced by a default');
  assertNoProhibitedText(r);
});

test('R1-F4: unknown orientation (palmFacing null) declines direction rules and caps everything else at tentative', () => {
  const r = generateReading(withCapture((f) => { f.capture.orientation.palmFacing = null; })());
  noDirectionInterpretations(r);
  assert.ok(items(r).length > 0);
  for (const it of items(r)) {
    assert.equal(it.tier, 'tentative', it.familyId);
    assert.ok(it.evidence.capsApplied.includes('orientation-unconfirmed'));
    assert.ok(it.evidence.evidenceScore <= 0.74 && it.evidence.evidenceBeforeFrameCaps > it.evidence.evidenceScore - 1e-9);
    assert.ok(it.uncertainty.some((u) => /palm side/.test(u)), 'cap is explained to the reader');
  }
  for (const id of DIRECTION_FAMILIES) assert.ok(dec(r, id).frameReasons.includes('palm-facing-unconfirmed'));
});

test('R1-F4: both unknown → no clear output and no direction-dependent output at all', () => {
  const r = generateReading(withCapture((f) => { f.capture.handedness = { value: 'unknown', source: 'unknown' }; f.capture.orientation.palmFacing = null; })());
  noDirectionInterpretations(r);
  for (const it of items(r)) assert.notEqual(it.tier, 'clear');
});

test('R1-F4: absent landmarks decline every scale- and direction-dependent rule', () => {
  const r = generateReading(withCapture((f) => { f.landmarks = { present: false }; })());
  for (const id of [...new Set([...SCALE_FAMILIES, ...DIRECTION_FAMILIES])]) {
    assert.equal(fam(r, id), undefined, id);
    const d = dec(r, id); if (d) assert.equal(d.reason, 'frame-unreliable', id);
  }
  assert.ok(dec(r, 'F-PTC-LENGTH').frameReasons.includes('landmarks-absent'));
  // frame-independent counts may remain (documented exception)
  assert.deepEqual(items(r).map((i) => i.familyId), ['F-DTC-BRANCHES']);
});

test('R1-F4: conflicting orientation metadata and a low-quality frame decline the dependent rules', () => {
  const rot = generateReading(withCapture((f) => { f.capture.quality.issues = ['hand-rotated']; })());
  noDirectionInterpretations(rot);
  assert.ok(dec(rot, 'F-PTC-SLOPE').frameReasons.includes('orientation-conflict'));
  assert.equal(fam(rot, 'F-PTC-LENGTH').tier, 'clear', 'rotation does not affect a scale-only rule');
  for (const issue of ['hand-cut-off', 'hand-too-small', 'palm-not-visible']) {
    const r = generateReading(withCapture((f) => { f.capture.quality.issues = [issue]; })());
    for (const id of [...new Set([...SCALE_FAMILIES, ...DIRECTION_FAMILIES])]) assert.equal(fam(r, id), undefined, `${issue}: ${id}`);
    assert.ok(dec(r, 'F-PTC-LENGTH').frameReasons.includes('frame-quality-low'));
    assert.deepEqual(r.frame.frameQualityIssues, [issue]);
  }
});

test('R1-F4: invalid orientation or handedness values are rejected, not defaulted', () => {
  const muts = [
    (f) => { f.capture.orientation.palmFacing = 'yes'; }, (f) => { f.capture.orientation.palmFacing = undefined; }, (f) => { f.capture.orientation.palmFacing = 1; },
    (f) => { f.capture.orientation.rotationDeg = 400; }, (f) => { f.capture.orientation.rotationDeg = NaN; }, (f) => { f.capture.orientation.rotationDeg = '4'; },
    (f) => { delete f.capture.orientation; }, (f) => { f.capture.handedness.value = 'up'; }, (f) => { f.capture.handedness = { value: 'left', source: 'unknown' }; },
    (f) => { delete f.capture.handedness; },
  ];
  for (const m of muts) { const r = noThrow(withCapture(m, F.base)); assert.equal(r.status, 'invalid-input', m.toString()); }
});

test('R1-F4: model-estimated (mirror-sensitive) handedness caps direction rules at tentative and says why', () => {
  const r = generateReading(withCapture((f) => { f.capture.handedness = { value: 'right', source: 'landmark-model' }; })());
  for (const id of DIRECTION_FAMILIES) {
    const it = fam(r, id); if (!it) continue;
    assert.equal(it.tier, 'tentative', id); assert.ok(it.evidence.capsApplied.includes('handedness-model'), id);
    assert.ok(it.uncertainty.some((u) => /estimated from the image/.test(u)));
  }
  assert.equal(fam(r, 'F-PTC-LENGTH').tier, 'clear', 'handedness source does not affect a scale-only rule');
});

test('R1-F4: research-detector cap and threshold boundaries hold under frame caps; 0.49996 regression preserved', () => {
  const d3 = generateReading(withCapture((f) => { f.capture.orientation.palmFacing = null; }, F.d3bUserConfirmed)());
  for (const it of items(d3)) { assert.equal(it.tier, 'tentative'); assert.ok(it.evidence.capsApplied.includes('basis-capped')); }
  const tierAt = (conf, facing) => { const f = F.base({ conf, scan: 0.95 }); f.capture.orientation.palmFacing = facing; return items(generateReading(f)).map((i) => i.tier); };
  assert.ok(tierAt(0.75, true).every((t) => t === 'clear'), '0.75 known frame → clear');
  assert.ok(tierAt(0.7499999, true).every((t) => t === 'tentative'));
  assert.ok(tierAt(0.75, null).every((t) => t === 'tentative'), '0.75 unknown orientation → tentative');
  assert.ok(tierAt(0.99, null).every((t) => t === 'tentative'));
  assert.ok(tierAt(0.5, null).length > 0 && tierAt(0.5, null).every((t) => t === 'tentative'));
  assert.equal(tierAt(0.4999999, null).length, 0); assert.equal(tierAt(0.49996, true).length, 0); assert.equal(tierAt(0.49996, null).length, 0);
  assert.equal(THRESHOLDS.clear, 0.75); assert.equal(THRESHOLDS.tentative, 0.5);
});

// =====================================================================================
// R1-F5 — point-order contract (RV-05)
// =====================================================================================

const withPTC = (points, mk = F.base) => () => { const f = mk(); at(f, 'c-ptc').geometry.points = points; return f; };
const PTC = [{ x: 0.05, y: 0.32 }, { x: 0.25, y: 0.35 }, { x: 0.45, y: 0.38 }, { x: 0.65, y: 0.42 }, { x: 0.8, y: 0.45 }];

test('R1-F5: valid ordered polylines behave consistently; whole reversal of any polyline gives identical sections', () => {
  for (const mk of [F.base, F.strong, F.multipleInterpretations, F.contradictory]) {
    const a = generateReading(mk());
    for (let i = 0; i < mk().creases.items.length; i++) {
      const f = mk(); f.creases.items[i].geometry.points.reverse();
      assert.equal(JSON.stringify(generateReading(f).sections), JSON.stringify(a.sections), `${mk.name} crease ${i}`);
    }
  }
});

test('R1-F5: consecutive duplicate points are collapsed; any other repeated point is rejected', () => {
  const dup = [PTC[0], PTC[1], { ...PTC[1] }, PTC[2], PTC[3], { ...PTC[3] }, PTC[4]];
  const r = generateReading(withPTC(dup)());
  assert.deepEqual(shape(r), shape(generateReading(F.base())));
  assert.equal(r.observations.find((o) => o.crease === 'PTC').descriptors.duplicatePointsCollapsed, 2);
  const revisit = generateReading(withPTC([PTC[0], PTC[1], PTC[2], PTC[1], PTC[3]])());
  assert.equal(revisit.status, 'invalid-input');
  const loop = generateReading(withPTC([...PTC, PTC[0]])());
  assert.equal(loop.status, 'invalid-input', 'closed loop: ambiguous endpoints');
});

test('R1-F5: empty, single-point, all-duplicate and degenerate polylines fail safely', () => {
  for (const pts of [[], [PTC[0]], [PTC[0], { ...PTC[0] }], [PTC[0], { ...PTC[0] }, { ...PTC[0] }], [{ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.5 }]]) {
    const r = noThrow(withPTC(pts));
    assert.equal(r.status, 'invalid-input', JSON.stringify(pts)); assert.ok(errCodes(r).includes('invalid-geometry'));
  }
});

test('R1-F5: unordered, doubling-back, self-intersecting and tortuous polylines are rejected, not measured', () => {
  const shuffled = [PTC[0], PTC[3], PTC[1], PTC[4], PTC[2]];
  const zigzag = [{ x: 0.05, y: 0.32 }, { x: 0.8, y: 0.45 }, { x: 0.1, y: 0.4 }, { x: 0.75, y: 0.36 }];
  const hairpin = [{ x: 0.1, y: 0.3 }, { x: 0.6, y: 0.35 }, { x: 0.15, y: 0.38 }];
  const crossing = [{ x: 0.1, y: 0.3 }, { x: 0.5, y: 0.3 }, { x: 0.5, y: 0.5 }, { x: 0.3, y: 0.5 }, { x: 0.3, y: 0.2 }];
  const curl = Array.from({ length: 10 }, (_, i) => ({ x: 0.5 + 0.2 * Math.cos((i * 30 * Math.PI) / 180), y: 0.5 + 0.2 * Math.sin((i * 30 * Math.PI) / 180) }));
  const expect = [[shuffled, ['doubles-back', 'self-intersecting']], [zigzag, ['doubles-back', 'self-intersecting']], [hairpin, ['doubles-back']], [crossing, ['self-intersecting']], [curl, ['tortuous']]];
  for (const [pts, codes] of expect) {
    assert.ok(codes.includes(polylineProblem(pts)), `${JSON.stringify(pts).slice(0, 60)} → ${polylineProblem(pts)}`);
    const r = noThrow(withPTC(pts));
    assert.equal(r.status, 'invalid-input'); assert.equal(items(r).length, 0);
  }
  assert.equal(polylineProblem(PTC), null);
  for (const c of F.strong().creases.items) assert.equal(polylineProblem(c.geometry.points), null, c.id);
});

test('R1-F5: ambiguous endpoints decline rules that read endpoint roles, identically in both directions', () => {
  const nearVertical = [{ x: 0.4, y: 0.3 }, { x: 0.42, y: 0.4 }, { x: 0.405, y: 0.5 }];
  const fwd = generateReading(withPTC(nearVertical, F.strong)());
  const rev = generateReading(withPTC([...nearVertical].reverse(), F.strong)());
  assert.equal(JSON.stringify(fwd.sections), JSON.stringify(rev.sections), 'direction-independent');
  for (const id of ['F-PTC-SLOPE', 'F-PTC-TC-ORIGIN', 'F-PTC-FORK']) {
    const d = dec(fwd, id); assert.equal(d.reason, 'geometry-ambiguous', id); assert.deepEqual(d.ambiguousEndpointRoles, ['radialUlnar']);
  }
  const ptc = fwd.observations.find((o) => o.crease === 'PTC').descriptors;
  assert.equal(ptc.endpointRoles.radialUlnar, 'ambiguous');
  assert.equal(ptc.endDropRadial, null); assert.equal(ptc.radialEnd, null); assert.equal(ptc.chordDeg, null);
  assert.ok(fam(fwd, 'F-PTC-LENGTH'), 'length does not depend on endpoint roles');
  // The G6-D0 B2 probe (equal-x V shape) is now rejected outright as doubling back.
  assert.equal(generateReading(withPTC([{ x: 0.4, y: 0.3 }, { x: 0.2, y: 0.4 }, { x: 0.4, y: 0.5 }])()).status, 'invalid-input');
});

test('R1-F5: invalid and extremely large coordinates are rejected', () => {
  const bad = [[{ x: NaN, y: 0.3 }, PTC[1]], [{ x: Infinity, y: 0.3 }, PTC[1]], [{ x: '0.1', y: 0.3 }, PTC[1]], [{ x: 0.1 }, PTC[1]], [null, PTC[1]],
    [{ x: 1e308, y: 0.3 }, PTC[1]], [{ x: -1e308, y: 0.3 }, PTC[1]], [{ x: 1e6, y: 1e6 }, PTC[1]], [{ x: 1.2000001, y: 0.3 }, PTC[1]], [{ x: 0.1, y: -0.2000001 }, PTC[1]],
    Array.from({ length: 65 }, (_, i) => ({ x: 0.01 * i, y: 0.3 }))];
  for (const pts of bad) { const r = noThrow(withPTC(pts)); assert.equal(r.status, 'invalid-input'); }
});

test('R1-F5: declared ordering metadata is rejected (order is derived from the points)', () => {
  for (const k of ['order', 'pointOrder', 'direction', 'closed', 'reversed']) {
    const f = F.base(); at(f, 'c-ptc').geometry[k] = 'reversed';
    const r = generateReading(f); assert.equal(r.status, 'invalid-input', k); assert.ok(errCodes(r).includes('declared-descriptor'));
  }
});

test('R1-F5: branch positions are radial-referenced, so reversing points does not move a branch', () => {
  const f = F.strong(); const g = F.strong(); at(g, 'c-ptc').geometry.points.reverse();
  assert.deepEqual(rulesOf(generateReading(f)), rulesOf(generateReading(g)));
  assert.ok(rulesOf(generateReading(g)).includes('C-PTC-FORK'));
});

test('R1-F5: repeated execution over all R1 edge cases is byte-identical', () => {
  const cases = [F.strong, withPTC([{ x: 0.4, y: 0.3 }, { x: 0.42, y: 0.4 }, { x: 0.405, y: 0.5 }], F.strong), withTC({ gapsBridged: 4, breaks: 2 }),
    withCapture((f) => { f.capture.orientation.palmFacing = null; }), withCapture((f) => { f.capture.handedness = { value: 'unknown', source: 'unknown' }; })];
  for (const mk of cases) { const a = JSON.stringify(generateReading(mk())); for (let i = 0; i < 5; i++) assert.equal(JSON.stringify(generateReading(mk())), a); }
});

// =====================================================================================
// Part E — G6-D0 guarantees preserved
// =====================================================================================

test('PART E: domains, rule ids and all user-facing rule text are unchanged from G6-D0', async () => {
  assert.deepEqual([...DOMAINS], ['personality', 'relationships', 'career', 'lifeDirection']);
  const g6 = path.resolve(here, '..', '..', 'vendor', 'AURA_PALM_G6_D0_READING_ENGINE_DESIGN', 'prototype', 'src', 'rules.mjs'); // G6-I1: hash-pinned vendored copy
  assert.ok(fs.existsSync(g6), 'inherited G6-D0 rules.mjs must be present (vendored)');
  const old = await import(pathToFileURL(g6).href);
  const textOf = (fams) => fams.map((f) => [f.id, f.domain, f.requires, f.variants.map((v) => [v.id, v.min, v.max, v.observe, v.text, v.reflect]), f.absentNote ?? null]);
  assert.deepEqual(textOf(FAMILIES), textOf(old.FAMILIES));
});

test('PART E: every R1 decline/uncertainty text passes the prohibited-claim lint', async () => {
  const { DECLINE_TEXT, UNCERTAINTY_NOTES } = await import('../src/policy.mjs');
  for (const t of [...Object.values(DECLINE_TEXT), ...Object.values(UNCERTAINTY_NOTES), ...FAMILIES.map((f) => f.hypothesisNote).filter(Boolean)]) assert.deepEqual(lintText(t, 'x'), [], t);
});
