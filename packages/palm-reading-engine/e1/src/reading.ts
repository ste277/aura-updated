/**
 * AURA-PALM-03-E1 -- the reading interface and the ONLY reading pipeline (R5: single-input construction).
 * DEVELOPMENT ONLY. SYNTHETIC ONLY. Not imported by any app module; excluded from every release build.
 *
 *   generateSyntheticReading(input, { synthetic: true, mode })
 *
 * `input` is ONE synthetic PALM-03-I1 input (landmarks, image size, quality feedback, line traces, marks).
 *
 * R5 (finding F6): construction authority is not exported, claimable or injectable. This module -- the one file the
 * G5 B2 exception lets import the frozen I1 builder -- binds the builder when it loads, and every step runs in
 * module-private functions here:
 *   1. the explicit own { synthetic: true } declaration (identity.mjs requireSyntheticOptions), before any work;
 *   2. ONE plain-data snapshot of the caller's input (own data properties only, deep-frozen);
 *   3. the I1 feature set, built HERE from that snapshot by the bound builder (never supplied from outside);
 *   4. the construction check (construction.mjs verifyConstruction) against the same snapshot, as defence in depth;
 *   5. observations, the selection plan and the text, from the pinned packaged library; the complete output is
 *      validated (compose.mjs validateReadingOutput) before it is returned.
 * No exported function anywhere in the package accepts a builder, a feature set or derived observations and
 * produces a reading. There is no catalogue, schema, feature-set, finger-base or observation override.
 *
 * Guarantee: the reading is internally consistent with the one supplied synthetic input. It does not prove that the
 * input came from a physical hand or a real image (later scanner / real-image validation milestone).
 */
import { buildPalmFeatureSet, type PalmFeatureSetInput } from '../../../../apps/web/lib/palm-analysis/features';

// The engine modules are ESM (.mjs); Node >= 22.12 loads them through the CommonJS loader used for this file.
/* eslint-disable @typescript-eslint/no-var-requires */
const identity = require('./identity.mjs');
const packaged = require('./packaged.mjs');
const compose = require('./compose.mjs');
const construction = require('./construction.mjs');
const descriptors = require('./descriptors.mjs');
const grid = require('./grid.mjs');
const adapter = require('../../adapter/feature-set-adapter.mjs');
/* eslint-enable @typescript-eslint/no-var-requires */

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export type ReadingMode = 'combined' | 'indian-only' | 'western-only';

const { E1Error: E1ErrorClass, E1_ENGINE: ENGINE, MODES, requireSyntheticOptions, isOwnDataDescriptor } = identity;
/** Bound once, at load: the feature-set builder is never a parameter. */
const BUILD: (input: PalmFeatureSetInput) => Any = buildPalmFeatureSet;

const deepFreeze = (o: Any): Any => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };

// ---------------------------------------------------------------- 2. input snapshot
const MAX_DEPTH = 8;
const MAX_ARRAY = 100000;

/** A deep, frozen, plain-data copy of `input` (own data properties only). */
function snapshotInput(input: unknown): Any {
  const refuse = (at: string, why: string): never => { throw new E1ErrorClass('invalid-input', `input ${at}: ${why}`); };
  const copy = (v: Any, at: string, depth: number): Any => {
    if (v === null || v === undefined || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v !== 'object') return refuse(at, `unsupported value type ${typeof v}`);
    if (depth > MAX_DEPTH) refuse(at, 'nested too deeply');
    if (Array.isArray(v)) {
      if (Object.getPrototypeOf(v) !== Array.prototype) refuse(at, 'not a plain array');
      const len = v.length;
      if (!Number.isSafeInteger(len) || len > MAX_ARRAY) refuse(at, 'array too long');
      const out = new Array(len); // holes are preserved: the I1 contract refuses sparse arrays itself
      for (let i = 0; i < len; i++) {
        const d = Object.getOwnPropertyDescriptor(v, i);
        if (d === undefined) continue;
        if (!isOwnDataDescriptor(d)) refuse(`${at}[${i}]`, 'accessor properties are not accepted');
        out[i] = copy(d.value, `${at}[${i}]`, depth + 1);
      }
      return Object.freeze(out);
    }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) refuse(at, 'not a plain object');
    const out: Any = Object.create(null); // R5: own data only -- nothing can be inherited by later reads
    for (const k of Reflect.ownKeys(v)) {
      if (typeof k !== 'string') refuse(at, 'symbol keys are not accepted');
      const key = k as string;
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (!isOwnDataDescriptor(d)) refuse(`${at}.${key}`, 'accessor properties are not accepted');
      if (key === '__proto__') refuse(at, 'the key __proto__ is not accepted');
      out[key] = copy((d as PropertyDescriptor).value, `${at}.${key}`, depth + 1);
    }
    return Object.freeze(out);
  };
  if (input === null || typeof input !== 'object' || Array.isArray(input)) refuse('', 'must be an object');
  return copy(input, '$', 0);
}

// ---------------------------------------------------------------- 5a. observations (module-private)
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
const LINE_KEYS: Record<string, string> = { heart: 'lines.heart', head: 'lines.head', life: 'lines.life', upward: 'lines.upward' };
const MEASUREMENT_KEYS = ['middleToPalmRatio', 'indexToRingRatio'];
const MARKS = ['yava', 'matsya', 'shankha', 'chatra', 'vedi'];

function lineReason(id: string, reason: string): Any {
  if (reason === 'user-skipped' || reason === 'user-cannot-see') return { notAssessed: reason, detail: reason };
  if (reason === 'not-requested') return { notAssessed: id === 'upward' ? 'not-traced' : 'not-requested', detail: reason };
  if (reason === 'frame-unavailable') return { notAssessed: 'frame-unavailable', detail: reason };
  return { notAssessed: 'trace-unusable', detail: reason }; // not-confirmed, trace-* geometry reasons
}

/** Boundary margin the catalogue sets for a zone descriptor (all records reading that line agree; checked). */
function zoneMargin(library: Any, line: string): number {
  const ms = new Set<number>();
  for (const e of library.catalogue.interpretations) {
    if (e.eligibility.status !== 'eligible-initial') continue;
    if (e.requires.some((r: Any) => r.feature === `lines.${line}` && r.observation !== undefined && Object.prototype.hasOwnProperty.call(r.observation, 'categorical'))) ms.add(e.observationQuality.boundaryMargin);
  }
  if (ms.size !== 1 || ![...ms].every((m) => typeof m === 'number' && m > 0)) throw new E1ErrorClass('invalid-catalogue', `zone records for lines.${line} must share one positive boundaryMargin`);
  return [...ms][0];
}

function deriveObservations(library: Any, snap: Any, fs: Any): Any {
  if (fs === null || typeof fs !== 'object' || fs.version !== ENGINE.featureSetVersion) throw new E1ErrorClass('invalid-input', `featureSet.version must be ${ENGINE.featureSetVersion}`);
  try {
    adapter.adaptFeatureSet(fs, { synthetic: true, scanConfidence: 1 }); // validation only (I1 contract C1-C7)
  } catch (err: Any) {
    if (err instanceof adapter.AdapterError) throw new E1ErrorClass('invalid-input', `feature set rejected by the I1 contract: ${err.code}: ${err.message}`);
    throw new E1ErrorClass('invalid-input', `feature set could not be validated: ${String(err?.message ?? err)}`);
  }
  const built = construction.verifyConstruction(snap, fs);
  const frame = fs.frame;
  const qualityAccepted = frame.qualityStatus === 'accepted' && frame.palmFacing !== false;
  const qualityDetail = qualityAccepted ? 'accepted' : frame.palmFacing === false ? 'palm-not-facing' : `quality-${frame.qualityStatus}`;

  let bases: Any = null, basesDetail: Any = null;
  if (frame.available) {
    const fb = descriptors.checkFingerBases(built.fingerBases);
    if (fb.ok) bases = fb.bases; else basesDetail = fb.detail;
  } else basesDetail = 'frame-unavailable';

  const obs: Any = Object.create(null);
  for (const [id, key] of Object.entries(LINE_KEYS)) {
    const l = fs.lines[id];
    if (l.provenance !== 'user-confirmed') { obs[key] = lineReason(id, l.reason); continue; }
    const pts = l.palmPoints;
    if (id === 'life') { obs[key] = { provenance: 'user-confirmed', value: 'present', descriptor: 'presence' }; continue; }
    if (id === 'head') {
      const s = descriptors.headSlope(pts);
      obs[key] = s.ok ? { provenance: 'user-confirmed', value: s.value, descriptor: 'head-slope' } : { notAssessed: 'trace-unusable', detail: s.detail };
      continue;
    }
    if (!bases) { obs[key] = { notAssessed: 'frame-unavailable', detail: basesDetail }; continue; }
    const z = id === 'upward' ? descriptors.upwardEndingZone(pts, bases, zoneMargin(library, 'upward')) : descriptors.heartEndingZone(pts, bases, zoneMargin(library, 'heart'));
    obs[key] = z.ok
      ? { provenance: 'user-confirmed', value: z.zone, nearEdge: z.nearEdge, adjacentZone: z.adjacentZone, descriptor: id === 'upward' ? 'upward-ending-zone' : 'heart-ending-zone', edgeDistance: z.edgeDistance, margin: z.margin }
      : { notAssessed: 'trace-unusable', detail: z.detail };
  }
  for (const id of MEASUREMENT_KEYS) {
    const m = fs.measurements.measurements[id];
    const gs = m.status === 'measured' ? grid.gridStatus(m.value) : null;
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

// ---------------------------------------------------------------- 5b. text (module-private)
const TAG: Record<string, string> = {
  'indian-classical': 'Indian · classical',
  'indian-later-treatise': 'Indian · medieval treatise',
  'indian-diagram-tradition': 'Indian · diagram tradition',
  'western-19c-chirognomy': 'Western · 19th c.',
  'western-19c-chiromancy': 'Western · 19th c.',
};
const own = (o: Any, k: string): boolean => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

function buildItem(library: Any, rec: Any, obs: Any, rank: number, section: string): Any {
  // Records are null-prototype normalized records (library.mjs normalizeRecord): only their own fields exist.
  const u = rec.userFacing;
  const disclosures: string[] = [];
  if (rec.overallSupport === 'disputed') disclosures.push('disputed-within-tradition');
  if (rec.requires.some((r: Any) => r.feature === 'lines.heart')) disclosures.push('ayurlekha-meaning-not-used');
  if (rec.requires.some((r: Any) => r.feature.startsWith('measurements.'))) disclosures.push('not-a-scientific-measure');
  return {
    recordId: rec.id,
    rank,
    section,
    tradition: rec.tradition,
    traditionTag: TAG[rec.tradition],
    supportingFeatures: rec.requires.map((r: Any) => ({
      feature: r.feature,
      anatomical: r.anatomical,
      provenance: obs[r.feature].provenance,
      observed: obs[r.feature].value,
      descriptor: own(obs[r.feature], 'descriptor') ? obs[r.feature].descriptor : null,
      ...(own(r.observation, 'thresholdStatus') ? { thresholdStatus: r.observation.thresholdStatus } : {}),
    })),
    sources: rec.sources.map((s: Any) => ({ sourceId: s.sourceId, locator: s.locator, supportLevel: s.supportLevel, verification: s.verification, title: own(library.sources[s.sourceId], 'title') ? library.sources[s.sourceId].title : null })),
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
      band: compose.concernCount(rec) <= 2 ? 0 : 1,
      eligibility: rec.eligibility.status,
    },
    reviewStatus: rec.review.status,
    text: {
      observation: u.observation,
      reading: u.reading,
      reflection: u.reflection,
      ...(own(u, 'applicationNote') && u.applicationNote ? { applicationNote: u.applicationNote } : {}),
    },
    // reviewer-facing conflict notes and free-text references are never emitted; only catalogue record ids are
    conflicts: (own(rec, 'conflicts') ? rec.conflicts : []).map((c: Any) => ({ withId: /^C1-(IN|WE)-[A-Z0-9-]+$/.test(c.withId) ? c.withId : 'external-reference', kind: c.kind, handling: c.handling })),
    disclosures,
  };
}

function composeReading(library: Any, derived: Any, mode: string): Any {
  const plan = compose.planSelection(library, derived.observations, { synthetic: true, mode, qualityAccepted: derived.qualityAccepted, qualityDetail: derived.qualityDetail });
  const cat = library.catalogue;
  const render = (it: Any) => buildItem(library, library.byId[it.recordId], derived.observations, it.rank, it.section);
  const reading = {
    engine: { id: ENGINE.id, version: ENGINE.version, library: cat.libraryVersion, descriptors: ENGINE.descriptorVersion },
    synthetic: true,
    contentStatus: ENGINE.contentStatus,
    publicationApproved: false,
    mode: plan.mode,
    tierCeiling: 'tentative',
    frame: compose.READING_FRAME,
    quality: { ...plan.quality },
    sections: plan.sections.map((x: Any) => ({ category: x.category, items: x.items.map(render) })),
    moreFromYourReading: plan.moreFromYourReading.map(render),
    domains: plan.domains.map((d: Any) => ({ ...d, categories: [...d.categories], items: [...d.items] })),
    notAssessed: plan.notAssessed.map((n: Any) => ({ feature: n.feature, code: n.code, wording: library.reasons[n.code].wording, ...(own(n, 'detail') && n.detail !== undefined ? { detail: n.detail } : {}) })),
    observed: Object.entries(derived.observations).filter(([, v]: Any) => !own(v, 'notAssessed')).map(([feature, v]: Any) => ({ feature, provenance: v.provenance, value: v.value, ...(own(v, 'nearEdge') && v.nearEdge !== undefined ? { nearEdge: v.nearEdge } : {}), ...(own(v, 'adjacentZone') && v.adjacentZone ? { adjacentZone: v.adjacentZone } : {}) })).sort((x: Any, y: Any) => (x.feature < y.feature ? -1 : 1)),
    historicalContextMatched: [...plan.historicalContextMatched],
    emptyResult: plan.emptyResult,
  };
  compose.validateReadingOutput(reading, library);
  return deepFreeze(reading);
}

// ---------------------------------------------------------------- the interface
/** options: an own data property { synthetic: true } (exactly true) and an optional mode. Nothing else. */
export function generateSyntheticReading(input: PalmFeatureSetInput, options: { synthetic: true; mode?: ReadingMode }): unknown {
  const opts = requireSyntheticOptions(options, ['synthetic', 'mode']); // 1. before any work
  const mode = opts.mode ?? 'combined';
  if (!MODES.includes(mode)) throw new E1ErrorClass('invalid-option', `mode must be one of ${MODES.join(', ')}`);
  const snap = snapshotInput(input); // 2.
  let built: Any;
  try {
    built = BUILD(snap); // 3. the bound I1 builder, on the snapshot
  } catch (err: Any) {
    throw new E1ErrorClass('invalid-input', `the I1 builder refused the input: ${String(err?.message ?? err)}`);
  }
  if (built === null || typeof built !== 'object' || built.ok !== true) {
    const errors = Array.isArray(built?.errors) ? built.errors.map(String).join('; ') : 'no feature set';
    throw new E1ErrorClass('invalid-input', `the I1 builder refused the input: ${errors}`);
  }
  const library = packaged.pinnedLibrary();
  return composeReading(library, deriveObservations(library, snap, built.featureSet), mode); // 4. + 5.
}

export const E1Error = E1ErrorClass;
export const E1_ENGINE = ENGINE;
