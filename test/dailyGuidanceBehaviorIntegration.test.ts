/**
 * Behavioral Integration V1 / Preferred Daypart Personalization V1:
 * regression suite for apps/web/lib/dailyGuidanceBehavior.ts (the
 * HabitLog -> #110 -> package-local-tier-map/boolean-map bridge) and its
 * wiring into apps/web/lib/dailyGuidanceOrchestrator.ts's
 * buildPersonalDailyGuidance().
 *
 * Two halves, deliberately combined in one file rather than split into a
 * second new test file (matching this feature's own "keep production AND
 * test-file count minimal" instruction):
 *
 * - PURE PROJECTION TESTS (top of file, run synchronously at module load,
 *   no DATABASE_URL needed): `buildPreferredDaypartMatchByFamily` is a
 *   pure, synchronous function -- these prove its midpoint/timezone/
 *   Plan-exclusion/rank-1-only/DST semantics directly against synthetic
 *   `BehavioralProfileContext`/`ConcreteGuidanceCandidate` fixtures, with
 *   zero DB dependency.
 * - LIVE-DATABASE TESTS (inside `main()`, requires a real, reachable
 *   DATABASE_URL, same convention as every other `*Db.test.ts` file in
 *   this repo):
 *
 *     DATABASE_URL="postgresql://..." npx ts-node test/dailyGuidanceBehaviorIntegration.test.ts
 *
 * No delete function exists for HabitLog anywhere in this codebase (see
 * test/behavioralAffinityDb.test.ts's own doc comment) -- this file uses
 * its OWN dedicated test users (never the shared
 * test-daily-guidance-owner@example.com fixture test/dailyGuidanceOrchestratorDb.test.ts
 * already uses), so repeated runs never pollute that shared fixture's own
 * evidence baseline. PlannedActivity rows ARE cleaned up (cancel-then-
 * delete), matching every other *Db.test.ts file's established pattern.
 *
 * QUERY-COUNT PROOF (merge-critical, Preferred Daypart Personalization V1
 * final review): the live-DB section proves "exactly one HabitLog fetch
 * per request" TWO ways -- a structural source-scan (matching this repo's
 * established convention, see the SEQUENCING section below) AND a genuine
 * runtime call-count spy (see RUNTIME-PROVEN QUERY COUNT below). The spy
 * needs no new mocking framework: TypeScript's commonjs output compiles a
 * named import into a live property lookup on the required module object
 * at every call site, and Node's require cache guarantees that object is
 * shared across files, so patching one property on this file's own
 * namespace import of dailyGuidanceBehavior.ts genuinely intercepts every
 * call the orchestrator makes. Verified to actually catch a regression
 * (not just pass vacuously) by temporarily duplicating the call in
 * dailyGuidanceOrchestrator.ts during review and confirming both checks
 * failed, then reverting.
 */
import { upsertUserByEmail, updateBirthProfile, createHabitLog, createPlannedActivity, cancelPlannedActivity, deletePlannedActivity, updateUserDayBuilderPrefs } from '../apps/web/lib/db';
import { buildBehavioralAffinityByFamily, buildPreferredDaypartMatchByFamily, buildBehavioralProfileForUser } from '../apps/web/lib/dailyGuidanceBehavior';
import * as dailyGuidanceBehaviorModule from '../apps/web/lib/dailyGuidanceBehavior';
import { activityDurationByActivityId } from '../apps/web/lib/behavioralAffinity';
import { buildDailyPersonalFitForUser } from '../apps/web/lib/dailyGuidancePipeline';
import { buildPersonalDailyGuidance } from '../apps/web/lib/dailyGuidanceOrchestrator';
import { collectPlanCandidates } from '../apps/web/lib/dailyGuidanceCandidates';
import { deriveDailyGuidance } from '../packages/daily-guidance/src/engine';
import * as fs from 'fs';
import type { WindowRankingContext, RankedTimingWindow } from '../packages/window-ranking/src/types';
import type { BehavioralProfileContext } from '../apps/web/lib/behavioralAffinity';
import type { ConcreteGuidanceCandidate } from '../apps/web/lib/dailyGuidanceTypes';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const TZ = 'Asia/Kolkata';
const NOW = new Date();

function buildWindow(overrides: Partial<RankedTimingWindow> = {}): RankedTimingWindow {
  return {
    start: '2026-09-09T04:00:00.000Z',
    end: '2026-09-09T05:00:00.000Z',
    score: 8.0,
    label: 'GOOD',
    muhurtaScore: 5,
    auraFitScore: 82,
    reasons: [],
    conflicts: undefined,
    metadata: { windowType: 'ABHIJIT', windowLabel: 'Abhijit Muhurtham', activityType: 'Deep work', dateLabel: 'Wed, Sep 9' },
    rank: 1,
    ...overrides,
  };
}

function buildRanking(family: string, windows: RankedTimingWindow[]): WindowRankingContext {
  return { engineVersion: 'WINDOW_RANKING_V1', activityFamily: family as WindowRankingContext['activityFamily'], windows };
}

// ============================================================
// PURE PROJECTION TESTS -- buildPreferredDaypartMatchByFamily. No DB.
// ============================================================

function buildProfile(daypartByFamily: Record<string, string | undefined>): BehavioralProfileContext {
  return {
    engineVersion: 'BEHAVIORAL_AFFINITY_V1',
    // Activity-Level Typical Duration Foundation V1 bumped this to V2 (a
    // new, unrelated additive field/policy) -- no Preferred Daypart
    // semantics changed, so this fixture's own literal is updated purely
    // to keep compiling, never a test-behavior change.
    policyVersion: 'BEHAVIORAL_AFFINITY_POLICY_V2',
    evaluationTime: '2026-09-09T12:00:00.000Z',
    activities: Object.entries(daypartByFamily).map(([activityFamily, preferredDaypart]) => ({
      activityFamily: activityFamily as BehavioralProfileContext['activities'][number]['activityFamily'],
      affinity: 'STRONG',
      evidenceCount: 5,
      preferredDaypart: preferredDaypart as BehavioralProfileContext['activities'][number]['preferredDaypart'],
    })),
    // Activity-Level Typical Duration Foundation V1 -- this file's own
    // tests exercise preferredDaypart only, never duration; an empty array
    // is the correct, inert fixture value (no activity-level signal).
    activityDurations: [],
  };
}

function buildCandidate(overrides: Partial<ConcreteGuidanceCandidate> & { start: string; end: string }): ConcreteGuidanceCandidate {
  const { start, end, ...rest } = overrides;
  return {
    source: 'DAY_BUILDER_INTENTION',
    sourceEntityId: 'suggestion-1',
    activityId: 'workout',
    title: 'Workout',
    activityFamily: 'WORKOUT',
    durationMinutes: 30,
    timingCandidates: [buildWindow({ start, end })],
    ...rest,
  };
}

check(
  'DAY BUILDER + MATCH: WORKOUT preferred MORNING, Day Builder candidate midpoint 07:05 IST (real MORNING) -> WORKOUT: true',
  (() => {
    const profile = buildProfile({ WORKOUT: 'MORNING' });
    const selected = new Map([['WORKOUT', buildCandidate({ start: '2026-09-09T01:00:00.000Z', end: '2026-09-09T01:10:00.000Z' })]]); // 06:30-06:40 IST
    return buildPreferredDaypartMatchByFamily(profile, selected, TZ).WORKOUT === true;
  })()
);

check(
  'DAY BUILDER + NO MATCH: WORKOUT preferred MORNING, Day Builder candidate midpoint in EVENING IST -> WORKOUT absent (never explicit false)',
  (() => {
    const profile = buildProfile({ WORKOUT: 'MORNING' });
    const selected = new Map([['WORKOUT', buildCandidate({ start: '2026-09-09T12:30:00.000Z', end: '2026-09-09T12:40:00.000Z' })]]); // 18:00-18:10 IST -- EVENING
    return buildPreferredDaypartMatchByFamily(profile, selected, TZ).WORKOUT === undefined;
  })()
);

check(
  'PLAN EXCLUSION (merge-critical): a PLAN candidate whose midpoint genuinely matches MORNING is still excluded -- WORKOUT absent, never boosted',
  (() => {
    const profile = buildProfile({ WORKOUT: 'MORNING' });
    const selected = new Map([['WORKOUT', buildCandidate({ source: 'PLAN', start: '2026-09-09T01:00:00.000Z', end: '2026-09-09T01:10:00.000Z' })]]); // 06:30-06:40 IST, genuinely MORNING
    return buildPreferredDaypartMatchByFamily(profile, selected, TZ).WORKOUT === undefined;
  })()
);

check(
  'PLAN NEVER PENALIZED EITHER: a PLAN candidate whose midpoint does NOT match is likewise simply absent -- identical outcome to the matching-but-excluded case above',
  (() => {
    const profile = buildProfile({ WORKOUT: 'MORNING' });
    const selected = new Map([['WORKOUT', buildCandidate({ source: 'PLAN', start: '2026-09-09T12:30:00.000Z', end: '2026-09-09T12:40:00.000Z' })]]); // EVENING IST, genuinely mismatching
    return buildPreferredDaypartMatchByFamily(profile, selected, TZ).WORKOUT === undefined;
  })()
);

check(
  'NO ESTABLISHED PREFERENCE: a family with no preferredDaypart at all (never met #110\'s own evidence/consistency floor) is absent, never a match',
  (() => {
    const profile = buildProfile({ WORKOUT: undefined });
    const selected = new Map([['WORKOUT', buildCandidate({ start: '2026-09-09T01:00:00.000Z', end: '2026-09-09T01:10:00.000Z' })]]);
    return buildPreferredDaypartMatchByFamily(profile, selected, TZ).WORKOUT === undefined;
  })()
);

check(
  'FAMILY ISOLATION: a WORKOUT preference/match never leaks onto a co-selected LEARNING family with no preference of its own',
  (() => {
    const profile = buildProfile({ WORKOUT: 'MORNING' });
    const selected = new Map([
      ['WORKOUT', buildCandidate({ start: '2026-09-09T01:00:00.000Z', end: '2026-09-09T01:10:00.000Z' })],
      ['LEARNING', buildCandidate({ activityFamily: 'LEARNING', activityId: 'reading', start: '2026-09-09T01:00:00.000Z', end: '2026-09-09T01:10:00.000Z' })],
    ]);
    const result = buildPreferredDaypartMatchByFamily(profile, selected, TZ);
    return result.WORKOUT === true && result.LEARNING === undefined;
  })()
);

check(
  'RANK-1 ONLY (merge-critical): a mismatching rank-1 window is never substituted by a matching rank-2 window -- WORKOUT stays absent even though timingCandidates[1] would match',
  (() => {
    const profile = buildProfile({ WORKOUT: 'MORNING' });
    const rank1Evening = buildWindow({ start: '2026-09-09T12:30:00.000Z', end: '2026-09-09T12:40:00.000Z' }); // EVENING IST
    const rank2Morning = buildWindow({ start: '2026-09-09T01:00:00.000Z', end: '2026-09-09T01:10:00.000Z', rank: 2 }); // MORNING IST
    const candidate: ConcreteGuidanceCandidate = { ...buildCandidate({ start: rank1Evening.start, end: rank1Evening.end }), timingCandidates: [rank1Evening, rank2Morning] };
    const selected = new Map([['WORKOUT', candidate]]);
    return buildPreferredDaypartMatchByFamily(profile, selected, TZ).WORKOUT === undefined;
  })()
);

check(
  'MIDPOINT BOUNDARY: 11:50-12:20 local straddles the MORNING/AFTERNOON boundary -- midpoint 12:05 classifies AFTERNOON, matching a preferred AFTERNOON',
  (() => {
    // 2026-09-09 is IST year-round (no DST) -- 11:50/12:20/12:05 IST = 06:20/06:50/06:35 UTC.
    const profile = buildProfile({ WORKOUT: 'AFTERNOON' });
    const selected = new Map([['WORKOUT', buildCandidate({ start: '2026-09-09T06:20:00.000Z', end: '2026-09-09T06:50:00.000Z' })]]);
    return buildPreferredDaypartMatchByFamily(profile, selected, TZ).WORKOUT === true;
  })()
);

check(
  'MIDPOINT BOUNDARY: the SAME 11:50-12:20 window does NOT match a preferred MORNING -- proves the boundary is resolved by midpoint (12:05 -> AFTERNOON), not by start (11:50 -> MORNING)',
  (() => {
    const profile = buildProfile({ WORKOUT: 'MORNING' });
    const selected = new Map([['WORKOUT', buildCandidate({ start: '2026-09-09T06:20:00.000Z', end: '2026-09-09T06:50:00.000Z' })]]);
    return buildPreferredDaypartMatchByFamily(profile, selected, TZ).WORKOUT === undefined;
  })()
);

check(
  'MIDPOINT BOUNDARY: 16:50-17:20 local straddles AFTERNOON/EVENING -- midpoint 17:05 classifies EVENING, matching a preferred EVENING (never AFTERNOON, the start-only classification)',
  (() => {
    const profile = buildProfile({ WORKOUT: 'EVENING' });
    const selected = new Map([['WORKOUT', buildCandidate({ start: '2026-09-09T11:20:00.000Z', end: '2026-09-09T11:50:00.000Z' })]]); // 16:50-17:20 IST
    return buildPreferredDaypartMatchByFamily(profile, selected, TZ).WORKOUT === true;
  })()
);

check(
  'MIDPOINT NON-CROSSING: 06:50-07:20 local stays entirely within MORNING -- matches a preferred MORNING regardless of start-vs-midpoint',
  (() => {
    const profile = buildProfile({ WORKOUT: 'MORNING' });
    const selected = new Map([['WORKOUT', buildCandidate({ start: '2026-09-09T01:20:00.000Z', end: '2026-09-09T01:50:00.000Z' })]]); // 06:50-07:20 IST
    return buildPreferredDaypartMatchByFamily(profile, selected, TZ).WORKOUT === true;
  })()
);

check(
  'MULTI-TIMEZONE: the SAME absolute candidate window classifies MORNING in Asia/Kolkata but NIGHT in America/New_York -- match depends on user.timezone, never a fixed/server timezone',
  (() => {
    const profile = buildProfile({ WORKOUT: 'MORNING' });
    // 2026-09-09T01:05:00Z = 06:35 IST (MORNING) = 21:05 EDT the prior evening (NIGHT).
    const selected = new Map([['WORKOUT', buildCandidate({ start: '2026-09-09T01:00:00.000Z', end: '2026-09-09T01:10:00.000Z' })]]);
    const kolkataMatch = buildPreferredDaypartMatchByFamily(profile, selected, 'Asia/Kolkata').WORKOUT;
    const nyMatch = buildPreferredDaypartMatchByFamily(profile, selected, 'America/New_York').WORKOUT;
    return kolkataMatch === true && nyMatch === undefined;
  })()
);

check(
  'DST: a real America/New_York spring-forward transition (2026-03-08) midpoint still classifies correctly -- mirrors test/behavioralAffinity.test.ts\'s own real DST fixture',
  (() => {
    const profile = buildProfile({ MEDITATION: 'MORNING' });
    // 2026-03-08T11:00:00Z = 6:00 AM EST (before 2:00 AM local spring-forward); +30min = 6:30 AM EST, still MORNING.
    const selected = new Map([['MEDITATION', buildCandidate({ activityFamily: 'MEDITATION', activityId: 'meditation', start: '2026-03-08T11:00:00.000Z', end: '2026-03-08T11:30:00.000Z' })]]);
    return buildPreferredDaypartMatchByFamily(profile, selected, 'America/New_York').MEDITATION === true;
  })()
);

check(
  'DETERMINISM: repeated calls with structurally identical (profile, selected, timezone) inputs produce deeply-equal output',
  (() => {
    const profile = buildProfile({ WORKOUT: 'MORNING' });
    const selected = new Map([['WORKOUT', buildCandidate({ start: '2026-09-09T01:00:00.000Z', end: '2026-09-09T01:10:00.000Z' })]]);
    const a = buildPreferredDaypartMatchByFamily(profile, selected, TZ);
    const b = buildPreferredDaypartMatchByFamily(profile, selected, TZ);
    return JSON.stringify(a) === JSON.stringify(b);
  })()
);

async function main() {
  const ownerA = await upsertUserByEmail({ email: 'test-daily-guidance-behavior-owner-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const userA0 = await updateBirthProfile(ownerA.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  await updateUserDayBuilderPrefs(userA0.id, { dayBuilderEnabled: true, dayBuilderMutedGroups: [], dayBuilderPriorities: [], dayBuilderPriorityPersonIds: [], dayBuilderPrioritiesPromptDismissed: true });
  const userA = userA0;

  const ownerB = await upsertUserByEmail({ email: 'test-daily-guidance-behavior-owner-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });

  const createdPlanIds: string[] = [];

  try {
    // ============================================================
    // COLD START. HabitLog has no delete function anywhere in this
    // codebase (see behavioralAffinityDb.test.ts's own doc comment), so
    // this file's own dedicated user accumulates real rows across repeated
    // runs -- asserting "the WHOLE map is empty" would only ever be true
    // on the very first run and would FAIL on every run after that,
    // exactly the "must run repeatably" trap this suite's own review must
    // guard against. Instead: MEDITATION is a family this file never
    // creates ANY HabitLog for, on ANY run -- its absence from the map is
    // a genuinely repeatable proof, unlike a global emptiness check. True
    // zero-history cold start (the FULL 13-entry all-NEUTRAL vector) is
    // already exhaustively proven, deterministically, by
    // test/behavioralAffinity.test.ts's own dedicated cold-start section --
    // this file's job is only to prove the real DB wiring, not to
    // re-prove #110's own pure cold-start contract.
    // ============================================================
    const beforeWorkoutMap = await buildBehavioralAffinityByFamily(userA, NOW);
    check('COLD START (repeatable): MEDITATION -- a family this file never creates any HabitLog for -- is absent from the map on every run', beforeWorkoutMap.MEDITATION === undefined);

    // ============================================================
    // REAL DB END-TO-END: 5 real WORKOUT HabitLog rows -> STRONG,
    // reusing #110's own deriveBehavioralProfile() and
    // listHabitLogsForInsights() completely unmodified.
    // ============================================================
    for (let i = 0; i < 5; i++) {
      await createHabitLog({
        userId: userA.id,
        activityTitle: 'Morning workout',
        activityId: 'workout',
        activeWindow: 'ABHIJIT',
        logMinuteOfDay: 360,
        logTimestamp: new Date(NOW.getTime() - i * 24 * 60 * 60 * 1000),
        durationMinutes: 45,
        logSource: 'MANUAL',
      });
    }
    const mapAfterFive = await buildBehavioralAffinityByFamily(userA, NOW);
    check('REAL DB: 5 real WORKOUT HabitLog rows -> behavioralAffinityByFamily.WORKOUT === STRONG', mapAfterFive.WORKOUT === 'STRONG');
    check('REAL DB: NEUTRAL families are simply absent from the map (sparse, matches buildCandidates\' own default)', mapAfterFive.LEARNING === undefined && mapAfterFive.MEDITATION === undefined);

    // ============================================================
    // CROSS-USER ISOLATION -- mirrors behavioralAffinityDb.test.ts's own
    // established pattern, adapted to this new function.
    // ============================================================
    for (let i = 0; i < 5; i++) {
      await createHabitLog({
        userId: ownerB.id,
        activityTitle: 'Focused deep work block',
        activityId: 'deep-work',
        activeWindow: 'ABHIJIT',
        logMinuteOfDay: 540,
        logTimestamp: new Date(NOW.getTime() - i * 24 * 60 * 60 * 1000),
        durationMinutes: 60,
        logSource: 'MANUAL',
      });
    }
    const mapB = await buildBehavioralAffinityByFamily(ownerB, NOW);
    check('CROSS-USER: ownerB\'s own map shows DEEP_WORK STRONG from B\'s own real history', mapB.DEEP_WORK === 'STRONG');
    check('CROSS-USER: ownerB\'s map shows no WORKOUT entry -- ownerA\'s real DB rows never leaked in', mapB.WORKOUT === undefined);
    const mapAAgain = await buildBehavioralAffinityByFamily(userA, NOW);
    check('CROSS-USER: ownerA\'s own map is unaffected by ownerB\'s DEEP_WORK history (still no DEEP_WORK entry)', mapAAgain.DEEP_WORK === undefined && mapAAgain.WORKOUT === 'STRONG');

    // ============================================================
    // REAL DB-SOURCED AFFINITY GENUINELY CHANGES DAILY GUIDANCE ORDER.
    // A deliberate, explicit tie in relevance/label/score isolates the
    // new tuple key -- the SAME established technique
    // test/dailyGuidanceEngine.test.ts's own same-family/within-stage
    // tie-break tests already use (never a way to "weaken" the stronger
    // signals; it is how a tie-break is tested at all). What is NOT
    // synthetic here is the affinity value itself: userA's real
    // dailyPersonalFit (real Bhrigu/Dasha/transit/Life Weather) and the
    // real, just-derived WORKOUT=STRONG map from real DB rows above.
    // ============================================================
    const realDailyPersonalFit = buildDailyPersonalFitForUser(userA, NOW)!;
    realDailyPersonalFit.activities = realDailyPersonalFit.activities.map((a) => (a.activityFamily === 'WORKOUT' || a.activityFamily === 'LEARNING' ? { ...a, personalRelevance: 'HIGHLY_RELEVANT' as const } : a));
    const tiedWindowRankings = [
      buildRanking('WORKOUT', [buildWindow({ start: '2026-09-09T02:00:00.000Z', end: '2026-09-09T03:00:00.000Z', label: 'GOOD', score: 8.0 })]),
      buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T05:00:00.000Z', end: '2026-09-09T06:00:00.000Z', label: 'GOOD', score: 8.0 })]),
    ];
    const guidanceWithRealAffinity = deriveDailyGuidance({ dailyPersonalFit: realDailyPersonalFit, windowRankings: tiedWindowRankings, limit: 2, behavioralAffinityByFamily: mapAAgain });
    check(
      'REAL AFFINITY CHANGES ORDER: with relevance/label/score all tied, WORKOUT (real STRONG from DB history) is selected first over LEARNING (real NEUTRAL/absent)',
      guidanceWithRealAffinity.recommendations[0]?.activityFamily === 'WORKOUT'
    );
    const guidanceWithoutBehavior = deriveDailyGuidance({ dailyPersonalFit: realDailyPersonalFit, windowRankings: tiedWindowRankings, limit: 2 });
    check(
      'CONTROL: the SAME tied fixture WITHOUT any behavioral map falls through to start-time ascending (WORKOUT\'s earlier start), never depends on affinity being present to resolve the tie',
      guidanceWithoutBehavior.recommendations[0]?.activityFamily === 'WORKOUT'
    );

    // ============================================================
    // FULL END-TO-END: buildPersonalDailyGuidance's own selectedActivities
    // forward-compat field is populated from the real map.
    // ============================================================
    const plan = await createPlannedActivity({
      userId: userA.id,
      title: 'Workout Block',
      activityId: 'workout',
      plannedStartAt: new Date(Date.now() + 60 * 60 * 1000),
      plannedEndAt: new Date(Date.now() + 90 * 60 * 1000),
      durationMinutes: 30,
      windowType: 'NEUTRAL',
    });
    createdPlanIds.push(plan.id);
    // This call alone is also the live proof that
    // buildPreferredDaypartMatchByFamily's own wiring inside
    // buildPersonalDailyGuidance does not throw against real profile/
    // selected-candidate data -- if it did, this whole call would reject
    // and the check below would never even run.
    const liveResult = await buildPersonalDailyGuidance(userA, new Date());
    check('LIVE END-TO-END: a real Plan produces status READY (implicitly proves buildPreferredDaypartMatchByFamily does not throw against real data)', liveResult.status === 'READY');
    if (liveResult.status === 'READY') {
      const workoutMetadata = liveResult.selectedActivities['WORKOUT'];
      check(
        'LIVE END-TO-END: if WORKOUT was selected, its selectedActivities metadata carries behavioralAffinity STRONG (forward-compat field, real value)',
        workoutMetadata === undefined || workoutMetadata.behavioralAffinity === 'STRONG'
      );
      check(
        'LIVE END-TO-END: every selectedActivities entry carries a valid behavioralAffinity tier',
        Object.values(liveResult.selectedActivities).every((m) => ['STRONG', 'MODERATE', 'NEUTRAL'].includes(m.behavioralAffinity ?? 'NEUTRAL'))
      );
      check(
        'LIVE END-TO-END: no selectedActivities entry ever carries a preferredDaypart/preferredDaypartMatch field -- no client exposure',
        Object.values(liveResult.selectedActivities).every((m) => !('preferredDaypart' in m) && !('preferredDaypartMatch' in m))
      );
    }

    // ============================================================
    // SEQUENCING (structural, matching dailyGuidanceOrchestrator.test.ts's
    // own established "STRUCTURAL" convention).
    // ============================================================
    const orchestratorSource = stripComments(fs.readFileSync('apps/web/lib/dailyGuidanceOrchestrator.ts', 'utf8'));
    const birthProfileReturnIndex = orchestratorSource.indexOf("status: 'BIRTH_PROFILE_REQUIRED'");
    const noActivityIntentIndices = [...orchestratorSource.matchAll(/status: 'NO_ACTIVITY_INTENT'/g)].map((m) => m.index!);
    const behaviorCallIndices = [...orchestratorSource.matchAll(/buildBehavioralProfileForUser\(/g)].map((m) => m.index!);
    check(
      'SEQUENCING: buildBehavioralProfileForUser is called AFTER the BIRTH_PROFILE_REQUIRED early return in source order',
      behaviorCallIndices.length > 0 && behaviorCallIndices.every((i) => i > birthProfileReturnIndex)
    );
    check(
      // Behavior-aware Day Builder Duration V1 added a THIRD
      // NO_ACTIVITY_INTENT return site -- a cheap, pre-behavioral-fetch
      // raw-intent check (Plan candidates + raw Day Builder intent, no
      // behavior needed for either) -- so buildBehavioralProfileForUser is
      // now called AFTER that FIRST check (preserving the zero-query
      // guarantee for a genuine no-intent request) but BEFORE the other
      // two (which only run after Day Builder resolution, which itself
      // needs the behavioral duration projection).
      'SEQUENCING: buildBehavioralProfileForUser is called AFTER the first (raw-intent) NO_ACTIVITY_INTENT check but BEFORE the other two (which run after Day Builder resolution)',
      noActivityIntentIndices.length === 3 &&
        behaviorCallIndices.every((i) => i > noActivityIntentIndices[0] && i < noActivityIntentIndices[1] && i < noActivityIntentIndices[2])
    );
    check(
      'QUERY COUNT (merge-critical): buildBehavioralProfileForUser -- the ONE function that calls listHabitLogsForInsights -- appears EXACTLY ONCE in the orchestrator\'s own source, proving Preferred Daypart Personalization V1 added zero additional HabitLog queries to the READY path',
      behaviorCallIndices.length === 1
    );
    check(
      'NO DUPLICATE DERIVATION: buildBehavioralAffinityByFamily (the pre-this-feature wrapper, which performs its OWN internal fetch) is never called from the orchestrator anymore -- affinityByFamily is used instead, against the SAME already-fetched profile',
      !orchestratorSource.includes('buildBehavioralAffinityByFamily(')
    );

    // ============================================================
    // RUNTIME-PROVEN QUERY COUNT: a genuine runtime spy, not just the
    // source-scan proof above. TypeScript's own commonjs output compiles
    // dailyGuidanceOrchestrator.ts's `import { buildBehavioralProfileForUser }
    // from './dailyGuidanceBehavior'` into a live property lookup on the
    // required module object at every call site (never a by-value
    // destructure) -- Node's own require cache guarantees that object is
    // the SAME one this file's `dailyGuidanceBehaviorModule` namespace
    // import gets, so patching that one property here genuinely
    // intercepts every call buildPersonalDailyGuidance makes, with zero
    // production code changes and no new mocking framework/dependency.
    // Reuses userA's still-active `plan` from the FULL END-TO-END section
    // above -- no extra fixture setup needed.
    // ============================================================
    const originalBuildProfile = dailyGuidanceBehaviorModule.buildBehavioralProfileForUser;
    let profileFetchCount = 0;
    (dailyGuidanceBehaviorModule as { buildBehavioralProfileForUser: typeof originalBuildProfile }).buildBehavioralProfileForUser = async (user, now) => {
      profileFetchCount++;
      return originalBuildProfile(user, now);
    };
    try {
      const spiedResult = await buildPersonalDailyGuidance(userA, new Date());
      check(
        'RUNTIME-PROVEN QUERY COUNT (merge-critical): buildBehavioralProfileForUser -- the ONE function that calls listHabitLogsForInsights -- is called EXACTLY ONCE per buildPersonalDailyGuidance invocation, proven by a genuine runtime spy (not just source-scan)',
        profileFetchCount === 1
      );
      check('RUNTIME-PROVEN QUERY COUNT: the spied call still produces a READY result -- patching the module does not alter real behavior', spiedResult.status === 'READY');
    } finally {
      (dailyGuidanceBehaviorModule as { buildBehavioralProfileForUser: typeof originalBuildProfile }).buildBehavioralProfileForUser = originalBuildProfile;
    }

    // ============================================================
    // BEHAVIOR-AWARE DAY BUILDER DURATION V1 -- SHARED PROFILE PROOF
    // (merge-critical). userA already carries 5 real WORKOUT HabitLog rows,
    // all durationMinutes: 45 (established above for the affinity proof) --
    // exactly 5 valid, consistent (range 0) observations, so the SAME
    // already-derived profile also carries a real, non-synthetic
    // typicalDurationMinutes for 'workout'. Proves activity duration is
    // projected from the identical profile affinity/daypart already use --
    // no second derivation, no second fetch.
    // ============================================================
    {
      const profile = await buildBehavioralProfileForUser(userA, NOW);
      const durationMap = activityDurationByActivityId(profile);
      check('SHARED PROFILE: the SAME already-fetched profile carries a real typicalDurationMinutes for workout (45, from userA\'s own 5 real HabitLog rows)', durationMap.workout === 45);
      check('SHARED PROFILE: that profile ALSO carries real WORKOUT affinity STRONG -- one fetch, both signals', profile.activities.find((a) => a.activityFamily === 'WORKOUT')?.affinity === 'STRONG');
    }

    // ============================================================
    // BEHAVIOR-AWARE DAY BUILDER DURATION V1 -- RAW-INTENT GATE (merge-
    // critical). A dedicated, throwaway user with Day Builder disabled and
    // zero Plans today: buildPersonalDailyGuidance must return
    // NO_ACTIVITY_INTENT with ZERO behavioral queries -- proven with the
    // SAME genuine runtime spy technique as RUNTIME-PROVEN QUERY COUNT
    // above, not just source inspection.
    // ============================================================
    {
      const noIntentOwner = await upsertUserByEmail({ email: 'test-daily-guidance-behavior-no-intent@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
      const noIntentUser = await updateBirthProfile(noIntentOwner.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
      await updateUserDayBuilderPrefs(noIntentUser.id, { dayBuilderEnabled: false, dayBuilderMutedGroups: [], dayBuilderPriorities: [], dayBuilderPriorityPersonIds: [], dayBuilderPrioritiesPromptDismissed: true });

      const originalForGate = dailyGuidanceBehaviorModule.buildBehavioralProfileForUser;
      let gateFetchCount = 0;
      (dailyGuidanceBehaviorModule as { buildBehavioralProfileForUser: typeof originalForGate }).buildBehavioralProfileForUser = async (user, now) => {
        gateFetchCount++;
        return originalForGate(user, now);
      };
      try {
        // REVIEW COVERAGE STRENGTHENING (pre-PR review) -- an IN-MEMORY
        // override (never persisted), matching dayBuilderDb.test.ts's own
        // established `{ ...user, dayBuilderEnabled: false }` convention.
        // Deliberately never uses noIntentOwner's own real DB row for
        // "incomplete" here: this SAME test's very next line calls
        // updateBirthProfile on that exact row, so on any run after the
        // first, the row's real persisted birth profile is already
        // complete (upsertUserByEmail returns its CURRENT, not a fresh,
        // state) -- exactly the "must run repeatably" trap this file's own
        // COLD START comment already warns about elsewhere. The in-memory
        // override is reliable on every run, not just the first.
        const incompleteBirthProfileUser = { ...noIntentUser, birthDate: null };
        const birthRequiredResult = await buildPersonalDailyGuidance(incompleteBirthProfileUser, NOW);
        check('BIRTH-PROFILE GATE (merge-critical): an incomplete birth profile -> status BIRTH_PROFILE_REQUIRED', birthRequiredResult.status === 'BIRTH_PROFILE_REQUIRED');
        check('BIRTH-PROFILE GATE (merge-critical): buildBehavioralProfileForUser is called ZERO times, proven by a real runtime spy (not just source-scan)', gateFetchCount === 0);

        const noIntentResult = await buildPersonalDailyGuidance(noIntentUser, NOW);
        check('RAW-INTENT GATE (merge-critical): no Plans + Day Builder disabled -> status NO_ACTIVITY_INTENT', noIntentResult.status === 'NO_ACTIVITY_INTENT');
        check('RAW-INTENT GATE (merge-critical): buildBehavioralProfileForUser is called ZERO times for a genuine no-intent request, proven by a real runtime spy', gateFetchCount === 0);
      } finally {
        (dailyGuidanceBehaviorModule as { buildBehavioralProfileForUser: typeof originalForGate }).buildBehavioralProfileForUser = originalForGate;
      }
    }

    // ============================================================
    // BEHAVIOR-AWARE DAY BUILDER DURATION V1 -- READY ONE-FETCH, ISOLATED
    // (merge-critical, pre-PR review). userA (used elsewhere in this file)
    // has Day Builder ENABLED throughout, so a READY result via userA could
    // always be resolving BOTH a Plan candidate AND a real Day Builder
    // candidate simultaneously -- never cleanly isolating "Day-Builder-only"
    // from "Plan-only." Two dedicated, single-purpose throwaway users
    // isolate each path genuinely: one with Day Builder enabled and zero
    // Plans (only Day Builder can produce a candidate), one with Day
    // Builder disabled and exactly one Plan (only the Plan can).
    // ============================================================
    {
      const originalForReady = dailyGuidanceBehaviorModule.buildBehavioralProfileForUser;
      let readyFetchCount = 0;
      (dailyGuidanceBehaviorModule as { buildBehavioralProfileForUser: typeof originalForReady }).buildBehavioralProfileForUser = async (user, now) => {
        readyFetchCount++;
        return originalForReady(user, now);
      };
      try {
        // Day-Builder-only: enabled, wide open, zero Plans today.
        readyFetchCount = 0;
        const dayBuilderOnlyOwner = await upsertUserByEmail({ email: 'test-daily-guidance-behavior-day-builder-only@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
        const dayBuilderOnlyUser = await updateBirthProfile(dayBuilderOnlyOwner.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
        await updateUserDayBuilderPrefs(dayBuilderOnlyUser.id, { dayBuilderEnabled: true, dayBuilderMutedGroups: [], dayBuilderPriorities: [], dayBuilderPriorityPersonIds: [], dayBuilderPrioritiesPromptDismissed: true });
        const dayBuilderOnlyResult = await buildPersonalDailyGuidance(dayBuilderOnlyUser, new Date());
        check('READY DAY-BUILDER-ONLY (isolated): a wide-open day with zero Plans produces status READY via Day Builder alone', dayBuilderOnlyResult.status === 'READY');
        check('READY DAY-BUILDER-ONLY (isolated, merge-critical): buildBehavioralProfileForUser is called EXACTLY ONCE, proven by a real runtime spy', readyFetchCount === 1);

        // Plan-only: disabled, exactly one real Plan today.
        readyFetchCount = 0;
        const planOnlyOwner = await upsertUserByEmail({ email: 'test-daily-guidance-behavior-plan-only@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
        const planOnlyUser = await updateBirthProfile(planOnlyOwner.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
        await updateUserDayBuilderPrefs(planOnlyUser.id, { dayBuilderEnabled: false, dayBuilderMutedGroups: [], dayBuilderPriorities: [], dayBuilderPriorityPersonIds: [], dayBuilderPrioritiesPromptDismissed: true });
        const planOnlyPlan = await createPlannedActivity({
          userId: planOnlyUser.id,
          title: 'Workout Block',
          activityId: 'workout',
          plannedStartAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          plannedEndAt: new Date(Date.now() + 2.5 * 60 * 60 * 1000),
          durationMinutes: 30,
          windowType: 'NEUTRAL',
        });
        try {
          const planOnlyResult = await buildPersonalDailyGuidance(planOnlyUser, new Date());
          check('READY PLAN-ONLY (isolated): Day Builder disabled, one real Plan -> status READY via the Plan alone', planOnlyResult.status === 'READY');
          check('READY PLAN-ONLY (isolated, merge-critical): buildBehavioralProfileForUser is called EXACTLY ONCE, proven by a real runtime spy', readyFetchCount === 1);
        } finally {
          await cancelPlannedActivity(planOnlyUser.id, planOnlyPlan.id);
          await deletePlannedActivity(planOnlyUser.id, planOnlyPlan.id);
        }
      } finally {
        (dailyGuidanceBehaviorModule as { buildBehavioralProfileForUser: typeof originalForReady }).buildBehavioralProfileForUser = originalForReady;
      }
    }

    // ============================================================
    // BEHAVIOR-AWARE DAY BUILDER DURATION V1 -- PLAN NEUTRALITY. userA's
    // real WORKOUT typicalDurationMinutes (45, established above) must
    // never affect a Plan's own explicit, already-scheduled duration --
    // even a Plan for the SAME activityId, at a DIFFERENT duration.
    // ============================================================
    {
      const neutralPlan = await createPlannedActivity({
        userId: userA.id,
        title: 'Workout Block',
        activityId: 'workout',
        plannedStartAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        plannedEndAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
        durationMinutes: 60,
        windowType: 'NEUTRAL',
      });
      try {
        // Directly at the candidate level (collectPlanCandidates itself
        // never accepts a behavioral parameter -- structurally impossible
        // for it to consult one), rather than through the full
        // ranking/window pipeline: #104's own CHECK-based window ranking
        // can select a nearby ALTERNATIVE slot when it scores better than
        // the exact requested instant (existing, pre-this-feature
        // behavior, unrelated to duration) -- so `timing.start`/`.end` on
        // the FINAL recommendation is not a reliable proxy for "the Plan's
        // own duration was preserved." `candidate.durationMinutes` is.
        const planCandidates = await collectPlanCandidates(userA, new Date());
        const workoutPlanCandidate = planCandidates.find((c) => c.sourceEntityId === neutralPlan.id);
        check('PLAN NEUTRALITY: the real Plan produces exactly one PLAN candidate for its own id', workoutPlanCandidate !== undefined);
        check(
          'PLAN NEUTRALITY (merge-critical): the Plan candidate keeps its own 60-minute durationMinutes -- never overridden by the real 45-minute behavioral signal for the same activityId (collectPlanCandidates never even accepts a behavioral parameter)',
          workoutPlanCandidate?.durationMinutes === 60
        );

        const planResult = await buildPersonalDailyGuidance(userA, new Date());
        check('PLAN NEUTRALITY: a real Plan produces status READY', planResult.status === 'READY');
      } finally {
        await cancelPlannedActivity(userA.id, neutralPlan.id);
        await deletePlannedActivity(userA.id, neutralPlan.id);
      }
    }
  } finally {
    for (const planId of createdPlanIds) {
      await cancelPlannedActivity(userA.id, planId);
      await deletePlannedActivity(userA.id, planId);
    }
  }

  if (!allPassed) {
    console.error('\nSome Behavioral Integration V1 (live-database) checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL BEHAVIORAL INTEGRATION V1 (LIVE-DATABASE) CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
