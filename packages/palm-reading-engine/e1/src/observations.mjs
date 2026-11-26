// AURA-PALM-03-E1 -- I1 feature set -> E1 observations (capabilities E1-E3, E1-E4, E1-E5).
// The I1 feature set is first validated by the PALM-03-I1 contract (adapter/feature-set-adapter.mjs, contract C1-C7:
// exact fields, frame/measurement consistency, provenance inventories). Only its validation is used: E1 never calls
// the frozen G6 engine and never reads the adapter's G6 output.
//
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
// 'observed-absent' cannot arise from I1 (it has no "I don't see it" input) and 'detector-missing' is never produced:
// every E1 input is user-assisted.

import { adaptFeatureSet, AdapterError } from '../../adapter/feature-set-adapter.mjs';
import { E1_ENGINE, E1Error } from './identity.mjs';
import { checkFingerBases, headSlope, upwardEndingZone, heartEndingZone } from './descriptors.mjs';
import { verifyConstruction } from './construction.mjs';
import { gridStatus } from './grid.mjs';

/** Observation sets produced by deriveObservations(); the text composer accepts nothing else (R3, F6/F7). */
const MINTED = new WeakSet();
export const isMintedObservations = (o) => typeof o === 'object' && o !== null && MINTED.has(o);
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };

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

/**
 * Derive observations from ONE synthetic input and the I1 feature set built from it (R3, finding F6).
 * options: { synthetic: true }. The feature set must pass the I1 contract AND match the input (construction.mjs):
 * frame, traces, line states, the two interpreted ratios, hand, quality and marks are all re-derived from the input.
 * Finger bases are derived here from the input landmarks; nothing geometric is accepted from the caller separately.
 * Returns a frozen, minted { observations, qualityAccepted, qualityDetail }.
 */
export function deriveObservations(library, input, featureSet, options) {
  if (options === null || typeof options !== 'object' || options.synthetic !== true) throw new E1Error('synthetic-required', 'pass { synthetic: true }; real input is not authorised');
  const fs = featureSet;
  if (fs === null || typeof fs !== 'object' || fs.version !== E1_ENGINE.featureSetVersion) throw new E1Error('invalid-input', `featureSet.version must be ${E1_ENGINE.featureSetVersion}`);
  try {
    adaptFeatureSet(fs, { synthetic: true, scanConfidence: 1 }); // validation only (I1 contract C1-C7)
  } catch (err) {
    if (err instanceof AdapterError) throw new E1Error('invalid-input', `feature set rejected by the I1 contract: ${err.code}: ${err.message}`);
    throw new E1Error('invalid-input', `feature set could not be validated: ${String(err?.message ?? err)}`);
  }
  const construction = verifyConstruction(input, fs);
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
  const result = deepFreeze({ observations: obs, qualityAccepted, qualityDetail });
  MINTED.add(result);
  return result;
}
