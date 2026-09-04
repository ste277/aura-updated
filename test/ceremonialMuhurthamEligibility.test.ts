/**
 * Ceremonial Muhurtham Eligibility + Interval Safety V1: regression suite
 * for the new event-specific Nakshatra/Tithi hard-eligibility check --
 * packages/recommendation/src/muhurthamFinder.ts's
 * spanOverlapsAuthoritativeEventAvoid() and its wiring into
 * evaluateMuhurthamCandidate(), plus the authority helpers
 * (isAuthoritativeAvoidNakshatra/isAuthoritativeAvoidTithi) in
 * packages/muhurta/src/muhurtaRulePacks.ts.
 *
 * All fixtures below are real, deterministic 2026 instants -- verified live
 * (getNakshatra/getTithi/getKarana, packages/vedic/src/panchangElements.ts)
 * before being hardcoded here, not guessed. See each check's comment for
 * the exact Panchanga values at that instant.
 */
import { spanOverlapsAuthoritativeEventAvoid, findMuhurthams, findPersonalMuhurthams, findSharedMuhurthams } from '../packages/recommendation/src/muhurthamFinder';
import { evaluateMuhurtaWithRulePack, resolveMuhurtaRulePack, isAuthoritativeAvoidNakshatra, isAuthoritativeAvoidTithi } from '../packages/muhurta/src/muhurtaRulePacks';
import { profileFromActivity } from '../packages/recommendation/src/dailyAssistant';
import { findActivityIntent } from '../packages/recommendation/src/personalizedTasks';
import { findNextTransition, getNakshatra } from '../packages/vedic/src/panchangElements';
import type { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const chennaiContext: DailyAssistantContext = {
  now: new Date(Date.UTC(2026, 8, 1, 4, 0, 0)),
  latitude: 13.0827,
  longitude: 80.2707,
  timezone: 'Asia/Kolkata',
  tzOffsetMinutes: 330,
};

const grihaActivity = findActivityIntent('griha pravesh')!;
const grihaProfile = profileFromActivity(grihaActivity);
const grihaClassification = grihaProfile.muhurtaClassification!;
const grihaPack = resolveMuhurtaRulePack(grihaClassification);

const journeyActivity = findActivityIntent('start a journey')!;
const journeyProfile = profileFromActivity(journeyActivity);
const journeyClassification = journeyProfile.muhurtaClassification!;

// ============================================================
// AUTHORITY HELPERS (muhurtaRulePacks.ts) -- the single source of truth
// spanOverlapsAuthoritativeEventAvoid() must derive from, never duplicate.
// ============================================================

check('Griha Pravesh rule pack has IMPLEMENTED coverage for both Tithi and Nakshatra (the precondition for any of this to matter)', grihaPack.coverage.tithi === 'IMPLEMENTED' && grihaPack.coverage.nakshatra === 'IMPLEMENTED');
check('isAuthoritativeAvoidNakshatra is true for Jyeshtha against the Griha Pravesh pack', isAuthoritativeAvoidNakshatra(grihaPack, 'Jyeshtha'));
check('isAuthoritativeAvoidNakshatra is false for a favorable Nakshatra (Rohini)', !isAuthoritativeAvoidNakshatra(grihaPack, 'Rohini'));
check('isAuthoritativeAvoidNakshatra is false for a neutral (neither favorable nor avoid) Nakshatra (Shravana)', !isAuthoritativeAvoidNakshatra(grihaPack, 'Shravana'));
check('isAuthoritativeAvoidTithi is true for Amavasya against the Griha Pravesh pack', isAuthoritativeAvoidTithi(grihaPack, 'Amavasya'));
check('isAuthoritativeAvoidTithi is false for a favorable Tithi (Shukla Tritiya)', !isAuthoritativeAvoidTithi(grihaPack, 'Shukla Tritiya'));

const journeyPack = resolveMuhurtaRulePack(journeyClassification);
check('start-journey resolves to REUSABLE_BASE_RULE (not IMPLEMENTED) coverage -- confirms it has no genuine intent-specific data', journeyPack.coverage.nakshatra === 'REUSABLE_BASE_RULE' && journeyPack.coverage.tithi === 'REUSABLE_BASE_RULE');
check('isAuthoritativeAvoidNakshatra is false for ANY value against a REUSABLE_BASE_RULE pack, even one in its own avoid list', journeyPack.nakshatra.avoid.every((n) => !isAuthoritativeAvoidNakshatra(journeyPack, n)));

// ============================================================
// POSITIVE-COMPENSATION-CANNOT-RESCUE -- the exact Jyeshtha reproduction
// from the audit: 2026-09-18T06:30:00.000Z is Jyeshtha (avoid) + Shukla
// Saptami (neutral) + Ayushman Yoga (+4) + Vanija Karana (+3) + ABHIJIT
// (+8) -- additive modifier is +5 (positive), yet the candidate must be
// hard-excluded, not merely scored down.
// ============================================================

const jyeshthaInstant = new Date('2026-09-18T06:30:00.000Z');
const jyeshthaEvaluation = evaluateMuhurtaWithRulePack({ classification: grihaClassification, date: jyeshthaInstant, windowType: 'ABHIJIT' });
check('The additive scoring formula itself is untouched: Jyeshtha + Yoga + Karana + Abhijit still nets a POSITIVE modifier (+5)', jyeshthaEvaluation.modifier === 5);
check('...and still carries the raw NAKSHATRA_UNFAVORABLE reason as a soft -10 (this PR does not change reason generation)', jyeshthaEvaluation.reasons.some((r) => r.code === 'NAKSHATRA_UNFAVORABLE' && r.impact === -10 && r.value === 'Jyeshtha'));
check('spanOverlapsAuthoritativeEventAvoid flags this exact instant as an avoid-Nakshatra span', spanOverlapsAuthoritativeEventAvoid(jyeshthaInstant, new Date('2026-09-18T07:30:00.000Z'), grihaClassification));

const jyeshthaDateSearch = findMuhurthams({
  activityId: 'griha-pravesh',
  dateRange: { start: '2026-09-18', end: '2026-09-18' },
  timePreference: 'ANY',
  durationMinutes: 60,
  limit: 5,
  context: chennaiContext,
});
check('Despite the positive additive modifier, findMuhurthams excludes 2026-09-18 entirely for griha-pravesh (Jyeshtha covers the whole calendar day at this location)', jyeshthaDateSearch.dates.length === 0);

// ============================================================
// AVOID-AT-START / AVOID-MID-CANDIDATE / DURATION SENSITIVITY -- all
// derived from the real Anuradha->Jyeshtha Nakshatra transition on
// 2026-09-17 (found via findNextTransition, the same primitive the
// production code uses -- not a second, independently-derived instant, so
// boundary assertions below are self-consistent with the production
// search's own precision).
// ============================================================

const anuradhaAnchor = new Date('2026-09-17T06:30:00.000Z');
check('Sanity: the anchor instant is genuinely Anuradha (favorable, not avoid)', getNakshatra(anuradhaAnchor).name === 'Anuradha' && !isAuthoritativeAvoidNakshatra(grihaPack, 'Anuradha'));
const transitionInstant = findNextTransition(anuradhaAnchor, 'NAKSHATRA');
check('Sanity: the found transition instant is on the correct calendar date (2026-09-17, afternoon IST)', transitionInstant.toISOString().startsWith('2026-09-17T1'));

check('avoid-at-start: a candidate starting exactly at the Anuradha->Jyeshtha transition is rejected', spanOverlapsAuthoritativeEventAvoid(transitionInstant, new Date(transitionInstant.getTime() + 15 * 60000), grihaClassification));
check('avoid-mid-candidate: a candidate starting 30min before and ending 30min after the transition (clean start, but crosses into Jyeshtha) is rejected', spanOverlapsAuthoritativeEventAvoid(new Date(transitionInstant.getTime() - 30 * 60000), new Date(transitionInstant.getTime() + 30 * 60000), grihaClassification));

check('boundary-exact (end === transition instant): half-open [start, end) EXCLUDES the new value -- not rejected', !spanOverlapsAuthoritativeEventAvoid(anuradhaAnchor, transitionInstant, grihaClassification));
check('boundary-exact (start === transition instant): the new value applies from its own start instant -- rejected', spanOverlapsAuthoritativeEventAvoid(transitionInstant, new Date(transitionInstant.getTime() + 15 * 60000), grihaClassification));

// Duration sensitivity: a fixed probe start 40 minutes before the
// transition. A short (15min) candidate ends well before the transition and
// survives; longer (60min, 120min) candidates starting at the SAME instant
// run past it and are rejected -- proving the check is duration-sensitive,
// not merely start-instant-sensitive.
const probeStart = new Date(transitionInstant.getTime() - 40 * 60000);
check('duration-sensitivity: a 15-minute candidate ending well before the transition survives', !spanOverlapsAuthoritativeEventAvoid(probeStart, new Date(probeStart.getTime() + 15 * 60000), grihaClassification));
check('duration-sensitivity: a 60-minute candidate at the same start instant runs past the transition and is rejected', spanOverlapsAuthoritativeEventAvoid(probeStart, new Date(probeStart.getTime() + 60 * 60000), grihaClassification));
check('duration-sensitivity: a 120-minute candidate at the same start instant is also rejected', spanOverlapsAuthoritativeEventAvoid(probeStart, new Date(probeStart.getTime() + 120 * 60000), grihaClassification));

// ============================================================
// PURE-FAVORABLE -- unaffected normal scoring. 2026-09-13T06:30 UTC is
// Chitra (favorable Nakshatra) + Shukla Tritiya (favorable Tithi) for
// Griha Pravesh -- neither factor is anywhere near avoid.
// ============================================================

check('A candidate on a genuinely favorable Nakshatra+Tithi instant is never flagged', !spanOverlapsAuthoritativeEventAvoid(new Date('2026-09-13T06:30:00.000Z'), new Date('2026-09-13T07:30:00.000Z'), grihaClassification));

// ============================================================
// AVOID-TITHI -- 2026-09-10T06:30 UTC is Amavasya, an authoritative avoid
// Tithi for Griha Pravesh (the Nakshatra that day, Purva Phalguni, is
// itself neutral -- proving the Tithi arm of the check independently
// triggers rejection, not merely riding on the Nakshatra arm).
// ============================================================

check('An authoritative avoid Tithi (Amavasya) alone triggers rejection, independent of Nakshatra', spanOverlapsAuthoritativeEventAvoid(new Date('2026-09-10T06:30:00.000Z'), new Date('2026-09-10T07:30:00.000Z'), grihaClassification));

// ============================================================
// GENERIC-NEGATIVE-REMAINS-SOFT -- a difficult Yoga/Karana (Vishti) alone,
// with a favorable Nakshatra/Tithi, must never trigger this check (it only
// ever inspects Nakshatra/Tithi -- Yoga/Karana stay soft additive signals,
// unchanged by this PR). 2026-09-22T06:30 UTC: Karana=Vishti,
// Nakshatra=Shravana (neutral), Tithi=Shukla Ekadashi (favorable).
// ============================================================

const vishtiInstant = new Date('2026-09-22T06:30:00.000Z');
check('A Vishti Karana instant with favorable Nakshatra/Tithi is NOT flagged by the new check (Karana is out of scope for it)', !spanOverlapsAuthoritativeEventAvoid(vishtiInstant, new Date('2026-09-22T07:30:00.000Z'), grihaClassification));
const vishtiEvaluation = evaluateMuhurtaWithRulePack({ classification: grihaClassification, date: vishtiInstant, windowType: 'NEUTRAL' });
check('...and Vishti Karana still surfaces as its own soft CAUTION reason via the unchanged additive scoring path', vishtiEvaluation.reasons.some((r) => r.code === 'KARANA_UNFAVORABLE' && r.impact === -8 && r.value === 'Vishti'));

// ============================================================
// GENERIC ACTIVITY UNAFFECTED -- start-journey (REUSABLE_BASE_RULE, not
// IMPLEMENTED) must never be hard-rejected by this check, even on a date
// that happens to carry a Nakshatra Griha Pravesh's OWN pack avoids
// (Jyeshtha, 2026-09-18) -- REUSABLE_BASE_RULE data stays a soft signal for
// every activity that only has it.
// ============================================================

check('start-journey (no dedicated rule pack) is never hard-rejected by this check, even on a Griha-Pravesh-avoid Nakshatra date', !spanOverlapsAuthoritativeEventAvoid(jyeshthaInstant, new Date('2026-09-18T07:30:00.000Z'), journeyClassification));

const journeyOnJyeshthaDate = findMuhurthams({
  activityId: 'start-journey',
  dateRange: { start: '2026-09-18', end: '2026-09-18' },
  timePreference: 'ANY',
  durationMinutes: 60,
  limit: 5,
  context: chennaiContext,
});
check('start-journey Muhurtham search for 2026-09-18 is governed only by pre-existing rules (not silently zeroed out by the new check)', journeyOnJyeshthaDate.dates.length > 0);

// ============================================================
// GENERAL/PERSONAL/SHARED WIDE-SWEEP SEMANTICS -- exact final date-set
// parity between GENERAL and PERSONAL is NOT the real invariant here (see
// the Muhurtham Wide-Sweep GENERAL/PERSONAL Date Divergence audit,
// root-caused and closed: candidate discovery and objective hard
// eligibility ARE identical between the two scopes; but findMuhurthams()'s
// resolved limit is capped at MAX_LIMIT=20 regardless of what's requested,
// this fixture has more than 20 objectively-eligible dates for BOTH scopes,
// and PERSONAL legitimately re-ranks using combinedScore (Tara Bala
// included) -- so a shared top-20 cutoff can legitimately select a
// slightly different set of dates per scope, exactly as
// findPersonalMuhurthams()'s own module doc comment already documents
// ("a date whose Tara Bala is favorable can out-rank a date with a
// marginally higher general score"). SHARED, by contrast, always selects
// using generalContext (never a personalized score), so it stays an exact
// architectural invariant against GENERAL. What this block actually proves:
// (1) SHARED === GENERAL exactly; (2) every date either scope returns is
// independently valid under its OWN scope's solo single-day query (rules
// out truncation/ranking corrupting a result into something invalid); (3)
// any date present in one scope's wide-sweep output but not the other's is
// explained by exactly one of two legitimate mechanisms -- still
// objectively discoverable under the other scope too (pure ranking/
// truncation, PERSONAL never "loses" real eligibility) or genuinely
// score-excluded under the other scope's own MIN_INCLUSION_SCORE (a
// documented, legitimate personalization outcome, e.g. the audit's own
// 2026-09-30 finding) -- never anything else; (4) results are deterministic
// across repeated calls.
// ============================================================

const wideRange = { start: '2026-09-01', end: '2026-09-30' };
const userPersonalContext = { natalNakshatraIndex: 1, janmaNakshatra: 'Ashwini' };
const partner = { savedPersonId: 'ceremonial-eligibility-test-partner', name: 'Test Partner', context: { natalNakshatraIndex: 4 } };

const generalWide = findMuhurthams({ activityId: 'griha-pravesh', dateRange: wideRange, timePreference: 'ANY', durationMinutes: 60, limit: 30, context: chennaiContext });
const personalWide = findPersonalMuhurthams({ activityId: 'griha-pravesh', dateRange: wideRange, timePreference: 'ANY', durationMinutes: 60, limit: 30, context: { ...chennaiContext, personalContext: userPersonalContext } });
const sharedWide = findSharedMuhurthams({ activityId: 'griha-pravesh', dateRange: wideRange, timePreference: 'ANY', durationMinutes: 60, limit: 30, context: { ...chennaiContext, personalContext: userPersonalContext }, partner });

check('PERSONAL scope returns OK status for this fixture (sanity)', personalWide.status === 'OK');
check('SHARED scope returns OK status for this fixture (sanity)', sharedWide.status === 'OK');
check('GENERAL excludes 2026-09-18 and 2026-09-19 (Jyeshtha/Mula) for griha-pravesh', !generalWide.dates.some((d) => d.date === '2026-09-18' || d.date === '2026-09-19'));
if (personalWide.status === 'OK' && sharedWide.status === 'OK') {
  const generalDateSet = generalWide.dates.map((d) => d.date).sort();
  const personalDateSet = personalWide.dates.map((d) => d.date).sort();
  const sharedDateSet = sharedWide.dates.map((d) => d.date).sort();

  // (1) SHARED is a real architectural invariant against GENERAL.
  check('SHARED surfaces exactly the same set of eligible dates as GENERAL (architectural invariant: findSharedMuhurthams always selects using generalContext)', JSON.stringify(sharedDateSet) === JSON.stringify(generalDateSet));

  // (2) Every returned date is independently valid under its own scope's
  // solo single-day query -- proves the wide sweep never manufactures or
  // corrupts a result; it only ever selects among genuinely valid ones.
  const soloOneDay = (scope: 'GENERAL' | 'PERSONAL', date: string) => {
    if (scope === 'GENERAL') {
      const r = findMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: date, end: date }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: chennaiContext });
      return r.dates.length > 0;
    }
    const r = findPersonalMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: date, end: date }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: { ...chennaiContext, personalContext: userPersonalContext } });
    return r.status === 'OK' && r.dates.length > 0;
  };
  check('Every GENERAL wide-sweep date is independently valid under a solo single-day GENERAL query', generalDateSet.every((d) => soloOneDay('GENERAL', d)));
  check('Every PERSONAL wide-sweep date is independently valid under a solo single-day PERSONAL query', personalDateSet.every((d) => soloOneDay('PERSONAL', d)));

  // (3) Every divergent date is explained by one of exactly two legitimate
  // mechanisms -- ranking/truncation (still discoverable under the OTHER
  // scope too) or a genuine personalization-driven score exclusion (NOT
  // discoverable under the other scope, via that scope's own
  // MIN_INCLUSION_SCORE) -- never candidate corruption or an unexplained gap.
  // Candidate discovery is proven identical between scopes elsewhere in this
  // suite's sibling file (marriageCandidateDiscoveryHardening.test.ts) and
  // by the wide-sweep audit -- personalContext never affects which
  // candidate-start instants are generated, only their score. Given that,
  // a divergent date is legitimately explained ONLY if it is still
  // discoverable under the OTHER scope's own solo query (pure
  // ranking/truncation -- the audit's actual, confirmed finding for this
  // fixture's 09-07/09-22 pair) -- a divergent date that DISAPPEARS under
  // solo querying too would mean personalization pushed every one of the
  // same candidates below that scope's own MIN_INCLUSION_SCORE (also
  // legitimate, e.g. the audit's 2026-09-30 finding, though that date does
  // not appear in THIS wide sweep's output at all since it is truncated by
  // ranking regardless of scope) -- asserted here as an explicit, falsifiable
  // expectation for this fixture's current dates, not a tautology.
  const onlyGeneral = generalDateSet.filter((d) => !personalDateSet.includes(d));
  const onlyPersonal = personalDateSet.filter((d) => !generalDateSet.includes(d));
  for (const date of onlyGeneral) {
    check(`${date} (GENERAL-only in the wide sweep) remains discoverable under a solo PERSONAL query (pure ranking/truncation, not a real exclusion)`, soloOneDay('PERSONAL', date));
  }
  for (const date of onlyPersonal) {
    check(`${date} (PERSONAL-only in the wide sweep) remains discoverable under a solo GENERAL query (pure ranking/truncation, not a real exclusion)`, soloOneDay('GENERAL', date));
  }

  // (4) Deterministic: repeating the exact same wide-sweep calls produces
  // byte-identical date sets every time.
  const generalWideRepeat = findMuhurthams({ activityId: 'griha-pravesh', dateRange: wideRange, timePreference: 'ANY', durationMinutes: 60, limit: 30, context: chennaiContext });
  const personalWideRepeat = findPersonalMuhurthams({ activityId: 'griha-pravesh', dateRange: wideRange, timePreference: 'ANY', durationMinutes: 60, limit: 30, context: { ...chennaiContext, personalContext: userPersonalContext } });
  check('GENERAL wide-sweep result is deterministic (identical date set on a repeated call)', JSON.stringify(generalWideRepeat.dates.map((d) => d.date).sort()) === JSON.stringify(generalDateSet));
  check('PERSONAL wide-sweep result is deterministic (identical date set on a repeated call)', personalWideRepeat.status === 'OK' && JSON.stringify(personalWideRepeat.dates.map((d) => d.date).sort()) === JSON.stringify(personalDateSet));
}

// ============================================================
// ZERO-RESULT ARCHITECTURE PRESERVED -- a date-range entirely inside an
// avoid stretch still returns a genuinely empty `dates: []`, not a
// manufactured result or a thrown error (brief: existing zero-result
// architecture, MIN_INCLUSION_SCORE/return null/[], must be untouched).
// ============================================================

const entirelyJyeshthaRange = findMuhurthams({
  activityId: 'griha-pravesh',
  dateRange: { start: '2026-09-18', end: '2026-09-18' },
  timePreference: 'ANY',
  durationMinutes: 60,
  limit: 5,
  context: chennaiContext,
});
check('A date range entirely inside an authoritative-avoid stretch returns a genuinely empty dates array, not an error', entirelyJyeshthaRange.dates.length === 0 && entirelyJyeshthaRange.evaluatedDateCount === 1);

console.log(allPassed ? '\nALL CEREMONIAL MUHURTHAM ELIGIBILITY CHECKS PASSED' : '\nSOME CEREMONIAL MUHURTHAM ELIGIBILITY CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
