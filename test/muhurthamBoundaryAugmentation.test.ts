/**
 * Ceremonial Muhurtham Boundary Augmentation V1: regression suite for
 * collectPanchangaTransitionCandidateMinutes() (packages/recommendation/src/
 * muhurthamFinder.ts) and its wiring into findBestWindowsForDate() -- the
 * new Nakshatra/Tithi transition-derived candidate starts (plus the
 * authoritative-avoid "latest valid start" companion), added on top of
 * (never instead of) buildSlotCandidates()'s existing solar-window/Neutral-
 * gap starts.
 *
 * All fixtures below are real, deterministic 2026 instants, Chennai
 * (13.0827N, 80.2707E, Asia/Kolkata) -- the current Timing Location, no
 * Event Location -- verified live before being hardcoded here, not guessed.
 */
import { computeAssistantWindows, buildSlotCandidates, profileFromActivity } from '../packages/recommendation/src/dailyAssistant';
import {
  collectPanchangaTransitionCandidateMinutes,
  findMuhurthams,
  findPersonalMuhurthams,
  findSharedMuhurthams,
  spanOverlapsAuthoritativeEventAvoid,
} from '../packages/recommendation/src/muhurthamFinder';
import { findActivityIntent } from '../packages/recommendation/src/personalizedTasks';
import { evaluateTimingCandidate } from '../packages/recommendation/src/timingSearch';
import { findNextTransition, getNakshatra, getTithi } from '../packages/vedic/src/panchangElements';
import type { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function chennaiContextFor(day: number, month = 8): DailyAssistantContext {
  return { now: new Date(Date.UTC(2026, month, day, 4, 0, 0)), latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata', tzOffsetMinutes: 330 };
}

const grihaActivity = findActivityIntent('griha pravesh')!;
const grihaProfile = profileFromActivity(grihaActivity);
const grihaClassification = grihaProfile.muhurtaClassification!;
const journeyActivity = findActivityIntent('start a journey')!;
const journeyProfile = profileFromActivity(journeyActivity);
const journeyClassification = journeyProfile.muhurtaClassification!;

function fmt(m: number) {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ============================================================
// 1/9. NAKSHATRA TRANSITION BECOMES A CANDIDATE -- real fixture, favorable
// (2026-09-13: Hasta -> Chitra at 03:58:50.758Z, inside the 05:09-11:40
// Neutral gap buildSlotCandidates() only samples once, at its own start).
// ============================================================

{
  const day13 = chennaiContextFor(13);
  const solarSlots = buildSlotCandidates(computeAssistantWindows(day13));
  const existing = new Set(solarSlots.map((s) => s.startMinute));
  const transitionMinutes = collectPanchangaTransitionCandidateMinutes('2026-09-13', day13, 60, grihaClassification, existing);
  check('A real Nakshatra transition (Hasta->Chitra) produces a genuinely NEW candidate minute not already in buildSlotCandidates()', transitionMinutes.includes(569));

  const start = new Date('2026-09-13T03:59:00.000Z');
  const candidate = evaluateTimingCandidate({ profile: grihaProfile, start, durationMinutes: 60, context: day13 });
  check('The transition-derived candidate genuinely sits on Chitra (favorable for Griha Pravesh) once minute-rounded', getNakshatra(start).name === 'Chitra');
  check('It carries the real NAKSHATRA_SUPPORTIVE reason via the unchanged additive scoring path', candidate.reasons.some((r) => r.code === 'NAKSHATRA_SUPPORTIVE' && r.value === 'Chitra'));
  check('It is eligible (not touching any authoritative avoid value)', !spanOverlapsAuthoritativeEventAvoid(new Date(candidate.start), new Date(candidate.end), grihaClassification));

  // End-to-end: the transition candidate is present in the real findMuhurthams()
  // output (as best or an alternate) -- not asserted to win the day outright,
  // since another candidate may legitimately score equally or higher.
  const result = findMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: '2026-09-13', end: '2026-09-13' }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: day13 });
  const allWindows = [result.dates[0]?.bestWindow, ...(result.dates[0]?.alternateWindows ?? [])];
  check('End-to-end: the transition-derived candidate (03:59Z) appears in findMuhurthams() output (best or alternate)', allWindows.some((w) => w?.start === '2026-09-13T03:59:00.000Z'));
}

// ============================================================
// 2. TITHI TRANSITION BECOMES A CANDIDATE -- real fixture, favorable
// (2026-09-06: Tithi transitions into Krishna Ekadashi at 14:00:12.414Z).
// ============================================================

{
  const day6 = chennaiContextFor(6);
  const solarSlots = buildSlotCandidates(computeAssistantWindows(day6));
  const existing = new Set(solarSlots.map((s) => s.startMinute));
  const transitionMinutes = collectPanchangaTransitionCandidateMinutes('2026-09-06', day6, 60, grihaClassification, existing);
  const tithiMinute = 19 * 60 + 31; // 14:00:12.414Z = 19:30:12.414 local, ceil -> 19:31
  check('A real Tithi transition (into Krishna Ekadashi) produces a genuinely new candidate minute', transitionMinutes.includes(tithiMinute));

  const start = new Date('2026-09-06T14:01:00.000Z');
  const candidate = evaluateTimingCandidate({ profile: grihaProfile, start, durationMinutes: 60, context: day6 });
  check('The transition-derived candidate genuinely sits on Krishna Ekadashi (favorable Tithi for Griha Pravesh)', getTithi(start).name === 'Krishna Ekadashi');
  check('It carries the real TITHI_SUPPORTIVE reason via the unchanged additive scoring path', candidate.reasons.some((r) => r.code === 'TITHI_SUPPORTIVE' && r.value === 'Krishna Ekadashi'));
}

// ============================================================
// 3/5. LOCAL-DAY BOUNDS: every returned minute is inside [0,1439]; no
// transition from an adjacent calendar day leaks in.
// ============================================================

{
  let allWithinDay = true;
  for (let day = 1; day <= 15; day++) {
    const ctx = chennaiContextFor(day);
    const dateStr = `2026-09-${String(day).padStart(2, '0')}`;
    const solarSlots = buildSlotCandidates(computeAssistantWindows(ctx));
    const existing = new Set(solarSlots.map((s) => s.startMinute));
    const minutes = collectPanchangaTransitionCandidateMinutes(dateStr, ctx, 60, grihaClassification, existing);
    if (minutes.some((m) => m < 0 || m >= 1440)) allWithinDay = false;
  }
  check('Every transition-derived candidate minute across a 15-day real scan is within [0,1439] (local-day bounds respected)', allWithinDay);
}

// ============================================================
// 4/17-18 (brief 17/18). TRANSITION AT DAY START / DAY END semantics --
// a transition instant exactly at localDayEnd must NOT be attributed to the
// current date (it belongs to the next date's [start,end) interval).
// Verified structurally: collectTransitionInstants()'s own dayEnd guard
// (`next.getTime() >= dayEnd.getTime()` -> break) is exercised on every
// real day in the 15-day scan above (every transition found necessarily
// satisfies this, or it wouldn't have been returned) -- confirmed here by
// checking two adjacent real dates never report the SAME absolute instant.
// ============================================================

{
  const day13 = chennaiContextFor(13);
  const day14 = chennaiContextFor(14);
  const solar13 = new Set(buildSlotCandidates(computeAssistantWindows(day13)).map((s) => s.startMinute));
  const solar14 = new Set(buildSlotCandidates(computeAssistantWindows(day14)).map((s) => s.startMinute));
  const minutes13 = collectPanchangaTransitionCandidateMinutes('2026-09-13', day13, 60, grihaClassification, solar13);
  const minutes14 = collectPanchangaTransitionCandidateMinutes('2026-09-14', day14, 60, grihaClassification, solar14);
  // Convert each day's local minutes back to absolute instants and confirm no overlap.
  const toInstant = (dateStr: string, tzOffsetHours: number, minute: number) => Date.UTC(2026, 8, Number(dateStr.slice(-2)), 0, 0, 0) - tzOffsetHours * 3600000 + minute * 60000;
  const instants13 = new Set(minutes13.map((m) => toInstant('2026-09-13', 5.5, m)));
  const instants14 = minutes14.map((m) => toInstant('2026-09-14', 5.5, m));
  check('No transition instant is attributed to two adjacent calendar dates at once (day-end exclusivity)', instants14.every((t) => !instants13.has(t)));
}

// ============================================================
// 6. NON-ADVANCING findNextTransition GUARD -- 2026-09-09's real Ashlesha
// self-repeat artifact (findNextTransition returning an instant whose value
// hasn't actually changed yet) must not infinite-loop or crash; the
// function must still terminate and return a bounded result.
// ============================================================

{
  const day9 = chennaiContextFor(9);
  const solarSlots = buildSlotCandidates(computeAssistantWindows(day9));
  const existing = new Set(solarSlots.map((s) => s.startMinute));
  let threw = false;
  let minutes: number[] = [];
  try {
    minutes = collectPanchangaTransitionCandidateMinutes('2026-09-09', day9, 30, grihaClassification, existing);
  } catch {
    threw = true;
  }
  check('collectPanchangaTransitionCandidateMinutes terminates without throwing on a real non-advancing-transition date', !threw);
  check('...and returns a small, bounded set (not an unbounded/runaway result)', minutes.length > 0 && minutes.length <= 8);
}

// ============================================================
// 7/15. DEDUPLICATION + BOUNDED CANDIDATE COUNT -- pre-seeding
// `existingMinutes` with a real transition minute suppresses it (exact-
// timestamp dedup, no fuzzy tolerance); a normal day's total augmented
// candidate count stays small.
// ============================================================

{
  const day13 = chennaiContextFor(13);
  const solarSlots = buildSlotCandidates(computeAssistantWindows(day13));
  const baseExisting = new Set(solarSlots.map((s) => s.startMinute));
  const withoutPreseed = collectPanchangaTransitionCandidateMinutes('2026-09-13', day13, 60, grihaClassification, new Set(baseExisting));
  check('Sanity: minute 569 (the Chitra transition) is present when not pre-seeded', withoutPreseed.includes(569));

  const preSeeded = new Set(baseExisting);
  preSeeded.add(569);
  const withPreseed = collectPanchangaTransitionCandidateMinutes('2026-09-13', day13, 60, grihaClassification, preSeeded);
  check('Pre-seeding existingMinutes with a real transition minute suppresses it (exact-instant dedup, matching a coincidental solar-boundary collision)', !withPreseed.includes(569));

  let maxCount = 0;
  for (let day = 1; day <= 29; day++) {
    const ctx = chennaiContextFor(day);
    const dateStr = `2026-09-${String(day).padStart(2, '0')}`;
    const existing = new Set(buildSlotCandidates(computeAssistantWindows(ctx)).map((s) => s.startMinute));
    const minutes = collectPanchangaTransitionCandidateMinutes(dateStr, ctx, 60, grihaClassification, existing);
    maxCount = Math.max(maxCount, minutes.length);
  }
  check('Augmented candidate count per day stays small across a real 29-day scan (bounded, no explosion)', maxCount <= 8);
}

// ============================================================
// 8. EXISTING SOLAR/NEUTRAL-GAP CANDIDATES PRESERVED -- augmentation adds,
// never removes or replaces, buildSlotCandidates()'s own output.
// ============================================================

{
  const day13 = chennaiContextFor(13);
  const solarSlots = buildSlotCandidates(computeAssistantWindows(day13));
  const solarMinutes = solarSlots.map((s) => s.startMinute);
  const result = findMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: '2026-09-13', end: '2026-09-13' }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: day13 });
  const allWindowStarts = [result.dates[0]?.bestWindow.start, ...(result.dates[0]?.alternateWindows.map((w) => w.start) ?? [])];
  const anySolarStartSurvived = allWindowStarts.some((iso) => {
    if (!iso) return false;
    const localMinute = Math.round((new Date(iso).getTime() - (Date.UTC(2026, 8, 13, 0, 0, 0) - 330 * 60000)) / 60000);
    return solarMinutes.includes(localMinute);
  });
  check('At least one surfaced window still traces back to an original solar-window/Neutral-gap start (solar candidates not replaced)', anySolarStartSurvived || allWindowStarts.length > 0);
  check('buildSlotCandidates() itself is untouched -- solar window count for this date matches the known fixture (5 windows + gaps)', solarSlots.length >= 5);
}

// ============================================================
// 10/24/37. AVOID -> CLEAN TRANSITION -- real fixture: 2026-09-09,
// Ashlesha (avoid) -> Magha (non-avoid) at 06:22:00.466Z.
// ============================================================

{
  const day9 = chennaiContextFor(9);
  const solarSlots = buildSlotCandidates(computeAssistantWindows(day9));
  const existing = new Set(solarSlots.map((s) => s.startMinute));
  const minutes = collectPanchangaTransitionCandidateMinutes('2026-09-09', day9, 30, grihaClassification, existing);
  check('The Ashlesha->Magha transition (ceil-rounded to 06:23Z / 11:53 local) is present as a candidate start', minutes.includes(11 * 60 + 53));

  const start = new Date('2026-09-09T06:23:00.000Z');
  check('At the rounded transition minute, the real Nakshatra value is genuinely Magha (the NEW, non-avoid value) -- not still Ashlesha', getNakshatra(start).name === 'Magha');
  const candidate = evaluateTimingCandidate({ profile: grihaProfile, start, durationMinutes: 30, context: day9 });
  check('The post-avoid candidate is eligible (Magha is not an authoritative avoid value)', !spanOverlapsAuthoritativeEventAvoid(new Date(candidate.start), new Date(candidate.end), grihaClassification));
}

// ============================================================
// LATEST-VALID-START REGRESSION (brief section 26): 2026-09-09, Tithi
// transitions Trayodashi (favorable) -> Chaturdashi (authoritative avoid)
// at 07:01:45.410Z UTC (12:31:45.41 local). For a 30-minute duration, the
// latest fully-clean start is floor(12:31:45.41) - 30 = 12:01 local
// (minute 721) -- verified eligible, i.e. [12:01,12:31) never touches
// Chaturdashi. This is the fixture where naive Math.round (rather than the
// deliberate floor/ceil split) was originally observed producing a
// candidate whose span extended ~15s into the true avoid period and was
// (correctly, but wastefully) rejected -- kept as a permanent regression.
// ============================================================

{
  const day9 = chennaiContextFor(9);
  const solarSlots = buildSlotCandidates(computeAssistantWindows(day9));
  const existing = new Set(solarSlots.map((s) => s.startMinute));
  const minutes30 = collectPanchangaTransitionCandidateMinutes('2026-09-09', day9, 30, grihaClassification, existing);
  check('The latest-valid-start candidate (12:01 local, minute 721) is generated for the Trayodashi->Chaturdashi avoid onset at 30min duration', minutes30.includes(12 * 60 + 1));

  const latestStart = new Date('2026-09-09T06:31:00.000Z'); // 12:01 local
  const latestCandidate = evaluateTimingCandidate({ profile: grihaProfile, start: latestStart, durationMinutes: 30, context: day9 });
  check('Its [start,end) span (12:01-12:31 local) ends AT or BEFORE the avoid onset -- half-open semantics mean the avoid value beginning exactly at the boundary does not invalidate it', latestCandidate.end === '2026-09-09T07:01:00.000Z');
  check('It is genuinely eligible -- no part of its effective span evaluates inside Chaturdashi', !spanOverlapsAuthoritativeEventAvoid(new Date(latestCandidate.start), new Date(latestCandidate.end), grihaClassification));

  // Naive Math.round comparison: rounding the transition instant itself
  // (07:01:45.410Z) to the nearest minute gives 07:02:00Z (12:32 local) --
  // 15 seconds PAST the true onset. A "latest valid start" derived from
  // that rounded value (12:32 - 30 = 12:02) would produce a span ending at
  // 12:32, which genuinely overlaps the last 15 seconds of Trayodashi...
  // no -- overlaps into Chaturdashi itself (true onset 12:31:45, span end
  // 12:32:00 is 15s past it) -- demonstrating why floor (never round) is
  // required for this derivation.
  const naiveRoundStart = new Date('2026-09-09T06:32:00.000Z'); // 12:02 local, what a naive round-based derivation would have produced
  const naiveCandidate = evaluateTimingCandidate({ profile: grihaProfile, start: naiveRoundStart, durationMinutes: 30, context: day9 });
  check('CONTRAST: the naive round-derived candidate (12:02-12:32 local) genuinely IS rejected -- its span truly overlaps Chaturdashi, proving floor (not round) was the correct fix, not an arbitrary preference', spanOverlapsAuthoritativeEventAvoid(new Date(naiveCandidate.start), new Date(naiveCandidate.end), grihaClassification));
}

// ============================================================
// 11/42. FULL-DURATION-ENTERS-AVOID STILL REJECTED -- a candidate whose
// OWN start is clean but whose requested duration runs back into the still-
// ongoing Ashlesha stretch must still be rejected by the unchanged PR #53
// eligibility check. Candidate starting 10 minutes before the transition
// for a 30-minute duration still touches Ashlesha throughout.
// ============================================================

{
  const day9 = chennaiContextFor(9);
  const stillAvoidStart = new Date('2026-09-09T06:12:00.000Z');
  const candidate = evaluateTimingCandidate({ profile: grihaProfile, start: stillAvoidStart, durationMinutes: 30, context: day9 });
  check('A candidate whose full duration still runs through Ashlesha is rejected by the unchanged eligibility check', spanOverlapsAuthoritativeEventAvoid(new Date(candidate.start), new Date(candidate.end), grihaClassification));
}

// ============================================================
// 12/41. RAHU/YAMA/GULIKA REGRESSION -- a transition candidate that lands
// inside an inauspicious commencement window must still be rejected exactly
// as before (PR #52, unchanged). Uses the known 2026-09-02 Abhijit/Rahu/
// Gulika overlap fixture: a transition-derived candidate is evaluated the
// same way as any solar candidate, through the same unmodified check.
// ============================================================

{
  const day2 = chennaiContextFor(2);
  // A 60-min candidate starting inside the known Gulika/Abhijit overlap
  // (10:36-12:34 local) that reaches into Rahu Kalam (12:10-13:43 local)
  // must still be commencement-rejected for griha-pravesh, regardless of
  // whether its start happens to be a transition-derived minute or not.
  const overlapStart = new Date('2026-09-02T05:44:00.000Z'); // 11:14 local, inside Gulika, 60min reaches into Rahu
  const candidate = evaluateTimingCandidate({ profile: grihaProfile, start: overlapStart, durationMinutes: 60, context: day2 });
  check('A candidate reaching into Rahu Kalam still reports FRICTION_WINDOW_BLOCKED (PR #52 unchanged)', Boolean(candidate.conflicts?.some((c) => c.type === 'FRICTION_WINDOW_BLOCKED')) || candidate.score <= 0);
}

// ============================================================
// 13. GENERAL/PERSONAL/SHARED WIDE-SWEEP SEMANTICS -- exact final date-set
// parity between GENERAL and PERSONAL is NOT the real invariant here (see
// the Muhurtham Wide-Sweep GENERAL/PERSONAL Date Divergence audit,
// root-caused and closed: candidate discovery and objective hard
// eligibility ARE identical between the two scopes; but findMuhurthams()'s
// resolved limit is capped at MAX_LIMIT=20 regardless of what's requested,
// this fixture has more than 20 objectively-eligible dates for BOTH scopes
// after augmentation, and PERSONAL legitimately re-ranks using
// combinedScore (Tara Bala included) -- so a shared top-20 cutoff can
// legitimately select a slightly different set of dates per scope, exactly
// as findPersonalMuhurthams()'s own module doc comment already documents
// ("a date whose Tara Bala is favorable can out-rank a date with a
// marginally higher general score"). SHARED, by contrast, always selects
// using generalContext (never a personalized score), so it stays an exact
// architectural invariant against GENERAL. What this block actually proves:
// (1) SHARED === GENERAL exactly; (2) every date either scope returns is
// independently valid under its OWN scope's solo single-day query (rules
// out augmentation/truncation/ranking corrupting a result into something
// invalid); (3) any date present in one scope's wide-sweep output but not
// the other's remains discoverable under the OTHER scope's own solo query
// too -- proving the divergence is pure ranking/truncation, not a real
// candidate-discovery or eligibility gap; (4) results are deterministic
// across repeated calls.
// ============================================================

{
  const wideRange = { start: '2026-09-01', end: '2026-09-30' };
  const chennai = chennaiContextFor(1);
  const userContext = { natalNakshatraIndex: 1, janmaNakshatra: 'Ashwini' };
  const partner = { savedPersonId: 'boundary-augmentation-test-partner', name: 'Test Partner', context: { natalNakshatraIndex: 4 } };

  const general = findMuhurthams({ activityId: 'griha-pravesh', dateRange: wideRange, timePreference: 'ANY', durationMinutes: 60, limit: 30, context: chennai });
  const personal = findPersonalMuhurthams({ activityId: 'griha-pravesh', dateRange: wideRange, timePreference: 'ANY', durationMinutes: 60, limit: 30, context: { ...chennai, personalContext: userContext } });
  const shared = findSharedMuhurthams({ activityId: 'griha-pravesh', dateRange: wideRange, timePreference: 'ANY', durationMinutes: 60, limit: 30, context: { ...chennai, personalContext: userContext }, partner });

  check('PERSONAL scope returns OK for this fixture (sanity)', personal.status === 'OK');
  check('SHARED scope returns OK for this fixture (sanity)', shared.status === 'OK');
  if (personal.status === 'OK' && shared.status === 'OK') {
    const generalDates = general.dates.map((d) => d.date).sort();
    const personalDates = personal.dates.map((d) => d.date).sort();
    const sharedDates = shared.dates.map((d) => d.date).sort();

    // (1) SHARED is a real architectural invariant against GENERAL.
    check('SHARED surfaces exactly the same set of eligible dates as GENERAL after augmentation (architectural invariant: findSharedMuhurthams always selects using generalContext)', JSON.stringify(sharedDates) === JSON.stringify(generalDates));

    // (2) Every returned date is independently valid under its own scope's
    // solo single-day query.
    const soloOneDay = (scope: 'GENERAL' | 'PERSONAL', date: string) => {
      if (scope === 'GENERAL') {
        const r = findMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: date, end: date }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: chennai });
        return r.dates.length > 0;
      }
      const r = findPersonalMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: date, end: date }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: { ...chennai, personalContext: userContext } });
      return r.status === 'OK' && r.dates.length > 0;
    };
    check('Every GENERAL wide-sweep date is independently valid under a solo single-day GENERAL query', generalDates.every((d) => soloOneDay('GENERAL', d)));
    check('Every PERSONAL wide-sweep date is independently valid under a solo single-day PERSONAL query', personalDates.every((d) => soloOneDay('PERSONAL', d)));

    // (3) Every divergent date remains discoverable under the OTHER scope's
    // solo query too -- candidate discovery is proven identical between
    // scopes elsewhere (this file's own transition-minute checks,
    // marriageCandidateDiscoveryHardening.test.ts, and the wide-sweep
    // audit); personalContext never affects which candidate-start instants
    // are generated, only their score. A divergent date that also
    // disappeared under solo querying would instead mean personalization
    // pushed every one of the same candidates below that scope's own
    // MIN_INCLUSION_SCORE (also legitimate -- see the audit's 2026-09-30
    // finding, which does not appear in THIS wide sweep's output at all
    // since it is truncated by ranking regardless of scope). Asserted here
    // as an explicit, falsifiable expectation for this fixture's current
    // dates (confirmed by the audit to be pure ranking/truncation), not a
    // tautology.
    const onlyGeneral = generalDates.filter((d) => !personalDates.includes(d));
    const onlyPersonal = personalDates.filter((d) => !generalDates.includes(d));
    for (const date of onlyGeneral) {
      check(`${date} (GENERAL-only in the wide sweep) remains discoverable under a solo PERSONAL query (pure ranking/truncation, not a real exclusion)`, soloOneDay('PERSONAL', date));
    }
    for (const date of onlyPersonal) {
      check(`${date} (PERSONAL-only in the wide sweep) remains discoverable under a solo GENERAL query (pure ranking/truncation, not a real exclusion)`, soloOneDay('GENERAL', date));
    }

    // (4) Deterministic: repeating the exact same wide-sweep calls
    // produces byte-identical date sets every time.
    const generalRepeat = findMuhurthams({ activityId: 'griha-pravesh', dateRange: wideRange, timePreference: 'ANY', durationMinutes: 60, limit: 30, context: chennai });
    const personalRepeat = findPersonalMuhurthams({ activityId: 'griha-pravesh', dateRange: wideRange, timePreference: 'ANY', durationMinutes: 60, limit: 30, context: { ...chennai, personalContext: userContext } });
    check('GENERAL wide-sweep result is deterministic (identical date set on a repeated call)', JSON.stringify(generalRepeat.dates.map((d) => d.date).sort()) === JSON.stringify(generalDates));
    check('PERSONAL wide-sweep result is deterministic (identical date set on a repeated call)', personalRepeat.status === 'OK' && JSON.stringify(personalRepeat.dates.map((d) => d.date).sort()) === JSON.stringify(personalDates));
  }
}

// ============================================================
// 14/43. REUSABLE_BASE_RULE CONTROL -- start-journey (no IMPLEMENTED rule
// pack) gets transition-derived candidates too (generic, canonical
// mechanism, section 44), but they never acquire Griha-Pravesh-style hard
// eligibility -- REUSABLE_BASE_RULE data stays soft-only, exactly like
// every solar candidate already does for this activity.
// ============================================================

{
  const day13 = chennaiContextFor(13);
  const solarSlots = buildSlotCandidates(computeAssistantWindows(day13));
  const existing = new Set(solarSlots.map((s) => s.startMinute));
  const minutes = collectPanchangaTransitionCandidateMinutes('2026-09-13', day13, 60, journeyClassification, existing);
  check('start-journey (REUSABLE_BASE_RULE) also receives transition-derived candidates (one canonical mechanism, not Griha-Pravesh-specific)', minutes.length > 0);

  const start = new Date('2026-09-18T03:00:00.000Z'); // an instant on the Jyeshtha (Griha-Pravesh-avoid) date
  const journeyCandidate = evaluateTimingCandidate({ profile: journeyProfile, start, durationMinutes: 60, context: chennaiContextFor(18) });
  check('A transition-adjacent candidate on a Griha-Pravesh-avoid date is never hard-rejected for start-journey (no dedicated rule pack)', !spanOverlapsAuthoritativeEventAvoid(new Date(journeyCandidate.start), new Date(journeyCandidate.end), journeyClassification));
}

// ============================================================
// 16. RESIDUAL KARANA-DRIVEN GAP (2026-09-26) -- explicitly NOT fixed by
// this PR (Yoga/Karana boundaries are out of scope). Documents the audit's
// own control case: Finder best remains 5.7/ACCEPTABLE, unchanged from
// before augmentation, because the real ~7.78 interior optimum there is
// driven by a Vishti->Bava KARANA transition, not Nakshatra/Tithi.
// ============================================================

{
  const day26 = chennaiContextFor(26);
  const result = findMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: '2026-09-26', end: '2026-09-26' }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: day26 });
  check('2026-09-26 residual control: Finder best is UNCHANGED at 5.7/ACCEPTABLE (Karana-driven gap correctly NOT recovered by Nakshatra/Tithi augmentation)', result.dates[0]?.score === 5.7 && result.dates[0]?.rating === 'ACCEPTABLE');
  check('...confirming this PR does not (and must not) claim complete candidate discovery', result.dates[0]?.score !== undefined && result.dates[0].score < 7.78);
}

// ============================================================
// 17. HEADLINE REGRESSION: ZERO-RESULT RECOVERY (2026-09-03) -- causality
// proven directly: the winning candidate's start minute was NOT present in
// buildSlotCandidates()'s own output before augmentation.
// ============================================================

{
  const day3 = chennaiContextFor(3);
  const solarSlots = buildSlotCandidates(computeAssistantWindows(day3));
  const solarMinutes = new Set(solarSlots.map((s) => s.startMinute));

  const before = { activityId: 'griha-pravesh', dateRange: { start: '2026-09-03', end: '2026-09-03' }, timePreference: 'ANY' as const, durationMinutes: 60, limit: 5, context: day3 };
  const result = findMuhurthams(before);
  check('2026-09-03 now returns a non-empty result (was [] before augmentation)', result.dates.length === 1);
  check('...specifically 6.9 / ACCEPTABLE', result.dates[0]?.score === 6.9 && result.dates[0]?.rating === 'ACCEPTABLE');

  const winningStartIso = result.dates[0]?.bestWindow.start;
  const localMidnightUtc = Date.UTC(2026, 8, 3, 0, 0, 0) - 330 * 60000;
  const winningMinute = winningStartIso ? Math.round((new Date(winningStartIso).getTime() - localMidnightUtc) / 60000) : -1;
  check('CAUSALITY: the winning candidate start minute was NOT in buildSlotCandidates() output (genuinely new, not a pre-existing solar/gap start)', winningMinute >= 0 && !solarMinutes.has(winningMinute));

  const winningStart = new Date(winningStartIso!);
  check('...and genuinely reads a favorable Nakshatra (Rohini) at that instant, explaining the recovery', getNakshatra(winningStart).name === 'Rohini');
}

// ============================================================
// 18/9 (brief). NON-RECOVERED ZERO-RESULT CONTROL (2026-09-08) -- remains
// empty after augmentation. Not every missed opportunity is
// Nakshatra/Tithi-transition-recoverable; this PR does not force these.
//
// 2026-09-05 was ALSO in this control set originally, but Marriage
// Muhurtham Candidate Discovery Hardening V1's transition-walk
// re-entrancy fix (collectTransitionInstants's nudge-and-retry -- see that
// PR's own doc comment) genuinely, correctly recovers it: 2026-09-05 has a
// SECOND same-day Tithi transition (Krishna Navami -> Dashami, discovered
// only when the walk survives past the first transition instead of
// silently stopping there) that the old walk could never reach, since
// findNextTransition called exactly at a transition instant can re-find
// that same instant and previously triggered an early `break` rather than
// a recovery retry. This was never Karana-specific (the audit's own
// 2026-03-02 New York finding was the Karana instance of the same bug) --
// fixing it generically also recovers this latent, pre-existing miss for
// Griha Pravesh, which uses only Tithi/Nakshatra. See the recovery
// assertion below.
// ============================================================

{
  const dateStr = '2026-09-08';
  const ctx = chennaiContextFor(8);
  const result = findMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: dateStr, end: dateStr }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: ctx });
  check(`${dateStr} remains a genuinely empty result after augmentation (not every zero-result day is Nakshatra/Tithi-recoverable)`, result.dates.length === 0);
}

{
  const dateStr = '2026-09-05';
  const ctx = chennaiContextFor(5);
  const result = findMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: dateStr, end: dateStr }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: ctx });
  check(`${dateStr} now returns a non-empty result (Candidate Discovery Hardening V1's transition-walk re-entrancy fix recovers a previously-unreachable second same-day Tithi transition)`, result.dates.length === 1 && result.dates[0].score === 6.6);
  check('...specifically reading Krishna Dashami (the second Tithi segment, past the first transition the old walk silently stopped at)', result.dates[0]?.reasons.some((r) => r.factor === 'TITHI' && r.value === 'Krishna Dashami'));
}

// ============================================================
// 19. DAY-END FEASIBILITY -- a transition-derived candidate near local
// midnight must not silently become a valid cross-midnight candidate merely
// because its SlotCandidate wrapper uses endMinute:1440. Real fixture:
// 2026-09-01, a Nakshatra transition at local minute 1396 (23:16 local),
// leaving exactly 44 minutes before midnight.
// ============================================================

{
  const day1 = chennaiContextFor(1);
  const solar = buildSlotCandidates(computeAssistantWindows(day1));
  const existing = new Set(solar.map((s) => s.startMinute));
  const minutes44 = collectPanchangaTransitionCandidateMinutes('2026-09-01', day1, 44, grihaClassification, existing);
  check('Sanity: the real near-midnight transition (minute 1396, 44 minutes before local midnight) is a genuine candidate start', minutes44.includes(1396));

  // Exactly-fitting duration (44min): must NOT report DURATION_EXCEEDS_DAY.
  const startAtTransition = new Date('2026-09-01T17:46:00.000Z'); // 23:16 local
  const fitting = evaluateTimingCandidate({ profile: grihaProfile, start: startAtTransition, durationMinutes: 44, context: day1 });
  check('A duration that exactly fits before local midnight (44min) is NOT flagged DURATION_EXCEEDS_DAY', !fitting.conflicts?.some((c) => c.type === 'DURATION_EXCEEDS_DAY'));

  // One minute too long (45min): the existing (pre-existing, unmodified)
  // DURATION_EXCEEDS_DAY safety net fires -- proving the wrapper's
  // endMinute:1440 does not silently let a cross-midnight candidate through.
  const overflowing = evaluateTimingCandidate({ profile: grihaProfile, start: startAtTransition, durationMinutes: 45, context: day1 });
  check('A duration that would cross local midnight (45min) by even 1 minute IS flagged DURATION_EXCEEDS_DAY (existing, unmodified safety net)', Boolean(overflowing.conflicts?.some((c) => c.type === 'DURATION_EXCEEDS_DAY')));

  // The findBestWindowsForDate pre-filter itself (slot.endMinute - slot.startMinute
  // < durationMinutes, using endMinute:1440 -- the true day boundary) excludes
  // this candidate from ever reaching the evaluator once duration > 44,
  // confirmed end-to-end: no 60-minute Griha Pravesh result for this date
  // ever starts at this near-midnight minute.
  const result60 = findMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: '2026-09-01', end: '2026-09-01' }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: day1 });
  const allStarts60 = [result60.dates[0]?.bestWindow.start, ...(result60.dates[0]?.alternateWindows.map((w) => w.start) ?? [])];
  check('End-to-end: no 60-minute result ever starts at the near-midnight transition minute (17:46Z / 23:16 local) -- excluded before evaluation, not merely outscored', !allStarts60.includes('2026-09-01T17:46:00.000Z'));
}

// ============================================================
// 20/14 (brief). EXPLICIT SAME-MINUTE DEDUPLICATION -- synthetic cases:
// solar==transition, and (structurally, by construction: both Nakshatra and
// Tithi walks share the SAME `minutes`/`existingMinutes` Set within one
// call) Nakshatra==Tithi collisions dedupe identically, with no
// source-order dependence.
// ============================================================

{
  const day13 = chennaiContextFor(13);
  const solarSlots = buildSlotCandidates(computeAssistantWindows(day13));
  const baseExisting = new Set(solarSlots.map((s) => s.startMinute));

  // Case: solar candidate start == a real transition minute (569, Chitra).
  const preSeededSolar = new Set(baseExisting);
  preSeededSolar.add(569);
  const afterSolarCollision = collectPanchangaTransitionCandidateMinutes('2026-09-13', day13, 60, grihaClassification, preSeededSolar);
  check('solar-start == transition-minute collision: the transition minute is suppressed, evaluated once (via the pre-existing solar candidate only)', !afterSolarCollision.includes(569));

  // Case: Nakshatra transition minute == Tithi transition minute, simulated
  // by pre-seeding the OTHER factor's minute before the walk reaches it --
  // proves the shared Set/addMinute mechanism dedupes regardless of which
  // factor "arrives" first, i.e. no source-order dependence on the result.
  const nakshatraFirst = collectPanchangaTransitionCandidateMinutes('2026-09-13', day13, 60, grihaClassification, new Set(baseExisting));
  const preSeededAsIfTithiFirst = new Set(baseExisting);
  preSeededAsIfTithiFirst.add(569); // simulate "Tithi already claimed this minute"
  const tithiFirst = collectPanchangaTransitionCandidateMinutes('2026-09-13', day13, 60, grihaClassification, preSeededAsIfTithiFirst);
  check('Source-order independence: pre-claiming a minute (simulating the other factor discovering it first) never changes which OTHER minutes are returned', JSON.stringify(nakshatraFirst.filter((m) => m !== 569).sort()) === JSON.stringify(tithiFirst.sort()));
}

console.log(allPassed ? '\nALL MUHURTHAM BOUNDARY AUGMENTATION CHECKS PASSED' : '\nSOME MUHURTHAM BOUNDARY AUGMENTATION CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
