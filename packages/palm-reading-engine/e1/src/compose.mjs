// AURA-PALM-03-E1 -- deterministic interpretation selection and reading composition (capability E1-E2).
// Implements the C1 rev. 4 rules from the catalogue itself (report §7 RC-1..RC-14; handover §3):
//   candidates   eligible-initial ONLY (later / held / excluded / historical never enter a reading), tradition allowed
//                by the mode, every requirement observed with an allowed provenance, value inside the range or zone and
//                outside the record's boundary margin (RC-7)
//   ranking      selectionOrder: eligibility -> relevance -> observation quality -> source support -> suitability band
//                -> tradition preference (Indian first only between comparably suitable candidates) -> catalogue order.
//                Every candidate is keyed directly to its observed feature (equal relevance) and has passed the same
//                quality gate and margin (equal observation quality), so the deciding keys are support, band, tradition.
//   placement    RC-12: in rank order, the first category in the record's own list with room (limit from the
//                catalogue); otherwise "More from your reading". No quotas, slots or ratios.
//   not assessed RC-13 vocabulary, one code per feature, wording from the catalogue.
// Pure and deterministic: no clock, randomness, I/O or locale dependence; output is deep-frozen.
//
// R3 trust boundaries:
//   planSelection(library, observations, { synthetic: true })  ids and reason codes only -- NO text. Any validated
//       library (loadLibrary) and strictly validated abstract observations. Used internally and by test fixtures.
//   composeReading(minted, { synthetic: true })  the ONLY text-emitting function: observations must be minted by
//       deriveObservations() (built from one synthetic input) and the library is always the pinned packaged one.
//       The complete output is validated before it is returned (F2).
//   Mutual exclusion (F4): if more than one record qualifies for the same observed feature, none is shown and the
//       feature is listed as 'ambiguous-in-source'.

import { E1_ENGINE, E1Error, MODES, DOMAINS, RECORD_MANIFEST } from './identity.mjs';
import { isValidatedLibrary, BANNED_WORDING, FORECAST_WORDING } from './library.mjs';
import { toGrid, gridStatus } from './grid.mjs';
import { pinnedLibrary } from './packaged.mjs';
import { isMintedObservations } from './observations.mjs';

const INITIAL = new Set(RECORD_MANIFEST['eligible-initial']);
const BANNED_1 = new RegExp(BANNED_WORDING.source, 'i');
const FORECAST_1 = new RegExp(FORECAST_WORDING.source, 'i');

const TAG = Object.freeze({
  'indian-classical': 'Indian · classical',
  'indian-later-treatise': 'Indian · medieval treatise',
  'indian-diagram-tradition': 'Indian · diagram tradition',
  'western-19c-chirognomy': 'Western · 19th c.',
  'western-19c-chiromancy': 'Western · 19th c.',
});
const FRAME = 'This reading describes what palm-reading traditions said about features you traced, measured or told us about. Each item names the tradition it comes from. Where Indian and Western readings are equally suitable, the Indian one is preferred. It is not a scientific assessment and not a prediction. Please don\'t use it for decisions about health, money, work or relationships.';
const KEY_RE = /^(lines|measurements|marks|proposed)\.[A-Za-z][A-Za-z0-9.]*$/;
const OBS_KEYS = new Set(['provenance', 'value', 'nearEdge', 'adjacentZone', 'descriptor', 'edgeDistance', 'margin']);
const NA_KEYS = new Set(['notAssessed', 'detail']);

const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Validate abstract observations. Throws E1Error('invalid-input'). */
export function validateObservations(library, observations, { source = 'user-assisted' } = {}) {
  if (observations === null || typeof observations !== 'object' || Array.isArray(observations)) throw new E1Error('invalid-input', 'observations must be an object');
  const codes = library.reasons;
  for (const [k, v] of Object.entries(observations)) {
    if (!KEY_RE.test(k)) throw new E1Error('invalid-input', `bad feature key ${k}`);
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new E1Error('invalid-input', `${k}: observation must be an object`);
    if ('notAssessed' in v) {
      if (Object.keys(v).some((x) => !NA_KEYS.has(x))) throw new E1Error('invalid-input', `${k}: unknown fields`);
      if (typeof v.notAssessed !== 'string' || !Object.prototype.hasOwnProperty.call(codes, v.notAssessed)) throw new E1Error('invalid-input', `${k}: unknown not-assessed code ${v.notAssessed}`);
      if ('detail' in v && v.detail !== undefined && typeof v.detail !== 'string') throw new E1Error('invalid-input', `${k}: detail must be a string`);
      if (v.notAssessed === 'detector-missing' && source === 'user-assisted') throw new E1Error('invalid-input', `${k}: E1-A1: detector-missing is reserved for detector sources, never user-assisted input`);
      continue;
    }
    if (Object.keys(v).some((x) => !OBS_KEYS.has(x))) throw new E1Error('invalid-input', `${k}: unknown fields`);
    if (typeof v.provenance !== 'string') throw new E1Error('invalid-input', `${k}: provenance required`);
    if (!(isNum(v.value) || (typeof v.value === 'string' && v.value.length > 0))) throw new E1Error('invalid-input', `${k}: value must be a finite number or a non-empty string`);
    if (isNum(v.value) && gridStatus(v.value) !== 'ok') throw new E1Error('invalid-input', `${k}: numeric value is ${gridStatus(v.value)} (I1 serialized grid, |v| <= 1e6)`);
    if ('descriptor' in v && typeof v.descriptor !== 'string') throw new E1Error('invalid-input', `${k}: descriptor must be a string`);
    for (const nk of ['edgeDistance', 'margin']) if (nk in v && v[nk] !== null && !isNum(v[nk])) throw new E1Error('invalid-input', `${k}: ${nk} must be a finite number`);
    if ('nearEdge' in v && typeof v.nearEdge !== 'boolean') throw new E1Error('invalid-input', `${k}: nearEdge must be boolean`);
    if (v.nearEdge === true && 'adjacentZone' in v && v.adjacentZone !== null && typeof v.adjacentZone !== 'string') throw new E1Error('invalid-input', `${k}: adjacentZone must be a string`);
  }
}

/** Match one record against observations: 'match' | 'boundary' | 'no', plus the features it reads. */
function matchRecord(rec, obs) {
  const used = [];
  let boundary = false;
  const m = rec.observationQuality.boundaryMargin ?? 0;
  for (const r of rec.requires) {
    used.push(r.feature);
    const x = obs[r.feature];
    if (!x || 'notAssessed' in x) return { res: 'no', used };
    if (!r.provenanceAllowed.includes(x.provenance)) return { res: 'no', used };
    const ob = r.observation ?? {};
    if ('categorical' in ob) {
      const want = String(ob.categorical);
      if (String(x.value) === want) { if (x.nearEdge === true) boundary = true; }
      else if (x.nearEdge === true && x.adjacentZone != null && String(x.adjacentZone) === want) boundary = true; // RC-7, either side of an edge
      else return { res: 'no', used };
    } else if ('range' in ob) {
      // R2 (finding F4): exact integer comparison on the serialized grid, CLOSED boundary bands. A value within the
      // margin of a threshold (distance <= margin, on either side) is a boundary; a clean match must lie inside the
      // range AND farther than the margin from every finite threshold. At slope 0.0800 (0.03 from both 0.05 and 0.11)
      // both head-line records are therefore boundary and neither emits.
      const v = toGrid(x.value), mg = toGrid(m);
      if (v === null || mg === null) return { res: 'no', used };
      const lo = ob.range.min === null || ob.range.min === undefined ? null : toGrid(ob.range.min);
      const hi = ob.range.max === null || ob.range.max === undefined ? null : toGrid(ob.range.max);
      const near = (lo !== null && Math.abs(v - lo) <= mg) || (hi !== null && Math.abs(v - hi) <= mg);
      if (near) boundary = true;
      else if ((lo !== null && v < lo) || (hi !== null && v > hi)) return { res: 'no', used };
    }
  }
  return { res: boundary ? 'boundary' : 'match', used };
}

function concernCount(rec) { return Object.values(rec.suitability).filter((v) => v === 'concern').length; }

/**
 * Selection and placement only: record ids and reason codes, never interpretation text.
 * opts: { synthetic: true, mode = 'combined', qualityAccepted = true, qualityDetail? }
 */
export function planSelection(library, observations, opts) {
  if (opts === null || typeof opts !== 'object' || opts.synthetic !== true) throw new E1Error('synthetic-required', 'pass { synthetic: true }; real input is not authorised');
  const mode = opts.mode ?? 'combined';
  if (!MODES.includes(mode)) throw new E1Error('invalid-option', `mode must be one of ${MODES.join(', ')}`);
  if (typeof (opts.qualityAccepted ?? true) !== 'boolean') throw new E1Error('invalid-option', 'qualityAccepted must be boolean');
  if (opts.qualityDetail !== undefined && typeof opts.qualityDetail !== 'string') throw new E1Error('invalid-option', 'qualityDetail must be a string');
  if (!isValidatedLibrary(library)) throw new E1Error('invalid-library', 'the library must be one returned by loadLibrary()');
  validateObservations(library, observations);
  const cat = library.catalogue;
  const mb = cat.readingModes.modeBehaviour[mode];
  const trads = new Set(mb.traditions);
  const order = cat.readingModes.placement.sectionOrder;
  const limit = cat.globalPolicy.maxInterpretationsPerCategory;
  const supportRank = cat.readingModes.composition.comparablySuitable.supportRank;
  const reason = (code, feature, detail) => ({ feature, code, ...(detail !== undefined ? { detail } : {}) });

  const observed = Object.keys(observations).filter((k) => !('notAssessed' in observations[k]));
  const notAssessed = new Map();
  for (const [k, v] of Object.entries(observations)) if ('notAssessed' in v) notAssessed.set(k, reason(v.notAssessed, k, v.detail));

  const sections = {};
  const overflow = [];
  const historical = [];
  if (opts.qualityAccepted === false) {
    for (const k of observed) notAssessed.set(k, reason('quality-gated', k, opts.qualityDetail));
  } else {
    const status = Object.fromEntries(observed.map((k) => [k, null]));
    let cands = [];
    const boundaryFeatures = {};
    for (const id of library.order) {
      const rec = library.byId[id];
      if (!trads.has(rec.tradition)) continue;
      const el = rec.eligibility.status;
      const { res, used } = matchRecord(rec, observations);
      if (res === 'no') continue;
      if (el === 'historical-context-only') { for (const k of used) status[k] = status[k] ?? 'historical'; historical.push(id); continue; }
      if (el !== 'eligible-initial' || !INITIAL.has(id)) { // R2 (finding F1): eligibility re-enforced at composition
        if ((el === 'excluded-initial' || el === 'held') && res === 'match') for (const k of used) if (status[k] === null || status[k] === 'boundary') status[k] = 'not-read';
        continue; // eligible-later never enters an E1 reading (its capabilities are not implemented)
      }
      if (res === 'boundary') { for (const k of used) { boundaryFeatures[k] = true; if (status[k] === null) status[k] = 'boundary'; } continue; }
      cands.push(rec);
      for (const k of used) status[k] = 'matched';
    }
    // R2 (finding F4 / RC-7): a feature that is ambiguous for any record reading it emits nothing at all.
    const ambiguous = new Set(Object.keys(boundaryFeatures));
    cands = cands.filter((rec) => { const hit = rec.requires.filter((r) => ambiguous.has(r.feature)); for (const r of hit) status[r.feature] = 'boundary'; return hit.length === 0; });
    // R3 (finding F4): mutual exclusion. Two or more qualifying records reading the same feature are incompatible
    // interpretations of one observation; none is shown and the feature is listed as ambiguous.
    const readers = {};
    for (const rec of cands) for (const r of rec.requires) (readers[r.feature] ??= []).push(rec.id);
    const conflicted = new Set(Object.keys(readers).filter((f) => readers[f].length > 1));
    cands = cands.filter((rec) => { const hit = rec.requires.filter((r) => conflicted.has(r.feature)); for (const r of hit) status[r.feature] = 'conflict'; return hit.length === 0; });
    for (const k of observed) {
      const st = status[k];
      if (st === 'matched' || st === 'historical') continue;
      notAssessed.set(k, reason(st === 'not-read' ? 'not-read-in-this-version' : st === 'boundary' ? 'boundary' : st === 'conflict' ? 'ambiguous-in-source' : 'no-supported-content', k));
    }
    const rankKey = (rec) => [supportRank.indexOf(rec.overallSupport), concernCount(rec) <= 2 ? 0 : 1, rec.tradition.startsWith('indian') ? 0 : 1, library.order.indexOf(rec.id)];
    const ranked = [...cands].sort((x, y) => { const kx = rankKey(x), ky = rankKey(y); for (let i = 0; i < kx.length; i++) if (kx[i] !== ky[i]) return kx[i] - ky[i]; return 0; });
    ranked.forEach((rec, rank) => {
      const section = rec.categories.find((c) => order.includes(c) && (sections[c]?.length ?? 0) < limit);
      const item = { recordId: rec.id, rank: rank + 1, section: section ?? 'more-from-your-reading' };
      if (section) (sections[section] ??= []).push(item); else overflow.push(item);
    });
  }
  const orderedSections = order.filter((c) => sections[c]).map((c) => ({ category: c, items: sections[c] }));
  const empty = orderedSections.length === 0 && overflow.length === 0;
  const domains = DOMAINS.map((d) => {
    const catsOfDomain = cat.readingModes.domains[d];
    const items = orderedSections.filter((x) => catsOfDomain.includes(x.category)).flatMap((x) => x.items.map((i) => i.recordId));
    const modeHasContent = library.initialIds.some((id) => { const r = library.byId[id]; return trads.has(r.tradition) && r.categories.some((c) => catsOfDomain.includes(c)); });
    return { domain: d, categories: [...catsOfDomain], items, status: items.length ? 'shown' : modeHasContent ? 'not-shown' : 'no-supported-content' };
  });
  return deepFreeze({
    mode,
    quality: { accepted: opts.qualityAccepted !== false, ...(opts.qualityDetail ? { detail: opts.qualityDetail } : {}) },
    sections: orderedSections,
    moreFromYourReading: overflow,
    domains,
    notAssessed: [...notAssessed.values()].sort((x, y) => (x.feature < y.feature ? -1 : x.feature > y.feature ? 1 : 0)),
    historicalContextMatched: historical,
    emptyResult: empty ? mb.emptyResult : null,
  });
}

/**
 * The only text-emitting function. `minted` must come from deriveObservations() (one synthetic input); the library is
 * always the pinned packaged library. opts: { synthetic: true, mode = 'combined' }.
 */
export function composeReading(minted, opts) {
  if (opts === null || typeof opts !== 'object' || opts.synthetic !== true) throw new E1Error('synthetic-required', 'pass { synthetic: true }; real input is not authorised');
  if (!isMintedObservations(minted)) throw new E1Error('invalid-input', 'observations must be produced by deriveObservations() from one synthetic input');
  const library = pinnedLibrary();
  const plan = planSelection(library, minted.observations, { synthetic: true, mode: opts.mode ?? 'combined', qualityAccepted: minted.qualityAccepted, qualityDetail: minted.qualityDetail });
  const cat = library.catalogue;
  const render = (it) => buildItem(library, library.byId[it.recordId], minted.observations, it.rank, it.section);
  const reading = {
    engine: { id: E1_ENGINE.id, version: E1_ENGINE.version, library: cat.libraryVersion, descriptors: E1_ENGINE.descriptorVersion },
    synthetic: true,
    contentStatus: E1_ENGINE.contentStatus,
    publicationApproved: false,
    mode: plan.mode,
    tierCeiling: 'tentative',
    frame: FRAME,
    quality: { ...plan.quality },
    sections: plan.sections.map((x) => ({ category: x.category, items: x.items.map(render) })),
    moreFromYourReading: plan.moreFromYourReading.map(render),
    domains: plan.domains.map((d) => ({ ...d, categories: [...d.categories], items: [...d.items] })),
    notAssessed: plan.notAssessed.map((n) => ({ feature: n.feature, code: n.code, wording: library.reasons[n.code].wording, ...(n.detail !== undefined ? { detail: n.detail } : {}) })),
    observed: Object.entries(minted.observations).filter(([, v]) => !('notAssessed' in v)).map(([feature, v]) => ({ feature, provenance: v.provenance, value: v.value, ...(v.nearEdge !== undefined ? { nearEdge: v.nearEdge } : {}), ...(v.adjacentZone ? { adjacentZone: v.adjacentZone } : {}) })).sort((x, y) => (x.feature < y.feature ? -1 : 1)),
    historicalContextMatched: [...plan.historicalContextMatched],
    emptyResult: plan.emptyResult,
  };
  validateReadingOutput(reading, library);
  return deepFreeze(reading);
}

const READING_KEYS = ['engine', 'synthetic', 'contentStatus', 'publicationApproved', 'mode', 'tierCeiling', 'frame', 'quality', 'sections', 'moreFromYourReading', 'domains', 'notAssessed', 'observed', 'historicalContextMatched', 'emptyResult'];
const TEXT_KEYS = ['observation', 'reading', 'reflection', 'applicationNote'];
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/**
 * R3 (finding F2): validate the complete reading before it is returned. Every value must be a string, finite number,
 * boolean, null, plain object or array; every string except the pinned disclaimer frame is checked for prohibited and
 * forecast wording (interpretation text, application notes, reflection questions, notAssessed wording, diagnostics);
 * text fields must be exactly the known string fields; the fallback (emptyResult) must be one of the pinned codes.
 * Automated checks support, and never replace, editorial and safety review.
 */
export function validateReadingOutput(reading, library) {
  const fail = (m) => { throw new E1Error('content-violation', m); };
  if (!isPlain(reading) || JSON.stringify(Object.keys(reading)) !== JSON.stringify(READING_KEYS)) fail('unexpected reading structure');
  if (reading.frame !== FRAME) fail('the disclaimer frame was altered');
  const fallbacks = new Set(Object.values(library.catalogue.readingModes.modeBehaviour).map((b) => b.emptyResult));
  if (reading.emptyResult !== null && !(fallbacks.has(reading.emptyResult) && /^[a-z0-9-]+$/.test(reading.emptyResult))) fail('unexpected fallback wording');
  const walk = (v, at) => {
    if (typeof v === 'string') { if (at !== '$.frame' && (BANNED_1.test(v) || FORECAST_1.test(v))) fail(`prohibited or forecast wording at ${at}`); return; }
    if (typeof v === 'number') { if (!Number.isFinite(v)) fail(`non-finite number at ${at}`); return; }
    if (typeof v === 'boolean' || v === null) return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${at}[${i}]`)); return; }
    if (!isPlain(v)) fail(`unexpected value type at ${at}`);
    for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
  };
  walk(reading, '$');
  for (const it of [...reading.sections.flatMap((x) => x.items), ...reading.moreFromYourReading]) {
    const keys = Object.keys(it.text);
    if (!keys.every((k) => TEXT_KEYS.includes(k)) || !keys.every((k) => typeof it.text[k] === 'string')) fail(`unexpected text fields on ${it.recordId}`);
    if (!it.text.reflection.trimEnd().endsWith('?')) fail(`${it.recordId}: reflection is not a question`);
  }
  for (const n of reading.notAssessed) if (typeof n.wording !== 'string' || n.wording !== library.reasons[n.code].wording) fail(`unexpected notAssessed wording for ${n.feature}`);
}

function buildItem(library, rec, obs, rank, section) {
  const u = rec.userFacing;
  const disclosures = [];
  if (rec.overallSupport === 'disputed') disclosures.push('disputed-within-tradition');
  if (rec.requires.some((r) => r.feature === 'lines.heart')) disclosures.push('ayurlekha-meaning-not-used');
  if (rec.requires.some((r) => r.feature.startsWith('measurements.'))) disclosures.push('not-a-scientific-measure');
  return {
    recordId: rec.id,
    rank,
    section,
    tradition: rec.tradition,
    traditionTag: TAG[rec.tradition],
    supportingFeatures: rec.requires.map((r) => ({
      feature: r.feature,
      anatomical: r.anatomical,
      provenance: obs[r.feature].provenance,
      observed: obs[r.feature].value,
      descriptor: obs[r.feature].descriptor ?? null,
      ...(r.observation?.thresholdStatus ? { thresholdStatus: r.observation.thresholdStatus } : {}),
    })),
    sources: rec.sources.map((s) => ({ sourceId: s.sourceId, locator: s.locator, supportLevel: s.supportLevel, verification: s.verification, title: library.sources[s.sourceId]?.title ?? null })),
    confidence: {
      tier: 'tentative',
      ceiling: rec.observationQuality.maxTier,
      displayRule: rec.observationQuality.displayRule,
      sourceSupport: rec.uncertainty.sourceSupport,
      identityConfirmation: rec.uncertainty.identityConfirmation,
      traditionalUncertainty: { level: rec.uncertainty.traditionalUncertainty.level, reasons: [...rec.uncertainty.traditionalUncertainty.reasons] },
      measurementQuality: 'passed-gate',
    },
    suitability: {
      sourceFidelity: rec.suitability.sourceFidelity,
      observationRequirements: rec.suitability.observationRequirements,
      culturalContext: rec.suitability.culturalContext,
      relevanceToUser: rec.suitability.relevanceToUser,
      harmfulAttributionRisk: rec.suitability.harmfulAttributionRisk,
      constructiveReflection: rec.suitability.constructiveReflection,
      band: concernCount(rec) <= 2 ? 0 : 1,
      eligibility: rec.eligibility.status,
    },
    reviewStatus: rec.review.status,
    text: {
      observation: u.observation,
      reading: u.reading,
      reflection: u.reflection,
      ...(u.applicationNote ? { applicationNote: u.applicationNote } : {}),
    },
    // reviewer-facing conflict notes and free-text references are never emitted; only catalogue record ids are
    conflicts: (rec.conflicts ?? []).map((c) => ({ withId: /^C1-(IN|WE)-[A-Z0-9-]+$/.test(c.withId) ? c.withId : 'external-reference', kind: c.kind, handling: c.handling })),
    disclosures,
  };
}
