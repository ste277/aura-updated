// AURA-PALM-G6-D0-R1.4 — coverage accounting (pure; harness-owned; NOT part of the interpretation engine).
// Shared by test/r1-4-hardening.test.mjs, test/r1-3-hardening.test.mjs, baseline/differential.mjs,
// baseline/fixture-campaigns.mjs and baseline/check-coverage-contract.mjs.
import crypto from 'node:crypto';

const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
export const sha = (o) => crypto.createHash('sha256').update(canon(o)).digest('hex');

// ---------------------------------------------------------------------------------------------------------------
// R1.3-RV-02 — distinct-input accounting up to point order.
// The canonical orientation of a point list is the lexicographically smaller of {points, reversed points}, comparing
// point by point on (x, then y) with exact number equality. Nothing is collapsed, rounded or reordered beyond whole
// reversal, so two inputs share a key ONLY IF every crease is identical up to reversal: an input and its reversal (or
// any partial reversal) count once; any changed coordinate gives a different key.
// ---------------------------------------------------------------------------------------------------------------
export function canonicalOrientation(points) {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[n - 1 - i];
    const ax = a?.x, bx = b?.x, ay = a?.y, by = b?.y;
    const lt = (u, v) => (typeof u === 'number' && typeof v === 'number' ? u < v : String(u) < String(v));
    if (ax !== bx) return lt(ax, bx) ? points : [...points].reverse();
    if (ay !== by) return lt(ay, by) ? points : [...points].reverse();
  }
  return points;
}
export function canonicalInputKey(input) {
  let g;
  try { g = JSON.parse(JSON.stringify(input)); } catch { return `unserialisable:${String(input)}`; }
  for (const c of g?.creases?.items || []) if (Array.isArray(c?.geometry?.points)) c.geometry.points = canonicalOrientation(c.geometry.points);
  return sha(g);
}
export const rawInputKey = (input) => sha(input);

// ---------------------------------------------------------------------------------------------------------------
// R1.3-RV-01 — tie categories, defined from the engine's existing reconciliation trace AND R1.1's single-orientation
// readings (the baseline evaluator). No new policy; no engine change.
//   observed           some crease's point list has a 4-dp order tie (geometry: describe(points).orderTies)
//   reconciledInTrace  the R1.3 reading records a non-no-op reconciliation for some family F: an item with
//                      orderTie.resolution 'common-reading-tentative', a quietOrderTies entry
//                      'claim-in-one-order-only-abstained', or (F = central longitudinal) centreOrderTieCandidates
//   outcomeRelevant    for some reconciled family F, R1.1's readings of the different orientations DISAGREE on F
//                      (presence, tier or rules) — the tie decides F's outcome
//   abstention         outcomeRelevant, and R1.3 emits no claim for F while some R1.1 orientation did
//   tierLowered        outcomeRelevant, and R1.3 has F tentative while some R1.1 orientation had F clear
//   harmless           observed but not outcomeRelevant (same reading in both orders; no claim in either; a tie that a
//                      cap, another competitor or another gate already decides; a crease no tie-sensitive rule reads;
//                      an invalid input)
//   noopChanged        CONSISTENCY VIOLATION: a reconciled family F on which all R1.1 orientations AGREE, yet R1.3's
//                      outcome for F differs from that common R1.1 outcome (a reconciliation must be a no-op there)
// `r11Summaries` (oracle summaries, Map- or array-form items) is REQUIRED; without it the categories are undefined.
// ---------------------------------------------------------------------------------------------------------------
const famState = (s, f) => { const items = s.items instanceof Map ? s.items : new Map(s.items); const it = items.get(f); return it ? JSON.stringify([it.tier, [...it.rules].sort()]) : 'none'; };
export function classifyTies(input, reading, describe, r11Summaries) {
  if (!Array.isArray(r11Summaries) || r11Summaries.length === 0) throw new Error('classifyTies: R1.1 orientation summaries are required');
  let observed = false;
  for (const c of input?.creases?.items || []) {
    const p = c?.geometry?.points;
    if (!Array.isArray(p) || p.length < 2) continue;
    try { if (describe(p).orderTies) { observed = true; break; } } catch { /* malformed geometry: not a tie */ }
  }
  const reconciled = new Set();
  if (reading && reading.status !== 'invalid-input') {
    for (const s of reading.sections) {
      for (const it of s.items) if (it.evidence?.orderTie?.resolution === 'common-reading-tentative') reconciled.add(it.familyId);
      for (const q of s.quietOrderTies || []) if (q.orderTie?.resolution === 'claim-in-one-order-only-abstained') reconciled.add(q.familyId);
    }
    if (reading.observations?.find((o) => o.crease === 'CENTRAL_LONGITUDINAL')?.centreOrderTieCandidates?.length) reconciled.add('F-CENTRAL-LONGITUDINAL');
  }
  const r13Items = new Map(reading && reading.status !== 'invalid-input' ? reading.sections.flatMap((s) => s.items.map((it) => [it.familyId, it])) : []);
  const r13State = (f) => { const it = r13Items.get(f); return it ? JSON.stringify([it.tier, it.interpretations.map((x) => x.ruleId).sort()]) : 'none'; };
  let outcomeRelevant = false, abstention = false, tierLowered = false, noopChanged = false;
  for (const f of reconciled) {
    const states = r11Summaries.map((s) => (s.valid ? famState(s, f) : 'invalid'));
    const disagree = new Set(states).size > 1;
    if (!disagree) { if (states[0] !== 'invalid' && states[0] !== r13State(f)) noopChanged = true; continue; }
    outcomeRelevant = true;
    if (!r13Items.has(f) && states.some((x) => x !== 'none' && x !== 'invalid')) abstention = true;
    if (r13Items.get(f)?.tier === 'tentative' && states.some((x) => x.startsWith('["clear"'))) tierLowered = true;
  }
  // R1.5 (R1.4-RV-04) accounting-only categories (existing trace fields; no new policy):
  //   candidateRank     the candidate's competitor ranking for the central longitudinal family depends on point order:
  //                     a MINOR crease passes the centre test in one order only (centreOrderTieCandidates, R1.3-RV-01)
  //   outcomeUnchanged  a reconciliation was recorded but no R1.1 orientation disagreement exists (final outcome unchanged)
  const candidateRank = !!(reading && reading.status !== 'invalid-input' && reading.observations?.find((o) => o.crease === 'CENTRAL_LONGITUDINAL')?.centreOrderTieCandidates?.length);
  return { observed, reconciledInTrace: reconciled.size > 0, outcomeRelevant, abstention, tierLowered, harmless: observed && !outcomeRelevant, noopChanged,
    candidateRank, outcomeUnchanged: reconciled.size > 0 && !outcomeRelevant };
}

/** Do R1.1's readings for the different orientations of one input disagree (on validity, any family or any tier)? */
export function r11OrientationsDisagree(summaries) {
  const key = (s) => JSON.stringify({ v: s.valid, i: [...(s.items instanceof Map ? s.items : new Map(s.items))].sort() });
  return new Set(summaries.map(key)).size > 1;
}

// ---------------------------------------------------------------------------------------------------------------
// R1.3-RV-04 — replacement for the vacuous `fx.r11.length >= 2`. Observable properties, per constructed fixture:
//   (a) a reconciliation recorded on a family where every R1.1 orientation agrees must leave that family's outcome
//       equal to R1.1's (noopChanged is false);
//   (b) every fixture whose proof claims order-dependent R1.1 validity really has disagreeing R1.1 orientations;
//   (c) every sole centre-tie fixture whose R1.1 orientations disagree on the central family produces a tie-caused
//       abstention (a centre tie with both orders inside [0.3, 0.7] is correctly identified and is not required to abstain).
// Returns a list of violations (empty = consistent).
// ---------------------------------------------------------------------------------------------------------------
export function checkFixtureDisagreementConsistency(fixtures, readingOf, describe) {
  const out = [];
  for (const fx of fixtures) {
    const sums = fx.r11.map((o) => o.summary);
    const t = classifyTies(fx.input, readingOf(fx.input), describe, sums);
    if (t.noopChanged) out.push({ id: fx.id, problem: 'R1.3 changed a family on which every R1.1 orientation agrees' });
    if (fx.proof?.r11Problems && !r11OrientationsDisagree(sums)) out.push({ id: fx.id, problem: 'proof claims order-dependent R1.1 validity but orientations agree' });
    const centralDisagree = new Set(sums.map((x) => (x.valid ? famState(x, 'F-CENTRAL-LONGITUDINAL') : 'invalid'))).size > 1;
    if (fx.expect === 'centre-tie-sole' && centralDisagree && !t.abstention) out.push({ id: fx.id, problem: 'sole centre tie decided by orientation in R1.1, but no tie-caused abstention' });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// R1.3-RV-03 — coverage contract. `contract` names the required campaigns and their floors; `reports` maps campaign
// id → report. Returns { pass, failures[] }. Every requirement is checked independently and named.
// ---------------------------------------------------------------------------------------------------------------
export function checkContract(contract, reports) {
  const failures = [];
  const fail = (campaign, check, detail) => failures.push({ campaign, check, detail });
  for (const req of contract.campaigns) {
    const r = reports[req.id];
    if (!r) { fail(req.id, 'campaign-present', 'report missing'); continue; }
    const c = r.counts || {};
    if (r.campaign !== req.id) fail(req.id, 'campaign-id', `report says ${r.campaign}`);
    if (req.generator && r.generator !== req.generator) fail(req.id, 'generator', String(r.generator));
    if (r.completed !== true) fail(req.id, 'completed', 'run did not complete (early termination or cap reached)');
    if (!(c.generated > 0)) fail(req.id, 'non-empty', 'no cases generated');
    if (!(c.canonicalDistinct >= req.minCanonicalDistinct)) fail(req.id, 'min-canonical-distinct', `${c.canonicalDistinct} < ${req.minCanonicalDistinct}`);
    if (!(c.eligibleCanonicalDistinct >= req.minEligible)) fail(req.id, 'min-eligible', `${c.eligibleCanonicalDistinct} < ${req.minEligible}`);
    if (!(c.orientationComparisons >= req.minOrientationComparisons)) fail(req.id, 'min-orientation-comparisons', `${c.orientationComparisons} < ${req.minOrientationComparisons}`);
    if (c.canonicalDistinct > 0 && c.comparedCases !== c.canonicalDistinct) fail(req.id, 'every-distinct-case-compared', `${c.comparedCases} vs ${c.canonicalDistinct}`);
    if (!(c.canonicalDistinct > 0) || c.canonicalDistinct * 2 < (req.minCanonicalDistinct || 1)) fail(req.id, 'not-duplicate-only', 'no distinct cases');
    if (c.variantCoverageFailures !== 0) fail(req.id, 'all-point-order-variants', `${c.variantCoverageFailures} cases missing variants`);
    if (c.r11Evaluations !== c.orientationVariants || c.r13Evaluations !== c.orientationVariants) fail(req.id, 'both-engines-every-variant', `R1.1 ${c.r11Evaluations}, R1.4 ${c.r13Evaluations}, variants ${c.orientationVariants}`);
    for (const [k, min] of Object.entries(req.minOutcome || {})) if (!(c[k] >= min)) fail(req.id, `min-${k}`, `${c[k]} < ${min}`);
    if (r.reversalMismatches !== 0) fail(req.id, 'reversal-invariant', String(r.reversalMismatches));
    for (const kind of ['claim-presence-upgrade', 'confidence-upgrade', 'invalid-to-valid', 'conflict-abstention-to-claim', 'additional-interpretation']) if ((r.upgrades?.[kind] ?? null) !== 0) fail(req.id, `zero-${kind}`, String(r.upgrades?.[kind]));
    if (r.oracleSelfTestFailures?.length) fail(req.id, 'oracle-self-test', JSON.stringify(r.oracleSelfTestFailures));
  }
  for (const id of Object.keys(reports)) if (!contract.campaigns.some((c) => c.id === id)) fail(id, 'unexpected-campaign', 'not in contract');
  return { pass: failures.length === 0, failures };
}
