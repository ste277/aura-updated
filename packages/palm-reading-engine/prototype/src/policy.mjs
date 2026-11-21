// AURA-PALM-G6-D0 — Confidence & uncertainty policy (executable form of CONFIDENCE_AND_UNCERTAINTY_POLICY.md).
// All user-facing text in this prototype is authored for G6-D0 (see CONTENT_PROVENANCE_REGISTER.md).

export const POLICY_VERSION = '0.1.2-r1.1';
// R1: thresholds, tiers, basis/status/class caps and the raw-score tier rule are UNCHANGED from G6-D0.
// R1 adds frame/orientation gating (R1-F4) and the decline/uncertainty texts below; it removes nothing.

/** Evidence tiers. There is deliberately NO tier above "clear": no reading is ever stated as fact. */
export const TIERS = Object.freeze({ CLEAR: 'clear', TENTATIVE: 'tentative', INSUFFICIENT: 'insufficient' });
export const THRESHOLDS = Object.freeze({
  clear: 0.75,            // evidence ≥ 0.75 → "clear" observation wording (still traditional, still non-predictive)
  tentative: 0.5,         // 0.5 ≤ evidence < 0.75 → hedged wording
  scanMinimum: 0.4,       // overall scan confidence below this → whole reading declined
  ambiguityMargin: 0.15,  // top-2 class confidences within this → crease identity ambiguous
  minInterpretedSections: 1,
});

/** Single cap value used by every "held at tentative" rule (just below the clear threshold). */
export const TENTATIVE_CAP = 0.74;

/** Basis caps: uncalibrated scores can never reach "clear". Synthetic-declared is treated as its stated value (test only). */
export const BASIS_CAP = Object.freeze({ 'synthetic-declared': 1, calibrated: 1, 'uncalibrated-detector-score': 0.74 });
/** Detector-status caps: research-experimental detectors can never reach "clear". */
export const STATUS_CAP = Object.freeze({ synthetic: 1, 'research-experimental': 0.74 });
/** Class-source caps: user confirmation is trusted for identity only up to its stated value. */
export const CLASS_SOURCE_CAP = Object.freeze({ 'synthetic-declared': 1, 'user-confirmed': 1, classifier: 0, none: 0 });

/**
 * R1-F4 frame policy. Quality issues that make the landmark-derived frame unreliable even when quality is "accepted".
 * - FRAME_SCALE_ISSUES: palm width / origin may be wrong → scale-dependent rules decline.
 * - FRAME_ORIENTATION_ISSUES: rotation or palm side in doubt → direction-dependent rules decline.
 * Caps (to TENTATIVE_CAP): palm side unconfirmed (palmFacing null) → every rule; handedness estimated by the
 * landmark model (mirror-sensitive) → direction-dependent rules.
 */
export const FRAME_SCALE_ISSUES = Object.freeze(['hand-cut-off', 'hand-too-small', 'palm-not-visible']);
export const FRAME_ORIENTATION_ISSUES = Object.freeze(['hand-rotated', 'palm-not-visible']);
/**
 * R1.1 (R1-RV-05): rotation consistency. Mirrors G5-I1 `QUALITY_THRESHOLDS.maxAbsRotationDeg = 45`, where the scanner
 * raises `hand-rotated` exactly when |rotationDeg| > 45. If the issue flag and the angle disagree, the rotation evidence
 * is CONFLICTING and every rule that needs a reliable axis or direction declines. Unknown rotation is not representable
 * (rotationDeg is required) and is rejected at validation.
 */
export const ROTATION_ACCEPT_LIMIT_DEG = 45;

export function tierFor(evidence) {
  if (evidence >= THRESHOLDS.clear) return TIERS.CLEAR;
  if (evidence >= THRESHOLDS.tentative) return TIERS.TENTATIVE;
  return TIERS.INSUFFICIENT;
}

export const DISCLAIMER = Object.freeze({
  id: 'disclaimer.v0.1',
  text:
    'Palmistry is a cultural and traditional practice, not a science. There is no scientific evidence that palm ' +
    'creases reveal personality, relationships, career outcomes or the future. This reading describes what the ' +
    'scan observed and what palmistry traditions associate with it, for reflection and entertainment. It is not ' +
    'advice, and it does not describe your health.',
});

export const TIER_LEAD = Object.freeze({
  clear: 'Palmistry traditions often associate this with',
  tentative: 'Some palmistry traditions might associate this with',
});

export const UNCERTAINTY_NOTES = Object.freeze({
  clear: 'Even a clearly visible crease only tells us what tradition says, not what is true about you.',
  tentative: 'The scan evidence here is limited, so treat this as a loose possibility.',
  'basis-capped': 'The crease detector has not been validated on real palms, so this observation is held at a tentative level.',
  ambiguous: 'This measurement sits close to the boundary between two traditional readings, so both are shown and neither is preferred.',
  'orientation-unconfirmed': 'The scan could not confirm that the palm side of the hand was shown, so this observation is held at a tentative level.',
  'handedness-model': 'Which hand was scanned was estimated from the image rather than stated, so this observation is held at a tentative level.',
});

export const DECLINE_TEXT = Object.freeze({
  'quality-not-accepted': 'The photo did not pass the image-quality check, so no reading was attempted. A clearer, evenly lit photo of an open palm may help.',
  'scan-confidence-low': 'The overall scan confidence was too low to read. This says nothing about your palm, only about the photo.',
  'no-interpretable-creases': 'No crease was observed clearly enough to interpret. Rather than guess, the reading stops here.',
  'invalid-input': 'The feature data was not valid, so no reading was produced.',
  missing: 'This crease was not detected. That is usually a limitation of the photo or detector, and it means nothing about you.',
  'low-confidence': 'This crease was seen too faintly to interpret.',
  conflict: 'Two observations disagree about this crease, so it was not interpreted.',
  unclassified: 'A crease was seen, but the scan could not tell which crease it is, so it was not interpreted.',
  'frame-unreliable': 'This feature depends on knowing which hand was scanned and how it was held, and the scan could not confirm that, so it was not interpreted.',
  'geometry-ambiguous': 'The shape of this crease did not show clearly which end is which, so this feature was not interpreted.',
  'feature-unsupported': 'The scan cannot observe this feature, so it was not interpreted. This means nothing about you.',
  'feature-not-observed': 'This feature was not observed, so it was not interpreted. This means nothing about you.',
});

/**
 * Prohibited-claim lint. Any generated user-facing string matching these patterns is a hard failure.
 * Covers deterministic future claims, lifespan, health/medical, wealth/financial, marriage/divorce outcomes,
 * guarantees and scientific-validity claims.
 */
export const PROHIBITED_PATTERNS = Object.freeze([
  { id: 'future-certainty', re: /\byou will\b|\bwill (definitely|certainly|surely)\b|\bdestined\b|\bfated\b|\binevitabl/i },
  { id: 'guarantee', re: /\bguarantee|\bcertain(ly)?\b|\bdefinitely\b|\bwithout (a )?doubt\b|\bproves?\b|\baccurate(ly)?\b/i },
  { id: 'lifespan', re: /\blifespan\b|\blife expectancy\b|\blong life\b|\bshort life\b|\bearly death\b|\byears to live\b|\bdie\b|\bdeath\b/i },
  { id: 'medical', re: /\bdiagnos|\bdisease\b|\billness\b|\bsyndrome\b|\bdisorder\b|\bmedical condition\b|\bsymptom/i },
  { id: 'wealth', re: /\bwealth(y)?\b|\brich\b|\bfortune\b|\blottery\b|\binvest(ment)?\b|\bfinancial success\b/i },
  { id: 'relationship-outcome', re: /\bmarr(y|iage|ied)\b|\bdivorce\b|\bsoulmate\b|\bnumber of (children|partners)\b/i },
  { id: 'career-outcome', re: /\bcareer success\b|\bpromotion\b|\bwill succeed\b|\bwill fail\b/i },
  { id: 'scientific-claim', re: /\bscientifically (proven|validated|shown)\b|\bresearch shows\b|\bstudies show\b/i },
]);

/** The disclaimer intentionally negates some prohibited topics; it is linted with an allowlist. */
const NEGATION_ALLOWED_IDS = new Set([DISCLAIMER.id]);

export function lintText(text, sourceId) {
  if (NEGATION_ALLOWED_IDS.has(sourceId)) return [];
  const hits = [];
  for (const p of PROHIBITED_PATTERNS) if (p.re.test(text)) hits.push({ pattern: p.id, sourceId, text });
  return hits;
}
