// AURA-PALM-G6-D0-R1.3 — no-upgrade oracle (pure; shared by the R1.3 tests and baseline/differential.mjs).
//
// Confidence ordering used throughout (R1_3_CONFIDENCE_ORDERING.md):
//   invalid input  <  no claim (declined / quiet / not emitted)  <  tentative claim  <  clear claim
// "No claim is more conservative than any positive claim": a tentative claim where the baseline made none IS an upgrade.
//
// Conservative R1.1 baseline: when R1.1's readings for the different point orientations of the same input disagree,
// the baseline is their MEET — the input is valid only if valid in every orientation; a family carries a claim only if
// it is interpreted in every orientation; its tier is the lowest; its rules are the intersection (empty → no claim).
// The meet never picks whichever orientation would make the candidate look compliant.
//
// R1.4 (R1.3-RV-03): COMPARISON DOMAIN — the meet is taken over EVERY orientation summary supplied (≥ 1 required;
// an empty or missing baseline throws instead of silently passing). Rule ids are INTERSECTED across orientations; the
// self-test now includes orientations that disagree on rule sets, so an intersection→union weakening is detected.
// Claim presence, confidence, validity and conflict upgrades are reported as separate violation kinds.

export const RANK = Object.freeze({ tentative: 1, clear: 2 });

/** Reduce a reading to the facts the oracle compares. */
export function summarize(r) {
  if (!r || r.status === 'invalid-input') return { valid: false, items: new Map(), declined: new Map() };
  const items = new Map(), declined = new Map();
  for (const s of r.sections) {
    for (const it of s.items) {
      // R2-F1: fail closed on malformed readings — an unknown confidence tier could never rank above a baseline, and a
      // duplicate claim would be silently overwritten (last one wins), so either could hide an upgrade.
      if (!Object.hasOwn(RANK, it.tier)) throw new Error(`oracle: malformed reading: unknown confidence tier ${JSON.stringify(it.tier)} for ${it.familyId}`);
      if (items.has(it.familyId)) throw new Error(`oracle: malformed reading: duplicate claim for family ${it.familyId}`);
      const rules = it.interpretations.map((x) => x.ruleId);
      if (new Set(rules).size !== rules.length) throw new Error(`oracle: malformed reading: duplicate interpretation rule in family ${it.familyId}`);
      items.set(it.familyId, { tier: it.tier, rules: rules.sort() });
    }
    for (const d of s.declined) declined.set(d.familyId, d.reason);
  }
  return { valid: true, items, declined };
}

/** The meet (most conservative common reading) of several summaries. */
export function meet(summaries) {
  if (!Array.isArray(summaries) || summaries.length === 0) throw new Error('oracle: meet() needs at least one orientation summary (missing comparison results)');
  const valid = summaries.every((s) => s.valid);
  const items = new Map(), conflictFamilies = new Set();
  for (const s of summaries) for (const [fam, reason] of s.declined) if (reason === 'conflict') conflictFamilies.add(fam);
  if (valid) {
    const fams = [...summaries[0].items.keys()].filter((f) => summaries.every((s) => s.items.has(f)));
    for (const f of fams) {
      const tier = summaries.map((s) => s.items.get(f).tier).reduce((a, b) => (RANK[a] <= RANK[b] ? a : b));
      const rules = summaries.map((s) => s.items.get(f).rules).reduce((a, b) => a.filter((x) => b.includes(x)));
      if (rules.length) items.set(f, { tier, rules });
    }
  }
  return { valid, items, conflictFamilies, orientationCount: summaries.length };
}

/**
 * Every way `candidate` is more permissive or more confident than `baseline` (a meet). Empty array = compliant.
 * Kinds: invalid-to-valid, claim-presence-upgrade (no claim → claim), conflict-abstention-to-claim,
 * confidence-upgrade (tentative → clear), additional-interpretation (a rule the baseline did not support).
 */
export function violations(candidate, baseline) {
  if (!candidate || !baseline || !(baseline.orientationCount >= 1)) throw new Error('oracle: violations() needs a candidate and a meet() baseline over ≥ 1 orientation');
  const out = [];
  if (candidate.valid && !baseline.valid) out.push({ kind: 'invalid-to-valid' });
  for (const [fam, it] of candidate.items) {
    const b = baseline.items.get(fam);
    if (!b) {
      out.push({ kind: 'claim-presence-upgrade', family: fam, to: it.tier });
      if (baseline.conflictFamilies?.has(fam)) out.push({ kind: 'conflict-abstention-to-claim', family: fam });
      continue;
    }
    if (RANK[it.tier] > RANK[b.tier]) out.push({ kind: 'confidence-upgrade', family: fam, from: b.tier, to: it.tier });
    const extra = it.rules.filter((x) => !b.rules.includes(x));
    if (extra.length) out.push({ kind: 'additional-interpretation', family: fam, rules: extra });
  }
  return out;
}

/** All 2^k orientation variants of an input (k = creases with an array of ≥ 2 points; capped at 2^maxBits). */
export function orientations(input, maxBits = 7) {
  const idx = (input?.creases?.items || []).map((c, i) => (Array.isArray(c?.geometry?.points) && c.geometry.points.length >= 2 ? i : -1)).filter((i) => i >= 0).slice(0, maxBits);
  const out = [];
  for (let m = 0; m < 1 << idx.length; m++) {
    const g = JSON.parse(JSON.stringify(input));
    idx.forEach((ci, b) => { if (m & (1 << b)) g.creases.items[ci].geometry.points.reverse(); });
    out.push({ mask: m, input: g });
  }
  return out;
}

/** Reading minus the two fields that fingerprint the input AS SUPPLIED (RV-15; documented exclusion). */
export const orderFree = (r) => JSON.stringify({ ...r, readingId: undefined, inputSha256: undefined });

/**
 * Oracle self-test: synthetic summary pairs that MUST be flagged (and one that must not). Returns failures; the
 * differential and the tests both refuse to proceed if any case is mis-classified (guards against a weakened oracle).
 */
export function oracleSelfTest() {
  const S = (valid, items = {}, declined = {}) => ({ valid, items: new Map(Object.entries(items)), declined: new Map(Object.entries(declined)) });
  const cases = [
    { name: 'no claim → tentative', base: [S(true), S(true)], cand: S(true, { F: { tier: 'tentative', rules: ['A'] } }), want: ['claim-presence-upgrade'] },
    { name: 'no claim → clear', base: [S(true)], cand: S(true, { F: { tier: 'clear', rules: ['A'] } }), want: ['claim-presence-upgrade'] },
    { name: 'tentative → clear', base: [S(true, { F: { tier: 'tentative', rules: ['A'] } })], cand: S(true, { F: { tier: 'clear', rules: ['A'] } }), want: ['confidence-upgrade'] },
    { name: 'invalid → valid', base: [S(false), S(true)], cand: S(true), want: ['invalid-to-valid'] },
    { name: 'conflict abstention → claim', base: [S(true, {}, { F: 'conflict' }), S(true, { F: { tier: 'tentative', rules: ['A'] } })], cand: S(true, { F: { tier: 'tentative', rules: ['A'] } }), want: ['claim-presence-upgrade', 'conflict-abstention-to-claim'] },
    { name: 'additional interpretation', base: [S(true, { F: { tier: 'tentative', rules: ['A'] } })], cand: S(true, { F: { tier: 'tentative', rules: ['A', 'B'] } }), want: ['additional-interpretation'] },
    { name: 'orientations disagree: meet, not the convenient one', base: [S(true, { F: { tier: 'clear', rules: ['A'] } }), S(true, { F: { tier: 'tentative', rules: ['A'] } })], cand: S(true, { F: { tier: 'clear', rules: ['A'] } }), want: ['confidence-upgrade'] },
    // R1.4 (R1.3-RV-03): orientations disagree on RULE SETS — the meet must intersect, not unite.
    { name: 'orientations disagree on rule sets: no common rule → no claim', base: [S(true, { F: { tier: 'tentative', rules: ['A'] } }), S(true, { F: { tier: 'tentative', rules: ['B'] } })], cand: S(true, { F: { tier: 'tentative', rules: ['A'] } }), want: ['claim-presence-upgrade'] },
    { name: 'orientations disagree on rule sets: union of rules not supported', base: [S(true, { F: { tier: 'tentative', rules: ['A', 'B'] } }), S(true, { F: { tier: 'tentative', rules: ['A'] } })], cand: S(true, { F: { tier: 'tentative', rules: ['A', 'B'] } }), want: ['additional-interpretation'] },
    { name: 'compliant decrease', base: [S(true, { F: { tier: 'clear', rules: ['A'] } })], cand: S(true, { F: { tier: 'tentative', rules: ['A'] } }), want: [] },
    { name: 'compliant abstention', base: [S(true, { F: { tier: 'clear', rules: ['A'] } })], cand: S(true), want: [] },
  ];
  const failures = [];
  for (const c of cases) {
    const got = violations(c.cand, meet(c.base)).map((v) => v.kind).sort();
    if (JSON.stringify(got) !== JSON.stringify([...c.want].sort())) failures.push({ name: c.name, want: c.want, got });
  }
  // R1.5 (R1.4-RV-03): the cases above build summaries by hand, so a weakened summarize() (ignore confidence, ignore
  // validity, collapse rules, drop declines) passed the self-test. These cases pass LITERAL reading objects (the engine's
  // reading shape, written out here — no engine code is called) through summarize() and compare with an expected
  // summary and expected violation kinds that are written out independently.
  const item = (familyId, tier, rules) => ({ kind: 'interpreted', familyId, tier, interpretations: rules.map((ruleId) => ({ ruleId })) });
  const R = (sections) => ({ status: 'interpreted', sections: sections.map(([items, declined = []]) => ({ items, declined: declined.map(([familyId, reason]) => ({ familyId, reason })), quiet: [] })) });
  const INVALID = { status: 'invalid-input', errors: [{ path: '$', code: 'x' }] };
  const ser = (sm) => JSON.stringify({ valid: sm.valid, items: [...sm.items].sort(), declined: [...sm.declined].sort() });
  const summaryCases = [
    { name: 'summarize: tiers, rule sets (sorted) and declines are read from every section',
      reading: R([[[item('F', 'clear', ['B', 'A'])], [['H', 'conflict']]], [[item('G', 'tentative', ['C'])], [['K', 'insufficient-evidence']]]]),
      want: { valid: true, items: [['F', { tier: 'clear', rules: ['A', 'B'] }], ['G', { tier: 'tentative', rules: ['C'] }]], declined: [['H', 'conflict'], ['K', 'insufficient-evidence']] } },
    { name: 'summarize: an invalid-input reading is invalid with no claims', reading: INVALID, want: { valid: false, items: [], declined: [] } },
  ];
  for (const c of summaryCases) {
    const got = ser(summarize(c.reading)), want = JSON.stringify(c.want);
    if (got !== want) failures.push({ name: c.name, want: c.want, got: JSON.parse(got) });
  }
  const readingCases = [
    { name: 'readings: tentative baseline, clear candidate → confidence-upgrade', base: [R([[[item('F', 'tentative', ['A'])]]])], cand: R([[[item('F', 'clear', ['A'])]]]), want: ['confidence-upgrade'] },
    { name: 'readings: one orientation invalid, candidate valid → invalid-to-valid', base: [INVALID, R([[[]]])], cand: R([[[]]]), want: ['invalid-to-valid'] },
    { name: 'readings: candidate adds a rule → additional-interpretation', base: [R([[[item('F', 'tentative', ['A'])]]])], cand: R([[[item('F', 'tentative', ['A', 'B'])]]]), want: ['additional-interpretation'] },
    { name: 'readings: conflict decline in one orientation, claim in candidate → presence + conflict-abstention', base: [R([[[], [['F', 'conflict']]]]), R([[[item('F', 'tentative', ['A'])]]])], cand: R([[[item('F', 'tentative', ['A'])]]]), want: ['claim-presence-upgrade', 'conflict-abstention-to-claim'] },
    { name: 'readings: compliant (lower tier, subset of rules)', base: [R([[[item('F', 'clear', ['A', 'B'])]]])], cand: R([[[item('F', 'tentative', ['A'])]]]), want: [] },
  ];
  for (const c of readingCases) {
    const got = violations(summarize(c.cand), meet(c.base.map(summarize))).map((v) => v.kind).sort();
    if (JSON.stringify(got) !== JSON.stringify([...c.want].sort())) failures.push({ name: c.name, want: c.want, got });
  }
  // R2-F1: malformed readings must be rejected (fail closed), not summarized
  const malformed = [
    ['unknown tier', R([[[item('F', 'definite', ['A'])]]])],
    ['duplicate family in one section', R([[[item('F', 'clear', ['A']), item('F', 'tentative', ['A'])]]])],
    ['duplicate family across sections', R([[[item('F', 'clear', ['A'])]], [[item('F', 'tentative', ['A'])]]])],
    ['duplicate rule within a claim', R([[[item('F', 'tentative', ['A', 'A'])]]])],
  ];
  for (const [name, reading] of malformed) { let threw = false; try { summarize(reading); } catch { threw = true; } if (!threw) failures.push({ name: `summarize must reject: ${name}` }); }
  return failures;
}
