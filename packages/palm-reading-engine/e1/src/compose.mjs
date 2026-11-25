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

import { E1_ENGINE, E1Error, MODES, DOMAINS } from './identity.mjs';

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
      if (!Object.prototype.hasOwnProperty.call(codes, v.notAssessed)) throw new E1Error('invalid-input', `${k}: unknown not-assessed code ${v.notAssessed}`);
      if (v.notAssessed === 'detector-missing' && source === 'user-assisted') throw new E1Error('invalid-input', `${k}: E1-A1: detector-missing is reserved for detector sources, never user-assisted input`);
      continue;
    }
    if (Object.keys(v).some((x) => !OBS_KEYS.has(x))) throw new E1Error('invalid-input', `${k}: unknown fields`);
    if (typeof v.provenance !== 'string') throw new E1Error('invalid-input', `${k}: provenance required`);
    if (!(isNum(v.value) || (typeof v.value === 'string' && v.value.length > 0))) throw new E1Error('invalid-input', `${k}: value must be a finite number or a non-empty string`);
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
      if (!isNum(x.value)) return { res: 'no', used };
      const v = x.value, lo = ob.range.min, hi = ob.range.max;
      if (lo !== null && lo !== undefined && v < lo - m) return { res: 'no', used };
      if (hi !== null && hi !== undefined && v > hi + m) return { res: 'no', used };
      if ((lo !== null && lo !== undefined && Math.abs(v - lo) < m) || (hi !== null && hi !== undefined && Math.abs(v - hi) < m)) boundary = true;
    }
  }
  return { res: boundary ? 'boundary' : 'match', used };
}

function concernCount(rec) { return Object.values(rec.suitability).filter((v) => v === 'concern').length; }

/**
 * Compose a reading from validated observations.
 * opts: { mode = 'combined', qualityAccepted = true, qualityDetail? }
 */
export function composeReading(library, observations, opts = {}) {
  const mode = opts.mode ?? 'combined';
  if (!MODES.includes(mode)) throw new E1Error('invalid-option', `mode must be one of ${MODES.join(', ')}`);
  if (typeof (opts.qualityAccepted ?? true) !== 'boolean') throw new E1Error('invalid-option', 'qualityAccepted must be boolean');
  validateObservations(library, observations);
  const cat = library.catalogue;
  const mb = cat.readingModes.modeBehaviour[mode];
  const trads = new Set(mb.traditions);
  const order = cat.readingModes.placement.sectionOrder;
  const limit = cat.globalPolicy.maxInterpretationsPerCategory;
  const supportRank = cat.readingModes.composition.comparablySuitable.supportRank;
  const reason = (code, feature, detail) => ({ feature, code, wording: library.reasons[code].wording, ...(detail !== undefined ? { detail } : {}) });

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
    const cands = [];
    for (const id of library.order) {
      const rec = library.byId.get(id);
      if (!trads.has(rec.tradition)) continue;
      const el = rec.eligibility.status;
      const { res, used } = matchRecord(rec, observations);
      if (res === 'no') continue;
      if (el === 'historical-context-only') { for (const k of used) status[k] = status[k] ?? 'historical'; historical.push(id); continue; }
      if (el !== 'eligible-initial') {
        if ((el === 'excluded-initial' || el === 'held') && res === 'match') for (const k of used) if (status[k] === null || status[k] === 'boundary') status[k] = 'not-read';
        continue; // eligible-later never enters an E1 reading (its capabilities are not implemented)
      }
      if (res === 'boundary') { for (const k of used) if (status[k] === null) status[k] = 'boundary'; continue; }
      cands.push(rec);
      for (const k of used) status[k] = 'matched';
    }
    for (const k of observed) {
      const s = status[k];
      if (s === 'matched' || s === 'historical') continue;
      notAssessed.set(k, reason(s === 'not-read' ? 'not-read-in-this-version' : s === 'boundary' ? 'boundary' : 'no-supported-content', k));
    }
    const rankKey = (rec) => [supportRank.indexOf(rec.overallSupport), concernCount(rec) <= 2 ? 0 : 1, rec.tradition.startsWith('indian') ? 0 : 1, library.order.indexOf(rec.id)];
    const ranked = [...cands].sort((a, b) => { const ka = rankKey(a), kb = rankKey(b); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return 0; });
    ranked.forEach((rec, rank) => {
      const section = rec.categories.find((c) => order.includes(c) && (sections[c]?.length ?? 0) < limit);
      const item = buildItem(library, rec, observations, rank + 1, section ?? 'more-from-your-reading');
      if (section) (sections[section] ??= []).push(item); else overflow.push(item);
    });
  }
  const orderedSections = order.filter((c) => sections[c]).map((c) => ({ category: c, items: sections[c] }));
  const empty = orderedSections.length === 0 && overflow.length === 0;
  const domains = DOMAINS.map((d) => {
    const catsOfDomain = cat.readingModes.domains[d];
    const items = orderedSections.filter((s) => catsOfDomain.includes(s.category)).flatMap((s) => s.items.map((i) => i.recordId));
    const modeHasContent = library.initialIds.some((id) => { const r = library.byId.get(id); return trads.has(r.tradition) && r.categories.some((c) => catsOfDomain.includes(c)); });
    return { domain: d, categories: catsOfDomain, items, status: items.length ? 'shown' : modeHasContent ? 'not-shown' : 'no-supported-content' };
  });
  return deepFreeze({
    engine: { id: E1_ENGINE.id, version: E1_ENGINE.version, library: cat.libraryVersion, descriptors: E1_ENGINE.descriptorVersion },
    synthetic: true,
    contentStatus: E1_ENGINE.contentStatus,
    publicationApproved: false,
    mode,
    tierCeiling: 'tentative',
    frame: FRAME,
    quality: { accepted: opts.qualityAccepted !== false, ...(opts.qualityDetail ? { detail: opts.qualityDetail } : {}) },
    sections: orderedSections,
    moreFromYourReading: overflow,
    domains,
    notAssessed: [...notAssessed.values()].sort((a, b) => (a.feature < b.feature ? -1 : a.feature > b.feature ? 1 : 0)),
    historicalContextMatched: historical,
    emptyResult: empty ? mb.emptyResult : null,
  });
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
      traditionalUncertainty: rec.uncertainty.traditionalUncertainty,
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
    conflicts: (rec.conflicts ?? []).map((c) => ({ withId: c.withId, kind: c.kind, handling: c.handling })),
    disclosures,
  };
}
