/**
 * Behavioral Personalization Foundation V1 (#110): regression suite for
 * apps/web/lib/behavioralAffinity.ts -- the pure, deterministic
 * derivation of a per-canonical-family BehavioralAffinity from a set of
 * already-fetched HabitLog rows. No DB, no fetch, no Date.now() --
 * everything here uses in-memory HabitLogRow fixtures, matching this
 * repo's established pattern (see test/insightsAuraFit.test.ts,
 * test/habitLogActivityIdentity.test.ts).
 *
 * FOUNDATION ONLY: this suite proves the engine's own contract -- it does
 * NOT touch Daily Guidance, Best For You, Forward Planner, Ask Aura, Why
 * Aura, Timing Search, GOOD_RIGHT_NOW, Muhurtham Finder, Aura Fit, Window
 * Ranking, Life Weather, or Daily Personal Fit, because this module has no
 * consumer yet.
 */
import type { HabitLogRow } from '../apps/web/lib/db';
import {
  deriveBehavioralProfile,
  BEHAVIORAL_AFFINITY_ENGINE_VERSION,
  BEHAVIORAL_AFFINITY_POLICY_VERSION,
  BEHAVIORAL_AFFINITY_RECENCY_DAYS,
  BehavioralActivityAffinity,
} from '../apps/web/lib/behavioralAffinity';
import { CANONICAL_ACTIVITY_FAMILIES } from '../packages/daily-personal-fit/src/constants';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-09-10T04:00:00.000Z'); // 9:30 AM IST, Thursday

let logCounter = 0;
function makeLog(overrides: Partial<HabitLogRow> = {}): HabitLogRow {
  logCounter += 1;
  return {
    id: `log-${logCounter}`,
    userId: 'user-1',
    activityTitle: 'Something I logged',
    activityId: 'workout',
    activeWindow: 'ABHIJIT',
    logTimestamp: NOW,
    logMinuteOfDay: 600,
    durationMinutes: 45,
    ...overrides,
  };
}

function findFamily(activities: BehavioralActivityAffinity[], family: string): BehavioralActivityAffinity {
  const entry = activities.find((a) => a.activityFamily === family);
  if (!entry) throw new Error(`family ${family} missing from output -- cold-start contract violated`);
  return entry;
}

// ============================================================
// Version stamps.
// ============================================================
{
  const profile = deriveBehavioralProfile([], TZ, NOW);
  check('engineVersion is BEHAVIORAL_AFFINITY_V1', profile.engineVersion === 'BEHAVIORAL_AFFINITY_V1' && profile.engineVersion === BEHAVIORAL_AFFINITY_ENGINE_VERSION);
  check('policyVersion is BEHAVIORAL_AFFINITY_POLICY_V1', profile.policyVersion === 'BEHAVIORAL_AFFINITY_POLICY_V1' && profile.policyVersion === BEHAVIORAL_AFFINITY_POLICY_VERSION);
  check('evaluationTime is the caller-supplied now, ISO-formatted', profile.evaluationTime === NOW.toISOString());
  check('BEHAVIORAL_AFFINITY_RECENCY_DAYS is a positive V1 policy placeholder (60)', BEHAVIORAL_AFFINITY_RECENCY_DAYS === 60);
}

// ============================================================
// COLD START -- cold-start contract: full 13-family vector, all NEUTRAL,
// 0 evidence -- never an empty array, never inferred dislike.
// ============================================================
{
  const profile = deriveBehavioralProfile([], TZ, NOW);
  check('cold start: activities has exactly CANONICAL_ACTIVITY_FAMILIES.length (13) entries', profile.activities.length === CANONICAL_ACTIVITY_FAMILIES.length);
  check('cold start: activities are in the fixed canonical order, not sparse/reordered', profile.activities.every((a, i) => a.activityFamily === CANONICAL_ACTIVITY_FAMILIES[i]));
  check('cold start: every family is NEUTRAL with evidenceCount 0', profile.activities.every((a) => a.affinity === 'NEUTRAL' && a.evidenceCount === 0));
  check('cold start: no family carries a preferredDaypart', profile.activities.every((a) => a.preferredDaypart === undefined));
  check('cold start: no family carries a typicalDurationMinutes', profile.activities.every((a) => a.typicalDurationMinutes === undefined));
}

// ============================================================
// EVIDENCE THRESHOLD -- 0/1-2 -> NEUTRAL, 3-4 -> MODERATE, 5+ -> STRONG.
// ============================================================
{
  for (const n of [1, 2]) {
    const logs = Array.from({ length: n }, () => makeLog({ activityId: 'workout' }));
    const workout = findFamily(deriveBehavioralProfile(logs, TZ, NOW).activities, 'WORKOUT');
    check(`${n} completion(s) -> NEUTRAL, evidenceCount=${n}`, workout.affinity === 'NEUTRAL' && workout.evidenceCount === n);
  }
  for (const n of [3, 4]) {
    const logs = Array.from({ length: n }, () => makeLog({ activityId: 'workout' }));
    const workout = findFamily(deriveBehavioralProfile(logs, TZ, NOW).activities, 'WORKOUT');
    check(`${n} completions -> MODERATE, evidenceCount=${n}`, workout.affinity === 'MODERATE' && workout.evidenceCount === n);
  }
  for (const n of [5, 6]) {
    const logs = Array.from({ length: n }, () => makeLog({ activityId: 'workout' }));
    const workout = findFamily(deriveBehavioralProfile(logs, TZ, NOW).activities, 'WORKOUT');
    check(`${n} completions -> STRONG, evidenceCount=${n}`, workout.affinity === 'STRONG' && workout.evidenceCount === n);
  }
}

// ============================================================
// FAMILY ISOLATION -- WORKOUT evidence must never leak into DEEP_WORK
// (or any other family)'s own affinity/evidenceCount.
// ============================================================
{
  const logs = [
    ...Array.from({ length: 5 }, () => makeLog({ activityId: 'workout' })),
    ...Array.from({ length: 1 }, () => makeLog({ activityId: 'deep-work' })),
  ];
  const profile = deriveBehavioralProfile(logs, TZ, NOW);
  const workout = findFamily(profile.activities, 'WORKOUT');
  const deepWork = findFamily(profile.activities, 'DEEP_WORK');
  check('FAMILY ISOLATION: WORKOUT reaches STRONG from its own 5 observations', workout.affinity === 'STRONG' && workout.evidenceCount === 5);
  check('FAMILY ISOLATION: DEEP_WORK stays NEUTRAL with its own 1 observation, unaffected by WORKOUT\'s evidence', deepWork.affinity === 'NEUTRAL' && deepWork.evidenceCount === 1);
  check('FAMILY ISOLATION: every other family remains at 0 evidence', profile.activities.filter((a) => a.activityFamily !== 'WORKOUT' && a.activityFamily !== 'DEEP_WORK').every((a) => a.evidenceCount === 0));
}

// ============================================================
// ACTIVITY NORMALIZATION -- invalid identity is excluded, never guessed.
// ============================================================
{
  const logs = [
    makeLog({ activityId: null }),
    makeLog({ activityId: undefined }),
    makeLog({ activityId: 'not-a-real-catalog-activity-id' }),
  ];
  const profile = deriveBehavioralProfile(logs, TZ, NOW);
  check('null/undefined/unknown activityId: every family stays at 0 evidence (excluded, never guessed from activityTitle)', profile.activities.every((a) => a.evidenceCount === 0));
}

// ============================================================
// RECENCY WINDOW -- inside the 60-day window is eligible, outside is
// excluded, the boundary itself is deterministic.
// ============================================================
{
  const insideWindow = new Date(NOW.getTime() - (BEHAVIORAL_AFFINITY_RECENCY_DAYS - 1) * 24 * 60 * 60 * 1000);
  const exactlyAtBoundary = new Date(NOW.getTime() - BEHAVIORAL_AFFINITY_RECENCY_DAYS * 24 * 60 * 60 * 1000);
  const justOutsideWindow = new Date(NOW.getTime() - (BEHAVIORAL_AFFINITY_RECENCY_DAYS * 24 * 60 * 60 * 1000 + 60 * 1000));

  const inside = findFamily(deriveBehavioralProfile([makeLog({ activityId: 'workout', logTimestamp: insideWindow })], TZ, NOW).activities, 'WORKOUT');
  check('RECENCY: an observation inside the window is eligible', inside.evidenceCount === 1);

  const boundary = findFamily(deriveBehavioralProfile([makeLog({ activityId: 'workout', logTimestamp: exactlyAtBoundary })], TZ, NOW).activities, 'WORKOUT');
  check('RECENCY: an observation exactly at the boundary (now - 60 days) is inclusive/eligible', boundary.evidenceCount === 1);

  const outside = findFamily(deriveBehavioralProfile([makeLog({ activityId: 'workout', logTimestamp: justOutsideWindow })], TZ, NOW).activities, 'WORKOUT');
  check('RECENCY: an observation just outside the window (60 days + 1 minute ago) is excluded', outside.evidenceCount === 0);

  // Exact millisecond-precision boundary proof (not just a coarse minute).
  const cutoffMs = NOW.getTime() - BEHAVIORAL_AFFINITY_RECENCY_DAYS * 24 * 60 * 60 * 1000;
  const oneMsBeforeBoundary = new Date(cutoffMs - 1);
  const oneMsAfterBoundary = new Date(cutoffMs + 1);
  const justBefore = findFamily(deriveBehavioralProfile([makeLog({ activityId: 'workout', logTimestamp: oneMsBeforeBoundary })], TZ, NOW).activities, 'WORKOUT');
  const justAfter = findFamily(deriveBehavioralProfile([makeLog({ activityId: 'workout', logTimestamp: oneMsAfterBoundary })], TZ, NOW).activities, 'WORKOUT');
  const exactlyOnBoundary = findFamily(deriveBehavioralProfile([makeLog({ activityId: 'workout', logTimestamp: new Date(cutoffMs) })], TZ, NOW).activities, 'WORKOUT');
  check('RECENCY (1ms precision): exactly at the boundary -> included', exactlyOnBoundary.evidenceCount === 1);
  check('RECENCY (1ms precision): 1ms before the boundary -> excluded', justBefore.evidenceCount === 0);
  check('RECENCY (1ms precision): 1ms after the boundary -> included', justAfter.evidenceCount === 1);
}

// ============================================================
// DAYPART CONSISTENCY -- the exact three worked examples from the brief.
// ============================================================
{
  // 3 morning (IST 9:30 AM = minute 570, MORNING band 300-719) -> MORNING.
  const allMorning = Array.from({ length: 3 }, () => makeLog({ activityId: 'meditation', logTimestamp: new Date('2026-09-08T04:00:00.000Z') }));
  const allMorningResult = findFamily(deriveBehavioralProfile(allMorning, TZ, NOW).activities, 'MEDITATION');
  check('DAYPART: 3 morning observations -> preferredDaypart MORNING', allMorningResult.preferredDaypart === 'MORNING');

  // 2 morning + 1 evening (IST 6:30 PM = minute 1110, EVENING band 1020-1319) -> MORNING (2/3 exactly).
  const twoMorningOneEvening = [
    makeLog({ activityId: 'meditation', logTimestamp: new Date('2026-09-07T04:00:00.000Z') }), // 9:30 AM IST
    makeLog({ activityId: 'meditation', logTimestamp: new Date('2026-09-08T04:00:00.000Z') }), // 9:30 AM IST
    makeLog({ activityId: 'meditation', logTimestamp: new Date('2026-09-09T13:00:00.000Z') }), // 6:30 PM IST
  ];
  const twoOneResult = findFamily(deriveBehavioralProfile(twoMorningOneEvening, TZ, NOW).activities, 'MEDITATION');
  check('DAYPART: 2 morning + 1 evening -> preferredDaypart MORNING (exactly 2/3)', twoOneResult.preferredDaypart === 'MORNING');

  // 1 morning + 1 afternoon + 1 evening -> undefined (3-way tie).
  const threeWaySplit = [
    makeLog({ activityId: 'meditation', logTimestamp: new Date('2026-09-07T04:00:00.000Z') }), // 9:30 AM IST -> MORNING
    makeLog({ activityId: 'meditation', logTimestamp: new Date('2026-09-08T09:00:00.000Z') }), // 2:30 PM IST -> AFTERNOON
    makeLog({ activityId: 'meditation', logTimestamp: new Date('2026-09-09T13:00:00.000Z') }), // 6:30 PM IST -> EVENING
  ];
  const splitResult = findFamily(deriveBehavioralProfile(threeWaySplit, TZ, NOW).activities, 'MEDITATION');
  check('DAYPART: 1 morning + 1 afternoon + 1 evening -> preferredDaypart undefined (3-way tie)', splitResult.preferredDaypart === undefined);

  // 2 morning + 2 evening -> undefined. Each is exactly 50% (never reaches
  // the 2/3 floor even without a tie), AND it's a genuine 2-way tie at the
  // max count -- neither reason alone is left untested by the other cases
  // above, so this proves BOTH guards independently on the same input.
  const twoMorningTwoEvening = [
    makeLog({ activityId: 'meditation', logTimestamp: new Date('2026-09-06T04:00:00.000Z') }), // 9:30 AM IST
    makeLog({ activityId: 'meditation', logTimestamp: new Date('2026-09-07T04:00:00.000Z') }), // 9:30 AM IST
    makeLog({ activityId: 'meditation', logTimestamp: new Date('2026-09-08T13:00:00.000Z') }), // 6:30 PM IST
    makeLog({ activityId: 'meditation', logTimestamp: new Date('2026-09-09T13:00:00.000Z') }), // 6:30 PM IST
  ];
  const tieResult = findFamily(deriveBehavioralProfile(twoMorningTwoEvening, TZ, NOW).activities, 'MEDITATION');
  check('DAYPART: 2 morning + 2 evening -> preferredDaypart undefined (evenly split, never arbitrarily resolved by enum order)', tieResult.preferredDaypart === undefined);
  check('DAYPART: the 2+2 tie case still reaches MODERATE affinity from its own 4 observations (independent of the daypart outcome)', tieResult.affinity === 'MODERATE' && tieResult.evidenceCount === 4);

  // Below the evidence-count-3 floor -- never populated even if the 1-2 observations agree.
  const twoAgreeing = [
    makeLog({ activityId: 'meditation', logTimestamp: new Date('2026-09-08T04:00:00.000Z') }),
    makeLog({ activityId: 'meditation', logTimestamp: new Date('2026-09-09T04:00:00.000Z') }),
  ];
  const twoAgreeingResult = findFamily(deriveBehavioralProfile(twoAgreeing, TZ, NOW).activities, 'MEDITATION');
  check('DAYPART: below the 3-observation floor, preferredDaypart is never populated even if the (2) observations agree', twoAgreeingResult.preferredDaypart === undefined);
}

// ============================================================
// TIMEZONE -- the SAME UTC instant classifies into a DIFFERENT daypart
// depending on the caller-supplied timezone (never a raw UTC hour bucket).
// ============================================================
{
  const instant = new Date('2026-09-08T04:00:00.000Z'); // 9:30 AM IST, but 12:00 AM America/New_York (EDT, UTC-4)
  const logs = Array.from({ length: 3 }, () => makeLog({ activityId: 'meditation', logTimestamp: instant }));
  const istResult = findFamily(deriveBehavioralProfile(logs, 'Asia/Kolkata', NOW).activities, 'MEDITATION');
  const nyResult = findFamily(deriveBehavioralProfile(logs, 'America/New_York', NOW).activities, 'MEDITATION');
  check('TIMEZONE: identical UTC instants classify as MORNING in Asia/Kolkata', istResult.preferredDaypart === 'MORNING');
  check('TIMEZONE: the SAME instants classify as NIGHT in America/New_York (never a raw UTC-hour bucket)', nyResult.preferredDaypart === 'NIGHT');
}

// ============================================================
// DST -- a real 2026 America/New_York spring-forward transition
// (2026-03-08) must not break daypart classification. Mirrors
// test/insightsTimezoneNormalization.test.ts's own real DST dates --
// this module composes toInsightsObservation()'s own already-DST-safe
// primitives, so this proves composition, not DST math itself.
// ============================================================
{
  const beforeSpringForward = new Date('2026-03-08T11:00:00.000Z'); // 6:00 AM EST (UTC-5, before 2:00 AM local spring-forward)
  const afterSpringForward = new Date('2026-03-08T14:00:00.000Z'); // 10:00 AM EDT (UTC-4, after spring-forward)
  const now = new Date('2026-03-15T00:00:00.000Z');
  const logs = [
    makeLog({ activityId: 'meditation', logTimestamp: beforeSpringForward }),
    makeLog({ activityId: 'meditation', logTimestamp: afterSpringForward }),
    makeLog({ activityId: 'meditation', logTimestamp: new Date('2026-03-09T13:00:00.000Z') }), // 9:00 AM EDT the next day
  ];
  const result = findFamily(deriveBehavioralProfile(logs, 'America/New_York', now).activities, 'MEDITATION');
  check('DST: three real observations spanning a spring-forward transition all classify MORNING, no DST-induced misclassification', result.preferredDaypart === 'MORNING' && result.evidenceCount === 3);
}

// ============================================================
// DURATION -- <3 valid durations -> undefined; 3 consistent -> median;
// widely varying -> undefined; invalid values excluded.
// ============================================================
{
  const twoDurations = [
    makeLog({ activityId: 'workout', durationMinutes: 30 }),
    makeLog({ activityId: 'workout', durationMinutes: 30 }),
  ];
  const twoResult = findFamily(deriveBehavioralProfile(twoDurations, TZ, NOW).activities, 'WORKOUT');
  check('DURATION: 2 observations (below the floor) -> typicalDurationMinutes undefined', twoResult.typicalDurationMinutes === undefined);

  const threeConsistent = [
    makeLog({ activityId: 'workout', durationMinutes: 30 }),
    makeLog({ activityId: 'workout', durationMinutes: 35 }),
    makeLog({ activityId: 'workout', durationMinutes: 40 }),
  ];
  const consistentResult = findFamily(deriveBehavioralProfile(threeConsistent, TZ, NOW).activities, 'WORKOUT');
  check('DURATION: 3 consistent durations (30/35/40, within 30 min) -> typicalDurationMinutes is the median (35)', consistentResult.typicalDurationMinutes === 35);

  const widelyVarying = [
    makeLog({ activityId: 'workout', durationMinutes: 15 }),
    makeLog({ activityId: 'workout', durationMinutes: 60 }),
    makeLog({ activityId: 'workout', durationMinutes: 120 }),
  ];
  const varyingResult = findFamily(deriveBehavioralProfile(widelyVarying, TZ, NOW).activities, 'WORKOUT');
  check('DURATION: widely varying durations (max-min > 30) -> typicalDurationMinutes undefined, never a false-precision average', varyingResult.typicalDurationMinutes === undefined);

  const withInvalid = [
    makeLog({ activityId: 'workout', durationMinutes: 30 }),
    makeLog({ activityId: 'workout', durationMinutes: 0 }),
    makeLog({ activityId: 'workout', durationMinutes: -10 }),
    makeLog({ activityId: 'workout', durationMinutes: 35 }),
  ];
  const invalidResult = findFamily(deriveBehavioralProfile(withInvalid, TZ, NOW).activities, 'WORKOUT');
  check('DURATION: 0/negative durations are excluded, leaving only 2 valid ones (below the floor) -> undefined', invalidResult.typicalDurationMinutes === undefined && invalidResult.evidenceCount === 4);

  // Even-count median (4 observations, within the 30-minute consistency
  // window: max-min = 50-20 = 30) -- the mathematically standard average
  // of the two middle values, exercising the branch the 3-value case above
  // (odd count, a single middle value) never reaches.
  const fourEvenSpread = [
    makeLog({ activityId: 'workout', durationMinutes: 20 }),
    makeLog({ activityId: 'workout', durationMinutes: 30 }),
    makeLog({ activityId: 'workout', durationMinutes: 40 }),
    makeLog({ activityId: 'workout', durationMinutes: 50 }),
  ];
  const evenResult = findFamily(deriveBehavioralProfile(fourEvenSpread, TZ, NOW).activities, 'WORKOUT');
  check('DURATION (even count): 20/30/40/50 -> median (30+40)/2 = 35, the standard average of the two middle values', evenResult.typicalDurationMinutes === 35);

  // Exact consistency-window boundary: max-min = 30 is inclusive (still
  // populated); max-min = 31 crosses over to undefined.
  const exactlyThirtySpread = [
    makeLog({ activityId: 'workout', durationMinutes: 30 }),
    makeLog({ activityId: 'workout', durationMinutes: 45 }),
    makeLog({ activityId: 'workout', durationMinutes: 60 }),
  ];
  const exactlyThirtyResult = findFamily(deriveBehavioralProfile(exactlyThirtySpread, TZ, NOW).activities, 'WORKOUT');
  check('DURATION CONSISTENCY BOUNDARY: max-min exactly 30 -> still populated (inclusive), median 45', exactlyThirtyResult.typicalDurationMinutes === 45);

  const thirtyOneSpread = [
    makeLog({ activityId: 'workout', durationMinutes: 30 }),
    makeLog({ activityId: 'workout', durationMinutes: 45 }),
    makeLog({ activityId: 'workout', durationMinutes: 61 }),
  ];
  const thirtyOneResult = findFamily(deriveBehavioralProfile(thirtyOneSpread, TZ, NOW).activities, 'WORKOUT');
  check('DURATION CONSISTENCY BOUNDARY: max-min exactly 31 -> undefined (just over the inclusive floor)', thirtyOneResult.typicalDurationMinutes === undefined);
}

// ============================================================
// AFFINITY / DAYPART / DURATION INDEPENDENCE -- affinity depends ONLY on
// evidenceCount. It must reach STRONG even when preferredDaypart AND
// typicalDurationMinutes both stay undefined because the SAME 5
// observations are inconsistent on both axes -- proving the three fields
// are computed independently, not gated on each other.
// ============================================================
{
  const inconsistentButFrequent = [
    makeLog({ activityId: 'workout', logTimestamp: new Date('2026-09-05T02:00:00.000Z'), durationMinutes: 15 }),  // 7:30 AM IST -> MORNING
    makeLog({ activityId: 'workout', logTimestamp: new Date('2026-09-06T09:00:00.000Z'), durationMinutes: 120 }), // 2:30 PM IST -> AFTERNOON
    makeLog({ activityId: 'workout', logTimestamp: new Date('2026-09-07T13:00:00.000Z'), durationMinutes: 45 }),  // 6:30 PM IST -> EVENING
    makeLog({ activityId: 'workout', logTimestamp: new Date('2026-09-08T18:00:00.000Z'), durationMinutes: 200 }), // 11:30 PM IST -> NIGHT
    makeLog({ activityId: 'workout', logTimestamp: new Date('2026-09-09T02:00:00.000Z'), durationMinutes: 10 }),  // 7:30 AM IST -> MORNING
  ];
  const result = findFamily(deriveBehavioralProfile(inconsistentButFrequent, TZ, NOW).activities, 'WORKOUT');
  check('INDEPENDENCE: 5 completions spanning all four dayparts and wildly varying durations still reach STRONG', result.affinity === 'STRONG' && result.evidenceCount === 5);
  check('INDEPENDENCE: preferredDaypart stays undefined (no daypart reaches 2/3) even though affinity is STRONG', result.preferredDaypart === undefined);
  check('INDEPENDENCE: typicalDurationMinutes stays undefined (durations span far more than 30 min) even though affinity is STRONG', result.typicalDurationMinutes === undefined);
}

// ============================================================
// DETERMINISM + ORDERING INDEPENDENCE -- shuffled input rows must
// produce an identical result.
// ============================================================
{
  const logs = [
    makeLog({ activityId: 'workout', logTimestamp: new Date('2026-09-01T04:00:00.000Z'), durationMinutes: 30 }),
    makeLog({ activityId: 'workout', logTimestamp: new Date('2026-09-03T04:00:00.000Z'), durationMinutes: 35 }),
    makeLog({ activityId: 'workout', logTimestamp: new Date('2026-09-05T04:00:00.000Z'), durationMinutes: 40 }),
    makeLog({ activityId: 'deep-work', logTimestamp: new Date('2026-09-06T09:00:00.000Z') }),
    makeLog({ activityId: null }),
  ];
  const shuffled = [logs[4], logs[1], logs[3], logs[0], logs[2]];

  const a = deriveBehavioralProfile(logs, TZ, NOW);
  const b = deriveBehavioralProfile(shuffled, TZ, NOW);
  check('DETERMINISM: original order and a shuffled copy produce byte-identical output', JSON.stringify(a) === JSON.stringify(b));
}

// ============================================================
// IMMUTABILITY -- the input array/rows must never be mutated.
// ============================================================
{
  const logs = [makeLog({ activityId: 'workout' }), makeLog({ activityId: 'deep-work' })];
  const snapshot = JSON.parse(JSON.stringify(logs));
  deriveBehavioralProfile(logs, TZ, NOW);
  check('IMMUTABILITY: the input habitLogs array is unchanged after derivation', JSON.stringify(logs) === JSON.stringify(snapshot));
  check('IMMUTABILITY: input array length is unchanged (never spliced/pushed into)', logs.length === 2);
}

if (!allPassed) {
  console.error('\nSome Behavioral Affinity (pure) checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL BEHAVIORAL AFFINITY (PURE) CHECKS PASSED');
}
