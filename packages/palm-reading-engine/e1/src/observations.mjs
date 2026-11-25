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

import { createHash } from 'node:crypto';
import { adaptFeatureSet, AdapterError } from '../../adapter/feature-set-adapter.mjs';
import { E1_ENGINE, E1Error, OBSERVATION_ENVELOPE } from './identity.mjs';
import { checkFingerBases, headSlope, upwardEndingZone, heartEndingZone } from './descriptors.mjs';

/** Canonical JSON (sorted keys, undefined omitted). Must match canonicalJson() in apps/web/lib/palm-analysis/fingerBases.ts. */
export function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x === undefined ? null : x)).join(',')}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
}
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
/** R2 (finding F6): the seal binds the feature set and the finger bases to one frame id, computed by the I1 helper. */
export function observationSeal(e) {
  return sha256(canonicalJson({ kind: e.kind, version: e.version, frameId: e.frameId, featureSet: e.featureSet, fingerBases: e.fingerBases, fingerBasesReason: e.fingerBasesReason }));
}

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
 * Validate a sealed E1 observation envelope (built by buildPalmE1Observation() in apps/web/lib/palm-analysis/
 * fingerBases.ts from ONE I1 input) and derive observations. The feature set and the finger bases must come from the
 * same frame: the envelope's seal is recomputed here and any mismatch (inputs from different hands or frames, or a
 * modified feature set or finger bases) is refused. The seal protects against accidental or caller-side mispairing;
 * it is not a secret-keyed signature (development-only, synthetic input).
 * options: { synthetic: true }.  Returns { observations, qualityAccepted, qualityDetail }.
 */
export function deriveObservations(library, input, options) {
  if (options === null || typeof options !== 'object' || options.synthetic !== true) throw new E1Error('synthetic-required', 'pass { synthetic: true }; real input is not authorised');
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new E1Error('invalid-input', 'input must be a sealed observation envelope');
  const want = ['kind', 'version', 'frameId', 'featureSet', 'fingerBases', 'fingerBasesReason', 'seal'];
  const keys = Object.keys(input);
  if (keys.length !== want.length || !want.every((k) => keys.includes(k))) throw new E1Error('invalid-input', `envelope fields must be exactly ${want.join(', ')}`);
  if (input.kind !== OBSERVATION_ENVELOPE.kind || input.version !== OBSERVATION_ENVELOPE.version) throw new E1Error('invalid-input', `envelope must be ${OBSERVATION_ENVELOPE.kind}@${OBSERVATION_ENVELOPE.version}`);
  if (typeof input.frameId !== 'string' || !/^[0-9a-f]{64}$/.test(input.frameId) || typeof input.seal !== 'string') throw new E1Error('invalid-input', 'frameId and seal must be SHA-256 hex strings');
  if (observationSeal(input) !== input.seal) throw new E1Error('frame-mismatch', 'feature set and finger bases are not the sealed pair from one observation frame');
  const fs = input.featureSet;
  if (fs === null || typeof fs !== 'object' || fs.version !== E1_ENGINE.featureSetVersion) throw new E1Error('invalid-input', `featureSet.version must be ${E1_ENGINE.featureSetVersion}`);
  try {
    adaptFeatureSet(fs, { synthetic: true, scanConfidence: 1 }); // validation only (I1 contract C1-C7)
  } catch (err) {
    if (err instanceof AdapterError) throw new E1Error('invalid-input', `feature set rejected by the I1 contract: ${err.code}: ${err.message}`);
    throw new E1Error('invalid-input', `feature set could not be validated: ${String(err?.message ?? err)}`);
  }
  if ((input.fingerBases !== null) !== (fs.frame.available === true)) throw new E1Error('frame-mismatch', 'finger bases must exist exactly when the feature set has a palm frame');
  const frame = fs.frame;
  const qualityAccepted = frame.qualityStatus === 'accepted' && frame.palmFacing !== false;
  const qualityDetail = qualityAccepted ? 'accepted' : frame.palmFacing === false ? 'palm-not-facing' : `quality-${frame.qualityStatus}`;

  let bases = null, basesDetail = null;
  if (frame.available) {
    const fb = checkFingerBases(input.fingerBases);
    if (fb.ok) bases = fb.bases; else basesDetail = fb.detail;
  } else basesDetail = input.fingerBasesReason ?? 'frame-unavailable';

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
  return { observations: obs, qualityAccepted, qualityDetail };
}
