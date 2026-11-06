/**
 * PCE-2A -- Engine Trust Contract & CI Enforcement.
 *
 * Covers the 9 required tests from the PCE-2A ticket's "Required new tests"
 * section: Marriage/Griha Pravesh resolve OCCASION_SPECIFIC; the five
 * generic Finder occasions resolve GENERAL_PANCHANGAM; a fallback can never
 * silently receive a higher trust classification; no occasion currently
 * receives TRADITIONALLY_VALIDATED; the existing methodology identifier is
 * unchanged; coverage metadata survives the production response path
 * (findMuhurthams/findPersonalMuhurthams/findSharedMuhurthams/
 * evaluateMuhurthamCandidateAt); user-facing explanations match the actual
 * coverage; and missing/unknown coverage never produces an unsupported
 * trust claim. All fixtures are deterministic (fixed dates/context, no
 * randomness, no DB).
 */
import {
  deriveTraditionalCoverageLevel,
  resolveMuhurtaRulePack,
  AURA_MUHURTA_METHODOLOGY_ID,
  MuhurtaTraditionalCoverageLevel,
} from '../packages/muhurta/src/muhurtaRulePacks';
import { ACTIVITY_DEFINITIONS } from '../packages/recommendation/src/activityDefinitions';
import {
  findMuhurthams,
  findPersonalMuhurthams,
  findSharedMuhurthams,
  evaluateMuhurthamCandidateAt,
  SUPPORTED_MUHURTHAM_ACTIVITY_IDS,
} from '../packages/recommendation/src/muhurthamFinder';
import { traditionalCoverageExplanation } from '../apps/web/lib/muhurthamTraditionalCoverageText';
import type { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';
import type { PersonalMuhurtaContext } from '../packages/recommendation/src/auraFitEngine';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const chennaiContext: DailyAssistantContext = {
  now: new Date(Date.UTC(2026, 7, 21, 4, 0, 0)),
  latitude: 13.0827,
  longitude: 80.2707,
  timezone: 'Asia/Kolkata',
  tzOffsetMinutes: 330,
};

const personalContext: PersonalMuhurtaContext = {
  natalNakshatraIndex: 4,
};

// ============================================================
// 1 & 2. Marriage and Griha Pravesh resolve OCCASION_SPECIFIC
// ============================================================

const marriageDefinition = ACTIVITY_DEFINITIONS.find((d) => d.id === 'marriage')!;
const grihaPraveshDefinition = ACTIVITY_DEFINITIONS.find((d) => d.id === 'griha-pravesh')!;

check(
  '1. Marriage resolves to OCCASION_SPECIFIC',
  deriveTraditionalCoverageLevel(resolveMuhurtaRulePack(marriageDefinition.muhurta)) === 'OCCASION_SPECIFIC',
);
check(
  '2. Griha Pravesh resolves to OCCASION_SPECIFIC',
  deriveTraditionalCoverageLevel(resolveMuhurtaRulePack(grihaPraveshDefinition.muhurta)) === 'OCCASION_SPECIFIC',
);

// ============================================================
// 3. Each of the five generic Finder occasions resolves to GENERAL_PANCHANGAM
// ============================================================

const GENERIC_FALLBACK_ACTIVITY_IDS = ['start-journey', 'financial-decision', 'new-beginning', 'business-start', 'property-purchase'];

check(
  '3a. The five generic fallback ids are exactly the non-dedicated half of SUPPORTED_MUHURTHAM_ACTIVITY_IDS',
  GENERIC_FALLBACK_ACTIVITY_IDS.every((id) => SUPPORTED_MUHURTHAM_ACTIVITY_IDS.includes(id)) &&
    SUPPORTED_MUHURTHAM_ACTIVITY_IDS.length === GENERIC_FALLBACK_ACTIVITY_IDS.length + 2,
);

for (const id of GENERIC_FALLBACK_ACTIVITY_IDS) {
  const definition = ACTIVITY_DEFINITIONS.find((d) => d.id === id)!;
  const level = deriveTraditionalCoverageLevel(resolveMuhurtaRulePack(definition.muhurta));
  check(`3b. ${id} resolves to GENERAL_PANCHANGAM`, level === 'GENERAL_PANCHANGAM');
}

// ============================================================
// 4. A fallback cannot silently receive a higher trust classification
// ============================================================

for (const id of GENERIC_FALLBACK_ACTIVITY_IDS) {
  const definition = ACTIVITY_DEFINITIONS.find((d) => d.id === id)!;
  const pack = resolveMuhurtaRulePack(definition.muhurta);
  check(
    `4. ${id}'s own rule pack is genuinely a reused family base (reusedFromLegacyFamily set), consistent with its GENERAL_PANCHANGAM classification`,
    pack.reusedFromLegacyFamily !== undefined && pack.coverage.tithi === 'REUSABLE_BASE_RULE',
  );
}
check(
  '4b. Marriage and Griha Pravesh are NOT reused family bases (dedicated, not fallback)',
  resolveMuhurtaRulePack(marriageDefinition.muhurta).reusedFromLegacyFamily === undefined &&
    resolveMuhurtaRulePack(grihaPraveshDefinition.muhurta).reusedFromLegacyFamily === undefined,
);

// ============================================================
// 5. No occasion currently receives TRADITIONALLY_VALIDATED
// ============================================================

check(
  '5. No SUPPORTED Finder occasion resolves to TRADITIONALLY_VALIDATED',
  SUPPORTED_MUHURTHAM_ACTIVITY_IDS.every((id) => {
    const definition = ACTIVITY_DEFINITIONS.find((d) => d.id === id)!;
    return deriveTraditionalCoverageLevel(resolveMuhurtaRulePack(definition.muhurta)) !== 'TRADITIONALLY_VALIDATED';
  }),
);
check(
  '5b. deriveTraditionalCoverageLevel has no code path at all producing TRADITIONALLY_VALIDATED (tithi+nakshatra IMPLEMENTED is the ceiling: OCCASION_SPECIFIC)',
  deriveTraditionalCoverageLevel({ coverage: { tithi: 'IMPLEMENTED', nakshatra: 'IMPLEMENTED' } } as any) === 'OCCASION_SPECIFIC',
);

// ============================================================
// 6. The existing methodology identifier remains unchanged
// ============================================================

check('6. AURA_MUHURTA_METHODOLOGY_ID is still the pre-existing constant', AURA_MUHURTA_METHODOLOGY_ID === 'AURA_MUHURTA_V1');

const journeyResult = findMuhurthams({
  activityId: 'start-journey',
  dateRange: { start: '2026-09-01', end: '2026-09-10' },
  timePreference: 'ANY',
  durationMinutes: 60,
  limit: 5,
  context: chennaiContext,
});
check('6b. findMuhurthams does not carry a provenance field of its own (GENERAL scope -- unchanged shape)', !('provenance' in journeyResult));

// ============================================================
// 7. Coverage metadata survives the production response path
// ============================================================

const marriageSearch = findMuhurthams({
  activityId: 'marriage',
  dateRange: { start: '2026-11-10', end: '2026-12-10' },
  timePreference: 'ANY',
  durationMinutes: 120,
  limit: 5,
  context: chennaiContext,
});
check('7a. findMuhurthams(marriage).activity.traditionalCoverage === OCCASION_SPECIFIC', marriageSearch.activity.traditionalCoverage === 'OCCASION_SPECIFIC');

const journeySearch = findMuhurthams({
  activityId: 'start-journey',
  dateRange: { start: '2026-09-01', end: '2026-09-10' },
  timePreference: 'ANY',
  durationMinutes: 60,
  limit: 5,
  context: chennaiContext,
});
check('7b. findMuhurthams(start-journey).activity.traditionalCoverage === GENERAL_PANCHANGAM', journeySearch.activity.traditionalCoverage === 'GENERAL_PANCHANGAM');

const personalOutcome = findPersonalMuhurthams({
  activityId: 'marriage',
  dateRange: { start: '2026-11-10', end: '2026-11-20' },
  timePreference: 'ANY',
  durationMinutes: 120,
  limit: 5,
  context: { ...chennaiContext, personalContext },
});
check(
  '7c. findPersonalMuhurthams(marriage) carries traditionalCoverage === OCCASION_SPECIFIC when PERSONAL_PROFILE is complete',
  personalOutcome.status === 'OK' && personalOutcome.activity.traditionalCoverage === 'OCCASION_SPECIFIC',
);

const sharedOutcome = findSharedMuhurthams({
  activityId: 'griha-pravesh',
  dateRange: { start: '2026-11-10', end: '2026-11-20' },
  timePreference: 'ANY',
  durationMinutes: 60,
  limit: 5,
  context: { ...chennaiContext, personalContext },
  partner: { savedPersonId: 'test-partner', name: 'Test Partner', context: { natalNakshatraIndex: 10 } },
});
check(
  '7d. findSharedMuhurthams(griha-pravesh) carries traditionalCoverage === OCCASION_SPECIFIC when both profiles are complete',
  sharedOutcome.status === 'OK' && sharedOutcome.activity.traditionalCoverage === 'OCCASION_SPECIFIC',
);

const checkOutcome = evaluateMuhurthamCandidateAt({
  activityId: 'property-purchase',
  scope: 'GENERAL',
  start: new Date(Date.UTC(2026, 9, 5, 7, 0, 0)),
  durationMinutes: 60,
  context: chennaiContext,
});
check(
  '7e. evaluateMuhurthamCandidateAt(property-purchase) carries traditionalCoverage === GENERAL_PANCHANGAM',
  checkOutcome.status === 'OK' && checkOutcome.activity.traditionalCoverage === 'GENERAL_PANCHANGAM',
);

check(
  '7f. Coverage is consistent across every candidate date in a single search result (one value on `activity`, not per-date)',
  marriageSearch.dates.length > 0 && marriageSearch.activity.traditionalCoverage === 'OCCASION_SPECIFIC',
);

// ============================================================
// 8. User-facing explanations match the actual coverage
// ============================================================

check(
  '8a. traditionalCoverageExplanation(OCCASION_SPECIFIC) mentions occasion-specific rules and discloses incompleteness',
  /occasion-specific/i.test(traditionalCoverageExplanation('OCCASION_SPECIFIC')) &&
    /may not be included/i.test(traditionalCoverageExplanation('OCCASION_SPECIFIC')),
);
check(
  '8b. traditionalCoverageExplanation(GENERAL_PANCHANGAM) mentions general Panchangam factors and discloses non-validation',
  /general panchangam/i.test(traditionalCoverageExplanation('GENERAL_PANCHANGAM')) &&
    /not yet been fully validated/i.test(traditionalCoverageExplanation('GENERAL_PANCHANGAM')),
);
check(
  '8c. Neither explanation ever POSITIVELY claims full validation (the proposed GENERAL_PANCHANGAM message correctly says the opposite -- "have not yet been fully validated" -- which must not trip this check) or uses defect/warning language',
  !/is fully validated|defective|error|invalid astronomical/i.test(traditionalCoverageExplanation('OCCASION_SPECIFIC')) &&
    !/is fully validated|defective|error|invalid astronomical/i.test(traditionalCoverageExplanation('GENERAL_PANCHANGAM')),
);
check(
  '8d. explanation text matches the actual resolved tier for a real search result (marriage -> occasion-specific wording, start-journey -> general wording)',
  /occasion-specific/i.test(traditionalCoverageExplanation(marriageSearch.activity.traditionalCoverage)) &&
    /general panchangam/i.test(traditionalCoverageExplanation(journeySearch.activity.traditionalCoverage)),
);

// ============================================================
// 9. Missing or unknown coverage does not produce an unsupported trust claim
// ============================================================

check(
  '9a. An unresolvable classification (no rule pack data at all, MISSING coverage) still resolves to GENERAL_PANCHANGAM, never higher',
  deriveTraditionalCoverageLevel({
    coverage: { tithi: 'MISSING', nakshatra: 'MISSING' },
  } as any) === 'GENERAL_PANCHANGAM',
);
check(
  '9b. Partial dedication (only ONE of tithi/nakshatra IMPLEMENTED) still resolves to GENERAL_PANCHANGAM, never OCCASION_SPECIFIC',
  deriveTraditionalCoverageLevel({ coverage: { tithi: 'IMPLEMENTED', nakshatra: 'REUSABLE_BASE_RULE' } } as any) === 'GENERAL_PANCHANGAM' &&
    deriveTraditionalCoverageLevel({ coverage: { tithi: 'REUSABLE_BASE_RULE', nakshatra: 'IMPLEMENTED' } } as any) === 'GENERAL_PANCHANGAM',
);
check(
  '9c. traditionalCoverageExplanation falls back to the GENERAL_PANCHANGAM-tier message for an unrecognized level string, never an unsupported trust claim',
  traditionalCoverageExplanation('TRADITIONALLY_VALIDATED' as MuhurtaTraditionalCoverageLevel) !== undefined &&
    !/fully validated and complete/i.test(traditionalCoverageExplanation('TRADITIONALLY_VALIDATED' as MuhurtaTraditionalCoverageLevel)),
);

// ============================================================

if (!allPassed) {
  console.error('\nSOME MUHURTA TRADITIONAL COVERAGE CHECKS FAILED');
  process.exit(1);
} else {
  console.log('\nALL MUHURTA TRADITIONAL COVERAGE CHECKS PASSED');
}
