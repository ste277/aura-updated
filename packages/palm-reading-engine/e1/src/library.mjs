// AURA-PALM-03-E1 -- interpretation library loader and validation (capability E1-E1).
// 1. The C1 schema may use only keywords this package's validator implements (schema-validate.mjs).
// 2. The catalogue must validate against that schema.
// 3. The catalogue must pass the C1 content policy (a line-by-line port of the C1 reference checker
//    reference/check_catalogue.py; the test suite proves both reject the same 25 catalogue mutations).
// 4. E1 runtime requirements: library/feature-set versions match this engine; every eligible-initial record needs only
//    capabilities this milestone implements.
// All 29 records are preserved (sources, tradition, suitability, provenance requirements, unreviewed status). Only
// eligible-initial records are ever candidates for a reading; research eligibility is NOT publication approval and the
// loader refuses any record whose review status is not UNREVIEWED_RESEARCH_CONTENT.

import { assertSupportedSchema, validateAgainstSchema } from './schema-validate.mjs';
import { E1_ENGINE, E1Error, IMPLEMENTED_CAPABILITIES, RECORD_MANIFEST } from './identity.mjs';

const BANNED = /\b(die|dies|death|lifespan|life span|live long|long life|longevity|rich|wealth|money|marri|husband|wife|children|sons|daughter|fertil|caste|varṇa|varna|health|illness|disease|accident|misfortune|guarantee|will become|you will|destined|fate)\w*/gi;
const FUT = /\b(you will|you'll|will (be|have|find|meet|become|get)|going to|your future|in the future|destined|fate)\b/i;
const DET = /detect|photo|camera|scanner/i;
const ATTRIB = /(tradition|text|treatise|palmist|Bṛhatsaṃhitā|Cheiro|guide)/i;
const WESTERN_TERMS = /\b(heart|head|life|fate) line\b|mount of/i;
const INDIAN_TERMS = /lekhā|rekhā|ūrdhva|Sarasvat/;
const CRIT = ['sourceFidelity', 'observationRequirements', 'culturalContext', 'relevanceToUser', 'harmfulAttributionRisk', 'constructiveReflection'];
const ELIG = ['eligible-initial', 'eligible-later', 'held', 'excluded-initial', 'historical-context-only'];
const REQUIRED_REASONS = ['user-skipped', 'user-cannot-see', 'not-traced', 'trace-unusable', 'frame-unavailable', 'quality-gated', 'boundary', 'mark-unknown', 'observed-absent', 'no-supported-content', 'not-read-in-this-version', 'detector-missing'];

const has = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const eqSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const userText = (e) => ['observation', 'reading', 'reflection'].map((k) => e.userFacing?.[k] ?? '').join(' ');
const emittable = (e) => !String(e.userFacing?.reading ?? '').startsWith('NOT FOR EMISSION');

/** C1 content policy. Mirrors reference/check_catalogue.py (rev. 4). Returns a list of failure strings. */
export function lintCatalogue(cat, schema) {
  const fails = [];
  const F = (m) => fails.push(m);
  const D = schema.$defs;
  for (const k of schema.required) if (!has(cat, k)) F(`top-level missing ${k}`);
  if (fails.length) return fails;
  if (cat.status !== 'UNREVIEWED_RESEARCH_CONTENT') F('status');
  if (cat.readingModes?.default !== 'combined') F('default reading mode must be combined (D1)');
  const comp = cat.readingModes?.composition ?? {};
  const so = comp.selectionOrder ?? [null];
  if (so[so.length - 1] !== 'tradition-preference' || !comp.noForcedTraditionSlots) F('tradition preference must be the last tie-breaker with no forced slots');
  if (cat.globalPolicy?.markPolicy !== 'unreported-is-unknown') F('markPolicy (D2)');
  const srcIds = new Set([...cat.sources.map((s) => s.id), 'WE-X (life line = lifespan)']);
  const trads = new Set(D.tradition.enum);
  for (const s of cat.sources) {
    for (const k of D.sourceRecord.required) if (!has(s, k)) F(`source ${s.id} missing ${k}`);
    if (!trads.has(s.tradition)) F(`source ${s.id} tradition`);
  }
  const ireq = D.interpretation.required;
  const iprops = new Set(Object.keys(D.interpretation.properties));
  const idpat = new RegExp(D.interpretation.properties.id.pattern, 'u');
  const fpat = new RegExp(D.featureRef.properties.feature.pattern, 'u');
  const cats = new Set(D.category.enum);
  const sup = new Set(D.supportLevel.enum);
  const prov = new Set(D.featureRef.properties.provenanceAllowed.items.enum);
  const proh = new Set(D.prohibitedClaim.enum);
  const handling = new Set(D.interpretation.properties.conflicts.items.properties.handling.enum);
  const seen = new Set();
  for (const e of cat.interpretations) {
    const i = e.id ?? '?';
    for (const k of ireq) if (!has(e, k)) F(`${i}: missing ${k}`);
    if (ireq.some((k) => !has(e, k))) continue;
    for (const k of Object.keys(e)) if (!iprops.has(k)) F(`${i}: unknown property ${k}`);
    if (!idpat.test(i)) F(`${i}: id pattern`);
    if (seen.has(i)) F(`${i}: duplicate`);
    seen.add(i);
    if (!trads.has(e.tradition)) F(`${i}: tradition`);
    if (e.tradition.startsWith('indian') !== i.startsWith('C1-IN')) F(`${i}: id/tradition mismatch`);
    for (const c of e.categories) if (!cats.has(c)) F(`${i}: category ${c}`);
    if (!sup.has(e.overallSupport)) F(`${i}: overallSupport`);
    for (const r of e.requires) {
      if (!fpat.test(r.feature)) F(`${i}: feature id ${r.feature}`);
      for (const p of r.provenanceAllowed) if (!prov.has(p)) F(`${i}: provenance ${p}`);
      if (r.provenanceAllowed.some((p) => ['user-confirmed', 'user-reported', 'user-self-assessed'].includes(p)) && e.observationQuality.maxTier !== 'tentative') F(`${i}: trace/report-based record not capped at tentative`);
    }
    if (e.observationQuality.maxTier !== 'tentative') F(`${i}: D3 ceiling is tentative for all records`);
    for (const s of e.sources) {
      if (!srcIds.has(s.sourceId)) F(`${i}: unknown source ${s.sourceId}`);
      if (!sup.has(s.supportLevel)) F(`${i}: source supportLevel`);
    }
    for (const c of e.conflicts ?? []) if (!handling.has(c.handling)) F(`${i}: conflict handling`);
    for (const p of e.exclusions.claimsNeverMade) if (!proh.has(p)) F(`${i}: prohibited enum ${p}`);
    if (!eqSet(new Set(e.exclusions.claimsNeverMade), proh)) F(`${i}: not all prohibited claims listed`);
    if (e.review.status !== 'UNREVIEWED_RESEARCH_CONTENT') F(`${i}: review status`);
    if (e.overallSupport === 'inferred' && !e.userFacing.applicationNote) F(`${i}: inferred without applicationNote`);
    const emit = emittable(e);
    if (['disputed', 'unsupported'].includes(e.overallSupport) && emit && !(e.conflicts ?? []).some((c) => c.handling === 'show-both-attributed')) F(`${i}: disputed record emittable without show-both conflict policy`);
    const uf = userText(e);
    const m = uf.match(BANNED);
    if (m) F(`${i}: banned wording in user-facing text: ${[...new Set(m.map((x) => x.toLowerCase()))].sort().join(',')}`);
    if (emit && !ATTRIB.test(e.userFacing.reading)) F(`${i}: reading lacks attribution frame`);
    if (i.startsWith('C1-IN') && WESTERN_TERMS.test(uf)) F(`${i}: Western term in Indian reading`);
    if (i.startsWith('C1-WE') && INDIAN_TERMS.test(uf)) F(`${i}: Indian term in Western reading`);
    if (e.readingModes == null) F(`${i}: readingModes missing`);
    if (i.startsWith('C1-WE')) {
      if (!has(e, 'complementsIndianGap')) F(`${i}: Western record lacks complementsIndianGap (D1)`);
      if ((e.readingModes ?? []).includes('indian-only')) F(`${i}: Western record in indian-only mode`);
    } else if ((e.readingModes ?? []).includes('western-only')) F(`${i}: Indian record in western-only mode`);
    if (e.uncertainty?.sourceSupport !== e.overallSupport) F(`${i}: uncertainty.sourceSupport mismatch`);
    if (e.requires.some((r) => r.provenanceAllowed.includes('user-self-reported'))) {
      const sr = e.selfReport;
      if (!sr || sr.subject !== 'hand-feature') F(`${i}: self-reported record lacks hand-feature selfReport (D2)`);
      else if (!sr.answers.some((a) => a.includes('not sure'))) F(`${i}: selfReport lacks 'not sure'`);
      if (!e.userFacing.observation.includes('your answer')) F(`${i}: self-report not disclosed in observation (D2)`);
    }
    for (const r of e.requires) if (['absent', 'none', 'missing', '0'].includes(String(r.observation?.categorical ?? '').toLowerCase())) F(`${i}: triggered by absence`);
    if (e.wordingFidelity?.status === 'softened-withdrawn' && emit) F(`${i}: withdrawn softened wording still emittable`);
    if (e.observationQuality.displayRule !== 'never-as-confidence') F(`${i}: displayRule`);
    const el = e.eligibility?.status;
    if (!ELIG.includes(el)) F(`${i}: eligibility missing/invalid`);
    const su = e.suitability ?? {};
    if (CRIT.some((k) => !has(su, k))) F(`${i}: suitability incomplete`);
    if (['eligible-initial', 'eligible-later'].includes(el) && CRIT.some((k) => su[k] === 'fail')) F(`${i}: eligible despite a failed suitability criterion`);
    if (el === 'excluded-initial' && emit) F(`${i}: excluded record still has emittable reading`);
    if (el === 'excluded-initial' && !has(e, 'researchHistory')) F(`${i}: excluded record lost its research history`);
  }
  if (fails.some((f) => / missing (id|tradition|requires|categories|sources|userFacing|eligibility|e1Capabilities)$/.test(f))) return fails;

  // ---------------------------------------------------------------- rev. 4 checks
  if (cat.libraryVersion !== schema.properties.libraryVersion.const) F('libraryVersion does not match schema');
  const rm = cat.readingModes ?? {};
  if (comp.westernEligibility !== 'suitable-additional-coverage') F('westernEligibility must be suitable-additional-coverage (no quota)');
  const cs = comp.comparablySuitable ?? {};
  if (JSON.stringify(cs.supportRank) !== JSON.stringify(['direct', 'inferred', 'disputed'])) F('comparablySuitable.supportRank');
  const mbh = rm.modeBehaviour ?? {};
  for (const mo of ['combined', 'indian-only', 'western-only']) {
    const b = mbh[mo];
    if (!b || !b.emptyResult || !b.traditions?.length) { F(`modeBehaviour.${mo} incomplete`); continue; }
    for (const t of b.traditions) if (!trads.has(t)) F(`modeBehaviour.${mo}: unknown tradition ${t}`);
  }
  if (Object.keys(mbh).length) {
    if ((mbh['indian-only']?.traditions ?? []).some((t) => !t.startsWith('indian'))) F('indian-only admits a non-Indian tradition');
    if ((mbh['western-only']?.traditions ?? []).some((t) => !t.startsWith('western'))) F('western-only admits a non-Western tradition');
    const combined = new Set(mbh.combined?.traditions ?? []);
    if (![...new Set(cat.interpretations.map((e) => e.tradition))].every((t) => combined.has(t))) F('combined must admit every tradition used in the catalogue');
    if (!eqSet(combined, new Set([...(mbh['indian-only']?.traditions ?? []), ...(mbh['western-only']?.traditions ?? [])]))) F('combined must be exactly indian-only + western-only');
  }
  const dom = rm.domains ?? {};
  for (const d of ['personality', 'relationships', 'career', 'life-direction']) {
    if (!dom[d]?.length) F(`domain ${d} unmapped`);
    for (const c of dom[d] ?? []) if (!cats.has(c) || c === 'overview' || c === 'historical-context-only') F(`domain ${d}: invalid category ${c}`);
  }
  const pl = rm.placement ?? {};
  if (pl.rule !== 'first-listed-category-with-room') F('placement rule');
  if (!eqSet(new Set(pl.sectionOrder ?? []), new Set([...cats].filter((c) => c !== 'overview' && c !== 'historical-context-only'))) || (pl.sectionOrder ?? []).length !== cats.size - 2) F('placement.sectionOrder must list every reading category once');
  const gpol = cat.globalPolicy;
  if (gpol.futureLanguage !== 'questions-only-never-forecasts') F('futureLanguage');
  if (!Number.isInteger(gpol.maxInterpretationsPerCategory) || gpol.maxInterpretationsPerCategory < 1) F('maxInterpretationsPerCategory must be a positive integer');
  const nar = Object.fromEntries((gpol.notAssessedReasons ?? []).map((r) => [r.code, r]));
  for (const code of REQUIRED_REASONS) if (!nar[code]) F(`notAssessedReasons lacks ${code}`);
  for (const code of ['user-skipped', 'user-cannot-see']) if (nar[code] && DET.test(nar[code].wording)) F(`E1-A1: ${code} wording reads as a detector/photo limitation`);
  if (nar['detector-missing'] && !nar['detector-missing'].carries.includes('never used for user')) F('E1-A1: detector-missing must be reserved for detector sources');
  if (nar['observed-absent'] && !nar['observed-absent'].wording.includes('no reading')) F('E1-A2: observed-absent must state that nothing is read from it');
  if (nar['not-read-in-this-version'] && nar['not-read-in-this-version'].wording !== 'Not read in this version.') F('RC-11: not-read wording must not reveal anything');
  const plan = cat.e1Planning ?? {};
  const CAPID = new Set(Object.keys(plan.capabilities ?? {}));
  const tiers = plan.tiers ?? {};
  const ESS = new Set(tiers.essential ?? []);
  if (!eqSet(ESS, new Set(['E1-E1', 'E1-E2', 'E1-E3', 'E1-E4', 'E1-E5']))) F('essential tier must be E1-E1..E1-E5');
  const alltiers = Object.values(tiers).flat();
  if (!eqSet(new Set(alltiers), CAPID) || alltiers.length !== new Set(alltiers).size || alltiers.length !== CAPID.size) F('every capability in exactly one tier');
  if (ESS.has('E1-L5')) F('origin-gap descriptor must not be essential');
  const cf = plan.carriedForwardFromI1 ?? {};
  for (const k of ['M4', 'E1-A1', 'E1-A2', 'E1-A3', 'E1-A4', 'E1-A5']) if (!cf[k]) F(`carry-forward ${k} missing`);
  for (const e of cat.interpretations) {
    const i = e.id; const el = e.eligibility.status; const ec = new Set(e.e1Capabilities ?? []);
    if (!ec.size) { F(`${i}: e1Capabilities missing`); continue; }
    for (const c of ec) if (!CAPID.has(c) && c !== 'not-planned') F(`${i}: unknown capability ${c}`);
    if (el === 'eligible-initial' && ![...ec].every((c) => ESS.has(c))) F(`${i}: eligible-initial record needs a non-essential capability`);
    if (el === 'eligible-later' && [...ec].every((c) => ESS.has(c))) F(`${i}: eligible-later record needs only essential capabilities (should be initial?)`);
    if (['eligible-initial', 'eligible-later'].includes(el) && ec.has('not-planned')) F(`${i}: eligible record depends on a not-planned capability`);
    if (['eligible-initial', 'eligible-later'].includes(el)) {
      if (!e.userFacing.reflection.trimEnd().endsWith('?')) F(`${i}: reflection is not a question (futureLanguage)`);
      if (FUT.test(userText(e))) F(`${i}: forecast wording`);
      if (e.tradition.startsWith('western')) { const g = e.complementsIndianGap ?? {}; if (!Object.keys(g).length || !Object.values(g).every(Boolean)) F(`${i}: complementsIndianGap incomplete`); }
    }
    for (const r of e.requires) {
      const d = String(r.observation?.descriptor ?? '');
      if ((d.startsWith('proposed.urdhva.terminationFinger') || d.startsWith('proposed.heart.radialEndFinger')) && !has(e.observationQuality, 'boundaryMargin')) F(`${i}: zone descriptor without boundaryMargin (RC-7)`);
    }
  }
  const served = {};
  for (const e of cat.interpretations) for (const c of e.e1Capabilities ?? []) (served[c] ??= new Set()).add(e.eligibility.status);
  const elig = (c) => [...(served[c] ?? [])].some((s) => s === 'eligible-initial' || s === 'eligible-later');
  for (const c of [...(tiers.essential ?? []), ...(tiers.optionalAssisted ?? [])]) if (c !== 'E1-E1' && c !== 'E1-E2' && !elig(c)) F(`${c}: planned capability serves no eligible record`);
  for (const e of cat.interpretations) if (e.eligibility.status === 'excluded-initial') for (const c of e.e1Capabilities ?? []) if (c !== 'E1-E1' && c !== 'E1-E2' && !elig(c)) F(`${e.id}: capability ${c} would exist only for an excluded record`);
  for (const e of cat.interpretations.filter((x) => x.eligibility.status === 'eligible-initial')) {
    const modes = Object.entries(mbh).filter(([, b]) => (b.traditions ?? []).includes(e.tradition)).map(([m]) => m).sort();
    if (JSON.stringify(modes) !== JSON.stringify([...e.readingModes].sort())) F(`${e.id}: readingModes disagree with modeBehaviour`);
  }
  return fails;
}

const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };

/**
 * Load and validate a library. `catalogue` and `schema` are parsed JSON. Throws E1Error('invalid-catalogue') with the
 * failure list. Returns a deep-frozen library with lookup indexes. The input objects are cloned, never mutated.
 */
export function loadLibrary(catalogue, schema) {
  const unsupported = assertSupportedSchema(schema);
  if (unsupported.length) throw new E1Error('invalid-schema', `unsupported schema keywords: ${unsupported.slice(0, 5).join(', ')}`);
  const cat = structuredClone(catalogue);
  const schemaErrors = validateAgainstSchema(cat, schema);
  if (schemaErrors.length) throw new E1Error('invalid-catalogue', `schema: ${schemaErrors.slice(0, 8).join('; ')}`);
  const policy = lintCatalogue(cat, schema);
  if (policy.length) throw new E1Error('invalid-catalogue', `policy: ${policy.slice(0, 8).join('; ')}`);
  if (cat.libraryVersion !== E1_ENGINE.libraryVersion) throw new E1Error('invalid-catalogue', `library ${cat.libraryVersion} is not ${E1_ENGINE.libraryVersion}`);
  if (cat.featureSetVersion !== E1_ENGINE.featureSetVersion) throw new E1Error('invalid-catalogue', `feature set ${cat.featureSetVersion} is not ${E1_ENGINE.featureSetVersion}`);
  const want = Object.entries(RECORD_MANIFEST).flatMap(([st, ids]) => ids.map((id) => `${id}=${st}`)).sort();
  const got = cat.interpretations.map((e) => `${e.id}=${e.eligibility.status}`).sort();
  if (JSON.stringify(want) !== JSON.stringify(got)) throw new E1Error('invalid-catalogue', 'record inventory or classification differs from the C1 rev. 4 manifest (29 records)');
  const initial = cat.interpretations.filter((e) => e.eligibility.status === 'eligible-initial');
  for (const e of initial) {
    const missing = e.e1Capabilities.filter((c) => !IMPLEMENTED_CAPABILITIES.includes(c));
    if (missing.length) throw new E1Error('invalid-catalogue', `${e.id} is eligible-initial but needs unimplemented ${missing.join(',')}`);
  }
  const byId = new Map(cat.interpretations.map((e) => [e.id, e]));
  return deepFreeze({
    catalogue: cat,
    byId,
    order: cat.interpretations.map((e) => e.id),
    initialIds: initial.map((e) => e.id),
    reasons: Object.fromEntries(cat.globalPolicy.notAssessedReasons.map((r) => [r.code, r])),
    sources: Object.fromEntries(cat.sources.map((s) => [s.id, s])),
  });
}
