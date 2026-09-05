/**
 * Insights Correctness + Historical Integrity V1, finding #3: regression
 * suite for the percentage-POINT delta lift formula in
 * apps/web/app/api/daily-assistant/insights/route.ts. The formula itself is
 * a pure, inline computation on two already-aggregated group averages (not
 * a separately-exported function), so it is replicated here EXACTLY as the
 * route implements it -- not reimplemented independently -- and
 * cross-checked against the live route source below, matching this repo's
 * established pattern for testing inline route logic without a live server
 * (see test/eventLocationAuraMomentPersistence.test.ts).
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// Exact replica of the route's own alignmentDeltaPoints/insightText
// computation (apps/web/app/api/daily-assistant/insights/route.ts).
function computeAlignment(
  alignedScoreTotal: number,
  alignedTotal: number,
  unalignedScoreTotal: number,
  unalignedTotal: number,
  reflectionCount: number
) {
  const alignedRate = alignedTotal > 0 ? alignedScoreTotal / alignedTotal : null;
  const unalignedRate = unalignedTotal > 0 ? unalignedScoreTotal / unalignedTotal : null;
  const hasValidComparison = alignedRate !== null && unalignedRate !== null;
  const alignmentDeltaPoints = hasValidComparison ? Math.round((alignedRate! - unalignedRate!) * 100) : null;

  let insightText: string;
  if (reflectionCount < 3) {
    insightText = 'Log a few evening check-ins to unlock your personal before-and-after trend.';
  } else if (!hasValidComparison) {
    insightText = 'Keep logging check-ins on both favorable and caution days to unlock your personal before-and-after trend.';
  } else if (alignmentDeltaPoints! > 0) {
    insightText = `Your check-ins score ${alignmentDeltaPoints} points higher on days when you followed favorable windows.`;
  } else if (alignmentDeltaPoints! < 0) {
    insightText = `Your check-ins score ${Math.abs(alignmentDeltaPoints!)} points lower on days when you followed favorable windows.`;
  } else {
    insightText = 'Your check-ins score about the same whether or not you followed favorable windows.';
  }

  return { alignmentDeltaPoints, insightText };
}

// ============================================================
// Positive delta: aligned days score higher.
// ============================================================

const positive = computeAlignment(4, 5, 1, 5, 10); // aligned avg 0.8, unaligned avg 0.2 -> +60 pts
check('Positive delta: aligned 0.8 vs unaligned 0.2 -> +60 points, not a relative percentage', positive.alignmentDeltaPoints === 60);
check('Positive delta wording says "points higher", preserves direction', positive.insightText.includes('60 points higher'));

// ============================================================
// Negative delta: aligned days score LOWER -- must never be clamped to 0 or
// rendered as "X% higher" for a negative result.
// ============================================================

const negative = computeAlignment(1, 5, 4, 5, 10); // aligned avg 0.2, unaligned avg 0.8 -> -60 pts
check('Negative delta is a genuine negative number, never clamped to 0', negative.alignmentDeltaPoints === -60);
check('Negative delta wording says "points lower", never "higher" and never "0% higher"', negative.insightText.includes('60 points lower') && !negative.insightText.includes('higher'));

// ============================================================
// Zero delta: both groups score identically -- including the genuinely
// zero-valued-outcomes case (every reflection in BOTH groups scored 0),
// which must resolve to a defined zero delta, not a divide-by-zero/NaN.
// ============================================================

const zeroSameNonzero = computeAlignment(3, 5, 3, 5, 10); // both average 0.6
check('Zero delta (both groups average the same non-zero rate) -> exactly 0, not null, not NaN', zeroSameNonzero.alignmentDeltaPoints === 0);
check('Zero delta wording says "about the same", not "0 points higher"', zeroSameNonzero.insightText === 'Your check-ins score about the same whether or not you followed favorable windows.');

const zeroValuedOutcomes = computeAlignment(0, 5, 0, 5, 10); // every reflection in both groups scored 0 (NEEDS_REST)
check('Zero-valued outcomes in BOTH groups (all NEEDS_REST) -> a defined 0 delta, no division-by-zero/NaN', zeroValuedOutcomes.alignmentDeltaPoints === 0 && !Number.isNaN(zeroValuedOutcomes.alignmentDeltaPoints));

// ============================================================
// Missing comparison group -- a comparison is NEVER manufactured from only
// one side. alignedTotal/unalignedTotal = 0 must yield null, not a
// fabricated 0 or a one-sided percentage.
// ============================================================

const missingUnaligned = computeAlignment(4, 5, 0, 0, 5); // only aligned days logged so far
check('Missing unaligned group (0 unaligned days) -> alignmentDeltaPoints is null, never a fabricated one-sided number', missingUnaligned.alignmentDeltaPoints === null);
check('Missing unaligned group -> insightText asks for both sides, never states a percentage', missingUnaligned.insightText === 'Keep logging check-ins on both favorable and caution days to unlock your personal before-and-after trend.' && !/\d/.test(missingUnaligned.insightText));

const missingAligned = computeAlignment(0, 0, 3, 5, 5); // only unaligned days logged so far
check('Missing aligned group (0 aligned days) -> alignmentDeltaPoints is null, never a fabricated one-sided number', missingAligned.alignmentDeltaPoints === null);

const bothMissing = computeAlignment(0, 0, 0, 0, 0);
check('No reflections at all -> null, with the "log a few check-ins" onboarding message (reflectionCount < 3)', bothMissing.alignmentDeltaPoints === null && bothMissing.insightText.includes('Log a few evening check-ins'));

// ============================================================
// Rounding: standard round-half-up on the percentage-point value, applied
// consistently regardless of sign.
// ============================================================

const roundingUp = computeAlignment(1, 3, 0, 3, 6); // aligned avg 0.3333, unaligned avg 0 -> 33.33 -> rounds to 33
check('Rounding: 33.33 points rounds down to 33 (standard rounding, not truncation-only or ceiling-only)', roundingUp.alignmentDeltaPoints === 33);

const roundingHalf = computeAlignment(2, 4, 1, 4, 8); // 0.5 - 0.25 = 0.25 -> 25 pts exactly, no rounding ambiguity
check('Rounding: an exact 25.0 points value is not perturbed by rounding', roundingHalf.alignmentDeltaPoints === 25);

const roundingNegative = computeAlignment(1, 3, 2, 3, 6); // aligned avg 0.3333, unaligned avg 0.6667 -> -33.33 -> -33
check('Rounding applies identically to negative deltas: -33.33 rounds to -33, not -34 or -33.33 displayed raw', roundingNegative.alignmentDeltaPoints === -33);

// ============================================================
// Single formula shape for ALL cases -- one Math.round(... * 100) call,
// never a relative-percentage branch for one denominator and an
// absolute-percentage branch for another (the exact bug this finding
// fixes).
// ============================================================

const routeSource = fs.readFileSync('apps/web/app/api/daily-assistant/insights/route.ts', 'utf8');
const roundCallCount = (routeSource.match(/Math\.round\(/g) || []).length;
check('Route contains exactly ONE Math.round(...) call for the delta -- a single formula shape, no dual relative/absolute branching', roundCallCount === 1);
check('Route never clamps a negative lift to zero (no Math.max(0, ...alignedRate/unalignedRate/lift...) pattern)', !/Math\.max\(0/.test(routeSource));
check('Route requires BOTH groups (alignedRate !== null && unalignedRate !== null) before computing a delta -- never a one-sided comparison', /alignedRate !== null && unalignedRate !== null/.test(routeSource));
check('Route stores group rates as null (not a silent 0) when that group is empty -- 0 would be indistinguishable from "scored the worst possible outcome"', /alignedTotal > 0 \? alignedScoreTotal \/ alignedTotal : null/.test(routeSource) && /unalignedTotal > 0 \? unalignedScoreTotal \/ unalignedTotal : null/.test(routeSource));
// Matches actual code usage (property access, type/object key, assignment)
// but not prose mentions inside a doc comment (e.g. "renamed from the old
// peakFlowLiftPercent, which conflated...").
const PEAK_FLOW_LIFT_LIVE_USAGE = /\.peakFlowLiftPercent\b|peakFlowLiftPercent\s*:\s*number|peakFlowLiftPercent\s*=/;
check('The old dual-formula field name (peakFlowLiftPercent) is not used as a live identifier in the route (only, if at all, in an explanatory doc comment)', !PEAK_FLOW_LIFT_LIVE_USAGE.test(routeSource));
check('The response field is named alignmentDeltaPoints (percentage-point delta, not a relative "lift" percent)', /alignmentDeltaPoints,/.test(routeSource));

// ============================================================
// InsightsView.tsx's rendering side: no lingering clamp, no lingering
// reference to the removed field name, and a defined display state for the
// null (insufficient two-sided data) case.
// ============================================================

const insightsViewSource = fs.readFileSync('apps/web/components/InsightsView.tsx', 'utf8');
check('InsightsView.tsx no longer references the removed peakFlowLiftPercent field as a live identifier (only, if at all, in an explanatory doc comment)', !PEAK_FLOW_LIFT_LIVE_USAGE.test(insightsViewSource));
check('InsightsView.tsx no longer clamps the displayed delta with Math.max(0, ...)', !/Math\.max\(0,\s*assistantInsight/.test(insightsViewSource));
check('InsightsView.tsx renders the new alignmentDeltaPoints field', /assistantInsight\.alignmentDeltaPoints/.test(insightsViewSource));
check('InsightsView.tsx has an explicit branch for the null (insufficient-comparison) case, not a bare number render that would show NaN/blank', /assistantInsight\.alignmentDeltaPoints !== null/.test(insightsViewSource));
check('InsightsView.tsx interface types alignmentDeltaPoints as number | null (matches the route\'s actual possible-null return)', /alignmentDeltaPoints:\s*number \| null/.test(insightsViewSource));

console.log(allPassed ? '\nALL INSIGHTS ALIGNMENT COMPARISON CHECKS PASSED' : '\nSOME INSIGHTS ALIGNMENT COMPARISON CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
