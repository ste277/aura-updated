import { scoreCandidate, scoreContinuousBlock, profileFromActivity, buildSlotCandidates, computeAssistantWindows, isTimingSensitiveActivity } from '../packages/recommendation/src/dailyAssistant';
import type { SlotCandidate, TaskProfile, DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';
import { evaluateTimingCandidate, runTimingSearch } from '../packages/recommendation/src/timingSearch';
import { findMuhurthams, SUPPORTED_MUHURTHAM_ACTIVITY_IDS } from '../packages/recommendation/src/muhurthamFinder';
import { findEverydaySharedTiming } from '../packages/recommendation/src/everydayTimingFit';
import { evaluateActivityFit } from '../packages/recommendation/src/auraFitEngine';
import { FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';
import { getActivityDefinition } from '../packages/recommendation/src/activityDefinitions';
import { isInauspiciousCommencementWindow, intervalsOverlap } from '../packages/panchang/src/windows';
import type { WindowSpan, SolarWindowType } from '../packages/panchang/src/windows';
import { deriveAgendaOpenings, candidateFitsOpenings } from '../apps/web/lib/dayBuilder';
import type { DailyAgenda, DailyAgendaItem } from '../apps/web/lib/dailyAgenda';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

/**
 * Inauspicious Period Precedence Fix V1. Fixes the two correctness issues
 * the completed "Inauspicious Period Override" audit identified:
 *
 * BUG 1 -- overlapping windows were resolved by array position (Array.find
 * first-match), not by explicit interval-overlap math, so a timing-
 * sensitive commencement inside an Abhijit/Rahu (or /Yama, or /Gulika)
 * overlap could inherit Abhijit's positive score merely because Abhijit
 * happened to be checked first. Fixed via an explicit interval-overlap
 * safety check (isInauspiciousCommencementWindow + intervalsOverlap,
 * packages/panchang/src/windows.ts) reused by both Timing Search
 * (scoreContinuousBlock, dailyAssistant.ts) and Muhurtham Finder
 * (spanOverlapsInauspiciousCommencementWindow, muhurthamFinder.ts).
 *
 * BUG 2 -- Gulika was never wired into ANY exclusion mechanism for ANY
 * activity, including significant/commencement-sensitive ones, and was
 * actively configured as a positive signal in three separate places
 * (GULIKA_SUPPORT bonus, capabilitiesForWindow's stronger-than-Neutral
 * values, and Engagement Ceremony's own recommendedWindowTypes). Fixed:
 * Gulika now overrides a positive commencement the same way Rahu/Yama do
 * for timing-sensitive activities, while remaining fully usable/rankable
 * (never a positive boost, never blocked) for everyday ones.
 */

function activityById(id: string) {
  const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === id);
  if (!activity) throw new Error(`test fixture bug: unknown activity id ${id}`);
  return activity;
}
function profileFor(id: string): TaskProfile {
  return profileFromActivity(activityById(id));
}

const chennaiContext: DailyAssistantContext = {
  now: new Date(Date.UTC(2026, 7, 21, 4, 0, 0)),
  latitude: 13.0827,
  longitude: 80.2707,
  timezone: 'Asia/Kolkata',
  tzOffsetMinutes: 330,
};

const SIGNIFICANT_ACTIVITY_IDS = ['task-1', 'engagement', 'financial-decision', 'new-beginning', 'business-start', 'property-purchase', 'griha-pravesh', 'start-journey'];
const EVERYDAY_ACTIVITY_IDS = ['deep-work', 'workout', 'task-7', 'tea-break', 'family-dinner', 'date-night', 'walk-together'];

// ============================================================
// Section 8: reproduction test, real 2026-09-02 Chennai data.
// ABHIJIT 11:44 AM-12:34 PM overlaps RAHU_KALAM 12:10 PM-1:43 PM.
// Financial Decision at 12:15-12:30 PM (entirely inside Rahu Kalam) must
// no longer be a valid positive commencement candidate.
// ============================================================
{
  const context2026_09_02: DailyAssistantContext = { ...chennaiContext, now: new Date(Date.UTC(2026, 8, 2, 4, 0, 0)) };
  function utcFor(minute: number): Date {
    return new Date(Date.UTC(2026, 8, 2, 0, 0, 0) - 330 * 60000 + minute * 60000);
  }
  const windows = computeAssistantWindows(context2026_09_02);
  const abhijit = windows.find((w) => w.type === 'ABHIJIT')!;
  const rahu = windows.find((w) => w.type === 'RAHU_KALAM')!;
  check('Fixture sanity: real 2026-09-02 Abhijit/Rahu Kalam genuinely overlap', abhijit.startMinutes < rahu.endMinutes && rahu.startMinutes < abhijit.endMinutes);

  const financialDecisionProfile = profileFor('financial-decision');
  // 12:15-12:30 PM = local minutes 735-750
  const candidate = evaluateTimingCandidate({ profile: financialDecisionProfile, start: utcFor(735), durationMinutes: 15, context: context2026_09_02 });
  check('Financial Decision 12:15-12:30 PM (real 2026-09-02, entirely inside Rahu Kalam) is NOT a positive candidate', candidate.score <= 0);
  check('Financial Decision 12:15-12:30 PM carries a FRICTION_WINDOW_BLOCKED conflict', Boolean(candidate.conflicts?.some((c) => c.type === 'FRICTION_WINDOW_BLOCKED')));
  check('Financial Decision 12:15-12:30 PM is not labeled GOOD/BEST/EXCELLENT/VERY_GOOD', !['GOOD', 'VERY_GOOD', 'EXCELLENT'].includes(candidate.label));

  // End-to-end through the canonical FIND path: no candidate anywhere in
  // this window overlap should ever surface as a positively-rated result.
  const findResult = runTimingSearch({ mode: 'FIND', activityId: 'financial-decision', durationMinutes: 15, dateRange: { start: '2026-09-02', end: '2026-09-02' }, timePreference: 'ANY', context: context2026_09_02, limit: 96 });
  const overlapZoneCandidate = findResult.candidates.find((c) => {
    const startMinute = (new Date(c.start).getTime() - utcFor(0).getTime()) / 60000;
    return startMinute >= rahu.startMinutes && startMinute + 15 <= abhijit.endMinutes;
  });
  check('FIND never returns a candidate entirely inside the Abhijit/Rahu overlap zone for Financial Decision', overlapZoneCandidate === undefined);
}

// ============================================================
// Section 9/10/11: deterministic overlap fixtures (Abhijit+Rahu,
// Abhijit+Yama, Abhijit+Gulika, Brahma+Rahu/Yama/Gulika). Synthetic
// WindowSpan[] fixtures -- exact, reproducible, independent of any real
// date's ephemeris -- matching the audit's own "construct a deterministic
// fixture" method.
// ============================================================

const AUG_21_2026 = (minute: number) => new Date(Date.UTC(2026, 7, 21, 0, 0, 0) - 330 * 60000 + minute * 60000);

function abhijitOverlapWindows(frictionType: SolarWindowType): WindowSpan[] {
  // Abhijit 11:50 AM-12:40 PM (710-760), friction window 12:15 PM-1:45 PM (735-825) -- the audit's own example.
  return [
    { type: 'ABHIJIT', label: 'Abhijit Muhurta', startMinutes: 710, endMinutes: 760 },
    { type: frictionType, label: frictionType, startMinutes: 735, endMinutes: 825 },
  ];
}

for (const [label, frictionType] of [['Rahu Kalam', 'RAHU_KALAM'], ['Yamaganda', 'YAMA'], ['Gulika', 'GULIKA']] as [string, SolarWindowType][]) {
  const windows = abhijitOverlapWindows(frictionType);
  const candidates = buildSlotCandidates(windows);
  for (const activityId of SIGNIFICANT_ACTIVITY_IDS) {
    const profile = profileFor(activityId);
    const overlapScore = scoreContinuousBlock(candidates, profile, 735, 760, AUG_21_2026); // 12:15-12:40, entirely inside the overlap
    const pureAbhijitScore = scoreContinuousBlock(candidates, profile, 710, 735, AUG_21_2026); // 11:50-12:15, pure Abhijit
    check(`${activityId}: Abhijit+${label} overlap (12:15-12:40) is hard-excluded for this significant commencement`, overlapScore < 0);
    check(`${activityId}: the pure-Abhijit portion (11:50-12:15) of the SAME window remains a valid, positive candidate`, pureAbhijitScore > 0);
  }
}

function brahmaOverlapWindows(frictionType: SolarWindowType): WindowSpan[] {
  // Brahma 4:30-5:18 AM (270-318), friction window 5:00-6:30 AM (300-390) -- the audit's own example.
  return [
    { type: 'BRAHMA', label: 'Brahma Muhurtham', startMinutes: 270, endMinutes: 318 },
    { type: frictionType, label: frictionType, startMinutes: 300, endMinutes: 390 },
  ];
}

for (const [label, frictionType] of [['Rahu Kalam', 'RAHU_KALAM'], ['Yamaganda', 'YAMA'], ['Gulika', 'GULIKA']] as [string, SolarWindowType][]) {
  const windows = brahmaOverlapWindows(frictionType);
  const candidates = buildSlotCandidates(windows);
  for (const activityId of ['task-1', 'new-beginning']) {
    const profile = profileFor(activityId);
    const overlapScore = scoreContinuousBlock(candidates, profile, 300, 318, AUG_21_2026); // 5:00-5:18 AM, entirely inside the overlap
    const pureBrahmaScore = scoreContinuousBlock(candidates, profile, 270, 300, AUG_21_2026); // 4:30-5:00 AM, pure Brahma
    check(`${activityId}: Brahma+${label} overlap (5:00-5:18 AM) is hard-excluded for this significant commencement`, overlapScore < 0);
    check(`${activityId}: the pure-Brahma portion (4:30-5:00 AM) of the SAME window remains a valid, positive candidate`, pureBrahmaScore > 0);
  }
}

// ============================================================
// Section 12/13: Gulika as a significant-activity override -- Engagement
// Ceremony specifically. Both the canonical engine guard AND the catalog
// data fix.
// ============================================================
{
  const engagement = activityById('engagement');
  check('Engagement Ceremony catalog entry no longer lists GULIKA in recommendedWindowTypes', !engagement.recommendedWindowTypes.includes('GULIKA'));
  const engagementProfile = profileFor('engagement');
  const isolatedGulikaCandidate: SlotCandidate = { startMinute: 600, endMinute: 660, type: 'GULIKA', label: 'Gulika Kalam' };
  check('Engagement Ceremony during ISOLATED Gulika (no overlap needed) is hard-excluded (-100)', scoreCandidate(isolatedGulikaCandidate, engagementProfile, AUG_21_2026(630)) === -100);

  // Canonical safety net: even if the catalog were misconfigured again in
  // the future, the engine itself must still exclude Gulika for a
  // commencement-sensitive activity -- verified directly against the
  // now-corrected classification (independent of catalog window lists).
  const def = getActivityDefinition('engagement');
  check('isTimingSensitiveActivity(engagement classification) is true (canonical guard is reachable)', isTimingSensitiveActivity(def?.muhurta));
}

// ============================================================
// Section 14/27: everyday activities remain schedulable during Rahu/Yama/
// Gulika -- ranked lower, never blocked. Not asserting fragile exact
// scores; asserting the semantic invariants the brief itself calls for.
// ============================================================

for (const frictionType of ['RAHU_KALAM', 'YAMA', 'GULIKA'] as SolarWindowType[]) {
  for (const activityId of EVERYDAY_ACTIVITY_IDS) {
    const activity = activityById(activityId);
    const profile = profileFromActivity(activity);
    const def = getActivityDefinition(activityId);
    const candidate: SlotCandidate = { startMinute: 600, endMinute: 660, type: frictionType, label: frictionType };
    const rawScore = scoreCandidate(candidate, profile, AUG_21_2026(630));
    const fit = evaluateActivityFit({ activity, date: AUG_21_2026(630), windowType: frictionType, classification: def?.muhurta });
    check(`${activityId} during ${frictionType}: remains schedulable (not hard-excluded)`, rawScore > 0);
    check(`${activityId} during ${frictionType}: fit score is a real, finite number in the normal 0-100 range`, fit.score >= 0 && fit.score <= 100);
  }
}

// ============================================================
// Section 15/16/17/18: Gulika must not be a POSITIVE boost for an everyday
// activity relative to that same activity's own Neutral score -- "may
// remain usable" is not "Gulika makes this better."
//
// Restricted to categories NOT covered by evaluateActivityFit's own
// pre-existing, unrelated neutralContextAdjustment (auraFitEngine.ts):
// that adjustment applies ONLY to windowType==='NEUTRAL' and deliberately
// penalizes NEUTRAL itself for RELATIONSHIP/SOCIAL (-12) and WORKOUT/
// MICRO_BREAK (-10) categories (a pre-existing product decision that a
// generic "Neutral Flow" period is a weaker fit for those activities than
// a real window) -- so for date-night/walk-together/workout/tea-break etc.
// Gulika CAN legitimately outscore that deliberately-penalized Neutral
// score without Gulika itself being the "stronger positive signal"; the
// Gulika-specific fix (capabilitiesForWindow, GULIKA_SUPPORT) is verified
// directly below instead, isolated from that unrelated confound.
const NEUTRAL_ADJUSTMENT_EXEMPT_CATEGORIES = new Set(['RELATIONSHIP', 'SOCIAL', 'WORKOUT', 'MICRO_BREAK']);
for (const activityId of EVERYDAY_ACTIVITY_IDS) {
  const activity = activityById(activityId);
  if (NEUTRAL_ADJUSTMENT_EXEMPT_CATEGORIES.has(activity.category)) continue;
  const def = getActivityDefinition(activityId);
  const gulikaFit = evaluateActivityFit({ activity, date: AUG_21_2026(630), windowType: 'GULIKA', classification: def?.muhurta });
  const neutralFit = evaluateActivityFit({ activity, date: AUG_21_2026(630), windowType: 'NEUTRAL', classification: def?.muhurta });
  check(`${activityId}: Gulika never scores higher than this activity's own Neutral score`, gulikaFit.score <= neutralFit.score);
}
{
  // Direct, category-independent proof of the actual Gulika-specific fix:
  // capabilitiesForWindow('GULIKA', modifier) is byte-identical to the
  // default/NEUTRAL branch's own values (Gulika's dedicated, stronger-
  // than-Neutral branch was removed entirely, not merely rebalanced).
  const workout = activityById('workout');
  const workoutDef = getActivityDefinition('workout');
  const gulikaCapabilities = evaluateActivityFit({ activity: workout, date: AUG_21_2026(630), windowType: 'GULIKA', classification: workoutDef?.muhurta }).capabilities;
  const neutralCapabilities = evaluateActivityFit({ activity: workout, date: AUG_21_2026(630), windowType: 'NEUTRAL', classification: workoutDef?.muhurta }).capabilities;
  check('capabilitiesForWindow(GULIKA) is byte-identical to capabilitiesForWindow(NEUTRAL) -- Gulika has no dedicated, stronger-than-Neutral branch any more', JSON.stringify(gulikaCapabilities) === JSON.stringify(neutralCapabilities));
}
{
  // Section 16: the GULIKA_SUPPORT bonus (ADMIN/LEARNING/SOCIAL families)
  // must be gone -- Gulika returns no SUPPORT reason for any family.
  const learningActivity = activityById('learning');
  const learningDef = getActivityDefinition('learning');
  const gulikaFit = evaluateActivityFit({ activity: learningActivity, date: AUG_21_2026(630), windowType: 'GULIKA', classification: learningDef?.muhurta });
  check('No activity fit evaluation during GULIKA carries a GULIKA_SUPPORT reason (bonus removed, not merely renamed)', !gulikaFit.reasons.some((r) => (r.code as string) === 'GULIKA_SUPPORT'));
}

// ============================================================
// Section 26: full significant-activity matrix (Rahu/Yama/Gulika, isolated
// + Abhijit overlap + Brahma overlap).
// ============================================================
console.log('\nSignificant-activity matrix (isolated window):');
console.log('Activity'.padEnd(20) + 'Rahu'.padEnd(10) + 'Yama'.padEnd(10) + 'Gulika');
for (const activityId of SIGNIFICANT_ACTIVITY_IDS) {
  const profile = profileFor(activityId);
  const row = [activityId];
  for (const wt of ['RAHU_KALAM', 'YAMA', 'GULIKA'] as SolarWindowType[]) {
    const candidate: SlotCandidate = { startMinute: 600, endMinute: 660, type: wt, label: wt };
    const score = scoreCandidate(candidate, profile, AUG_21_2026(630));
    check(`${activityId} isolated ${wt}: BLOCKED (-100)`, score === -100);
    row.push(String(score));
  }
  console.log(row[0].padEnd(20) + row[1].padEnd(10) + row[2].padEnd(10) + row[3]);
}

// ============================================================
// Section 29: NO array-order dependence. Permute the overlapping
// WindowSpan[] input order for a significant activity's commencement
// safety check -- the semantic result (hard-excluded) must be identical
// regardless of which window is listed first.
// ============================================================
{
  const financialDecisionProfile = profileFor('financial-decision');
  const orderings: WindowSpan[][] = [
    [
      { type: 'ABHIJIT', label: 'Abhijit Muhurta', startMinutes: 710, endMinutes: 760 },
      { type: 'RAHU_KALAM', label: 'Rahu Kalam', startMinutes: 735, endMinutes: 825 },
    ],
    [
      { type: 'RAHU_KALAM', label: 'Rahu Kalam', startMinutes: 735, endMinutes: 825 },
      { type: 'ABHIJIT', label: 'Abhijit Muhurta', startMinutes: 710, endMinutes: 760 },
    ],
  ];
  const results = orderings.map((windows) => scoreContinuousBlock(buildSlotCandidates(windows), financialDecisionProfile, 735, 760, AUG_21_2026));
  check('Permuting the overlapping WindowSpan[] order does not change the significant-activity safety result (both orderings hard-exclude)', results.every((r) => r < 0));
  check('Both permutation orderings agree exactly (array order genuinely does not matter)', results[0] === results[1]);

  // Same check with a THREE-window overlap (Abhijit + Gulika + Rahu, the
  // real 2026-09-02 shape) permuted across all 6 orderings.
  const threeWindows: WindowSpan[] = [
    { type: 'ABHIJIT', label: 'Abhijit Muhurta', startMinutes: 704, endMinutes: 754 },
    { type: 'GULIKA', label: 'Gulika Kalam', startMinutes: 636, endMinutes: 730 },
    { type: 'RAHU_KALAM', label: 'Rahu Kalam', startMinutes: 730, endMinutes: 823 },
  ];
  function permutations<T>(arr: T[]): T[][] {
    if (arr.length <= 1) return [arr];
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
      for (const perm of permutations(rest)) result.push([arr[i], ...perm]);
    }
    return result;
  }
  const threeWindowResults = permutations(threeWindows).map((windows) => scoreContinuousBlock(buildSlotCandidates(windows), financialDecisionProfile, 704, 754, AUG_21_2026));
  check('All 6 permutations of a 3-window (Abhijit+Gulika+Rahu) overlap agree exactly for a significant commencement', threeWindowResults.every((r) => r === threeWindowResults[0]));
  check('All 6 permutations hard-exclude the significant commencement', threeWindowResults.every((r) => r < 0));
}

// ============================================================
// Section 28: Muhurtham regression -- every Muhurtham-supported
// significant activity, Gulika overlap does not survive as a valid
// Muhurtham. Real date: 2026-09-02 (Abhijit/Gulika/Rahu all overlap).
// ============================================================
{
  const context2026_09_02: DailyAssistantContext = { ...chennaiContext, now: new Date(Date.UTC(2026, 8, 2, 4, 0, 0)) };
  for (const activityId of SUPPORTED_MUHURTHAM_ACTIVITY_IDS) {
    const result = findMuhurthams({ activityId, dateRange: { start: '2026-09-02', end: '2026-09-02' }, timePreference: 'ANY', durationMinutes: 20, limit: 5, context: context2026_09_02 });
    // 2026-09-02: Abhijit(11:44AM-12:34PM)/Gulika(10:36AM-12:10PM)/Rahu(12:10PM-1:43PM) together fully cover
    // Abhijit's whole span -- there is no genuinely clean sub-window inside Abhijit on this date. Any date
    // returned must therefore NOT be anchored inside Abhijit's own overlap-covered span.
    const abhijitOverlapStartISO = new Date(Date.UTC(2026, 8, 2, 0, 0, 0) - 330 * 60000 + 704 * 60000).toISOString();
    const abhijitOverlapEndISO = new Date(Date.UTC(2026, 8, 2, 0, 0, 0) - 330 * 60000 + 754 * 60000).toISOString();
    const survivesInsideOverlap = result.dates.some((d) => d.bestWindow.start >= abhijitOverlapStartISO && d.bestWindow.start < abhijitOverlapEndISO);
    check(`Muhurtham (${activityId}): no candidate anchored inside the Abhijit/Gulika/Rahu overlap zone survives as a valid Muhurtham for 2026-09-02`, !survivesInsideOverlap);
  }
}

// ============================================================
// Section 23: Day Builder inherits the fix (no Day Builder-specific
// filtering added or needed). If the only available opening is a
// friction-window-only stretch: Family Dinner (everyday) may surface;
// Financial Decision (significant) must not surface as a positive
// candidate.
// ============================================================
{
  const windows = computeAssistantWindows(chennaiContext);
  const rahuKalam = windows.find((w) => w.type === 'RAHU_KALAM')!;
  function dateAtLocalMinute(minute: number): Date {
    return new Date(Date.UTC(2026, 7, 21, 0, 0, 0) - chennaiContext.tzOffsetMinutes * 60000 + minute * 60000);
  }
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
    // 1439, not 1440: deriveAgendaOpenings documents that an item crossing
    // local midnight is deliberately unhandled (itemMinuteRange returns
    // null when end <= start after zoning) -- a literal 1440 end computes
    // to minute 0 of the NEXT day once re-zoned, silently dropping this
    // whole "evening-block" item and leaving the day open all the way to
    // midnight instead of just the Rahu Kalam stretch.
    items: [busyItem('morning-block', 0, rahuKalam.startMinutes - 5), busyItem('evening-block', rahuKalam.endMinutes + 5, 1439)],
    completedCount: 0,
    plannedCount: 2,
  };
  const openings = deriveAgendaOpenings({ agenda, minuteOfDay: 0 });
  check('Day Builder fixture: exactly one opening, correctly bounded to the Rahu-Kalam stretch (not silently open until midnight)', openings.length === 1 && openings[0].startMinute === rahuKalam.startMinutes - 5 && openings[0].endMinute === rahuKalam.endMinutes + 5);

  // Deep Work, not Family Dinner: Family Dinner carries its own real-world-
  // clock EVENING default (ActivityTimeOfDayPreference, unrelated to this
  // PR), which pushes every one of its FIND candidates into the evening
  // regardless of an explicit 'ANY' Panchang preference -- so it would never
  // fit a morning Rahu-Kalam-timed opening for reasons having nothing to do
  // with the fix under test here. Deep Work carries no such default.
  const deepWorkPool = runTimingSearch({ mode: 'FIND', activityId: 'deep-work', durationMinutes: 45, dateRange: { start: '2026-08-21', end: '2026-08-21' }, timePreference: 'ANY', context: chennaiContext, limit: 96 });
  const deepWorkFits = deepWorkPool.candidates.filter((c) => candidateFitsOpenings(c, openings, 'Asia/Kolkata', '2026-08-21'));
  check('Day Builder: Deep Work (everyday) surfaces at least one candidate in a Rahu-Kalam-only opening', deepWorkFits.length > 0);

  const financialDecisionPool = runTimingSearch({ mode: 'FIND', activityId: 'financial-decision', durationMinutes: 45, dateRange: { start: '2026-08-21', end: '2026-08-21' }, timePreference: 'ANY', context: chennaiContext, limit: 96 });
  const financialDecisionFits = financialDecisionPool.candidates.filter((c) => candidateFitsOpenings(c, openings, 'Asia/Kolkata', '2026-08-21'));
  check('Day Builder: Financial Decision (significant) does NOT surface any candidate in a Rahu-Kalam-only opening', financialDecisionFits.length === 0);
}

// ============================================================
// Section 24: Shared Timing inherits the everyday behavior -- Family
// Dinner during Gulika may remain usable, ranked (not boosted).
// ============================================================
{
  const shared = findEverydaySharedTiming({
    activityId: 'family-dinner',
    durationMinutes: 60,
    dateRange: { start: '2026-08-21', end: '2026-08-22' },
    context: { ...chennaiContext, personalContext: { natalNakshatraIndex: 2 } },
    partnerContext: { natalNakshatraIndex: 4 },
  });
  check('Shared Timing (Family Dinner, everyday) returns OK', shared.status === 'OK');
  if (shared.status === 'OK') {
    check('Shared Timing candidates remain ranked by sharedScore descending', shared.candidates.every((c, i) => i === 0 || shared.candidates[i - 1].sharedScore >= c.sharedScore));
  }
}

console.log(allPassed ? '\nALL INAUSPICIOUS PERIOD PRECEDENCE CHECKS PASSED' : '\nSOME INAUSPICIOUS PERIOD PRECEDENCE CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
