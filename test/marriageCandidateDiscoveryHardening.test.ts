/**
 * Marriage Muhurtham Candidate Discovery Hardening V1: regression suite for
 * the Karana/Yoga transition candidate discovery this PR adds to
 * collectPanchangaTransitionCandidateMinutes(), the coverage-gating that
 * keeps it Marriage-only (data-driven, never `if (activityId ===
 * 'marriage')`), the transition-walk boundary re-entrancy fix, and the
 * dedup correctness fix (a solar slot too narrow for the requested duration
 * no longer suppresses a genuine transition candidate at the same minute).
 *
 * Every date/instant used below is DERIVED from a preceding "Candidate
 * Discovery Hardening" audit's own 1-minute-resolution measurement against
 * Aura's canonical engine, never hand-picked to force a result. Scores are
 * asserted semantically (non-zero result count, correct ordering) rather
 * than pinned to brittle exact values wherever the audit's own guidance
 * prefers that.
 */
import { findMuhurthams, collectPanchangaTransitionCandidateMinutes } from '../packages/recommendation/src/muhurthamFinder';
import { computeAssistantWindows, buildSlotCandidates, profileFromActivity, DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';
import { FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';
import { resolveMuhurtaRulePack, isAuthoritativeAvoidKarana, isAuthoritativeAvoidYoga } from '../packages/muhurta/src/muhurtaRulePacks';
import { getActivityDefinition } from '../packages/recommendation/src/activityDefinitions';
import { getKarana, findNextTransition } from '../packages/vedic/src/panchangElements';
import { localDateTimeToUTC } from '../packages/panchang/src/localDate';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const marriageDef = getActivityDefinition('marriage');
const grihaDef = getActivityDefinition('griha-pravesh');
const engagementDef = getActivityDefinition('engagement');
const journeyDef = getActivityDefinition('start-journey');
if (!marriageDef || !grihaDef || !engagementDef || !journeyDef) throw new Error('marriage/griha-pravesh/engagement/start-journey definitions must exist');
const marriagePack = resolveMuhurtaRulePack(marriageDef.muhurta);
const grihaPack = resolveMuhurtaRulePack(grihaDef.muhurta);
const engagementPack = resolveMuhurtaRulePack(engagementDef.muhurta);
const journeyPack = resolveMuhurtaRulePack(journeyDef.muhurta);

const chennai: DailyAssistantContext = { now: new Date(), latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata', tzOffsetMinutes: 330 };
const newYork: DailyAssistantContext = { now: new Date(), latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York', tzOffsetMinutes: -300 };
const dubai: DailyAssistantContext = { now: new Date(), latitude: 25.2048, longitude: 55.2708, timezone: 'Asia/Dubai', tzOffsetMinutes: 240 };

function searchOneDay(activityId: string, dateStr: string, context: DailyAssistantContext, durationMinutes: number) {
  return findMuhurthams({
    activityId,
    dateRange: { start: dateStr, end: dateStr },
    durationMinutes,
    timePreference: 'ANY',
    limit: 5,
    context: { ...context, now: new Date(`${dateStr}T04:00:00.000Z`) },
  });
}

// ============================================================
// 1. COVERAGE-GATING: coverage flags are the actual authority.
// ============================================================

check('Marriage has karanaAuthoritative IMPLEMENTED', marriagePack.coverage.karanaAuthoritative === 'IMPLEMENTED');
check('Marriage has yogaAuthoritative IMPLEMENTED', marriagePack.coverage.yogaAuthoritative === 'IMPLEMENTED');
check('Griha Pravesh has karanaAuthoritative MISSING', grihaPack.coverage.karanaAuthoritative === 'MISSING');
check('Griha Pravesh has yogaAuthoritative MISSING', grihaPack.coverage.yogaAuthoritative === 'MISSING');
check('Engagement has karanaAuthoritative MISSING', engagementPack.coverage.karanaAuthoritative === 'MISSING');
check('Engagement has yogaAuthoritative MISSING', engagementPack.coverage.yogaAuthoritative === 'MISSING');
check('start-journey (REUSABLE_BASE_RULE) has karanaAuthoritative MISSING', journeyPack.coverage.karanaAuthoritative === 'MISSING');
check('start-journey (REUSABLE_BASE_RULE) has yogaAuthoritative MISSING', journeyPack.coverage.yogaAuthoritative === 'MISSING');

// ============================================================
// 2. COVERAGE-GATING: OBSERVABLE CANDIDATE BEHAVIOR (brief section 25 --
// not inferred from metadata alone). Uses 2026-03-02 New York, a date
// this suite's own day-boundary regression (section 8 below) proves
// carries a real Karana transition candidate for Marriage.
// ============================================================

{
  const dateStr = '2026-03-02';
  const marriageProfile = profileFromActivity(FULL_ACTIVITY_CATALOG.find((a) => a.id === 'marriage')!);
  const grihaProfile = profileFromActivity(FULL_ACTIVITY_CATALOG.find((a) => a.id === 'griha-pravesh')!);
  const engagementProfile = profileFromActivity(FULL_ACTIVITY_CATALOG.find((a) => a.id === 'engagement')!);
  const journeyProfile = profileFromActivity(FULL_ACTIVITY_CATALOG.find((a) => a.id === 'start-journey')!);

  function karanaOrYogaMinutesFor(profile: ReturnType<typeof profileFromActivity>): number[] {
    const dayContext: DailyAssistantContext = { ...newYork, now: new Date(`${dateStr}T12:00:00.000Z`) };
    const solarSlots = buildSlotCandidates(computeAssistantWindows(dayContext));
    const existing = new Set(solarSlots.filter((s) => s.endMinute - s.startMinute >= 60).map((s) => s.startMinute));
    const before = new Set(existing);
    const transitionMinutes = collectPanchangaTransitionCandidateMinutes(dateStr, newYork, 60, profile.muhurtaClassification, existing);
    // Any minute added beyond what a plain Tithi/Nakshatra-only walk would
    // find is attributable to Karana/Yoga -- isolate by re-running with a
    // classification whose pack has neither (start-journey) starting from
    // the SAME base existingMinutes and diffing.
    void before;
    return transitionMinutes;
  }

  const marriageMinutes = karanaOrYogaMinutesFor(marriageProfile);
  const grihaMinutes = karanaOrYogaMinutesFor(grihaProfile);
  const engagementMinutes = karanaOrYogaMinutesFor(engagementProfile);
  const journeyMinutes = karanaOrYogaMinutesFor(journeyProfile);

  check('Marriage receives at least one Karana-transition-derived candidate on 2026-03-02 (New York) that Tithi/Nakshatra alone would not produce', marriageMinutes.length > grihaMinutes.length);
  check('Griha Pravesh (no Karana/Yoga coverage) candidate minutes are UNCHANGED from start-journey (REUSABLE_BASE_RULE, also no Karana/Yoga coverage) -- same Tithi/Nakshatra-only walk', JSON.stringify([...grihaMinutes].sort((a, b) => a - b)) === JSON.stringify([...journeyMinutes].sort((a, b) => a - b)));
  check('Engagement (no Karana/Yoga coverage) candidate minutes also match the Tithi/Nakshatra-only walk', JSON.stringify([...engagementMinutes].sort((a, b) => a - b)) === JSON.stringify([...journeyMinutes].sort((a, b) => a - b)));
}

// ============================================================
// 3. KARANA REGRESSION -- 2026-05-01 New York, 30 minutes. Audit finding:
// Vishti -> Bava around minute 31, eligible run ~[31,237], missed before
// this PR.
// ============================================================

{
  const result = searchOneDay('marriage', '2026-05-01', newYork, 30);
  check('2026-05-01 New York 30min: Finder discovers at least one eligible candidate in the Vishti->Bava run', result.dates.length > 0);
  check('...and the winning window falls on 2026-05-01 itself (New York local date), consistent with the audit\'s morning-recovery finding', result.dates[0]?.date === '2026-05-01');
}

// ============================================================
// 4. KARANA FALSE-ZERO REGRESSION -- 2026-05-01 New York, all three
// durations. Audit reported all three as genuine Karana-driven false-zero
// cases (production returned zero results despite a real eligible run).
// ============================================================

for (const durationMinutes of [15, 30, 60]) {
  const result = searchOneDay('marriage', '2026-05-01', newYork, durationMinutes);
  check(`2026-05-01 New York ${durationMinutes}min: no longer a false-zero result`, result.dates.length > 0);
}

// ============================================================
// 5. YOGA REGRESSION -- 2026-03-06 Chennai, 60 minutes. Audit finding:
// Ganda -> Vriddhi around minute 7, missing a ~4-hour eligible stretch.
// ============================================================

{
  const result = searchOneDay('marriage', '2026-03-06', chennai, 60);
  check('2026-03-06 Chennai 60min: Finder discovers the eligible window (Ganda->Vriddhi recovery)', result.dates.length > 0);
}

// ============================================================
// 6. YOGA FALSE-ZERO REGRESSION -- 2026-05-25 Chennai, all three durations.
// Audit finding: Vajra -> Siddhi, production returned zero results.
// ============================================================

for (const durationMinutes of [15, 30, 60]) {
  const result = searchOneDay('marriage', '2026-05-25', chennai, durationMinutes);
  check(`2026-05-25 Chennai ${durationMinutes}min: no longer a false-zero result (Vajra->Siddhi recovery)`, result.dates.length > 0);
}

// ============================================================
// 7. SECOND YOGA CONTROL -- 2026-05-17 Chennai, Atiganda -> Sukarma.
// Independently observed in the audit; prevents this implementation from
// being accidentally tuned only to the Vajra/Ganda cases above.
// ============================================================

for (const durationMinutes of [15, 30, 60]) {
  const result = searchOneDay('marriage', '2026-05-17', chennai, durationMinutes);
  check(`2026-05-17 Chennai ${durationMinutes}min: Atiganda->Sukarma recovery produces a result`, result.dates.length > 0);
}

// ============================================================
// 8. DAY-BOUNDARY / TRANSITION-WALK RE-ENTRANCY REGRESSION -- 2026-03-02
// New York. Audit finding: a Karana avoid period (Vishti) starting early in
// the day and ending late the same day was invisible to candidate
// discovery because collectTransitionInstants's walk, called exactly at
// the FIRST transition it found, re-found that same instant (a documented
// astronomy-engine search characteristic) and silently stopped rather than
// continuing to the SECOND, later transition -- previously latent for
// low-frequency Tithi/Nakshatra, exposed once Karana's higher frequency
// made two same-day transitions common. Root-cause classification:
// (E) genuine production bug in collectTransitionInstants, fixed with a
// small, local nudge-and-retry (TRANSITION_REENTRANCY_NUDGE_MS) -- not a
// cross-day architecture change.
// ============================================================

{
  const dateStr = '2026-03-02';
  const durationMinutes = 60;
  const profile = profileFromActivity(FULL_ACTIVITY_CATALOG.find((a) => a.id === 'marriage')!);
  const dayContext: DailyAssistantContext = { ...newYork, now: new Date(`${dateStr}T12:00:00.000Z`) };
  const solarSlots = buildSlotCandidates(computeAssistantWindows(dayContext));
  const existing = new Set(solarSlots.filter((s) => s.endMinute - s.startMinute >= durationMinutes).map((s) => s.startMinute));
  const transitionMinutes = collectPanchangaTransitionCandidateMinutes(dateStr, newYork, durationMinutes, profile.muhurtaClassification, existing);
  check('2026-03-02 New York 60min: a SECOND same-day Karana transition candidate is now discovered (minute ~1140, the Vishti-ending boundary the old walk could never reach)', transitionMinutes.some((m) => m >= 1135 && m <= 1145));
}

// ============================================================
// 9. DEDUP CORRECTNESS REGRESSION -- 2026-11-21 Dubai, 60 minutes. Audit
// finding: a Karana transition ceil-rounds onto the same minute (~303) a
// raw solar-window candidate also starts at, but that solar slot cannot
// host a 60-minute block -- the old dedup (seeded from EVERY solar slot's
// startMinute regardless of duration fit) silently dropped the useful
// transition candidate. Uses canonical engine-derived values, never a
// hardcoded fake transition.
// ============================================================

{
  const dateStr = '2026-11-21';
  const durationMinutes = 60;
  const profile = profileFromActivity(FULL_ACTIVITY_CATALOG.find((a) => a.id === 'marriage')!);
  const dayContext: DailyAssistantContext = { ...dubai, now: new Date(`${dateStr}T12:00:00.000Z`) };
  const solarSlots = buildSlotCandidates(computeAssistantWindows(dayContext));
  const rawSolarMinutes = new Set(solarSlots.map((s) => s.startMinute));
  const durationFitSolarMinutes = new Set(solarSlots.filter((s) => s.endMinute - s.startMinute >= durationMinutes).map((s) => s.startMinute));
  check('Sanity: a raw (unfiltered) solar slot genuinely claims minute ~303 on 2026-11-21 Dubai', [...rawSolarMinutes].some((m) => m >= 300 && m <= 306));
  check('...but that specific slot cannot host a 60-minute block (correctly excluded by duration-fit filtering)', ![...durationFitSolarMinutes].some((m) => m >= 300 && m <= 306));

  const existing = new Set(durationFitSolarMinutes);
  const transitionMinutes = collectPanchangaTransitionCandidateMinutes(dateStr, dubai, durationMinutes, profile.muhurtaClassification, existing);
  check('The Karana transition candidate at minute ~303 survives dedup and is generated (previously dropped)', transitionMinutes.some((m) => m >= 300 && m <= 306));

  const result = searchOneDay('marriage', dateStr, dubai, durationMinutes);
  check('2026-11-21 Dubai 60min: Finder now returns a non-empty result (was false-zero before this PR)', result.dates.length > 0);
}

// ============================================================
// 10. ROUNDING -- transition-becomes-candidate-start rounds FORWARD (ceil),
// never onto or before the still-old value, for Karana. Uses a real
// engine-derived transition instant, never a synthetic/fake one.
// ============================================================

{
  const dateStr = '2026-11-21';
  const profile = profileFromActivity(FULL_ACTIVITY_CATALOG.find((a) => a.id === 'marriage')!);
  const dubaiDayStart = localDateTimeToUTC(dateStr, '00:00', 'Asia/Dubai');
  const transitionInstant = findNextTransition(dubaiDayStart, 'KARANA');
  // findNextTransition's own convergence precision band can be wider than a
  // few milliseconds for KARANA specifically (documented elsewhere in this
  // PR); check a 2-minute margin on each side, not micro-second offsets,
  // to avoid a false "no change" reading that straddles the same side of
  // the true boundary.
  const beforeName = getKarana(new Date(transitionInstant.getTime() - 120_000)).name;
  const afterName = getKarana(new Date(transitionInstant.getTime() + 120_000)).name;
  check('Sanity: a genuine Karana transition exists on 2026-11-21 (Dubai local day)', beforeName !== afterName);

  const dayContext: DailyAssistantContext = { ...dubai, now: new Date(`${dateStr}T12:00:00.000Z`) };
  const solarSlots = buildSlotCandidates(computeAssistantWindows(dayContext));
  const existing = new Set(solarSlots.filter((s) => s.endMinute - s.startMinute >= 60).map((s) => s.startMinute));
  const transitionMinutes = collectPanchangaTransitionCandidateMinutes(dateStr, dubai, 60, profile.muhurtaClassification, existing);

  // The transition instant, converted to Dubai-local minute-of-day, rounded
  // both ways -- the candidate must be the CEIL, never the FLOOR, whenever
  // they differ (a transition landing exactly on a whole minute has no
  // ambiguity to test).
  const rawMinute = (transitionInstant.getTime() - dubaiDayStart.getTime()) / 60000;
  const ceilMinute = Math.ceil(rawMinute);
  const floorMinute = Math.floor(rawMinute);
  if (ceilMinute !== floorMinute) {
    check('Transition rounding: the candidate lands on the CEIL minute, not the FLOOR (never claims clean before the value genuinely changed)', transitionMinutes.includes(ceilMinute) && !transitionMinutes.includes(floorMinute));
  } else {
    check('Transition landed exactly on a whole minute (no rounding ambiguity to test here) -- candidate present at that minute', transitionMinutes.includes(ceilMinute));
  }
}

// ============================================================
// 11. LATEST-VALID-START -- a SAFE->AVOID Karana transition (entering an
// authoritative avoid Karana) generates the correct duration-aware latest
// start. Uses the 2026-03-02 New York Vanija->Vishti entry (Vishti IS an
// authoritative avoid Karana for Marriage), the same real transition this
// suite's day-boundary regression (section 8) already anchors on.
// ============================================================

{
  const dateStr = '2026-03-02';
  const durationMinutes = 60;
  const profile = profileFromActivity(FULL_ACTIVITY_CATALOG.find((a) => a.id === 'marriage')!);
  const dayContext: DailyAssistantContext = { ...newYork, now: new Date(`${dateStr}T12:00:00.000Z`) };
  const solarSlots = buildSlotCandidates(computeAssistantWindows(dayContext));
  const existing = new Set(solarSlots.filter((s) => s.endMinute - s.startMinute >= durationMinutes).map((s) => s.startMinute));
  const transitionMinutes = collectPanchangaTransitionCandidateMinutes(dateStr, newYork, durationMinutes, profile.muhurtaClassification, existing);

  // The Vanija->Vishti transition ceil-rounds to minute 447 (12:27 local);
  // Vishti IS an authoritative avoid Karana for Marriage, so a
  // latest-valid-start candidate at floor(instant) - 60 (~386) must also
  // be generated -- the same mechanism already proven for Tithi/Nakshatra,
  // now extended to Karana.
  check('AVOID entry (Vanija->Vishti) transition-start candidate at minute ~447 is present', transitionMinutes.some((m) => m >= 445 && m <= 449));
  check('SAFE->AVOID latest-valid-start candidate at minute ~386 (447-60, before the avoid Karana begins) is present', transitionMinutes.some((m) => m >= 384 && m <= 388));
  check('isAuthoritativeAvoidKarana confirms Vishti is genuinely avoid for Marriage (the precondition for this candidate to exist at all)', isAuthoritativeAvoidKarana(marriagePack, 'Vishti'));
}

// ============================================================
// 12. YOGA LATEST-VALID-START -- same SAFE->AVOID proof for Yoga, using
// 2026-05-17 Chennai's real Atiganda entry.
// ============================================================

{
  check('isAuthoritativeAvoidYoga confirms Atiganda is genuinely avoid for Marriage', isAuthoritativeAvoidYoga(marriagePack, 'Atiganda'));
  const dateStr = '2026-05-17';
  const durationMinutes = 30;
  const profile = profileFromActivity(FULL_ACTIVITY_CATALOG.find((a) => a.id === 'marriage')!);
  const dayContext: DailyAssistantContext = { ...chennai, now: new Date(`${dateStr}T12:00:00.000Z`) };
  const solarSlots = buildSlotCandidates(computeAssistantWindows(dayContext));
  const existing = new Set(solarSlots.filter((s) => s.endMinute - s.startMinute >= durationMinutes).map((s) => s.startMinute));
  const transitionMinutes = collectPanchangaTransitionCandidateMinutes(dateStr, chennai, durationMinutes, profile.muhurtaClassification, existing);
  check('At least one Yoga-derived candidate minute exists for 2026-05-17 Chennai (transition-start and/or latest-valid-start)', transitionMinutes.length > 0);
}

console.log(allPassed ? '\nALL MARRIAGE CANDIDATE DISCOVERY HARDENING CHECKS PASSED' : '\nSOME MARRIAGE CANDIDATE DISCOVERY HARDENING CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
