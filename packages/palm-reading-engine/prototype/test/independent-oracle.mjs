// AURA-PALM-G6-D0-R1.5 — independent no-upgrade / reversal re-check used by the coverage-contract verifier.
// Harness-owned; NOT part of the interpretation engine; deliberately shares NO code with test/oracle.mjs, so a weakened
// oracle (or a forged evidence record) cannot make the contract's re-evaluation agree with it.
//
// Formulation (pairwise, no meet object is built): the candidate reading C must not exceed the R1.1 reading of ANY
// orientation variant. For each family F that C claims:
//   claim-presence-upgrade       some orientation has no claim for F, or the orientations share no rule for F
//   conflict-abstention-to-claim (in addition) some orientation declined F for 'conflict'
//   confidence-upgrade           C's tier for F is above some orientation's tier
//   additional-interpretation    C has a rule for F that is not common to every orientation
// invalid-to-valid               C is valid while some orientation is invalid
// Kinds are reported as a sorted set, matching the evidence-record convention.
const TIER = { tentative: 1, clear: 2 };

function view(reading) {
  if (!reading || reading.status === 'invalid-input') return { valid: false, claims: {}, conflict: {}, declined: {} };
  const claims = {}, conflict = {}, declined = {};
  for (const section of reading.sections || []) {
    for (const item of section.items || []) {
      // R2-F1 (independently coded): fail closed on an unknown tier or a duplicate claim instead of ignoring/overwriting it
      if (!(item.tier in TIER) || !Object.prototype.hasOwnProperty.call(TIER, item.tier)) throw new Error(`independent-oracle: malformed reading: tier ${JSON.stringify(item.tier)} is not one of ${Object.keys(TIER).join('/')} (${item.familyId})`);
      if (Object.prototype.hasOwnProperty.call(claims, item.familyId)) throw new Error(`independent-oracle: malformed reading: family ${item.familyId} is claimed more than once`);
      const rules = (item.interpretations || []).map((i) => i.ruleId);
      if (rules.some((x, k) => rules.indexOf(x) !== k)) throw new Error(`independent-oracle: malformed reading: rule repeated within family ${item.familyId}`);
      claims[item.familyId] = { tier: item.tier, rules };
    }
    for (const d of section.declined || []) { declined[d.familyId] = d.reason; if (d.reason === 'conflict') conflict[d.familyId] = true; }
  }
  return { valid: true, claims, conflict, declined };
}

/** Upgrade kinds of `candidate` against the R1.1 readings of every orientation (`baselines`, ≥ 1 required). */
export function independentUpgradeKinds(candidate, baselines) {
  if (!Array.isArray(baselines) || baselines.length === 0) throw new Error('independent-oracle: at least one baseline orientation is required');
  const c = view(candidate), bs = baselines.map(view);
  const kinds = new Set();
  if (c.valid && bs.some((b) => !b.valid)) kinds.add('invalid-to-valid');
  if (c.valid && bs.every((b) => b.valid)) {
    for (const [fam, claim] of Object.entries(c.claims)) {
      const present = bs.every((b) => b.claims[fam]);
      let common = present ? new Set(bs[0].claims[fam].rules) : new Set();
      if (present) for (const b of bs.slice(1)) common = new Set([...common].filter((r) => b.claims[fam].rules.includes(r)));
      if (!present || common.size === 0) {
        kinds.add('claim-presence-upgrade');
        if (bs.some((b) => b.conflict[fam])) kinds.add('conflict-abstention-to-claim');
        continue;
      }
      if (bs.some((b) => TIER[claim.tier] > TIER[b.claims[fam].tier])) kinds.add('confidence-upgrade');
      if (claim.rules.some((r) => !common.has(r))) kinds.add('additional-interpretation');
    }
  } else if (c.valid) {
    // some orientation is invalid: any claim is also a presence upgrade relative to that orientation
    for (const fam of Object.keys(c.claims)) { kinds.add('claim-presence-upgrade'); if (bs.some((b) => b.conflict[fam])) kinds.add('conflict-abstention-to-claim'); }
  }
  return [...kinds].sort();
}

/** True when every reading is identical apart from the two as-supplied fingerprint fields. */
export function independentReversalInvariant(readings) {
  const strip = (r) => JSON.stringify(r, (k, v) => (k === 'readingId' || k === 'inputSha256' ? undefined : v));
  const first = strip(readings[0]);
  return readings.every((r) => strip(r) === first);
}

/** Summaries in the shape classifyTies expects (items Map of {tier, rules}); computed here, not by oracle.summarize. */
export function independentSummaries(readings) {
  return readings.map((r) => { const v = view(r); return { valid: v.valid, items: new Map(Object.entries(v.claims).map(([f, x]) => [f, { tier: x.tier, rules: [...x.rules].sort() }])), declined: new Map(Object.entries(v.declined)) }; });
}

/**
 * R1.5 (review F1): self-test of the independent re-check on LITERAL readings with independently written expected
 * kinds. The contract checker runs it itself (it never trusts a report's self-test field). Returns failures.
 */
export function independentSelfTest() {
  const item = (familyId, tier, rules) => ({ familyId, tier, interpretations: rules.map((ruleId) => ({ ruleId })) });
  const R = (items, declined = []) => ({ status: 'interpreted', sections: [{ items, declined: declined.map(([familyId, reason]) => ({ familyId, reason })) }] });
  const INVALID = { status: 'invalid-input' };
  const cases = [
    { name: 'tentative → clear', base: [R([item('F', 'tentative', ['A'])])], cand: R([item('F', 'clear', ['A'])]), want: ['confidence-upgrade'] },
    { name: 'one orientation invalid', base: [INVALID, R([])], cand: R([]), want: ['invalid-to-valid'] },
    { name: 'claim absent in one orientation', base: [R([]), R([item('F', 'tentative', ['A'])])], cand: R([item('F', 'tentative', ['A'])]), want: ['claim-presence-upgrade'] },
    { name: 'no common rule', base: [R([item('F', 'tentative', ['A'])]), R([item('F', 'tentative', ['B'])])], cand: R([item('F', 'tentative', ['A'])]), want: ['claim-presence-upgrade'] },
    { name: 'rule not common', base: [R([item('F', 'tentative', ['A', 'B'])]), R([item('F', 'tentative', ['A'])])], cand: R([item('F', 'tentative', ['A', 'B'])]), want: ['additional-interpretation'] },
    { name: 'conflict decline', base: [R([], [['F', 'conflict']]), R([item('F', 'tentative', ['A'])])], cand: R([item('F', 'tentative', ['A'])]), want: ['claim-presence-upgrade', 'conflict-abstention-to-claim'] },
    { name: 'compliant', base: [R([item('F', 'clear', ['A', 'B'])])], cand: R([item('F', 'tentative', ['A'])]), want: [] },
  ];
  const failures = [];
  for (const c of cases) { const got = independentUpgradeKinds(c.cand, c.base); if (JSON.stringify(got) !== JSON.stringify([...c.want].sort())) failures.push({ name: c.name, want: c.want, got }); }
  if (independentReversalInvariant([R([item('F', 'clear', ['A'])]), R([item('F', 'tentative', ['A'])])])) failures.push({ name: 'reversal check must see differing readings' });
  if (!independentReversalInvariant([{ ...R([]), readingId: 'x', inputSha256: 'y' }, { ...R([]), readingId: 'z', inputSha256: 'w' }])) failures.push({ name: 'reversal check must ignore the fingerprint fields' });
  // R2-F1: malformed readings must be rejected (fail closed), as candidate or as baseline
  const ok = R([item('F', 'tentative', ['A'])]);
  for (const [name, bad] of [['unknown tier', R([item('F', 'definite', ['A'])])], ['duplicate family', R([item('F', 'clear', ['A']), item('F', 'tentative', ['A'])])],
    ['duplicate family across sections', { status: 'interpreted', sections: [{ items: [item('F', 'clear', ['A'])], declined: [] }, { items: [item('F', 'tentative', ['A'])], declined: [] }] }], ['duplicate rule', R([item('F', 'tentative', ['A', 'A'])])]]) {
    for (const [role, run] of [['candidate', () => independentUpgradeKinds(bad, [ok])], ['baseline', () => independentUpgradeKinds(ok, [bad])]]) { let threw = false; try { run(); } catch { threw = true; } if (!threw) failures.push({ name: `must reject ${name} (${role})` }); }
  }
  return failures;
}
