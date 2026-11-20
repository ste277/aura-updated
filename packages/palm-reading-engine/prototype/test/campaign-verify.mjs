// AURA-PALM-G6-D0-R1.5 — coverage-contract evidence verification (harness-owned; NOT part of the interpretation engine).
//
// R1.4-RV-01 / R1.4-RV-02: the R1.4 contract (coverage.mjs checkContract) checked only the totals a report stated
// about itself. R1.5 makes the contract's authority RE-EXECUTION, not self-report:
//   1. regenerateCampaign  rebuilds every case from the CONTRACT's seed (random campaigns) or the CONTRACT's fixture
//                          set, in order, with the shared generator (test/campaign-core.mjs), and requires the evidence
//                          records to be exactly the canonical-distinct cases of that sequence (ids, generation
//                          indices, canonical and raw keys, orientation masks), with the generator-level counts and the
//                          stop rule (target reached on the last record) re-derived from the regeneration.
//   2. reverifyCampaign    re-evaluates every regenerated case with BOTH frozen engines and an INDEPENDENT oracle
//                          (test/independent-oracle.mjs, no shared code with test/oracle.mjs) and requires every record
//                          field (validity, reading digests, reversal invariance, upgrade kinds, R1.1 disagreement,
//                          tie categories, central conflict, tags) to equal the re-derived value.
//   3. checkCampaignEvidence (pure) applies every rule below to the assembled evidence and returns named failures.
// Self-reported fields (pass, checks, counts, upgrades, provenance, attestation) are still REQUIRED to be present and
// consistent — a failing or inconsistent report is rejected even if its records are genuine — but no such field is
// ever sufficient on its own: every count used for a floor is the count derived from re-verified records.
import { UPGRADE_KINDS, TIE_FIELDS, RECORD_SCHEMA, randomCaseStream, fixtureCaseStream, expectedVariantSet, readingDigest, sha256, countsFromRecords, caseSetDigest } from './campaign-core.mjs';
import { independentUpgradeKinds, independentReversalInvariant, independentSummaries } from './independent-oracle.mjs';
import { checkContract } from './coverage.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Regenerate a campaign's case sequence and compare it with its records. `req` is the contract entry (its seed/target
 * are authoritative), `ctx` = { F, FIX, C, protoDir }. Calls `onCase(entry, record)` for every matched compared case
 * (used by reverifyCampaign). Returns { generated, rawDistinct, rawDuplicates, reversalMerged, mismatch, stopRule,
 * variantFailures }. Fails closed: the first sequence mismatch ends the comparison.
 */
export function regenerateCampaign(req, records, ctx, onCase) {
  const out = { generated: 0, rawDistinct: 0, rawDuplicates: 0, reversalMerged: 0, mismatch: null, stopRule: null, variantFailures: 0, matched: 0 };
  const random = req.kind === 'random';
  const stream = random ? randomCaseStream(req.seed, ctx) : fixtureCaseStream(req.id, ctx.protoDir, ctx);
  let j = 0, eligible = 0;
  const cap = random ? req.target * 6 : Infinity;
  while (true) {
    if (random && (eligible >= req.target || out.generated >= cap)) break;
    const step = stream.next(); if (step.done) break;
    const c = step.value; out.generated++;
    if (c.rawNew) out.rawDistinct++; else out.rawDuplicates++;
    if (c.duplicate) { if (c.rawNew) out.reversalMerged++; continue; }
    const r = records[j];
    if (!r) { out.mismatch = { j, problem: `regenerated case ${c.id} has no record (records end early)` }; break; }
    const want = { j, n: c.n, id: c.id, key: c.key, raw: c.raw, variants: c.vars.length, masks: c.vars.map((v) => v.mask), tags: c.tags };
    const have = { j: r.j, n: r.n, id: r.id, key: r.key, raw: r.raw, variants: r.variants, masks: r.masks, tags: r.tags };
    if (!same(want, have)) { out.mismatch = { j, problem: 'record does not match the regenerated case', want, have }; break; }
    const exp = expectedVariantSet(c.input, random);
    const got = new Set(c.vars.map((v) => JSON.stringify(v.input)));
    if (exp.exact ? got.size !== exp.keys.size || [...exp.keys].some((x) => !got.has(x)) : [...exp.keys].some((x) => !got.has(x))) out.variantFailures++;
    if (onCase) onCase(c, r);
    if (r.valid) eligible++;
    j++; out.matched++;
  }
  if (!out.mismatch && j < records.length) out.mismatch = { j, problem: `${records.length - j} record(s) beyond the regenerated sequence (duplicated, fabricated or from another seed)` };
  if (random) out.stopRule = { eligibleAtStop: eligible, target: req.target, ok: !out.mismatch && eligible === req.target && records.length > 0 && records.at(-1).valid === true };
  else out.stopRule = { ok: !out.mismatch && j > 0 && out.generated === ctx.fixtureCount };
  return out;
}

/** Re-evaluate one regenerated case with both frozen engines + the independent oracle; return the mismatching fields. */
export function reverifyCase(c, r, { E11, EC, G, C }) {
  const rc = c.vars.map(({ input }) => EC.generateReading(input));
  const r11 = c.vars.map(({ input }) => E11.generateReading(input));
  const sums = independentSummaries(r11);
  const t = C.classifyTies(c.input, rc[0], G.describe, sums);
  const want = {
    schema: RECORD_SCHEMA, valid: rc[0].status !== 'invalid-input', r13: readingDigest(rc[0]), r11: sha256(JSON.stringify(r11.map(readingDigest))),
    r13all: independentReversalInvariant(rc), upgrades: independentUpgradeKinds(rc[0], r11), r11Disagree: C.r11OrientationsDisagree(sums),
    ties: Object.fromEntries(TIE_FIELDS.map((f) => [f, !!t[f]])),
    centralConflict: rc[0].observations?.find((o) => o.crease === 'CENTRAL_LONGITUDINAL')?.status === 'conflict',
  };
  const bad = Object.keys(want).filter((k) => !same(want[k], r[k]));
  // R1.5 (review F1): fixture files record R1.1's summary per orientation; re-derive the recorded-vs-live comparison
  if (c.fixture?.r11) {
    const ser = (s) => JSON.stringify({ valid: s.valid, items: [...s.items].sort(), declined: [...s.declined].sort() });
    for (const o of c.fixture.r11) {
      const i = c.vars.findIndex((v) => v.mask === o.mask);
      const rec = { valid: o.summary.valid, items: new Map(o.summary.items.map(([f, x]) => [f, { tier: x.tier, rules: [...x.rules].sort() }])), declined: new Map(o.summary.declined) };
      if (i < 0 || ser(sums[i]) !== ser(rec)) { bad.push('recordedR11'); break; }
    }
  }
  return { bad, want, evaluations: rc.length + r11.length };
}

/** Regenerate AND re-evaluate every record. Returns { regen, reverify: { mode:'all', checked, evaluations, mismatches[] } }. */
export function verifyCampaign(req, records, ctx, engines, mode = 'all') {
  const reverify = { mode, checked: 0, evaluations: 0, mismatches: [] };
  const regen = regenerateCampaign(req, records, ctx, mode === 'all' ? (c, r) => {
    const v = reverifyCase(c, r, { ...engines, C: ctx.C }); reverify.checked++; reverify.evaluations += v.evaluations;
    if (v.bad.length && reverify.mismatches.length < 20) reverify.mismatches.push({ j: r.j, id: r.id, fields: v.bad });
    else if (v.bad.length) reverify.mismatches.push({ j: r.j, fields: v.bad });
  } : null);
  return { regen, reverify };
}

const DERIVED_KEYS = ['comparedCases', 'canonicalDistinct', 'invalidCases', 'eligibleCanonicalDistinct', 'orientationVariants', 'orientationComparisons', 'observedTies', 'reconciledInTraceTies',
  'outcomeRelevantTies', 'abstentionTies', 'tierLoweredTies', 'candidateRankTies', 'outcomeUnchangedTies', 'harmlessTies', 'noopChangedTies', 'outcomeRelevantNotObserved', 'r11DisagreementCases',
  'competingConflicts', 'validityBoundaryInvalid', 'reversalMismatches'];
const RANDOM_DERIVED_KEYS = ['constructedTieCases', 'competingCases', 'validityBoundaryCases', 'errorTruncationCases'];
const GEN_KEYS = ['generated', 'rawDistinct', 'rawDuplicates', 'reversalMerged'];

/**
 * Pure rule evaluation. `ev` = { loadErrors[], reports: { id: entry } } where each entry is
 *   { files: { report, records, attestation }, report, reportError, attestation, attestationError, records, recordsError,
 *     actual: { reportSha256, recordsSha256, stderrSha256 }, provenanceActual, expectedIdentity, verification }
 * Returns { pass, failures: [{ campaign, check, detail }] }.
 */
export function checkCampaignEvidence(contract, ev) {
  const failures = []; const fail = (campaign, check, detail) => failures.push({ campaign, check, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
  for (const e of ev.loadErrors || []) fail(e.campaign || '(set)', e.check || 'load', e.problem);
  const derivedReports = {};
  for (const req of contract.campaigns) {
    const e = ev.reports?.[req.id];
    if (!e) { fail(req.id, 'campaign-present', 'no report for this campaign'); continue; }
    // ---- report file ----
    if (e.reportError || !e.report) { fail(req.id, 'report-parse', e.reportError || 'report missing or unreadable (truncated output?)'); continue; }
    const r = e.report;
    // ---- exit-status evidence (attestation written by baseline/run-campaign.mjs) ----
    if (!e.attestation) fail(req.id, 'attestation-present', e.attestationError || 'no exit-status attestation');
    else {
      const a = e.attestation;
      if (a.exitCode !== 0 || a.signal != null) fail(req.id, 'exit-status', `exit ${a.exitCode}, signal ${a.signal}`);
      if (a.campaign !== req.id) fail(req.id, 'attestation-campaign', String(a.campaign));
      if (a.reportSha256 !== e.actual?.reportSha256) fail(req.id, 'attestation-report-hash', 'report file differs from the attested output');
      if (a.recordsSha256 !== e.actual?.recordsSha256) fail(req.id, 'attestation-records-hash', 'records file differs from the attested output');
      if (a.stderrSha256 !== e.actual?.stderrSha256) fail(req.id, 'attestation-stderr-hash', 'stderr log differs from the attested output');
      if (req.kind === 'random' && !(Array.isArray(a.argv) && a.argv[3] === String(req.seed))) fail(req.id, 'attestation-seed', `attested command ${JSON.stringify(a.argv)} does not run seed ${req.seed}`);
    }
    // ---- identity / verdict self-consistency (required, never sufficient) ----
    if (r.campaign !== req.id) fail(req.id, 'campaign-id', `report says ${r.campaign}`);
    if (r.generator !== req.generator) fail(req.id, 'generator', String(r.generator));
    if (req.kind === 'random') {
      if (r.seed !== req.seed) fail(req.id, 'seed-binding', `report seed ${r.seed}, contract seed ${req.seed}`);
      if (r.target !== req.target) fail(req.id, 'target-binding', `report target ${r.target}, contract target ${req.target}`);
    }
    if (contract.official && r.quick !== false) fail(req.id, 'not-quick', 'quick (non-official) report');
    if (r.pass !== true) fail(req.id, 'report-pass', 'the campaign reported failure');
    if (r.completed !== true) fail(req.id, 'report-completed', 'the campaign reported that it did not complete');
    const checks = r.checks && typeof r.checks === 'object' ? Object.entries(r.checks) : [];
    if (!checks.length) fail(req.id, 'report-checks', 'no checks recorded');
    for (const [k, ok] of checks) if (ok !== true) fail(req.id, 'report-checks', `check ${k} is ${ok}`);
    for (const k of req.requiredChecks || []) if (r.checks?.[k] !== true) fail(req.id, 'report-checks', `required check ${k} missing or false`);
    if (!Array.isArray(r.oracleSelfTestFailures) || r.oracleSelfTestFailures.length) fail(req.id, 'oracle-self-test', r.oracleSelfTestFailures === undefined ? 'missing' : JSON.stringify(r.oracleSelfTestFailures));
    // ---- provenance: recorded == expected identity == actual files ----
    for (const part of ['candidateEngine', 'baselineEngine', 'harness', 'fixtures']) {
      const rec = r.provenance?.[part], exp = e.expectedIdentity?.[part], act = e.provenanceActual?.[part];
      if (!rec || !same(rec, exp)) fail(req.id, part === 'harness' ? 'harness-identity' : `${part}-identity`, 'recorded provenance differs from the expected identity');
      if (!act || !same(act, exp)) fail(req.id, part === 'harness' ? 'harness-identity' : `${part}-identity`, 'files under verification differ from the expected identity');
    }
    // ---- records ----
    const recs = e.records;
    if (!recs) { fail(req.id, 'records-present', e.recordsError || 'no evidence records'); continue; }
    if (r.records?.sha256 !== e.actual?.recordsSha256) fail(req.id, 'records-hash', 'records file differs from the hash in the report');
    if (r.records?.count !== recs.length) fail(req.id, 'records-count', `report ${r.records?.count}, file ${recs.length}`);
    if (recs.some((x, i) => x?.schema !== RECORD_SCHEMA || x.j !== i)) fail(req.id, 'records-schema', 'record schema or index sequence broken');
    if (new Set(recs.map((x) => x.key)).size !== recs.length) fail(req.id, 'records-unique', 'duplicate canonical keys among records');
    if (recs.some((x) => !Array.isArray(x.upgrades) || typeof x.ties !== 'object' || TIE_FIELDS.some((f) => typeof x.ties?.[f] !== 'boolean'))) fail(req.id, 'records-schema', 'record without upgrade or tie fields');
    const d = countsFromRecords(recs);
    if (r.records?.caseSetDigest !== caseSetDigest(recs)) fail(req.id, 'records-digest', 'case-set digest does not match records');
    // self-reported counts must equal record-derived counts
    for (const k of [...DERIVED_KEYS, ...(req.kind === 'random' ? RANDOM_DERIVED_KEYS : [])]) if (r.counts?.[k] !== d.counts[k]) fail(req.id, 'counts-match-records', `${k}: report ${r.counts?.[k]}, records ${d.counts[k]}`);
    for (const k of UPGRADE_KINDS) if (r.upgrades?.[k] !== d.upgrades[k]) fail(req.id, 'counts-match-records', `upgrades.${k}: report ${r.upgrades?.[k]}, records ${d.upgrades[k]}`);
    if (r.reversalMismatches !== d.counts.reversalMismatches) fail(req.id, 'counts-match-records', 'reversalMismatches');
    // tie partition (R1.4-RV-04)
    const k = d.counts;
    // R1.5 (review F1): tie consistency is required from the records, never from the report's own check
    if (k.noopChangedTies !== 0) fail(req.id, 'tie-consistency', `${k.noopChangedTies} reconciliations changed an outcome on which every R1.1 orientation agrees`);
    if (r.tieConsistencyFailures !== k.noopChangedTies) fail(req.id, 'tie-consistency', `report ${r.tieConsistencyFailures}, records ${k.noopChangedTies}`);
    if (req.kind === 'fixture' && r.counts?.recordedR11Mismatches !== 0) fail(req.id, 'recorded-r11', `report says ${r.counts?.recordedR11Mismatches}`);
    if (k.outcomeRelevantNotObserved !== 0) fail(req.id, 'tie-partition', `${k.outcomeRelevantNotObserved} outcome-relevant ties without an observed tie`);
    if (k.observedTies !== k.outcomeRelevantTies + k.harmlessTies) fail(req.id, 'tie-partition', 'observed ≠ outcome-relevant + harmless');
    if (k.abstentionTies > k.outcomeRelevantTies || k.tierLoweredTies > k.outcomeRelevantTies) fail(req.id, 'tie-partition', 'abstention / tier-lowered not a subset of outcome-relevant');
    if (k.outcomeUnchangedTies > k.reconciledInTraceTies) fail(req.id, 'tie-partition', 'outcome-unchanged exceeds reconciled');
    if (recs.some((x) => x.ties.harmless && x.ties.outcomeRelevant)) fail(req.id, 'tie-partition', 'a case is both harmless and outcome-relevant');
    if (recs.some((x) => x.ties.outcomeRelevant && x.variants < 2)) fail(req.id, 'tie-point-order', 'an outcome-relevant tie without a point-order comparison');
    // ---- regeneration (seed / fixture identity, distinctness, completeness) ----
    const v = e.verification;
    if (!v) { fail(req.id, 'seed-regeneration', 'no regeneration performed'); continue; }
    if (v.regen.mismatch) fail(req.id, 'seed-regeneration', v.regen.mismatch);
    for (const g of GEN_KEYS) if (r.counts?.[g] !== v.regen[g]) fail(req.id, 'generator-counts', `${g}: report ${r.counts?.[g]}, regenerated ${v.regen[g]}`);
    if (!v.regen.stopRule?.ok) fail(req.id, 'stop-rule', v.regen.stopRule);
    if (v.regen.variantFailures !== 0) fail(req.id, 'variant-coverage', `${v.regen.variantFailures} cases without the expected orientation variants`);
    // ---- re-evaluation ----
    if (contract.requireReverify === 'all' && (v.reverify.mode !== 'all' || v.reverify.checked !== recs.length)) fail(req.id, 'reverify-required', `mode ${v.reverify.mode}, checked ${v.reverify.checked}/${recs.length}`);
    if (v.reverify.mismatches.some((m) => m.fields?.includes('recordedR11'))) fail(req.id, 'recorded-r11', 'recorded R1.1 readings in the fixture file differ from live R1.1');
    if (v.reverify.mismatches.length) fail(req.id, 'record-reverify', `${v.reverify.mismatches.length} record(s) differ from re-evaluation, e.g. ${JSON.stringify(v.reverify.mismatches[0])}`);
    // ---- floors on DERIVED evidence (legacy checkContract rules applied to a report rebuilt from evidence) ----
    derivedReports[req.id] = { campaign: req.id, generator: r.generator, completed: !!v.regen.stopRule?.ok,
      counts: { ...d.counts, generated: v.regen.generated, rawDistinct: v.regen.rawDistinct, rawDuplicates: v.regen.rawDuplicates, reversalMerged: v.regen.reversalMerged,
        variantCoverageFailures: v.regen.variantFailures, r11Evaluations: d.counts.orientationVariants, r13Evaluations: d.counts.orientationVariants, ...(req.kind === 'random' ? {} : { constructedTieCases: 0 }) },
      reversalMismatches: d.counts.reversalMismatches, upgrades: d.upgrades, oracleSelfTestFailures: Array.isArray(r.oracleSelfTestFailures) ? r.oracleSelfTestFailures : ['missing'] };
  }
  // R1.5 (review F1): both oracles' self-tests are RE-RUN by the checker (from its own package); a report's
  // oracleSelfTestFailures field is still required to be present and empty, but is never sufficient.
  if (!ev.selfTests) fail('(checker)', 'self-test-rerun', 'the checker did not re-run the oracle self-tests');
  else {
    if (!Array.isArray(ev.selfTests.oracle) || ev.selfTests.oracle.length) fail('(checker)', 'oracle-self-test-rerun', JSON.stringify(ev.selfTests.oracle));
    if (!Array.isArray(ev.selfTests.independent) || ev.selfTests.independent.length) fail('(checker)', 'independent-oracle-self-test', JSON.stringify(ev.selfTests.independent));
  }
  const legacy = checkContract({ campaigns: contract.campaigns.filter((c) => derivedReports[c.id]) }, derivedReports);
  for (const f of legacy.failures) fail(f.campaign, f.check, f.detail);
  // ---- set-level identity ----
  for (const id of Object.keys(ev.reports || {})) if (!contract.campaigns.some((c) => c.id === id)) fail(id, 'unexpected-campaign', 'not in contract');
  const seeds = contract.campaigns.filter((c) => c.kind === 'random').map((c) => c.seed);
  if (new Set(seeds).size !== seeds.length) fail('(contract)', 'distinct-seeds', `contract seeds ${seeds}`);
  const reported = Object.values(ev.reports || {}).filter((e) => e.report && e.report.seed != null).map((e) => e.report.seed);
  if (new Set(reported).size !== reported.length) fail('(set)', 'distinct-seeds', `reported seeds ${reported}`);
  const digests = Object.entries(ev.reports || {}).filter(([, e]) => e.records?.length).map(([id, e]) => [id, caseSetDigest(e.records)]);
  for (let i = 0; i < digests.length; i++) for (let j = i + 1; j < digests.length; j++) if (digests[i][1] === digests[j][1]) fail(`${digests[i][0]}+${digests[j][0]}`, 'distinct-case-sets', 'two campaigns contain the identical case set');
  return { pass: failures.length === 0, failures };
}
