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
import { E1_ENGINE, E1Error, IMPLEMENTED_CAPABILITIES, RECORD_MANIFEST, isOwnDataDescriptor } from './identity.mjs';

// R4 (finding F2, defence in depth): medical-claim vocabulary (diagnoses, conditions, treatment). Integrity of the
// packaged catalogue rests on its pinned bytes and immutability (packaged.mjs), never on this keyword list.
const MEDICAL = 'cancer|tumou?r|malignan|diagnos|prognos|disorder|syndrome|symptom|medic|clinic|patholog|diabet|infect|sick|treatment|therap|surger|surgical|pregnan|depress|anxiety|heart attack|blood pressure|terminal';
const BANNED = new RegExp(`\\b(die|dies|death|lifespan|life span|live long|long life|longevity|rich|wealth|money|marri|husband|wife|children|sons|daughter|fertil|caste|varṇa|varna|health|illness|disease|accident|misfortune|guarantee|will become|you will|destined|fate|${MEDICAL})\\w*`, 'gi');
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
// R2 (finding F2): EVERY user-facing string field is checked (observation, reading, reflection, applicationNote and any
// other), not a fixed subset. Automated wording checks support, and never replace, editorial and safety review.
// Records E1 can emit (eligible-initial) are checked on all fields. Other records cannot reach a reading (enforced again at
// composition) and keep the C1 rev. 4 field set, so the preserved research catalogue loads unchanged; the one later
// record whose application note fails the stricter check (C1-IN-MATSYA-PAIR-HOSPITALITY, a disclaimer naming 'rich')
// is reported for editorial review instead of being edited.
const C1_FIELDS = ['observation', 'reading', 'reflection'];
const userText = (e) => (e.eligibility?.status === 'eligible-initial'
  ? Object.values(e.userFacing ?? {}).filter((v) => typeof v === 'string')
  : C1_FIELDS.map((k) => e.userFacing?.[k] ?? '')).join(' ');
/** Every user-facing string of a record (used at emission time, whatever the record's status). */
export const allUserText = (e) => Object.values(e.userFacing ?? {}).filter((v) => typeof v === 'string').join(' ');
export const BANNED_WORDING = BANNED;
export const FORECAST_WORDING = FUT;
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
  const nar = Object.assign(Object.create(null), Object.fromEntries((gpol.notAssessedReasons ?? []).map((r) => [r.code, r]))); // R6: data-keyed maps are null-prototype
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
      if (typeof e.userFacing.reflection !== 'string' || !e.userFacing.reflection.trimEnd().endsWith('?')) F(`${i}: reflection is not a question (futureLanguage)`);
      if (FUT.test(userText(e))) F(`${i}: forecast wording`);
      if (e.tradition.startsWith('western')) { const g = e.complementsIndianGap ?? {}; if (!Object.keys(g).length || !Object.values(g).every(Boolean)) F(`${i}: complementsIndianGap incomplete`); }
    }
    for (const r of e.requires) {
      const d = String(r.observation?.descriptor ?? '');
      if ((d.startsWith('proposed.urdhva.terminationFinger') || d.startsWith('proposed.heart.radialEndFinger')) && !has(e.observationQuality, 'boundaryMargin')) F(`${i}: zone descriptor without boundaryMargin (RC-7)`);
    }
  }
  // R3 (finding F2): reason wording and fallback values are user-facing too.
  for (const r of gpol.notAssessedReasons ?? []) {
    if (typeof r.wording !== 'string' || typeof r.code !== 'string') { F(`notAssessedReasons ${r.code}: wording and code must be strings`); continue; }
    if (new RegExp(BANNED.source, 'i').test(r.wording) || FUT.test(r.wording)) F(`notAssessedReasons ${r.code}: prohibited or forecast wording`);
  }
  for (const [mo, b] of Object.entries(mbh)) if (typeof b.emptyResult !== 'string' || !/^[a-z0-9-]+$/.test(b.emptyResult)) F(`modeBehaviour.${mo}.emptyResult must be a plain code`);
  // R3 (finding F4): incompatible interpretations of the same observation must not overlap. For eligible-initial
  // records reading one feature, categorical values must differ, and range records' clean regions (inside the range
  // and farther than the margin from every threshold, on the 0.0001 grid) must be disjoint.
  const byFeature = Object.create(null);
  for (const e of cat.interpretations.filter((x) => x.eligibility?.status === 'eligible-initial')) for (const r of e.requires) (byFeature[r.feature] ??= []).push({ id: e.id, ob: r.observation ?? {}, m: e.observationQuality?.boundaryMargin ?? 0 });
  const g4 = (v) => (v === null || v === undefined ? null : Math.round(v * 10000));
  for (const [f, rs] of Object.entries(byFeature)) {
    if (rs.length < 2) continue;
    const kinds = new Set(rs.map((x) => ('categorical' in x.ob ? 'categorical' : 'range' in x.ob ? 'range' : 'presence')));
    if (kinds.size > 1 || kinds.has('presence')) { F(`${f}: incompatible interpretation kinds for one observation`); continue; }
    if (kinds.has('categorical')) { const vals = rs.map((x) => String(x.ob.categorical)); if (new Set(vals).size !== vals.length) F(`${f}: two records read the same categorical value`); continue; }
    const clean = rs.map((x) => { const m = g4(x.m), lo = g4(x.ob.range.min), hi = g4(x.ob.range.max); return { id: x.id, a: lo === null ? -Infinity : lo + m + 1, b: hi === null ? Infinity : hi - m - 1 }; });
    for (let i = 0; i < clean.length; i++) for (let j = i + 1; j < clean.length; j++) if (Math.max(clean[i].a, clean[j].a) <= Math.min(clean[i].b, clean[j].b)) F(`${f}: ${clean[i].id} and ${clean[j].id} can both match one value (incompatible range overlap)`);
  }
  const served = Object.create(null);
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

/** Libraries produced by loadLibrary(). The composer refuses anything else (R2, finding F1). */
const VALIDATED = new WeakSet();
export const isValidatedLibrary = (lib) => typeof lib === 'object' && lib !== null && VALIDATED.has(lib);

const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };

/**
 * R5 (finding F2): normalize parsed JSON into private records -- every object becomes a null-prototype object holding
 * only its OWN data properties, recursively (arrays are rebuilt dense from own indexes). With no prototype chain, a
 * property that is absent from the catalogue can never be supplied by an inherited value (Object.prototype or any
 * other), for optional fields read by eligibility, matching, wording, diagnostics or output metadata alike. The
 * schema (additionalProperties: false) then restricts each record to its permitted fields. Accessors, symbols,
 * sparse arrays and non-JSON values are refused. Validation and generation use this same normalized structure.
 */
export function normalizeRecord(v, at = '$', depth = 0) {
  const fail = (why) => { throw new E1Error('invalid-catalogue', `${at}: ${why}`); };
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') { if (!Number.isFinite(v)) fail('non-finite number'); return v; }
  if (typeof v !== 'object') fail(`unsupported value type ${typeof v}`);
  if (depth > 32) fail('nested too deeply');
  if (Array.isArray(v)) {
    const out = [];
    for (let i = 0; i < v.length; i++) {
      const d = Object.getOwnPropertyDescriptor(v, i);
      if (!isOwnDataDescriptor(d)) fail(`[${i}] is missing or not a data property`);
      out.push(normalizeRecord(d.value, `${at}[${i}]`, depth + 1));
    }
    return out;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) fail('not a plain object');
  const out = Object.create(null);
  for (const k of Reflect.ownKeys(v)) {
    if (typeof k !== 'string') fail('symbol key');
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!isOwnDataDescriptor(d)) fail(`${k} is not a data property`);
    out[k] = normalizeRecord(d.value, `${at}.${k}`, depth + 1);
  }
  return out;
}
const nullProtoFrom = (entries) => Object.assign(Object.create(null), Object.fromEntries(entries));

/**
 * Load and validate a library. `catalogue` and `schema` are parsed JSON. Throws E1Error('invalid-catalogue') with the
 * failure list. Returns a deep-frozen library with lookup indexes. The inputs are normalized into new null-prototype
 * records (normalizeRecord), never mutated.
 */
export function loadLibrary(catalogue, schemaInput) {
  const schema = normalizeRecord(schemaInput, 'schema');
  const unsupported = assertSupportedSchema(schema);
  if (unsupported.length) throw new E1Error('invalid-schema', `unsupported schema keywords: ${unsupported.slice(0, 5).join(', ')}`);
  const cat = normalizeRecord(catalogue, 'catalogue'); // R5: private null-prototype records (own data only)
  const schemaErrors = validateAgainstSchema(cat, schema);
  if (schemaErrors.length) throw new E1Error('invalid-catalogue', `schema: ${schemaErrors.slice(0, 8).join('; ')}`);
  let policy;
  try { policy = lintCatalogue(cat, schema); } catch (err) { throw new E1Error('invalid-catalogue', `policy check could not complete: ${String(err?.message ?? err)}`); }
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
  deepFreeze(cat);
  // R2 (finding F1): no writable map is exposed; records are reachable only through frozen, null-prototype objects.
  const byId = Object.freeze(nullProtoFrom(cat.interpretations.map((e) => [e.id, e])));
  const lib = deepFreeze(Object.assign(Object.create(null), {
    catalogue: cat,
    byId,
    order: cat.interpretations.map((e) => e.id),
    initialIds: initial.map((e) => e.id),
    reasons: nullProtoFrom(cat.globalPolicy.notAssessedReasons.map((r) => [r.code, r])),
    sources: nullProtoFrom(cat.sources.map((s) => [s.id, s])),
  }));
  VALIDATED.add(lib);
  return lib;
}
