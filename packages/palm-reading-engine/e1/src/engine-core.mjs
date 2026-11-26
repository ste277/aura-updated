// AURA-PALM-03-E1 -- the single reading pipeline (R4: findings F6 and F7).
// DEVELOPMENT ONLY. SYNTHETIC ONLY.
//
// One construction path, with no feature-set, observation, catalogue or schema parameter anywhere:
//
//   reading.ts --claimSyntheticReader(buildPalmFeatureSet)--> reader(input, { synthetic: true, mode })
//     1. explicit own { synthetic: true } declaration (identity.mjs requireSyntheticOptions);
//     2. ONE plain-data snapshot of the caller's input (no accessors, no prototypes, deep-frozen), so every later
//        step reads the same values;
//     3. the I1 feature set is built HERE, from that snapshot, by the builder bound at claim time;
//     4. the feature set must pass the I1 contract and match the snapshot field by field (construction.mjs:
//        frame, palm facing, finger bases, traces, line states, the two interpreted ratios with their status and
//        reasons, hand, quality and marks), else 'construction-mismatch';
//     5. observations and text are derived by module-private functions from the pinned packaged library, and the
//        complete output is validated (compose.mjs validateReadingOutput).
//
// The pipeline can be claimed ONCE per process. reading.ts claims it when it loads; any later claim is refused
// ('pipeline-claimed'). If other code claimed it first, reading.ts fails to load, so the supported interface is
// unavailable rather than shared (fail closed). Even then, step 4 refuses a feature set that is not the I1
// representation of the same input, so an inconsistent supplied state cannot produce a reading.
//
// Guarantee: internal consistency with ONE supplied synthetic input. Not physical-hand identity or image provenance.
import { adaptFeatureSet, AdapterError } from '../../adapter/feature-set-adapter.mjs';
import { pinnedLibrary } from './packaged.mjs';
import { planSelection, validateReadingOutput, concernCount, READING_FRAME } from './compose.mjs';
import { verifyConstruction } from './construction.mjs';
import { checkFingerBases, headSlope, upwardEndingZone, heartEndingZone } from './descriptors.mjs';
import { gridStatus } from './grid.mjs';
import { E1Error, E1_ENGINE, MODES, requireSyntheticOptions } from './identity.mjs';

const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };

// ---------------------------------------------------------------- input snapshot
const MAX_DEPTH = 8;
const MAX_ARRAY = 100000;

/** A deep, frozen, plain-data copy of `input`. Accessors, non-plain objects, functions and symbols are refused. */
function snapshotInput(input) {
  const refuse = (at, why) => { throw new E1Error('invalid-input', `input ${at}: ${why}`); };
  const copy = (v, at, depth) => {
    if (v === null || v === undefined || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v !== 'object') refuse(at, `unsupported value type ${typeof v}`);
    if (depth > MAX_DEPTH) refuse(at, 'nested too deeply');
    if (Array.isArray(v)) {
      if (Object.getPrototypeOf(v) !== Array.prototype) refuse(at, 'not a plain array');
      const len = v.length;
      if (!Number.isSafeInteger(len) || len > MAX_ARRAY) refuse(at, 'array too long');
      const out = new Array(len); // holes are preserved: the I1 contract refuses sparse arrays itself
      for (let i = 0; i < len; i++) {
        const d = Object.getOwnPropertyDescriptor(v, i);
        if (d === undefined) continue;
        if (!('value' in d)) refuse(`${at}[${i}]`, 'accessor properties are not accepted');
        out[i] = copy(d.value, `${at}[${i}]`, depth + 1);
      }
      return Object.freeze(out);
    }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) refuse(at, 'not a plain object');
    const out = {};
    for (const k of Reflect.ownKeys(v)) {
      if (typeof k !== 'string') refuse(at, 'symbol keys are not accepted');
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (!('value' in d)) refuse(`${at}.${k}`, 'accessor properties are not accepted');
      if (k === '__proto__') refuse(at, 'the key __proto__ is not accepted');
      out[k] = copy(d.value, `${at}.${k}`, depth + 1);
    }
    return Object.freeze(out);
  };
  if (input === null || typeof input !== 'object' || Array.isArray(input)) refuse('', 'must be an object');
  return copy(input, '$', 0);
}

// ---------------------------------------------------------------- observations (module-private)
// Observations are keyed by the catalogue's feature ids. Each is either
//   { provenance, value[, nearEdge, adjacentZone, descriptor] }      an observed value, or
//   { notAssessed: <RC-13 code>, detail }                            why nothing can be read.
// I1 distinctions are preserved, never merged (M4, E1-A1, E1-A2):
//   user-skipped / user-cannot-see       the user's own choice, never "not detected"
//   not-traced / not-requested           not offered or optional and not given
//   trace-unusable (detail: I1 reason)   traced but unusable (geometry, not confirmed, ambiguous endpoints)
//   frame-unavailable                    no usable palm frame or finger bases
//   measurement-unavailable (detail)     unavailable or UNCERTAIN measurement (detail keeps 'uncertain:<reasons>')
//   mark-unknown                         not reported (unknown, never absent)
// 'observed-absent' cannot arise from I1 and 'detector-missing' is never produced: every E1 input is user-assisted.
const LINE_KEYS = Object.freeze({ heart: 'lines.heart', head: 'lines.head', life: 'lines.life', upward: 'lines.upward' });
const MEASUREMENT_KEYS = Object.freeze(['middleToPalmRatio', 'indexToRingRatio']);
const MARKS = Object.freeze(['yava', 'matsya', 'shankha', 'chatra', 'vedi']);

function lineReason(id, reason) {
  if (reason === 'user-skipped' || reason === 'user-cannot-see') return { notAssessed: reason, detail: reason };
  if (reason === 'not-requested') return { notAssessed: id === 'upward' ? 'not-traced' : 'not-requested', detail: reason };
  if (reason === 'frame-unavailable') return { notAssessed: 'frame-unavailable', detail: reason };
  return { notAssessed: 'trace-unusable', detail: reason }; // not-confirmed, trace-* geometry reasons
}

/** Boundary margin the catalogue sets for a zone descriptor (all records reading that line agree; checked). */
function zoneMargin(library, line) {
  const ms = new Set();
  for (const e of library.catalogue.interpretations) {
    if (e.eligibility.status !== 'eligible-initial') continue;
    if (e.requires.some((r) => r.feature === `lines.${line}` && 'categorical' in (r.observation ?? {}))) ms.add(e.observationQuality.boundaryMargin);
  }
  if (ms.size !== 1 || ![...ms].every((m) => typeof m === 'number' && m > 0)) throw new E1Error('invalid-catalogue', `zone records for lines.${line} must share one positive boundaryMargin`);
  return [...ms][0];
}

function deriveObservations(library, snap, fs) {
  if (fs === null || typeof fs !== 'object' || fs.version !== E1_ENGINE.featureSetVersion) throw new E1Error('invalid-input', `featureSet.version must be ${E1_ENGINE.featureSetVersion}`);
  try {
    adaptFeatureSet(fs, { synthetic: true, scanConfidence: 1 }); // validation only (I1 contract C1-C7)
  } catch (err) {
    if (err instanceof AdapterError) throw new E1Error('invalid-input', `feature set rejected by the I1 contract: ${err.code}: ${err.message}`);
    throw new E1Error('invalid-input', `feature set could not be validated: ${String(err?.message ?? err)}`);
  }
  const construction = verifyConstruction(snap, fs);
  const frame = fs.frame;
  const qualityAccepted = frame.qualityStatus === 'accepted' && frame.palmFacing !== false;
  const qualityDetail = qualityAccepted ? 'accepted' : frame.palmFacing === false ? 'palm-not-facing' : `quality-${frame.qualityStatus}`;

  let bases = null, basesDetail = null;
  if (frame.available) {
    const fb = checkFingerBases(construction.fingerBases);
    if (fb.ok) bases = fb.bases; else basesDetail = fb.detail;
  } else basesDetail = 'frame-unavailable';

  const obs = {};
  for (const [id, key] of Object.entries(LINE_KEYS)) {
    const l = fs.lines[id];
    if (l.provenance !== 'user-confirmed') { obs[key] = lineReason(id, l.reason); continue; }
    const pts = l.palmPoints;
    if (id === 'life') { obs[key] = { provenance: 'user-confirmed', value: 'present', descriptor: 'presence' }; continue; }
    if (id === 'head') {
      const s = headSlope(pts);
      obs[key] = s.ok ? { provenance: 'user-confirmed', value: s.value, descriptor: 'head-slope' } : { notAssessed: 'trace-unusable', detail: s.detail };
      continue;
    }
    if (!bases) { obs[key] = { notAssessed: 'frame-unavailable', detail: basesDetail }; continue; }
    const z = id === 'upward' ? upwardEndingZone(pts, bases, zoneMargin(library, 'upward')) : heartEndingZone(pts, bases, zoneMargin(library, 'heart'));
    obs[key] = z.ok
      ? { provenance: 'user-confirmed', value: z.zone, nearEdge: z.nearEdge, adjacentZone: z.adjacentZone, descriptor: id === 'upward' ? 'upward-ending-zone' : 'heart-ending-zone', edgeDistance: z.edgeDistance, margin: z.margin }
      : { notAssessed: 'trace-unusable', detail: z.detail };
  }
  for (const id of MEASUREMENT_KEYS) {
    const m = fs.measurements.measurements[id];
    const gs = m.status === 'measured' ? gridStatus(m.value) : null;
    // R3 (finding F5): a valid I1 value that cannot be compared safely (beyond the interpretable range, e.g. 9e+304)
    // withholds only the interpretation that depends on it; the rest of the reading is unaffected.
    if (gs !== null && gs !== 'ok') { obs[`measurements.${id}`] = { notAssessed: 'measurement-unavailable', detail: gs === 'out-of-range' ? 'value-outside-interpretable-range' : `value-${gs}` }; continue; }
    obs[`measurements.${id}`] = m.status === 'measured'
      ? { provenance: 'automatic-measured', value: m.value, descriptor: 'i1-measurement' }
      // when the frame's quality is not accepted, I1's 'uncertain' comes from that same quality: report the gate (C1 R3Q)
      : { notAssessed: m.status === 'uncertain' && !qualityAccepted ? 'quality-gated' : 'measurement-unavailable', detail: `${m.status}:${m.reasons.join('+')}` };
  }
  for (const id of MARKS) {
    const mk = fs.marks[id];
    if (mk.provenance === 'user-reported') obs[`marks.${id}`] = { provenance: 'user-reported', value: 'reported', descriptor: 'user-report' };
    else obs[`marks.${id}`] = mk.reason === 'user-skipped' ? { notAssessed: 'user-skipped', detail: 'user-skipped' } : { notAssessed: 'mark-unknown', detail: mk.reason };
  }
  // The head/life origin is not measured in this milestone (C1: not necessary; its only consumers are excluded or
  // later). When both lines were traced the user gave the input, so it is listed, revealing nothing (RC-11).
  if (obs['lines.head'].provenance && obs['lines.life'].provenance) obs['proposed.origin.gap'] = { notAssessed: 'not-read-in-this-version', detail: 'origin-gap-not-measured' };
  return deepFreeze({ observations: obs, qualityAccepted, qualityDetail });
}

// ---------------------------------------------------------------- text (module-private)
const TAG = Object.freeze({
  'indian-classical': 'Indian · classical',
  'indian-later-treatise': 'Indian · medieval treatise',
  'indian-diagram-tradition': 'Indian · diagram tradition',
  'western-19c-chirognomy': 'Western · 19th c.',
  'western-19c-chiromancy': 'Western · 19th c.',
});

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

function composeReading(library, derived, mode) {
  const plan = planSelection(library, derived.observations, { synthetic: true, mode, qualityAccepted: derived.qualityAccepted, qualityDetail: derived.qualityDetail });
  const cat = library.catalogue;
  const render = (it) => buildItem(library, library.byId[it.recordId], derived.observations, it.rank, it.section);
  const reading = {
    engine: { id: E1_ENGINE.id, version: E1_ENGINE.version, library: cat.libraryVersion, descriptors: E1_ENGINE.descriptorVersion },
    synthetic: true,
    contentStatus: E1_ENGINE.contentStatus,
    publicationApproved: false,
    mode: plan.mode,
    tierCeiling: 'tentative',
    frame: READING_FRAME,
    quality: { ...plan.quality },
    sections: plan.sections.map((x) => ({ category: x.category, items: x.items.map(render) })),
    moreFromYourReading: plan.moreFromYourReading.map(render),
    domains: plan.domains.map((d) => ({ ...d, categories: [...d.categories], items: [...d.items] })),
    notAssessed: plan.notAssessed.map((n) => ({ feature: n.feature, code: n.code, wording: library.reasons[n.code].wording, ...(n.detail !== undefined ? { detail: n.detail } : {}) })),
    observed: Object.entries(derived.observations).filter(([, v]) => !('notAssessed' in v)).map(([feature, v]) => ({ feature, provenance: v.provenance, value: v.value, ...(v.nearEdge !== undefined ? { nearEdge: v.nearEdge } : {}), ...(v.adjacentZone ? { adjacentZone: v.adjacentZone } : {}) })).sort((x, y) => (x.feature < y.feature ? -1 : 1)),
    historicalContextMatched: [...plan.historicalContextMatched],
    emptyResult: plan.emptyResult,
  };
  validateReadingOutput(reading, library);
  return deepFreeze(reading);
}

// ---------------------------------------------------------------- the one entry point
let claimed = false;

/**
 * Bind the I1 feature-set builder and return the reader. Callable ONCE per process (reading.ts does so at load).
 * The reader takes exactly (input, { synthetic: true, mode? }).
 */
export function claimSyntheticReader(build) {
  if (claimed) throw new E1Error('pipeline-claimed', 'the E1 reading pipeline is already bound; use generateSyntheticReading() from reading.ts');
  if (typeof build !== 'function') throw new E1Error('invalid-option', 'a feature-set builder is required');
  claimed = true;
  return Object.freeze(function reader(input, options) {
    const opts = requireSyntheticOptions(options, ['synthetic', 'mode']);
    const mode = opts.mode ?? 'combined';
    if (!MODES.includes(mode)) throw new E1Error('invalid-option', `mode must be one of ${MODES.join(', ')}`);
    const snap = snapshotInput(input);
    let built;
    try {
      built = build(snap);
    } catch (err) {
      throw new E1Error('invalid-input', `the I1 builder refused the input: ${String(err?.message ?? err)}`);
    }
    if (built === null || typeof built !== 'object' || built.ok !== true) {
      const errors = Array.isArray(built?.errors) ? built.errors.map(String).join('; ') : 'no feature set';
      throw new E1Error('invalid-input', `the I1 builder refused the input: ${errors}`);
    }
    const library = pinnedLibrary();
    return composeReading(library, deriveObservations(library, snap, built.featureSet), mode);
  });
}

export { E1Error, E1_ENGINE };
