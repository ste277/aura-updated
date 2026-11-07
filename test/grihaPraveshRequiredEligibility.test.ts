/**
 * AURA PCE-3E: Griha Pravesh Adhika Masa hard-exclusion regression suite.
 *
 * Griha Pravesh's periodRules now enable ONLY the Adhika Masa sub-rule
 * (never Kharmas or Chaturmas -- neither is sourced for this occasion; see
 * GRIHA_PRAVESH_SOURCES' adhika-masa-policy entry). This reuses Marriage's
 * existing, already-validated spanOverlapsProhibitedPeriod()/
 * classifySynodicMonthContaining() pipeline unchanged -- no new
 * astronomical code, no Griha-Pravesh-specific conditional branch.
 *
 * Adhika Masa window dates below are DERIVED from Aura's own
 * classifySynodicMonthContaining() at probe time, never hand-coded exact
 * transition instants -- consistent with this engagement's "do not invent
 * boundary timestamps" discipline (PCE-3D's reference-validation gap
 * remains open for true boundary-second precision; this suite tests
 * comfortably-inside/outside instants and the engine's own interval
 * semantics, not an independently-sourced exact transition second).
 */
import { classifySynodicMonthContaining } from '../packages/vedic/src/lunarCalendar';
import { spanOverlapsProhibitedPeriod } from '../packages/recommendation/src/ceremonialPeriods';
import { resolveMuhurtaRulePack, computeMuhurtaSupportLevel, deriveTraditionalCoverageLevel } from '../packages/muhurta/src/muhurtaRulePacks';
import { getActivityDefinition } from '../packages/recommendation/src/activityDefinitions';
import { findMuhurthams } from '../packages/recommendation/src/muhurthamFinder';
import type { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const grihaDef = getActivityDefinition('griha-pravesh');
const marriageDef = getActivityDefinition('marriage');
if (!grihaDef || !marriageDef) throw new Error('griha-pravesh/marriage definitions must exist');
const grihaClassification = grihaDef.muhurta;
const grihaPack = resolveMuhurtaRulePack(grihaClassification);
const delhiLocation = { latitude: 28.6139, longitude: 77.2090, timezone: 'Asia/Kolkata' };
const dubaiLocation = { latitude: 25.2048, longitude: 55.2708, timezone: 'Asia/Dubai' };

// Independently established in this engagement (PCE-3B/PCE-4A/PCE-4A-T2):
// the real 2026 Adhika month is Jyeshtha, approx. May 17 - June 15. Derive
// the exact engine-computed window from this known neighborhood rather
// than hand-coding boundary instants.
const insideProbe = new Date('2026-06-01T04:30:00.000Z'); // 2026-06-01 10:00 IST
const adhikaWindow = classifySynodicMonthContaining(insideProbe);
check('0. The known 2026 Adhika Jyeshtha neighborhood genuinely classifies ADHIKA (sanity check on the probe instant itself, not assumed)', adhikaWindow.classification === 'ADHIKA');

// ============================================================
// A. Griha Pravesh -- inside Adhika Masa
// ============================================================

const insideResult = spanOverlapsProhibitedPeriod(insideProbe, new Date(insideProbe.getTime() + 60 * 60_000), grihaClassification, delhiLocation);
check('A1. A Griha Pravesh candidate clearly inside Adhika Masa is ineligible', !insideResult.eligible);
check('A2. The rejection reason is ADHIKA_MASA', insideResult.reason === 'ADHIKA_MASA');

const generalRangeInside: DailyAssistantContext = { now: new Date('2026-05-20T00:00:00.000Z'), ...delhiLocation, tzOffsetMinutes: 330 };
const findInsideAdhika = findMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: '2026-05-25', end: '2026-06-10' }, timePreference: 'ANY', durationMinutes: 60, limit: 10, context: generalRangeInside });
check('A3. A real Griha Pravesh search range fully inside the Adhika window returns zero ranked candidates (exclusion happens before ranking, no candidate survives to be ranked)', findInsideAdhika.dates.length === 0);

// ============================================================
// B. Griha Pravesh -- outside Adhika Masa
// ============================================================

const outsideProbe = new Date('2026-07-20T04:30:00.000Z'); // well after the Adhika window ends
const outsideMonth = classifySynodicMonthContaining(outsideProbe);
check('B0. The outside-probe month genuinely classifies NORMAL (sanity check)', outsideMonth.classification === 'NORMAL');
const outsideResult = spanOverlapsProhibitedPeriod(outsideProbe, new Date(outsideProbe.getTime() + 60 * 60_000), grihaClassification, delhiLocation);
check('B1. A Griha Pravesh candidate clearly outside Adhika Masa is not rejected on Adhika Masa grounds', outsideResult.reason !== 'ADHIKA_MASA');
// Do not assert unconditional .eligible === true here -- another rule
// (Tithi/Nakshatra avoid-list) may legitimately reject this exact instant;
// only the ADHIKA_MASA-specific claim is being tested.

// ============================================================
// C. Interval overlap
// ============================================================

check('C1. Entirely inside: already covered by A1/A2 above', !insideResult.eligible && insideResult.reason === 'ADHIKA_MASA');
check('C2. Entirely outside: already covered by B1 above', outsideResult.reason !== 'ADHIKA_MASA');

const beginsBeforeEndsInside = spanOverlapsProhibitedPeriod(new Date(adhikaWindow.start.getTime() - 30 * 60_000), new Date(adhikaWindow.start.getTime() + 30 * 60_000), grihaClassification, delhiLocation);
check('C3. A candidate beginning before and ending inside Adhika Masa is rejected (full-span safety, not just start-instant)', !beginsBeforeEndsInside.eligible && beginsBeforeEndsInside.reason === 'ADHIKA_MASA');

const beginsInsideEndsAfter = spanOverlapsProhibitedPeriod(new Date(adhikaWindow.end.getTime() - 30 * 60_000), new Date(adhikaWindow.end.getTime() + 30 * 60_000), grihaClassification, delhiLocation);
check('C4. A candidate beginning inside and ending after Adhika Masa is rejected (the start instant alone is inside ADHIKA)', !beginsInsideEndsAfter.eligible && beginsInsideEndsAfter.reason === 'ADHIKA_MASA');

const touchesStartNoOverlap = spanOverlapsProhibitedPeriod(new Date(adhikaWindow.start.getTime() - 60 * 60_000), adhikaWindow.start, grihaClassification, delhiLocation);
check('C5. Half-open semantics: a candidate ENDING exactly at the Adhika Masa start has no overlap (same convention Marriage already relies on)', touchesStartNoOverlap.reason !== 'ADHIKA_MASA');

// Verified by direct probe, not assumed: classifySynodicMonthContaining()
// resolves the EXACT end instant back into the SAME (Adhika) month, not
// the next one -- the shared spanOverlapsProhibitedPeriod() implementation
// already works around this by nudging 1 second past the boundary before
// checking the next month (see its own "+ 1000" offset), confirming this
// inclusive-tail-instant behavior is pre-existing and shared with
// Marriage, not introduced or altered by this PR.
const beginsExactlyAtEnd = spanOverlapsProhibitedPeriod(adhikaWindow.end, new Date(adhikaWindow.end.getTime() + 60 * 60_000), grihaClassification, delhiLocation);
check('C6. The exact Adhika Masa end instant still resolves into the Adhika month itself (pre-existing shared-function precision characteristic, verified directly, not a half-open boundary this PR controls)', beginsExactlyAtEnd.reason === 'ADHIKA_MASA');
const safelyAfterEnd = spanOverlapsProhibitedPeriod(new Date(adhikaWindow.end.getTime() + 60_000), new Date(adhikaWindow.end.getTime() + 120_000), grihaClassification, delhiLocation);
check('C6b. A candidate safely (1+ minute) after the Adhika Masa end is correctly not rejected', safelyAfterEnd.reason !== 'ADHIKA_MASA');

// ============================================================
// D. Uniform applicability (no occasion-type field exists; verify the
// shared occasion-LEVEL rule-pack path applies identically regardless of
// which "type" of Griha Pravesh a user might have in mind -- the API has
// no subtype representation, so this is verified at the rule-pack level,
// not via a fabricated subtype parameter).
// ============================================================

check('D1. The Griha Pravesh classification carries no occasion-subtype field at all -- the exclusion is applied at the occasion level uniformly, exactly as D2 specifies, not conditioned on a type this API cannot represent', !('subtype' in grihaClassification) && !('category' in grihaClassification));
const secondInsideCall = spanOverlapsProhibitedPeriod(insideProbe, new Date(insideProbe.getTime() + 60 * 60_000), grihaClassification, delhiLocation);
check('D2. Repeated evaluation of the identical Griha Pravesh classification+instant is deterministic (no hidden per-call type branching)', secondInsideCall.eligible === insideResult.eligible && secondInsideCall.reason === insideResult.reason);

// ============================================================
// E. Marriage regression -- unchanged
// ============================================================

const marriageMay20 = spanOverlapsProhibitedPeriod(new Date('2026-05-20T04:30:00.000Z'), new Date('2026-05-20T05:30:00.000Z'), marriageDef.muhurta, delhiLocation);
check('E1. Marriage 2026-05-20 remains ADHIKA_MASA-excluded, unchanged by this PR', !marriageMay20.eligible && marriageMay20.reason === 'ADHIKA_MASA');
const marriageJun1 = spanOverlapsProhibitedPeriod(new Date('2026-06-01T04:30:00.000Z'), new Date('2026-06-01T05:30:00.000Z'), marriageDef.muhurta, delhiLocation);
check('E2. Marriage 2026-06-01 remains ADHIKA_MASA-excluded, unchanged by this PR', !marriageJun1.eligible && marriageJun1.reason === 'ADHIKA_MASA');
const marriageJun20 = spanOverlapsProhibitedPeriod(new Date('2026-06-20T04:30:00.000Z'), new Date('2026-06-20T05:30:00.000Z'), marriageDef.muhurta, delhiLocation);
check('E3. Marriage 2026-06-20 remains eligible (no Adhika Masa exclusion), unchanged by this PR', marriageJun20.reason !== 'ADHIKA_MASA');

// ============================================================
// F. Other occasions -- not newly affected
// ============================================================

for (const id of ['start-journey', 'financial-decision', 'business-start', 'property-purchase', 'new-beginning']) {
  const def = getActivityDefinition(id)!;
  const pack = resolveMuhurtaRulePack(def.muhurta);
  check(`F. ${id} still has no period-exclusion coverage (unaffected by Griha Pravesh's new periodRules)`, pack.coverage.periodExclusion === 'MISSING');
}

// ============================================================
// G. Trust-tier preservation
// ============================================================

check('G1. Griha Pravesh remains OCCASION_SPECIFIC (not promoted to TRADITIONALLY_VALIDATED)', deriveTraditionalCoverageLevel(grihaPack) === 'OCCASION_SPECIFIC');
check('G2. Griha Pravesh support level is SUPPORTED (coverage.periodExclusion correctly derives to IMPLEMENTED now that periodRules exists)', computeMuhurtaSupportLevel(grihaClassification, grihaPack) === 'SUPPORTED');
check('G3. Griha Pravesh does NOT inherit Marriage\'s Kharmas/Chaturmas rules', grihaPack.periodRules?.chaturmas === false && grihaPack.periodRules?.kharmasRashiIndices.length === 0);
check('G4. Griha Pravesh carries no combustionRules (Marriage-only, not sourced for this occasion)', grihaPack.combustionRules === undefined);

// ============================================================
// Location invariance (Adhika Masa is a global/instant-based check, same
// discipline Marriage's own suite already verifies for Kharmas/Asta).
// ============================================================

const insideDubai = spanOverlapsProhibitedPeriod(insideProbe, new Date(insideProbe.getTime() + 60 * 60_000), grihaClassification, dubaiLocation);
check('Location invariance: Griha Pravesh Adhika Masa eligibility is identical across Delhi/Dubai for the same UTC instant', insideResult.eligible === insideDubai.eligible && insideResult.reason === insideDubai.reason);

console.log(allPassed ? '\nALL GRIHA PRAVESH REQUIRED ELIGIBILITY CHECKS PASSED' : '\nSOME GRIHA PRAVESH REQUIRED ELIGIBILITY CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
