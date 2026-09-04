/**
 * Muhurtham Solar Score-Boundary Candidate Augmentation V1: regression
 * suite for collectSolarScoreBoundaryCandidateMinutes()
 * (packages/recommendation/src/muhurthamFinder.ts) and its wiring into
 * findBestWindowsForDate() -- the fix for the "Marriage 60-Minute Candidate
 * Scoring-Density False Zero" audit's core finding: scoreContinuousBlock()
 * segments a requested [start, start+duration) span only at solar-window
 * boundaries, so a duration wider than a narrow favorable window (BRAHMA/
 * ABHIJIT, typically ~48-50 minutes) produces a continuously-varying,
 * duration-weighted score that peaks in an exact plateau across
 * [windowEnd - duration, windowStart] -- a range production only ever
 * sampled at one end (windowStart) before this PR.
 *
 * Every window boundary used below is DERIVED live from Aura's canonical
 * engine (computeAssistantWindows/buildSlotCandidates), never hand-picked
 * or fabricated, so this suite stays correct if ephemeris data ever shifts
 * slightly.
 */
import {
  findMuhurthams,
  findPersonalMuhurthams,
  findSharedMuhurthams,
  collectSolarScoreBoundaryCandidateMinutes,
} from '../packages/recommendation/src/muhurthamFinder';
import { evaluateTimingCandidate } from '../packages/recommendation/src/timingSearch';
import {
  computeAssistantWindows,
  buildSlotCandidates,
  profileFromActivity,
  DailyAssistantContext,
} from '../packages/recommendation/src/dailyAssistant';
import { FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';
import { localDateTimeToUTC } from '../packages/panchang/src/localDate';
import { formatMinutes } from '../packages/astronomy/src/ephemeris';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const chennai: DailyAssistantContext = { now: new Date(), latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata', tzOffsetMinutes: 330 };
const dubai: DailyAssistantContext = { now: new Date(), latitude: 25.2048, longitude: 55.2708, timezone: 'Asia/Dubai', tzOffsetMinutes: 240 };
const newYork: DailyAssistantContext = { now: new Date(), latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York', tzOffsetMinutes: -300 };
const kochi: DailyAssistantContext = { now: new Date(), latitude: 9.9312, longitude: 76.2673, timezone: 'Asia/Kolkata', tzOffsetMinutes: 330 };

const marriageActivity = FULL_ACTIVITY_CATALOG.find((a) => a.id === 'marriage')!;
const marriageProfile = profileFromActivity(marriageActivity);

function solarSlotsFor(dateStr: string, context: DailyAssistantContext) {
  const dayContext: DailyAssistantContext = { ...context, now: localDateTimeToUTC(dateStr, '12:00', context.timezone) };
  return buildSlotCandidates(computeAssistantWindows(dayContext));
}

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
// 1. BRAHMA REGRESSION -- a real, engine-derived BRAHMA window narrower
// than 60 minutes must produce a candidate at windowEnd - 60.
// ============================================================

{
  const dateStr = '2026-04-23';
  const durationMinutes = 60;
  const slots = solarSlotsFor(dateStr, chennai);
  const brahma = slots.find((s) => s.type === 'BRAHMA')!;
  check('Sanity: a real BRAHMA window exists for this date and is narrower than 60 minutes', Boolean(brahma) && brahma.endMinute - brahma.startMinute < durationMinutes);
  const existing = new Set(slots.filter((s) => s.endMinute - s.startMinute >= durationMinutes).map((s) => s.startMinute));
  const derived = collectSolarScoreBoundaryCandidateMinutes(slots, durationMinutes, existing);
  check('BRAHMA.endMinute - 60 is present in the derived candidate set', derived.includes(brahma.endMinute - durationMinutes));
  check('BRAHMA.startMinute is NOT re-derived here (it is already a solar-slot candidate elsewhere)', !derived.includes(brahma.startMinute) || brahma.startMinute === brahma.endMinute - durationMinutes);
}

// ============================================================
// 2. ABHIJIT REGRESSION -- same proof for ABHIJIT.
// ============================================================

{
  const dateStr = '2026-04-23';
  const durationMinutes = 60;
  const slots = solarSlotsFor(dateStr, chennai);
  const abhijit = slots.find((s) => s.type === 'ABHIJIT')!;
  check('Sanity: a real ABHIJIT window exists for this date and is narrower than 60 minutes', Boolean(abhijit) && abhijit.endMinute - abhijit.startMinute < durationMinutes);
  const existing = new Set(slots.filter((s) => s.endMinute - s.startMinute >= durationMinutes).map((s) => s.startMinute));
  const derived = collectSolarScoreBoundaryCandidateMinutes(slots, durationMinutes, existing);
  check('ABHIJIT.endMinute - 60 is present in the derived candidate set', derived.includes(abhijit.endMinute - durationMinutes));
}

// ============================================================
// 3. CLOSED-FORM PLATEAU -- for a real favorable window [ws, we) narrower
// than duration D, both windowStart and (windowEnd - D) sit on the SAME
// maximum/full-capture score plateau, and a point clearly outside that
// plateau scores lower. Proves WHY the derived candidate is correct, not
// merely that it exists.
// ============================================================

{
  const dateStr = '2026-04-23';
  const durationMinutes = 60;
  const slots = solarSlotsFor(dateStr, chennai);
  const abhijit = slots.find((s) => s.type === 'ABHIJIT')!;
  const plateauStart = abhijit.endMinute - durationMinutes; // full-capture range: [plateauStart, abhijit.startMinute]
  const plateauEnd = abhijit.startMinute;
  check('Sanity: the full-capture plateau range is non-empty (window narrower than duration)', plateauStart <= plateauEnd);

  const scoreAt = (minute: number) => {
    const start = localDateTimeToUTC(dateStr, formatMinutes(minute), chennai.timezone);
    return evaluateTimingCandidate({ profile: marriageProfile, start, durationMinutes, context: chennai }).score;
  };
  const scorePlateauStart = scoreAt(plateauStart);
  const scorePlateauEnd = scoreAt(plateauEnd);
  const scoreOutside = scoreAt(Math.max(0, plateauStart - 20)); // clearly outside the plateau, still same day

  check('windowEnd - duration and windowStart score identically (same flat plateau)', Math.abs(scorePlateauStart - scorePlateauEnd) < 0.01);
  check('A point 20 minutes before the plateau scores strictly lower (confirms this is a real peak, not a flat baseline)', scoreOutside < scorePlateauStart);
}

// ============================================================
// 4. NEGATIVE WIDTH CONTROL -- 15/30-minute requests, where BRAHMA/ABHIJIT
// width >= duration, must NOT get an extra windowEnd-duration candidate
// from this source (the existing windowStart candidate already suffices).
// ============================================================

{
  const dateStr = '2026-04-23';
  const slots = solarSlotsFor(dateStr, chennai);
  for (const durationMinutes of [15, 30]) {
    const existing = new Set(slots.filter((s) => s.endMinute - s.startMinute >= durationMinutes).map((s) => s.startMinute));
    const derived = collectSolarScoreBoundaryCandidateMinutes(slots, durationMinutes, existing);
    check(`${durationMinutes}min: no solar-score-boundary candidates generated (BRAHMA/ABHIJIT already wider than the requested duration)`, derived.length === 0);
  }
}

// ============================================================
// 5. WINDOW-TYPE SCOPE -- only BRAHMA/ABHIJIT ever produce a derived
// candidate; RAHU_KALAM/GULIKA/YAMA/NEUTRAL never do, even when narrower
// than the requested duration.
// ============================================================

{
  const dateStr = '2026-04-23';
  const durationMinutes = 360; // deliberately very wide, so every window type is "narrower than duration"
  const slots = solarSlotsFor(dateStr, chennai);
  const existing = new Set(slots.filter((s) => s.endMinute - s.startMinute >= durationMinutes).map((s) => s.startMinute));
  const derived = collectSolarScoreBoundaryCandidateMinutes(slots, durationMinutes, existing);
  const derivedSet = new Set(derived);
  for (const slot of slots) {
    if (slot.type === 'BRAHMA' || slot.type === 'ABHIJIT') continue;
    const wouldBeCandidate = slot.endMinute - durationMinutes;
    check(`${slot.type} window never produces a solar-score-boundary candidate (only BRAHMA/ABHIJIT do)`, !derivedSet.has(wouldBeCandidate) || wouldBeCandidate < 0);
  }
}

// ============================================================
// 6. DAY BOUNDS -- a derived candidate outside [0,1440) is skipped, no
// cross-day wrapping.
// ============================================================

{
  // Synthetic-but-realistic slot shape (BRAHMA-typed, narrow, ending before
  // the requested duration could fit before local midnight) to prove the
  // bounds-guard in isolation, without depending on a specific date having
  // this exact edge case naturally.
  const syntheticSlots = [{ startMinute: 10, endMinute: 40, type: 'BRAHMA' as const, label: 'Brahma Muhurta' }];
  const derived = collectSolarScoreBoundaryCandidateMinutes(syntheticSlots, 60, new Set());
  check('A derived candidate that would fall before local midnight (endMinute - duration < 0) is skipped, not wrapped to the previous day', derived.length === 0);
}

// ============================================================
// 7. DEDUP -- a derived minute that collides with an already-known minute
// (solar/Tithi/Nakshatra/Yoga/Karana/another derived candidate) is not
// duplicated.
// ============================================================

{
  const dateStr = '2026-04-23';
  const durationMinutes = 60;
  const slots = solarSlotsFor(dateStr, chennai);
  const abhijit = slots.find((s) => s.type === 'ABHIJIT')!;
  const preclaimed = new Set([abhijit.endMinute - durationMinutes]);
  const derived = collectSolarScoreBoundaryCandidateMinutes(slots, durationMinutes, preclaimed);
  check('A minute already claimed by another candidate source is not re-added as a duplicate', !derived.includes(abhijit.endMinute - durationMinutes));
}

// ============================================================
// 8/9/10. REQUIRED FALSE-ZERO REGRESSIONS
// ============================================================

{
  const cases: [string, DailyAssistantContext, string][] = [
    ['2026-04-23', chennai, 'Chennai'],
    ['2026-02-22', chennai, 'Chennai'],
    ['2026-02-26', newYork, 'NewYork'],
    ['2026-04-23', dubai, 'Dubai'],
    ['2026-04-23', kochi, 'Kochi'],
  ];
  for (const [dateStr, ctx, label] of cases) {
    const result = searchOneDay('marriage', dateStr, ctx, 60);
    check(`${dateStr} ${label} 60min: findMuhurthams() now returns a non-empty result (was a false zero before this PR)`, result.dates.length > 0);
    check(`${dateStr} ${label} 60min: result score clears MIN_INCLUSION_SCORE (>= 5.5)`, (result.dates[0]?.score ?? 0) >= 5.5);
  }
}

// ============================================================
// 11. 15-MINUTE CONTROLS -- unaffected on the same recovered dates.
// ============================================================

{
  for (const [dateStr, ctx, label] of [['2026-04-23', chennai, 'Chennai'], ['2026-02-26', newYork, 'NewYork']] as [string, DailyAssistantContext, string][]) {
    const result = searchOneDay('marriage', dateStr, ctx, 15);
    check(`${dateStr} ${label} 15min: search still returns a valid result (unaffected by the augmentation)`, result.dates.length > 0 && result.dates[0].score >= 5.5);
  }
}

// ============================================================
// 12. 30-MINUTE CONTROLS -- same.
// ============================================================

{
  for (const [dateStr, ctx, label] of [['2026-04-23', chennai, 'Chennai'], ['2026-02-26', newYork, 'NewYork']] as [string, DailyAssistantContext, string][]) {
    const result = searchOneDay('marriage', dateStr, ctx, 30);
    check(`${dateStr} ${label} 30min: search still returns a valid result (unaffected by the augmentation)`, result.dates.length > 0 && result.dates[0].score >= 5.5);
  }
}

// ============================================================
// 13. OTHER CEREMONIAL ACTIVITY CONTROLS -- generic candidate source: no
// eligibility semantics change for any other activity. A wider-than-BRAHMA/
// ABHIJIT duration MAY see additional candidates (that is the intended,
// generic benefit), but hard eligibility/rejection behavior is untouched.
// ============================================================

{
  const otherActivities = ['griha-pravesh', 'start-journey', 'financial-decision', 'business-start', 'property-purchase', 'new-beginning'];
  for (const activityId of otherActivities) {
    const result = searchOneDay(activityId, '2026-04-23', chennai, 60);
    check(`${activityId} 2026-04-23 Chennai 60min: search completes without throwing and returns a well-formed result set`, Array.isArray(result.dates));
  }
}

// ============================================================
// 14. GENERAL / PERSONAL / SHARED -- the same derived candidates feed all
// three scopes through the existing shared architecture; no mode-specific
// generation.
// ============================================================

{
  const dateStr = '2026-04-23';
  const userContext = { natalNakshatraIndex: 1, janmaNakshatra: 'Ashwini' };
  const partner = { savedPersonId: 'solar-boundary-test-partner', name: 'Test Partner', context: { natalNakshatraIndex: 4 } };
  const general = searchOneDay('marriage', dateStr, chennai, 60);
  const personal = findPersonalMuhurthams({ activityId: 'marriage', dateRange: { start: dateStr, end: dateStr }, durationMinutes: 60, timePreference: 'ANY', limit: 5, context: { ...chennai, now: new Date(`${dateStr}T04:00:00.000Z`), personalContext: userContext } });
  const shared = findSharedMuhurthams({ activityId: 'marriage', dateRange: { start: dateStr, end: dateStr }, durationMinutes: 60, timePreference: 'ANY', limit: 5, context: { ...chennai, now: new Date(`${dateStr}T04:00:00.000Z`), personalContext: userContext }, partner });
  check('GENERAL recovers a result for 2026-04-23 Chennai 60min', general.dates.length > 0);
  check('PERSONAL also recovers a result via the same shared candidate set (Tara Bala applied on top, unchanged mechanism)', personal.status === 'OK' && personal.dates.length > 0);
  check('SHARED also recovers a result via the same shared candidate set', shared.status === 'OK' && shared.dates.length > 0);
}

// ============================================================
// 15. EVENT LOCATION -- derived candidates use the effective Event
// Location's own solar windows (not a fixed/browser location); already
// exercised via Chennai/Dubai/NewYork/Kochi above using each location's
// own real BRAHMA/ABHIJIT windows.
// ============================================================

{
  const slotsChennai = solarSlotsFor('2026-04-23', chennai);
  const slotsDubai = solarSlotsFor('2026-04-23', dubai);
  const brahmaChennai = slotsChennai.find((s) => s.type === 'BRAHMA');
  const brahmaDubai = slotsDubai.find((s) => s.type === 'BRAHMA');
  check('Different Event Locations produce genuinely different BRAHMA window boundaries (derived candidates are location-specific, not a fixed offset)', Boolean(brahmaChennai) && Boolean(brahmaDubai) && brahmaChennai!.startMinute !== brahmaDubai!.startMinute);
}

// ============================================================
// 16. KNOWN RESIDUAL (historical, now resolved) -- 2026-06-12 New York was
// left unfixed by THIS PR (Solar Score-Boundary Candidate Augmentation V1):
// the true optimum there sits at RAHU_KALAM.endMinute, an ELIGIBILITY
// boundary (not a scoring-plateau boundary), which this PR's mechanism does
// not add. That residual was subsequently audited (Muhurtham Friction-
// Boundary Residual audit) and fixed by Muhurtham Gated Friction-End
// Eligibility Boundaries (PR E) -- see test/muhurthamFrictionBoundary.test.ts
// for its dedicated regression suite, including this exact date/duration.
// This assertion is updated (not deleted) to document that this PR's own
// scope genuinely stopped here, and a later, deliberately separate PR
// picked up the remainder.
// ============================================================

{
  const result = searchOneDay('marriage', '2026-06-12', newYork, 60);
  check('2026-06-12 New York 60min: no longer a residual -- resolved by Muhurtham Gated Friction-End Eligibility Boundaries (PR E), out of this PR\'s own scope', result.dates.length > 0);
}

console.log(allPassed ? '\nALL MUHURTHAM SOLAR SCORE-BOUNDARY CHECKS PASSED' : '\nSOME MUHURTHAM SOLAR SCORE-BOUNDARY CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
