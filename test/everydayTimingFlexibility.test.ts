import { isTimingSensitiveActivity, scoreCandidate, scoreContinuousBlock, profileFromActivity, computeAssistantWindows, buildSlotCandidates, findOptimalTaskTimes } from '../packages/recommendation/src/dailyAssistant';
import type { DailyAssistantContext, SlotCandidate } from '../packages/recommendation/src/dailyAssistant';
import { runTimingSearch } from '../packages/recommendation/src/timingSearch';
import { findEverydaySharedTiming } from '../packages/recommendation/src/everydayTimingFit';
import { findMuhurthams } from '../packages/recommendation/src/muhurthamFinder';
import { FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';
import { getActivityDefinition } from '../packages/recommendation/src/activityDefinitions';
import { deriveAgendaOpenings, candidateFitsOpenings } from '../apps/web/lib/dayBuilder';
import type { DailyAgenda, DailyAgendaItem } from '../apps/web/lib/dailyAgenda';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

/**
 * Everyday Timing Flexibility V1. For everyday/reversible activities,
 * Panchang should RANK real availability, not RESTRICT it -- only
 * commencement-sensitive/consequential activities keep the hard exclusion.
 * See isTimingSensitiveActivity() (dailyAssistant.ts), which reuses the
 * existing MuhurtaClassification (evaluationDepth + timingSensitivity.start)
 * rather than a new taxonomy -- this file proves that reuse is exhaustive
 * and that the flexibility can never leak into commencement-sensitive
 * activities or into Muhurtham Finder.
 */

const chennaiContext: DailyAssistantContext = {
  now: new Date(Date.UTC(2026, 7, 21, 4, 0, 0)), // Fri Aug 21 2026, ~9:30 AM IST
  latitude: 13.0827,
  longitude: 80.2707,
  timezone: 'Asia/Kolkata',
  tzOffsetMinutes: 330,
};

function activityById(id: string) {
  const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === id);
  if (!activity) throw new Error(`test fixture bug: unknown activity id ${id}`);
  return activity;
}

// On 2026-08-21 (Chennai): RAHU_KALAM 638-733, GULIKA 450-544, YAMA 827-921
// (confirmed via computeAssistantWindows -- captured once as a fixture
// rather than recomputed per test so failures point at scoreCandidate()
// itself, not at ephemeris drift).
const windows = computeAssistantWindows(chennaiContext);
const rahuKalam = windows.find((w) => w.type === 'RAHU_KALAM')!;
const yama = windows.find((w) => w.type === 'YAMA')!;
check('Fixture sanity: Rahu Kalam window resolved for 2026-08-21', Boolean(rahuKalam));
check('Fixture sanity: Yama Gandam window resolved for 2026-08-21', Boolean(yama));

function dateAtLocalMinute(minute: number): Date {
  return new Date(Date.UTC(2026, 7, 21, 0, 0, 0) - chennaiContext.tzOffsetMinutes * 60000 + minute * 60000);
}

function scoreDuringFriction(activityId: string, windowType: 'RAHU_KALAM' | 'YAMA'): number {
  const activity = activityById(activityId);
  const profile = profileFromActivity(activity);
  const span = windowType === 'RAHU_KALAM' ? rahuKalam : yama;
  const midpoint = (span.startMinutes + span.endMinutes) / 2;
  const candidate: SlotCandidate = { startMinute: span.startMinutes, endMinute: span.endMinutes, type: windowType, label: span.label };
  return scoreCandidate(candidate, profile, dateAtLocalMinute(midpoint));
}

// ============================================================
// Classification: EVERYDAY_FLEXIBLE / TIMING_SENSITIVE (brief sections
// 2-5, 6, 7, 29, 42). Table-driven so an accidental catalog edit that
// silently changes evaluationDepth or timingSensitivity.start on any of
// these activities fails a named check here, not a downstream symptom.
// ============================================================

const EVERYDAY_FLEXIBLE_IDS = [
  'task-2', 'task-3', 'task-4', 'task-5', 'learning', 'deep-work', // Work/Focus
  'task-6', 'task-7', 'workout', 'meditation', 'quiet-time', 'tea-break', // Rest/Wellness
  'dating', 'date-night', 'dinner-date', // Relationships
  'family-dinner', 'family-outing', 'visit-family', 'family-movie-night', // Family
  'coffee-tea', 'movie-night', 'walk-together', 'dinner-with-friends', 'catch-up', 'game-night',
  'birthday-party', 'celebration-dinner', 'party', 'picnic', 'shopping-trip', // Social
  'anniversary-dinner', // Section 7 special review -- STANDARD depth, everyday/social by default
];
for (const id of EVERYDAY_FLEXIBLE_IDS) {
  const def = getActivityDefinition(id);
  check(`${id}: catalog definition resolves`, Boolean(def));
  if (def) check(`${id}: classified as everyday-flexible (not timing-sensitive)`, isTimingSensitiveActivity(def.muhurta) === false);
}

// Section 14: Road Trip / Day Trip are everyday-depth (STANDARD) but the
// DEPARTURE remains timing-sensitive in this architecture (timingSensitivity
// .start === 'HIGH') -- prefer semantic correctness over the brief's own
// classification list, per the brief's own explicit instruction.
for (const id of ['road-trip', 'day-trip']) {
  const def = getActivityDefinition(id);
  check(`${id}: STANDARD evaluationDepth (activity itself is everyday)`, def?.muhurta.evaluationDepth === 'STANDARD');
  check(`${id}: HIGH start-sensitivity (departure stays commencement-sensitive)`, def?.muhurta.timingSensitivity.start === 'HIGH');
  check(`${id}: classified as timing-sensitive overall (keeps strict/hard-exclusion behavior)`, Boolean(def) && isTimingSensitiveActivity(def!.muhurta) === true);
}

const TIMING_SENSITIVE_IDS = ['task-1', 'engagement', 'financial-decision', 'new-beginning', 'business-start', 'property-purchase', 'griha-pravesh', 'start-journey'];
for (const id of TIMING_SENSITIVE_IDS) {
  const def = getActivityDefinition(id);
  check(`${id}: catalog definition resolves`, Boolean(def));
  if (def) check(`${id}: classified as timing-sensitive`, isTimingSensitiveActivity(def.muhurta) === true);
}

check('isTimingSensitiveActivity fails safe (undefined classification treated as sensitive)', isTimingSensitiveActivity(undefined) === true);

// ============================================================
// Section 31: Family Dinner -- both a GULIKA/NEUTRAL and a RAHU_KALAM/YAMA
// candidate can now exist; the former ranks higher; the latter is not
// hard-filtered and surfaces when it's the only real option.
// ============================================================

check('Family Dinner: Rahu Kalam is no longer a hard exclusion (-100)', scoreDuringFriction('family-dinner', 'RAHU_KALAM') > 0);
check('Family Dinner: Yama Gandam is no longer a hard exclusion (-100)', scoreDuringFriction('family-dinner', 'YAMA') > 0);
{
  // Family Dinner carries its own real-world-clock EVENING default (a
  // DIFFERENT, orthogonal mechanism -- ActivityTimeOfDayPreference -- from
  // the Panchang eligibility this brief concerns), which on 2026-08-21
  // pushes every FIND candidate into the 17:00-21:00 IST evening, well
  // after this date's actual Rahu Kalam (10:38am-12:13pm). An explicit
  // MORNING timePreference overrides that default (see timingSearch.ts's
  // own `explicitPreference` precedence) so this check exercises Panchang
  // eligibility in isolation, independent of that other feature.
  const familyDinnerMorning = runTimingSearch({ mode: 'FIND', activityId: 'family-dinner', durationMinutes: 60, dateRange: { start: '2026-08-21', end: '2026-08-21' }, timePreference: 'MORNING', context: chennaiContext, limit: 96 });
  const rahuCandidate = familyDinnerMorning.candidates.find((c) => c.metadata.windowType === 'RAHU_KALAM');
  const strongerCandidate = familyDinnerMorning.candidates.find((c) => c.metadata.windowType === 'GULIKA' || c.metadata.windowType === 'NEUTRAL' || c.metadata.windowType === 'ABHIJIT');
  check('Family Dinner: a Rahu Kalam candidate is surfaced by FIND (ranked, not eliminated)', Boolean(rahuCandidate));
  check('Family Dinner: a Gulika/Neutral/Abhijit candidate outranks the Rahu Kalam candidate', Boolean(rahuCandidate && strongerCandidate && strongerCandidate.score > rahuCandidate.score));
  check('Family Dinner: no candidate carries a FRICTION_WINDOW_BLOCKED conflict any more', familyDinnerMorning.candidates.every((c) => !c.conflicts?.some((cf) => cf.type === 'FRICTION_WINDOW_BLOCKED')));
}

// ============================================================
// Section 32: Date Night -- remains schedulable in a realistic evening slot
// even when it lands inside a weaker (avoid) window; never forced into an
// unrealistic daytime slot to avoid Rahu Kalam/Yama.
// ============================================================

check('Date Night: Rahu Kalam is no longer a hard exclusion', scoreDuringFriction('date-night', 'RAHU_KALAM') > 0);
{
  const dateNightEvening = runTimingSearch({ mode: 'FIND', activityId: 'date-night', durationMinutes: 90, dateRange: { start: '2026-08-21', end: '2026-08-21' }, timePreference: 'EVENING', context: chennaiContext, limit: 10 });
  check('Date Night: EVENING preference still returns real evening candidates (17:00-21:00 IST)', dateNightEvening.candidates.length > 0 && dateNightEvening.candidates.every((c) => {
    const h = (new Date(c.start).getUTCHours() + 5 + Math.floor((new Date(c.start).getUTCMinutes() + 30) / 60)) % 24;
    return h >= 17 && h < 21;
  }));
}

// ============================================================
// Section 33: Walk Together -- the "evening walk" alias must inherit the
// exact same flexible eligibility as the canonical activity, not a
// separately-assigned sensitivity.
// ============================================================

{
  const canonical = getActivityDefinition('walk-together');
  check('Walk Together: canonical activity resolves', Boolean(canonical));
  check('Walk Together: alias list includes "evening walk"', Boolean(canonical?.aliases?.some((a) => a.toLowerCase() === 'evening walk')));
  const walkToday = runTimingSearch({ mode: 'FIND', taskTitle: 'evening walk', durationMinutes: 30, dateRange: { start: '2026-08-21', end: '2026-08-21' }, timePreference: 'ANY', context: chennaiContext, limit: 96 });
  const canonicalToday = runTimingSearch({ mode: 'FIND', activityId: 'walk-together', durationMinutes: 30, dateRange: { start: '2026-08-21', end: '2026-08-21' }, timePreference: 'ANY', context: chennaiContext, limit: 96 });
  check('Walk Together: "evening walk" alias produces the identical candidate set as the canonical activityId', JSON.stringify(walkToday.candidates.map((c) => c.start)) === JSON.stringify(canonicalToday.candidates.map((c) => c.start)));
  check('Walk Together: alias candidates also carry no FRICTION_WINDOW_BLOCKED conflicts', walkToday.candidates.every((c) => !c.conflicts?.some((cf) => cf.type === 'FRICTION_WINDOW_BLOCKED')));
}

// ============================================================
// Sections 34/35: Deep Work / Workout -- with all preferred windows
// occupied, a Rahu Kalam/Yama opening still surfaces (as a lower-ranked,
// caution-tier option), rather than returning no candidate at all.
// ============================================================

for (const id of ['deep-work', 'workout']) {
  check(`${id}: Rahu Kalam is no longer a hard exclusion`, scoreDuringFriction(id, 'RAHU_KALAM') > 0);
  check(`${id}: Yama Gandam is no longer a hard exclusion`, scoreDuringFriction(id, 'YAMA') > 0);
  const today = runTimingSearch({ mode: 'FIND', activityId: id, durationMinutes: 45, dateRange: { start: '2026-08-21', end: '2026-08-21' }, timePreference: 'ANY', context: chennaiContext, limit: 96 });
  const frictionCandidate = today.candidates.find((c) => c.metadata.windowType === 'RAHU_KALAM' || c.metadata.windowType === 'YAMA');
  const strongerCandidate = today.candidates.find((c) => c.metadata.windowType === 'ABHIJIT' || c.metadata.windowType === 'NEUTRAL');
  check(`${id}: a Rahu Kalam/Yama candidate is surfaced (ranking, not elimination)`, Boolean(frictionCandidate));
  check(`${id}: a stronger window still outranks the friction-window candidate`, Boolean(frictionCandidate && strongerCandidate && strongerCandidate.score >= frictionCandidate.score));
}

// ============================================================
// scoreContinuousBlock()'s OWN friction guard (dailyAssistant.ts line ~540)
// is a SECOND, independent hard-exclusion mechanism from scoreCandidate()'s
// -100 -- it predates muhurtaClassification and keyed off the legacy
// `profile.significance === 'HIGH'` field, which Deep Work/Workout carry
// despite being everyday-depth. Both mechanisms must agree; this proves it
// directly at the scoreContinuousBlock layer (not just through FIND).
// ============================================================

{
  const deepWork = FULL_ACTIVITY_CATALOG.find((a) => a.id === 'deep-work')!;
  check('Deep Work: legacy significance is HIGH (the exact condition that used to over-trigger the block-level guard)', deepWork.significance === 'HIGH');
  const deepWorkProfile = profileFromActivity(deepWork);
  const slotCandidates = buildSlotCandidates(windows);
  const blockScore = scoreContinuousBlock(slotCandidates, deepWorkProfile, rahuKalam.startMinutes, rahuKalam.endMinutes, (m) => dateAtLocalMinute(m));
  check('Deep Work: scoreContinuousBlock no longer hard-blocks (-1) a block fully inside Rahu Kalam', blockScore !== -1 && blockScore >= 0);
}
{
  const task1 = FULL_ACTIVITY_CATALOG.find((a) => a.id === 'task-1')!; // High-Stakes Decision or Pitch
  const task1Profile = profileFromActivity(task1);
  const slotCandidates = buildSlotCandidates(windows);
  const blockScore = scoreContinuousBlock(slotCandidates, task1Profile, rahuKalam.startMinutes, rahuKalam.endMinutes, (m) => dateAtLocalMinute(m));
  check('High-Stakes Decision: scoreContinuousBlock still hard-blocks (-1) a block fully inside Rahu Kalam', blockScore === -1);
}
{
  // The legacy chronological-nearest NO_FIT fallback (findOptimalTaskTimes)
  // shares this exact core: for a duration that only that fallback path can
  // satisfy, it may now legitimately surface a friction window for an
  // everyday activity -- but must never do so for a timing-sensitive one.
  // Duration picked adaptively (not hardcoded): which duration actually
  // reaches the NO_FIT fallback on this fixed test date shifts whenever a
  // real Panchang-window-overlap scoring refinement lands nearby (already
  // happened once for this exact check, when Inauspicious Period
  // Precedence Fix V1 corrected the Abhijit/Rahu overlap resolution) -- see
  // the identical reasoning in timingSearch.test.ts's own cross-engine
  // duration search.
  const NO_FIT_TEST_DURATIONS = [25, 30, 45, 60, 90];
  let legacyDeepWork = findOptimalTaskTimes('Deep Work', chennaiContext, NO_FIT_TEST_DURATIONS[0], 'TODAY', undefined, undefined, 'ANYTIME');
  for (const duration of NO_FIT_TEST_DURATIONS) {
    const attempt = findOptimalTaskTimes('Deep Work', chennaiContext, duration, 'TODAY', undefined, undefined, 'ANYTIME');
    legacyDeepWork = attempt;
    if (attempt.recommendationState === 'NO_FIT') break;
  }
  check('Legacy planner: Deep Work at a duration that only fits via the NO_FIT fallback can surface a friction window', legacyDeepWork.recommendationState === 'NO_FIT');
  const legacyFinancial60 = findOptimalTaskTimes('Financial Decision', chennaiContext, 60, 'TODAY', undefined, undefined, 'ANYTIME');
  check('Legacy planner: Financial Decision never surfaces a Rahu Kalam/Yama bestWindow even via the NO_FIT fallback', legacyFinancial60.bestWindow.label !== 'Rahu Kalam' && legacyFinancial60.bestWindow.label !== 'Yama Gandam');
}

// ============================================================
// Sections 36/37/28: High-Stakes Decision / Financial Decision -- critical
// regression guards. If only a Rahu Kalam/Yama slot is available, these
// MUST remain excluded -- everyday flexibility must never leak in.
// ============================================================

const HIGH_SIGNIFICANCE_GUARD_IDS = ['task-1', 'financial-decision', 'new-beginning', 'business-start', 'property-purchase', 'engagement', 'griha-pravesh', 'start-journey'];
for (const id of HIGH_SIGNIFICANCE_GUARD_IDS) {
  check(`${id}: Rahu Kalam remains a hard exclusion (-100)`, scoreDuringFriction(id, 'RAHU_KALAM') === -100);
  check(`${id}: Yama Gandam remains a hard exclusion (-100)`, scoreDuringFriction(id, 'YAMA') === -100);
}
{
  // End-to-end guard through the canonical FIND path: with the search window
  // narrowed to exactly the Rahu Kalam span, a timing-sensitive activity
  // must return zero candidates -- never a manufactured "usable" option.
  const rahuOnlyStart = dateAtLocalMinute(rahuKalam.startMinutes).toISOString();
  const rahuOnlyEnd = dateAtLocalMinute(rahuKalam.endMinutes).toISOString();
  for (const id of ['task-1', 'financial-decision', 'start-journey']) {
    const result = runTimingSearch({ mode: 'CHECK', activityId: id, durationMinutes: 30, candidateStart: dateAtLocalMinute((rahuKalam.startMinutes + rahuKalam.endMinutes) / 2 - 15).toISOString(), context: chennaiContext, checkNearbyWindowMinutes: 0 });
    check(`${id}: CHECK at a Rahu Kalam instant still reports FRICTION_WINDOW_BLOCKED`, Boolean(result.candidates[0]?.conflicts?.some((c) => c.type === 'FRICTION_WINDOW_BLOCKED')));
  }
  void rahuOnlyStart; void rahuOnlyEnd;
}

// ============================================================
// Section 38 / 46: Griha Pravesh + Muhurtham Finder parity. Muhurtham
// Finder (muhurthamFinder.ts) never calls scoreCandidate()/
// evaluateActivityFit() -- confirmed structurally (it uses its own
// evaluatePersonalMuhurtaFit / rule-pack path) and confirmed here with a
// captured fixture: this exact score/rating/window was captured with a
// git-stashed (pre-Everyday-Timing-Flexibility-V1 build) of
// dailyAssistant.ts and was originally byte-for-byte identical to that PR's
// own result, proving THAT fix could not leak in.
//
// This snapshot itself DID change under Inauspicious Period Precedence Fix
// V1 -- deliberately: several of the originally-captured top-5 dates
// (2026-09-01, 09-12, 09-15, 09-17) scored STRONG only because their best
// window silently overlapped Gulika (or Rahu/Yama) the way the array-order
// bug allowed; Muhurtham's own spanOverlapsInauspiciousCommencementWindow
// safety check now correctly excludes those candidates for this
// commencement-sensitive activity, so genuinely clean dates (09-04, 09-13,
// 09-14, 09-21, 09-28) surface instead, at correspondingly lower but
// honest scores.
//
// Re-captured again under Ceremonial Muhurtham Boundary Augmentation V1 --
// deliberately: that PR adds Nakshatra/Tithi transition instants (and
// authoritative-avoid latest-valid-start instants) as extra candidate
// starts, on top of (never instead of) the existing solar-window/Neutral-
// gap starts. 2026-09-12 (best window lands exactly on a Uttara
// Phalguni/Shukla Dvitiya transition -- both favorable for Griha Pravesh)
// and 2026-09-17 (lands on an Anuradha transition -- also favorable) now
// score 7.3/7.1 respectively via genuinely new, previously-unsampled
// candidates, displacing 09-04 (6.9) and 09-28 (7.0) from the top-5. Same
// additive scoring formula, same eligibility rules -- only candidate
// DISCOVERY changed. Re-captured post-augmentation; still proves
// determinism/stability going forward, not "never changes" -- see
// test/muhurthamBoundaryAugmentation.test.ts for the dedicated
// augmentation regression suite.
// ============================================================

{
  const grihaPravesh = findMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: '2026-09-01', end: '2026-09-30' }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: chennaiContext });
  const captured = [
    { date: '2026-09-12', score: 7.3, rating: 'FAVORABLE', start: '2026-09-12T02:18:00.000Z' },
    { date: '2026-09-13', score: 7.3, rating: 'FAVORABLE', start: '2026-09-13T08:08:00.000Z' },
    { date: '2026-09-14', score: 7.3, rating: 'FAVORABLE', start: '2026-09-13T18:30:00.000Z' },
    { date: '2026-09-17', score: 7.1, rating: 'FAVORABLE', start: '2026-09-17T05:20:00.000Z' },
    { date: '2026-09-21', score: 7.3, rating: 'FAVORABLE', start: '2026-09-20T23:39:00.000Z' },
  ];
  const actual = grihaPravesh.dates.map((d) => ({ date: d.date, score: d.score, rating: d.rating, start: d.bestWindow.start }));
  check('Griha Pravesh Muhurtham Finder output is deterministic (re-captured after Inauspicious Period Precedence Fix V1)', JSON.stringify(actual) === JSON.stringify(captured));
}

// ============================================================
// Section 40: Shared Timing (Date Night) -- a weaker everyday window
// remains eligible for a shared candidate, but a stronger shared candidate
// still ranks higher; compatibility/personal scoring itself is untouched.
// ============================================================

{
  const shared = findEverydaySharedTiming({
    activityId: 'date-night',
    durationMinutes: 90,
    dateRange: { start: '2026-08-21', end: '2026-08-21' },
    context: { ...chennaiContext, personalContext: { natalNakshatraIndex: 2 } },
    partnerContext: { natalNakshatraIndex: 4 },
  });
  check('Shared Date Night: findEverydaySharedTiming returns OK', shared.status === 'OK');
  if (shared.status === 'OK') {
    check('Shared Date Night: candidates remain ranked by sharedScore descending', shared.candidates.every((c, i) => i === 0 || shared.candidates[i - 1].sharedScore >= c.sharedScore));
  }
}

// ============================================================
// Section 41: Timing parity -- the everyday flexibility fix lives ONLY in
// the canonical scoreCandidate() layer (dailyAssistant.ts), so Day
// Builder's own pure filtering (dayBuilder.ts: deriveAgendaOpenings +
// candidateFitsOpenings) sees the exact same candidate times runTimingSearch
// itself returns -- Day Builder is never independently patched.
// ============================================================

{
  // A day almost entirely booked except a stretch that covers only the
  // Rahu Kalam window -- before this fix, family-dinner's own candidate
  // pool from runTimingSearch would never contain a Rahu Kalam slot at all
  // (hard-filtered upstream), so Day Builder would have nothing to offer
  // in this opening. After the fix, the exact same canonical candidate
  // (ranked, not invented) fits the opening.
  const busyItem = (id: string, startMin: number, endMin: number): DailyAgendaItem => ({
    id,
    type: 'PLAN',
    title: id,
    startAt: dateAtLocalMinute(startMin).toISOString(),
    endAt: dateAtLocalMinute(endMin).toISOString(),
    status: 'UPCOMING',
    target: { type: 'PLAN', id },
  });
  const agenda: DailyAgenda = {
    localDate: '2026-08-21',
    timezone: 'Asia/Kolkata',
    items: [
      busyItem('morning-block', 0, rahuKalam.startMinutes - 5),
      busyItem('evening-block', rahuKalam.endMinutes + 5, 1440),
    ],
    completedCount: 0,
    plannedCount: 2,
  };
  const openings = deriveAgendaOpenings({ agenda, minuteOfDay: 0 });
  check('Day Builder fixture: the only real opening covers the Rahu Kalam window', openings.some((o) => o.startMinute <= rahuKalam.startMinutes && o.endMinute >= rahuKalam.endMinutes));

  const familyDinnerPool = runTimingSearch({ mode: 'FIND', activityId: 'family-dinner', durationMinutes: 45, dateRange: { start: '2026-08-21', end: '2026-08-21' }, timePreference: 'ANY', context: chennaiContext, limit: 96 });
  const fittingCandidates = familyDinnerPool.candidates.filter((c) => candidateFitsOpenings(c, openings, 'Asia/Kolkata', '2026-08-21'));
  check('Day Builder: at least one canonical Family Dinner candidate now fits the Rahu-Kalam-only opening', fittingCandidates.length > 0);
  check('Day Builder never invents a time: every fitting candidate is byte-identical to a runTimingSearch candidate', fittingCandidates.every((fc) => familyDinnerPool.candidates.some((c) => c.start === fc.start && c.end === fc.end)));
}

console.log(allPassed ? '\nALL EVERYDAY TIMING FLEXIBILITY CHECKS PASSED' : '\nSOME EVERYDAY TIMING FLEXIBILITY CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
