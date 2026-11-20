// AURA-PALM-G6-D0 — Deterministic synthetic reading engine.
// Input: a synthetic `aura.palm.features` v0.1.0 object. Output: a structured, traceable reading.
// No I/O, no network, no clock, no randomness. The only import outside this folder is node:crypto (hashing).
//
// R1 (AURA-PALM-G6-D0-R1):
//   R1-F1  the prohibited-claim lint reads user-facing text fields only, never identifiers; generateReading is total
//          for unreadable/unhashable payloads (controlled invalid-input reading instead of an exception).
//   R1-F2  registry lookups go through ownLookup() on null-prototype tables; per-class grouping uses a Map.
//   R1-F3  `gapsBridged` is carried only as preprocessing metadata; break-dependent logic reads observed breaks only.
//   R1-F4  frame/orientation gating: direction- and scale-dependent families decline when the frame is unreliable;
//          palm side unconfirmed or model-estimated handedness caps at tentative. Every cap/decline is traced.
//   R1-F5  families decline when the endpoint roles they read are ambiguous (branch atT is radial-referenced by contract).
//
// R1.1 (AURA-PALM-G6-D0-R1.1):
//   R1-RV-02 / RV-09 / RV-10  generateReading works ONLY on a validated, deep-frozen snapshot (snapshot.mjs): the
//          caller's object is read once, through own data descriptors, against the closed contract shape; it is never
//          read again. The input hash is computed over the snapshot.
//   R1-RV-01  central-longitudinal identification uses the raw, reversal-invariant verticality with the shared
//          inclusive comparison (atMost); no rounding before classification.
//   R1-RV-05  rotation consistency (G5-I1 rule |rotationDeg| > 45 ⇔ hand-rotated) and an `axis` frame property.
//   R1-RV-07  a hypothesis tier cap is recorded in capsApplied ('hypothesis-capped').
//
// R1.2 (AURA-PALM-G6-D0-R1.2):
//   R1.1-RV-01  descriptors come from the canonical point sequence; where the two point orders give different 4-dp
//          values (a rounding tie) the OWNER-APPROVED CONSERVATIVE TIE RULE applies: a length tie that changes the
//          selected reading shows both neighbouring readings at tentative ('order-tie'); the central-longitudinal
//          centre gate must pass in both orders, else the candidate is not identified ('tieExcludedCreaseIds').
//   R1.1-RV-03  invalid-input readings list at most MAX_REPORTED_ERRORS errors, with errorCount / errorsTruncated.
//
// R1.3 (AURA-PALM-G6-D0-R1.3, owner-approved conservative reconciliation; supersedes the R1.2 tie handling):
//   R1.2-RV-01  a MINOR crease whose centre passes in EITHER point order competes for conflict detection; it is
//          identified only if it is the sole competitor AND passes in BOTH orders. Centre-tied candidates are traced.
//   R1.2-RV-02  a length tie keeps only the readings selected in BOTH orders (intersection); if either order makes no
//          claim the family abstains (quiet). Any difference between the orders lowers the tier to tentative.
//   R1.2-RV-07  identical selection and ambiguity in both orders → no tie-specific change.
//   R1.2-RV-03  (schema.polylineProblem) a polyline is valid only if valid in both orders.

import { createHash } from 'node:crypto';
import { validateFeatures, DETECTOR_REGISTRY, MAJOR_CLASSES, FEATURE_SCHEMA_VERSION, VALIDATOR_REVISION, ownLookup, GEOMETRY_CONTRACT, atMost, MAX_REPORTED_ERRORS } from './schema.mjs';
import { snapshotInput } from './snapshot.mjs';
import { describe, dist, verticalDeviation } from './geometry.mjs';
import {
  POLICY_VERSION, THRESHOLDS, TIERS, BASIS_CAP, STATUS_CAP, CLASS_SOURCE_CAP, TENTATIVE_CAP, tierFor,
  FRAME_SCALE_ISSUES, FRAME_ORIENTATION_ISSUES, ROTATION_ACCEPT_LIMIT_DEG,
  DISCLAIMER, TIER_LEAD, UNCERTAINTY_NOTES, DECLINE_TEXT, lintText,
} from './policy.mjs';
import { RULESET_VERSION, DOMAINS, DOMAIN_TITLES, FAMILIES, TRADITIONAL_NAMES, provenanceFor, exclusionsFor } from './rules.mjs';

export const ENGINE_VERSION = '0.1.4-g6d0r1.3-synthetic';
const HYPOTHESIS_CAP = TENTATIVE_CAP;
const r4 = (v) => Math.round(v * 1e4) / 1e4;

export const EXTRA_DECLINE_TEXT = Object.freeze({
  'ambiguous-identity': 'This crease could be more than one of the major creases, so it was not interpreted.',
  'palm-not-facing': 'The scan did not show the palm side of the hand, so no reading was attempted.',
});
const declineText = (reason) => ownLookup(DECLINE_TEXT, reason) ?? ownLookup(EXTRA_DECLINE_TEXT, reason) ?? null;

function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const inputHash = (input) => createHash('sha256').update(canonicalJson(input)).digest('hex');
/** R1-F1: hashing must never throw (BigInt, cycles, throwing getters). Returns null when the payload cannot be hashed. */
function tryInputHash(input) { try { return inputHash(input); } catch { return null; } }

function header(hash, status) {
  return {
    readingId: `rd_${hash.slice(0, 16)}`, inputSha256: hash, status,
    versions: { engine: ENGINE_VERSION, ruleset: RULESET_VERSION, policy: POLICY_VERSION, featureSchema: FEATURE_SCHEMA_VERSION, validator: VALIDATOR_REVISION },
    synthetic: true, disclaimer: DISCLAIMER,
  };
}

/**
 * R1.2 (R1.1-RV-03): bounded, deterministic error reporting. `errors` lists at most MAX_REPORTED_ERRORS entries in a
 * fixed order (snapshot walk order, then validation order). `errorCount` is the full count. When entries are omitted,
 * a final `{ code: 'errors-truncated', omitted }` entry says so and `errorsTruncated` is true. The reading is invalid
 * whenever errorCount > 0, however many entries are listed. Messages are fixed strings and never echo input values.
 */
function invalidReading(allErrors, totalCount, hash) {
  const listed = allErrors.slice(0, MAX_REPORTED_ERRORS);
  const omitted = totalCount - listed.length;
  const errors = omitted > 0 ? [...listed, { path: '$', code: 'errors-truncated', msg: 'Further validation errors were found but are not listed.', omitted }] : listed;
  // For unhashable payloads the reading id is derived from the (static, id-free) listed errors and the count instead.
  const h = hash ?? createHash('sha256').update(canonicalJson({ invalid: errors.map((e) => [e.path, e.code]), totalCount })).digest('hex');
  return finalize({ ...header(h, 'invalid-input'), decline: { reason: 'invalid-input', text: DECLINE_TEXT['invalid-input'] }, errors, errorCount: totalCount, errorsTruncated: omitted > 0, observations: [], sections: [] });
}

function declinedReading(hash, reason, extra = {}) {
  return finalize({ ...header(hash, 'declined'), decline: { reason, text: declineText(reason) }, observations: [], sections: [], ...extra });
}

/** R1-F4: assess whether the palm-normalized frame's direction (radial/ulnar) and scale (palm width) can be trusted. */
function assessFrame(input) {
  const { handedness, orientation, quality } = input.capture;
  const handKnown = handedness.value === 'left' || handedness.value === 'right';
  const facing = orientation.palmFacing; // true | null here (false is declined globally)
  const scaleIssues = quality.issues.filter((i) => FRAME_SCALE_ISSUES.includes(i));
  const orientIssues = quality.issues.filter((i) => FRAME_ORIENTATION_ISSUES.includes(i));
  const scaleReasons = [];
  if (!input.landmarks.present) scaleReasons.push('landmarks-absent');
  if (scaleIssues.length) scaleReasons.push('frame-quality-low');
  // R1.1: rotation evidence must agree with the scanner's own rule (hand-rotated ⇔ |rotationDeg| > 45).
  const rotatedFlag = quality.issues.includes('hand-rotated');
  const rotatedAngle = Math.abs(orientation.rotationDeg) > ROTATION_ACCEPT_LIMIT_DEG;
  const axisReasons = [...scaleReasons];
  if (orientIssues.length) axisReasons.push('orientation-conflict');
  if (rotatedFlag !== rotatedAngle) axisReasons.push('rotation-conflict');
  else if (rotatedAngle) axisReasons.push('rotation-out-of-range');
  const directionReasons = [...axisReasons];
  if (!handKnown) directionReasons.push('handedness-unknown');
  if (facing !== true) directionReasons.push('palm-facing-unconfirmed');
  return Object.freeze({
    handedness: Object.freeze({ value: handedness.value, source: handedness.source }),
    palmFacing: facing,
    landmarksPresent: input.landmarks.present,
    frameQualityIssues: Object.freeze([...new Set([...scaleIssues, ...orientIssues])].sort()),
    rotationDeg: orientation.rotationDeg,
    scaleReliable: scaleReasons.length === 0,
    axisReliable: axisReasons.length === 0,
    directionReliable: directionReasons.length === 0,
    scaleReasons: Object.freeze(scaleReasons),
    axisReasons: Object.freeze([...new Set(axisReasons)]),
    directionReasons: Object.freeze([...new Set(directionReasons)]),
    palmSideCap: facing !== true,                                  // every family capped at tentative
    handednessModelCap: handKnown && handedness.source === 'landmark-model', // direction families capped at tentative
  });
}

/** R1-F3: observed break count for a crease. gapsBridged is never consulted. */
function observedBreaks(crease, detectorCaps) {
  if (!detectorCaps.observesBreaks) return { status: 'unsupported', value: null };
  const b = crease.continuity.breaks;
  if (b === undefined || b === null) return { status: 'not-observed', value: null };
  return { status: 'observed', value: b };
}
const preprocessingOf = (crease) => Object.freeze({
  gapsBridged: Number.isInteger(crease.continuity.gapsBridged) ? crease.continuity.gapsBridged : null,
  meaning: 'detector preprocessing metadata (gaps bridged by the tracker); not an observation of the palm',
  usedForInterpretation: false,
});

/** Build evidence context: per-class state, chosen crease, descriptors and evidence score with caps traced. */
function resolveClasses(input) {
  const scan = input.scanConfidence.value;
  const detector = ownLookup(DETECTOR_REGISTRY, input.creases.source.detector);
  const detStatus = detector.status;
  const conflictIds = new Set(input.creases.conflicts.flatMap((c) => c.ids));
  const items = [...input.creases.items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byClass = new Map();
  for (const c of items) { const k = c.identity.anatomicalClass; if (!byClass.has(k)) byClass.set(k, []); byClass.get(k).push(c); }

  const evidenceOf = (c, extraCap) => {
    const caps = [];
    const det = Math.min(c.detection.confidence, ownLookup(BASIS_CAP, c.detection.confidenceBasis));
    if (det < c.detection.confidence) caps.push('basis-capped');
    const cls = Math.min(c.identity.classConfidence, ownLookup(CLASS_SOURCE_CAP, c.identity.classSource));
    const st = ownLookup(STATUS_CAP, detStatus);
    if (st < 1 && st < Math.min(scan, det, cls)) caps.push('basis-capped');
    let ev = Math.min(scan, det, cls, st);
    if (extraCap !== undefined && extraCap < ev) { ev = extraCap; caps.push('hypothesis-capped'); }
    // Tier on the raw score; r4 is for display only (rounding must never lift evidence across a threshold).
    return { score: r4(ev), raw: ev, components: { scan, detection: c.detection.confidence, detectionBasis: c.detection.confidenceBasis, classConfidence: c.identity.classConfidence, classSource: c.identity.classSource, detectorStatus: detStatus }, caps: [...new Set(caps)] };
  };
  const okState = (c, d, ev) => ({
    status: tierFor(ev.raw) === TIERS.INSUFFICIENT ? 'low-confidence' : 'ok', crease: c, creaseIds: [c.id], d, evidence: ev,
    breaks: observedBreaks(c, detector.capabilities), preprocessing: preprocessingOf(c),
  });

  const state = Object.create(null);
  for (const cls of MAJOR_CLASSES) {
    const list = byClass.get(cls) || [];
    if (list.length === 0) { state[cls] = { status: input.creases.expectedButMissing.includes(cls) ? 'missing' : 'not-observed' }; continue; }
    if (list.length > 1) { state[cls] = { status: 'conflict', creaseIds: list.map((c) => c.id), detail: 'More than one crease was labelled as this crease.' }; continue; }
    const c = list[0];
    if (conflictIds.has(c.id)) { state[cls] = { status: 'conflict', creaseIds: [c.id], detail: 'The feature data records a conflict for this crease.' }; continue; }
    const rival = (c.identity.alternatives || []).find((a) => a.anatomicalClass !== cls && a.anatomicalClass !== 'unclassified' && a.classConfidence >= c.identity.classConfidence - THRESHOLDS.ambiguityMargin);
    if (rival) { state[cls] = { status: 'ambiguous-identity', creaseIds: [c.id], detail: `Could also be ${rival.anatomicalClass}.` }; continue; }
    state[cls] = okState(c, describe(c.geometry.points), evidenceOf(c));
  }

  // Central longitudinal crease: hypothesis feature, geometry-identified among class-labelled MINOR creases only.
  // R1-F5: uses the reversal-invariant verticalDeviationDeg instead of the direction-dependent chordDeg.
  // R1.3 (R1.2-RV-01): evaluate the centre condition in BOTH point orders for every vertical MINOR crease. A crease that
  // passes in EITHER order is a competing candidate (it takes part in conflict detection, so reconciliation can never
  // remove a competitor and promote another). A crease is identified only if it is the SOLE competitor and passes in
  // BOTH orders. Every candidate whose centre passes in only one order is traced in centreOrderTieCandidates.
  const inCentre = (x) => x >= 0.3 && x <= 0.7;
  const considered = (byClass.get('MINOR') || []).filter((c) => !conflictIds.has(c.id)).map((c) => ({ c, d: describe(c.geometry.points) }))
    .filter(({ c }) => atMost(verticalDeviation(c.geometry.points), GEOMETRY_CONTRACT.centralMaxVerticalDeviationDeg)) // raw value, inclusive
    .map((m) => { const xs = m.d.orderTies?.centroidX ?? [m.d.centroid.x, m.d.centroid.x]; const byOrder = [inCentre(xs[0]), inCentre(xs[xs.length - 1])]; return { ...m, byOrder, passEither: byOrder[0] || byOrder[1], passBoth: byOrder[0] && byOrder[1] }; });
  const competitors = considered.filter((m) => m.passEither);
  const tied = considered.filter((m) => m.passEither && !m.passBoth);
  const sole = competitors.length === 1 ? competitors[0] : null;
  const tieTrace = tied.length ? {
    centreOrderTieCandidates: tied.map((m) => ({ creaseId: m.c.id, centreInsideByOrder: m.byOrder, participatedInConflictDetection: true,
      outcome: competitors.length > 1 ? 'competing-candidate-in-conflict' : 'excluded-centre-order-tie' })),
  } : {};
  if (competitors.length === 0) state.CENTRAL_LONGITUDINAL = { status: 'not-observed' };
  else if (competitors.length > 1) state.CENTRAL_LONGITUDINAL = { status: 'conflict', creaseIds: competitors.map((m) => m.c.id), detail: 'Several vertical minor creases compete.', ...tieTrace };
  else if (!sole.passBoth) state.CENTRAL_LONGITUDINAL = { status: 'not-observed', tieExcludedCreaseIds: [sole.c.id], ...tieTrace };
  else state.CENTRAL_LONGITUDINAL = okState(sole.c, sole.d, evidenceOf(sole.c, HYPOTHESIS_CAP));
  const unclassifiedIds = (byClass.get('unclassified') || []).map((c) => c.id);
  return { state, unclassifiedIds, frame: assessFrame(input) };
}

const lowerTier = (t) => (t === TIERS.CLEAR ? TIERS.TENTATIVE : TIERS.INSUFFICIENT);

/** Exported (R1.2) for the RV-02 boundary characterisation tests only; behaviour unchanged since G6-D0. */
export function selectVariants(family, v) {
  const vs = family.variants;
  const idx = vs.findIndex((x) => (x.min === undefined || v >= x.min) && (x.max === undefined || v < x.max));
  const picked = [vs[idx]];
  let ambiguous = false;
  if (family.margin > 0) {
    const cur = vs[idx];
    if (cur.min !== undefined && v - cur.min < family.margin && idx > 0) { picked.push(vs[idx - 1]); ambiguous = true; }
    if (cur.max !== undefined && cur.max - v <= family.margin && idx < vs.length - 1) { picked.push(vs[idx + 1]); ambiguous = true; }
  }
  return { variants: picked.filter((x) => x.text !== null).sort((a, b) => vs.indexOf(a) - vs.indexOf(b)), ambiguous };
}

/** Frame trace attached to every family result (R1-F4). */
function frameTrace(family, frame) {
  return {
    requires: { direction: !!family.frame.direction, scale: !!family.frame.scale, axis: !!family.frame.axis },
    directionReliable: frame.directionReliable, scaleReliable: frame.scaleReliable, axisReliable: frame.axisReliable, rotationDeg: frame.rotationDeg,
    handedness: frame.handedness, palmFacing: frame.palmFacing, landmarksPresent: frame.landmarksPresent, frameQualityIssues: frame.frameQualityIssues,
  };
}

function evaluateFamily(family, ctx) {
  const states = family.requires.map((k) => [k, ctx.state[k]]);
  const creaseIdsOf = () => states.flatMap(([, s]) => s.creaseIds || []);
  const blocking = states.find(([, s]) => s.status !== 'ok');
  if (blocking) {
    const [cls, s] = blocking;
    const reason = s.status === 'not-observed' ? (ctx.unclassifiedIds.length ? 'unclassified' : 'missing') : s.status;
    return { kind: 'declined', familyId: family.id, reason, crease: cls, traditionalName: TRADITIONAL_NAMES[cls], creaseIds: s.creaseIds || [], detail: s.detail || null,
      text: declineText(reason), absentNote: (cls === 'CENTRAL_LONGITUDINAL' && family.absentNote) || null };
  }
  const frame = ctx.frame;
  const fTrace = frameTrace(family, frame);
  // R1-F4: a family that reads a frame property the scan cannot attest is declined, never defaulted.
  const frameReasons = [...(family.frame.direction ? frame.directionReasons : []), ...(family.frame.scale ? frame.scaleReasons : []), ...(family.frame.axis ? frame.axisReasons : [])];
  if (frameReasons.length) {
    return { kind: 'declined', familyId: family.id, reason: 'frame-unreliable', creaseIds: creaseIdsOf(), detail: null, text: declineText('frame-unreliable'),
      frameReasons: [...new Set(frameReasons)], frame: fTrace };
  }
  // R1-F5: a family that reads endpoint roles the polyline leaves ambiguous is declined.
  for (const [cls, roles] of Object.entries(family.endpoints)) {
    const amb = roles.filter((r) => ctx.state[cls].d.endpointRoles[r] !== 'resolved');
    if (amb.length) return { kind: 'declined', familyId: family.id, reason: 'geometry-ambiguous', crease: cls, creaseIds: ctx.state[cls].creaseIds, detail: null, text: declineText('geometry-ambiguous'), ambiguousEndpointRoles: amb };
  }
  // R1-F3: a family that reads an optional observation declines when that observation is unsupported or absent.
  const excludedInputs = family.observations ? Object.keys(family.observations).map((cls) => ({ crease: cls, creaseIds: ctx.state[cls].creaseIds, field: 'continuity.gapsBridged', value: ctx.state[cls].preprocessing.gapsBridged, reason: 'detector preprocessing metadata; not a break observation' })) : [];
  for (const [cls, fields] of Object.entries(family.observations || {})) {
    for (const fld of fields) {
      const o = ctx.state[cls][fld];
      if (o.status !== 'observed') {
        const reason = o.status === 'unsupported' ? 'feature-unsupported' : 'feature-not-observed';
        return { kind: 'declined', familyId: family.id, reason, crease: cls, creaseIds: ctx.state[cls].creaseIds, detail: null, text: declineText(reason), excludedInputs };
      }
    }
  }

  let evScore = Math.min(...states.map(([, s]) => s.evidence.raw));
  const caps = [...new Set(states.flatMap(([, s]) => s.evidence.caps))];
  // R1-F4 caps: palm side unconfirmed → every family; model-estimated handedness → direction-dependent families.
  const frameCaps = [];
  if (frame.palmSideCap) frameCaps.push('orientation-unconfirmed');
  if (family.frame.direction && frame.handednessModelCap) frameCaps.push('handedness-model');
  const evidenceBeforeFrameCaps = evScore;
  if (frameCaps.length && evScore > TENTATIVE_CAP) evScore = TENTATIVE_CAP;
  caps.push(...frameCaps);

  const breaks = Object.create(null);
  for (const [k, s] of states) breaks[k] = s.breaks.status === 'observed' ? s.breaks.value : null;
  const c = { d: {}, crease: {}, breaks, dist, centralLongitudinal: ctx.state.CENTRAL_LONGITUDINAL.status === 'ok' ? ctx.state.CENTRAL_LONGITUDINAL : null };
  for (const [k, s] of states) { c.d[k] = s.d; c.crease[k] = s.crease; }
  const value = family.value(c);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { kind: 'declined', familyId: family.id, reason: 'feature-not-observed', creaseIds: creaseIdsOf(), detail: null, text: declineText('feature-not-observed') };
  }
  let tier = tierFor(evScore);
  const notes = [];
  const contradiction = family.contradictedBy(c);
  if (contradiction) { tier = lowerTier(tier); notes.push(contradiction); }
  if (tier === TIERS.INSUFFICIENT) {
    return { kind: 'declined', familyId: family.id, reason: contradiction ? 'conflict' : 'low-confidence', creaseIds: creaseIdsOf(), detail: contradiction, text: contradiction ? DECLINE_TEXT.conflict : DECLINE_TEXT['low-confidence'] };
  }
  let { variants, ambiguous } = selectVariants(family, value);
  // R1.3 conservative reconciliation of a length tie (R1.2-RV-02 / RV-07, owner-approved). The two point orders give
  // two 4-dp values. A reading survives only if BOTH orders select it (intersection). If either order makes no claim
  // that the other makes, there is no common claim → the family abstains (quiet). If the orders select the same
  // readings with the same ambiguity, nothing changes (RV-07). Any other difference lowers the tier to tentative.
  let orderTie = null;
  const tv = family.tieValues ? family.tieValues(c) : null;
  if (tv) {
    const s1 = selectVariants(family, tv[0]), s2 = selectVariants(family, tv[1]);
    const ids1 = s1.variants.map((x) => x.id), ids2 = s2.variants.map((x) => x.id);
    const sameIds = JSON.stringify(ids1) === JSON.stringify(ids2);
    const selections = [{ variants: ids1, ambiguous: s1.ambiguous }, { variants: ids2, ambiguous: s2.ambiguous }];
    if (sameIds && s1.ambiguous === s2.ambiguous) orderTie = { values: [...tv], selections, resolution: 'same-reading-in-both-orders' };
    else {
      const common = ids1.filter((id) => ids2.includes(id));
      if (common.length === 0) {
        orderTie = { values: [...tv], selections, resolution: ids1.length || ids2.length ? 'claim-in-one-order-only-abstained' : 'no-claim-in-either-order' };
        return { kind: 'quiet', familyId: family.id, measuredValue: r4(value), orderTie };
      }
      variants = family.variants.filter((x) => common.includes(x.id));
      ambiguous = true; caps.push('order-tie');
      orderTie = { values: [...tv], selections, resolution: 'common-reading-tentative' };
    }
  }
  if (variants.length === 0) return { kind: 'quiet', familyId: family.id, measuredValue: r4(value), ...(orderTie ? { orderTie } : {}) };
  if (ambiguous) { tier = TIERS.TENTATIVE; notes.push(UNCERTAINTY_NOTES.ambiguous); }
  if (family.hypothesis && tier === TIERS.CLEAR) { tier = TIERS.TENTATIVE; if (!caps.includes('hypothesis-capped')) caps.push('hypothesis-capped'); } // R1.1: R1-RV-07
  for (const cp of caps) { const n = ownLookup(UNCERTAINTY_NOTES, cp); if (n) notes.push(n); }
  // Lead note reflects the evidence itself; a boundary, hypothesis or frame cap is explained by its own note, not by "limited evidence".
  notes.unshift(tierFor(evidenceBeforeFrameCaps) === TIERS.CLEAR && !contradiction ? UNCERTAINTY_NOTES.clear : UNCERTAINTY_NOTES.tentative);
  if (family.hypothesis) notes.push(family.hypothesisNote);
  const evidence = {
    creaseIds: creaseIdsOf(),
    anatomicalClasses: family.requires,
    traditionalNames: family.requires.map((k) => TRADITIONAL_NAMES[k]),
    feature: family.feature, measuredValue: r4(value), evidenceScore: r4(evScore), evidenceBeforeFrameCaps: r4(evidenceBeforeFrameCaps),
    evidenceComponents: Object.fromEntries(states.map(([k, s]) => [k, s.evidence.components])),
    capsApplied: caps, contradiction: contradiction || null, ambiguousBoundary: ambiguous,
    ...(orderTie ? { orderTie } : {}),
    frame: fTrace,
    ...(excludedInputs.length ? { excludedInputs } : {}),
  };
  return {
    kind: 'interpreted', familyId: family.id, tier, multiplePossibilities: ambiguous,
    interpretations: variants.map((x) => ({
      ruleId: x.id, observation: x.observe, interpretation: `${TIER_LEAD[tier]} ${x.text}.`, reflection: x.reflect,
    })),
    uncertainty: [...new Set(notes)], evidence, provenance: provenanceFor(family), excludedClaims: exclusionsFor(family),
  };
}

/**
 * R1-F1: only these keys hold user-facing prose. Identifiers (crease ids, rule ids, family ids, codes, paths) are
 * never linted, so an opaque id such as "death" can neither crash the engine nor be mistaken for a claim.
 */
const USER_TEXT_KEYS = new Set(['observation', 'interpretation', 'reflection', 'uncertainty', 'text', 'note', 'title', 'detail', 'absentNote', 'msg']);
const METADATA_KEYS = new Set(['excludedClaims', 'provenance', 'evidence', 'versions', 'disclaimer']);

function finalize(reading) {
  const hits = [];
  const visit = (v, key) => {
    if (typeof v === 'string') { if (USER_TEXT_KEYS.has(key)) hits.push(...lintText(v, key)); }
    else if (Array.isArray(v)) v.forEach((x) => visit(x, key));
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) { if (!METADATA_KEYS.has(k)) visit(v[k], k); }
  };
  visit(reading, '$');
  hits.push(...lintText(reading.disclaimer.text, DISCLAIMER.id)); // allowlisted negations; kept for symmetry with G6-D0
  if (hits.length) {
    const e = new Error(`Prohibited claim in generated reading: ${hits.map((h) => `${h.pattern} in "${h.text}"`).join('; ')}`);
    e.code = 'PROHIBITED_CLAIM'; e.hits = hits; throw e;
  }
  return deepFreeze(reading);
}
function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; }

/** Main entry point. Pure and deterministic: same input → byte-identical JSON output. */
export function generateReading(rawInput) {
  // R1.1: snapshot first. From here on only `input` (frozen plain data owned by the engine) is read; never the raw argument.
  const snap = snapshotInput(rawInput);
  if (snap.fatal) return invalidReading(snap.errors, snap.total, null);
  const input = snap.value;
  let v;
  try { v = validateFeatures(input); } catch { v = { ok: false, errors: [{ path: '$', code: 'unreadable-input', msg: 'The feature payload could not be read.' }] }; }
  const hash = tryInputHash(input);
  const errorCount = snap.total + v.errors.length; // full count: validity never depends on the listing cap
  if (errorCount > 0) return invalidReading([...snap.errors, ...v.errors], errorCount, hash);
  if (hash === null) return invalidReading([{ path: '$', code: 'unhashable-input', msg: 'The feature payload contains values that cannot be serialised.' }], 1, null);
  if (input.capture.quality.status !== 'accepted') return declinedReading(hash, 'quality-not-accepted', { qualityIssues: input.capture.quality.issues });
  if (input.capture.orientation.palmFacing === false) return declinedReading(hash, 'palm-not-facing');
  if (input.scanConfidence.value < THRESHOLDS.scanMinimum) return declinedReading(hash, 'scan-confidence-low');

  const ctx = resolveClasses(input);
  const observations = [...MAJOR_CLASSES, 'CENTRAL_LONGITUDINAL'].map((k) => {
    const s = ctx.state[k];
    return { crease: k, traditionalName: TRADITIONAL_NAMES[k], status: s.status, creaseIds: s.creaseIds || [], descriptors: s.d || null, evidenceScore: s.evidence ? s.evidence.score : null,
      ...(s.preprocessing ? { preprocessing: s.preprocessing, breakObservation: s.breaks.status } : {}),
      ...(s.tieExcludedCreaseIds ? { tieExcludedCreaseIds: s.tieExcludedCreaseIds } : {}),
      ...(s.centreOrderTieCandidates ? { centreOrderTieCandidates: s.centreOrderTieCandidates } : {}),
      note: s.status === 'missing' ? DECLINE_TEXT.missing : s.status === 'low-confidence' ? DECLINE_TEXT['low-confidence'] : s.status === 'conflict' ? DECLINE_TEXT.conflict : s.status === 'ambiguous-identity' ? EXTRA_DECLINE_TEXT['ambiguous-identity'] : null };
  });
  const results = FAMILIES.map((f) => evaluateFamily(f, ctx));
  const sections = DOMAINS.map((domain) => {
    const fr = results.filter((r, i) => FAMILIES[i].domain === domain);
    const interpreted = fr.filter((r) => r.kind === 'interpreted');
    const quietTies = fr.filter((r) => r.kind === 'quiet' && r.orderTie).map((r) => ({ familyId: r.familyId, orderTie: r.orderTie }));
    return { domain, title: DOMAIN_TITLES[domain], status: interpreted.length ? 'interpreted' : 'nothing-interpretable', items: interpreted,
      declined: fr.filter((r) => r.kind === 'declined'), quiet: fr.filter((r) => r.kind === 'quiet').map((r) => r.familyId),
      ...(quietTies.length ? { quietOrderTies: quietTies } : {}) }; // R1.3: a tie-caused abstention is traced
  });
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const f = ctx.frame;
  const frameSummary = { directionReliable: f.directionReliable, scaleReliable: f.scaleReliable, axisReliable: f.axisReliable, directionReasons: f.directionReasons, scaleReasons: f.scaleReasons, axisReasons: f.axisReasons, rotationDeg: f.rotationDeg,
    handedness: f.handedness, palmFacing: f.palmFacing, landmarksPresent: f.landmarksPresent, frameQualityIssues: f.frameQualityIssues };
  const base = { ...header(hash, total >= THRESHOLDS.minInterpretedSections ? 'interpreted' : 'declined'), frame: frameSummary, observations, unclassifiedCreaseIds: ctx.unclassifiedIds, sections };
  if (total === 0) base.decline = { reason: 'no-interpretable-creases', text: DECLINE_TEXT['no-interpretable-creases'] };
  return finalize(base);
}
