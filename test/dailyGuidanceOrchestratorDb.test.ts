/**
 * Live-database tests for Personal Guidance Orchestration V1 -- the full
 * end-to-end buildPersonalDailyGuidance() flow, plus
 * collectPlanCandidates/collectDayBuilderCandidates individually. Requires
 * a real, reachable DATABASE_URL, same convention as dayBuilderDb.test.ts/
 * savedPersonDb.test.ts -- NOT part of ci.yml's math-core-tests job (no
 * Postgres service provisioned there).
 *
 * Run locally with a real DATABASE_URL set:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/dailyGuidanceOrchestratorDb.test.ts
 *
 * Creates one throwaway test user (idempotent via email upsert, given a
 * complete birth profile) and one throwaway PlannedActivity per check
 * that needs one, cleaning up every Plan it creates in a finally block --
 * same convention as dayBuilderDb.test.ts's own SavedPerson cleanup.
 * Leaves the User row in place (same convention).
 */
import { upsertUserByEmail, updateBirthProfile, createPlannedActivity, cancelPlannedActivity, deletePlannedActivity, updateUserDayBuilderPrefs, setDailyWorkPreferences, clearDailyWorkPreferences, getUserById } from '../apps/web/lib/db';
import { buildPersonalDailyGuidance } from '../apps/web/lib/dailyGuidanceOrchestrator';
import { collectPlanCandidates, collectDayBuilderCandidates, preferOutsideWorkForGuidance } from '../apps/web/lib/dailyGuidanceCandidates';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
// A fixed instant on a real day, matching this repo's own established
// fixed-fake-"now" convention for DB tests (see dayBuilderDb.test.ts).
const NOW = new Date('2026-09-09T04:00:00.000Z'); // 9:30 AM IST

async function main() {
  const user0 = await upsertUserByEmail({ email: 'test-daily-guidance-owner@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const user = await updateBirthProfile(user0.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  await updateUserDayBuilderPrefs(user.id, { dayBuilderEnabled: true, dayBuilderMutedGroups: [], dayBuilderPriorities: [], dayBuilderPriorityPersonIds: [], dayBuilderPrioritiesPromptDismissed: true });

  const createdPlanIds: string[] = [];

  try {
    // ============================================================
    // BIRTH_PROFILE_REQUIRED.
    // ============================================================
    const incompleteUser = { ...user, birthDate: null };
    const incompleteResult = await buildPersonalDailyGuidance(incompleteUser, NOW);
    check('BIRTH_PROFILE_REQUIRED: missing birthDate -> status BIRTH_PROFILE_REQUIRED', incompleteResult.status === 'BIRTH_PROFILE_REQUIRED');

    // ============================================================
    // NO_ACTIVITY_INTENT -- complete profile, but no Plans and Day
    // Builder disabled (so it contributes nothing either).
    // ============================================================
    const noIntentUser = { ...user, dayBuilderEnabled: false };
    const noIntentResult = await buildPersonalDailyGuidance(noIntentUser, NOW);
    check('NO_ACTIVITY_INTENT: complete profile, zero Plans today, Day Builder disabled -> status NO_ACTIVITY_INTENT', noIntentResult.status === 'NO_ACTIVITY_INTENT');

    // ============================================================
    // PLAN CANDIDATE COLLECTION.
    // ============================================================
    const plan = await createPlannedActivity({
      userId: user.id,
      title: 'Deep Work Block',
      activityId: 'deep-work',
      plannedStartAt: new Date('2026-09-09T05:00:00.000Z'), // 10:30 AM IST
      plannedEndAt: new Date('2026-09-09T06:00:00.000Z'),
      durationMinutes: 60,
      windowType: 'NEUTRAL',
    });
    createdPlanIds.push(plan.id);

    const planCandidates = await collectPlanCandidates(user, NOW);
    check('PLAN CANDIDATES: an eligible Plan with a resolved activityId produces exactly one candidate', planCandidates.length === 1);
    check('PLAN CANDIDATES: candidate.source is PLAN', planCandidates[0]?.source === 'PLAN');
    check('PLAN CANDIDATES: candidate.activityFamily is derived (DEEP_WORK for deep-work)', planCandidates[0]?.activityFamily === 'DEEP_WORK');
    check('PLAN CANDIDATES: candidate.timingCandidates has exactly one CHECK-evaluated window', planCandidates[0]?.timingCandidates.length === 1);
    check('PLAN CANDIDATES: the CHECK-evaluated window matches the Plan\'s own scheduled instant (never a FIND-searched different time)', planCandidates[0]?.timingCandidates[0]?.start === plan.plannedStartAt.toISOString());

    // ============================================================
    // TITLE-ONLY PLAN EXCLUSION.
    // ============================================================
    const titleOnlyPlan = await createPlannedActivity({
      userId: user.id,
      title: 'Something unresolved',
      activityId: null,
      plannedStartAt: new Date('2026-09-09T07:00:00.000Z'),
      plannedEndAt: new Date('2026-09-09T08:00:00.000Z'),
      durationMinutes: 60,
      windowType: 'NEUTRAL',
    });
    createdPlanIds.push(titleOnlyPlan.id);
    const withTitleOnly = await collectPlanCandidates(user, NOW);
    check('TITLE-ONLY PLAN: a Plan with activityId=null is excluded from candidates (never a guessed family)', withTitleOnly.length === 1 && withTitleOnly.every((c) => c.sourceEntityId !== titleOnlyPlan.id));

    // ============================================================
    // MISSED PLAN EXCLUSION.
    // ============================================================
    const missedPlan = await createPlannedActivity({
      userId: user.id,
      title: 'Already elapsed',
      activityId: 'workout',
      plannedStartAt: new Date('2026-09-09T01:00:00.000Z'), // 6:30 AM IST -- before NOW
      plannedEndAt: new Date('2026-09-09T01:30:00.000Z'),
      durationMinutes: 30,
      windowType: 'BRAHMA',
    });
    createdPlanIds.push(missedPlan.id);
    const withMissed = await collectPlanCandidates(user, NOW);
    check('MISSED PLAN: an elapsed, unlogged Plan is excluded (the identical MISSED rule dailyAgenda.ts uses)', withMissed.every((c) => c.sourceEntityId !== missedPlan.id));

    // ============================================================
    // DAY BUILDER CANDIDATE COLLECTION (SOLO only).
    // ============================================================
    const dayBuilderCandidates = await collectDayBuilderCandidates(user, NOW);
    check('DAY BUILDER CANDIDATES: every returned candidate has a non-empty activityId', dayBuilderCandidates.every((c) => c.activityId.length > 0));
    check('DAY BUILDER CANDIDATES: every returned candidate has at least one timing candidate reused from Day Builder\'s own FIND result', dayBuilderCandidates.every((c) => c.timingCandidates.length > 0));

    // ============================================================
    // HOME RECOMMENDATIONS: DAILY RHYTHM ALIGNMENT -- real, live Day
    // Builder suggestion (muted to only the SELF taxonomy group, which
    // resolves deterministically to a 'workout' SOLO suggestion with 3
    // real FIND-searched timing candidates for this fixed user+now) is
    // genuinely reordered/filtered by the real, now-wired
    // applyDailyRhythmPreference call inside resolveDayBuilderCandidates
    // -- never a mock, never a reimplementation.
    // ============================================================
    const dailyRhythmUser0 = await upsertUserByEmail({ email: 'test-daily-guidance-rhythm@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    const dailyRhythmUserBase = await updateBirthProfile(dailyRhythmUser0.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
    await updateUserDayBuilderPrefs(dailyRhythmUserBase.id, {
      dayBuilderEnabled: true,
      dayBuilderMutedGroups: ['RELATIONSHIPS', 'FAMILY', 'SOCIAL', 'WORK', 'ENJOYMENT'], // only SELF (-> workout/walk/meditation) active
      dayBuilderPriorities: [],
      dayBuilderPriorityPersonIds: [],
      dayBuilderPrioritiesPromptDismissed: true,
    });

    // Baseline: no Daily Rhythm configured -> unchanged (DR2's own "no
    // work preferences -> unchanged behavior" rule, verified through
    // THIS PR's new call site, not just the already-tested pure function).
    await clearDailyWorkPreferences(dailyRhythmUserBase.id);
    const dailyRhythmUserUnconfigured = await getUserById(dailyRhythmUserBase.id);
    const baselineCandidates = await collectDayBuilderCandidates(dailyRhythmUserUnconfigured!, NOW);
    const workoutBaseline = baselineCandidates.find((c) => c.activityId === 'workout');
    check('DAILY RHYTHM (missing prefs): a real Day Builder workout suggestion is produced with multiple timing candidates', workoutBaseline !== undefined && workoutBaseline.timingCandidates.length > 1);
    const baselineFirstStart = workoutBaseline?.timingCandidates[0]?.start;

    // All candidates inside a wide work window (09:00-17:00 IST) -> no
    // outside-work alternative exists in this batch -> fallback to the
    // full, original, unfiltered set (never an empty/excluded result).
    await setDailyWorkPreferences(dailyRhythmUserBase.id, { workStart: '09:00', workEnd: '17:00', workDays: [1, 2, 3, 4, 5] });
    const dailyRhythmUserWideWork = await getUserById(dailyRhythmUserBase.id);
    const wideWorkCandidates = await collectDayBuilderCandidates(dailyRhythmUserWideWork!, NOW);
    const workoutWideWork = wideWorkCandidates.find((c) => c.activityId === 'workout');
    check('DAILY RHYTHM (all candidates inside a wide work window): fallback preserves the full original candidate count (never excluded)', workoutWideWork?.timingCandidates.length === workoutBaseline?.timingCandidates.length);
    check('DAILY RHYTHM (all candidates inside a wide work window): rank-1 candidate is unchanged from the unfiltered baseline', workoutWideWork?.timingCandidates[0]?.start === baselineFirstStart);

    // AURA-CI-06 (#349). The original narrow-window case hard-coded a
    // 10:00-17:00 work window that assumed one baseline candidate at 09:30
    // IST. Which slots the real Panchang-ranked search returns for this fixed
    // user/date is an engine output, and PCE-4A (#298, the Lahiri ayanamsa
    // correction) legitimately changed it to 10:45 (USABLE), 15:15 (CAUTION)
    // and 16:45 (CAUTION). That exposed a Home defect: when the only
    // outside-work slots were CAUTION, Daily Rhythm kept only them, Daily
    // Guidance (which never recommends CAUTION) dropped them, and the workout
    // got NO recommendation. Home now keeps Daily Rhythm's narrowed list only
    // when it still holds a guidance-eligible window
    // (preferOutsideWorkForGuidance, dailyGuidanceCandidates.ts).
    //
    // The real-engine cases below derive their work windows from the baseline
    // itself, so they don't depend on specific engine-ranked times. The
    // reordering rule is also pinned on fixed synthetic candidates (further
    // below), because this date's real output has no eligible non-rank-1
    // outside-work slot to promote.
    const istHHMM = (iso: string | number | Date) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const baselineList = workoutBaseline?.timingCandidates ?? [];
    const isEligible = (label: string) => ['EXCELLENT', 'VERY_GOOD', 'GOOD', 'USABLE'].includes(label);
    // A work window spanning every baseline candidate except candidate k, which must lie wholly outside it.
    const windowExcluding = (k: number): { workStart: string; workEnd: string } | null => {
      const others = baselineList.filter((_, i) => i !== k);
      if (others.length === 0) return null;
      const lo = Math.min(...others.map((c) => new Date(c.start).getTime()));
      const hi = Math.max(...others.map((c) => new Date(c.end).getTime()));
      const kStart = new Date(baselineList[k].start).getTime();
      const kEnd = new Date(baselineList[k].end).getTime();
      if (!(istHHMM(lo) < istHHMM(hi - 1)) || !(kEnd <= lo || kStart >= hi)) return null;
      return { workStart: istHHMM(lo), workEnd: istHHMM(hi) };
    };
    const firstIndex = (pred: (k: number) => boolean) => { for (let k = baselineList.length - 1; k >= 0; k--) if (pred(k) && windowExcluding(k)) return k; return -1; };

    // Baseline guidance (no Daily Rhythm): the workout is recommended at the baseline's eligible time.
    const baselineReady = await buildPersonalDailyGuidance(dailyRhythmUserUnconfigured!, NOW);
    const baselineWorkoutRec = baselineReady.status === 'READY' ? baselineReady.guidance.recommendations.find((r) => r.activityFamily === 'WORKOUT') : undefined;
    check('DAILY RHYTHM (missing prefs): Home recommends the workout at the baseline rank-1 time, which is guidance-eligible', baselineWorkoutRec !== undefined && baselineWorkoutRec.timing.start === baselineFirstStart && isEligible(String(baselineList[0]?.label)));

    // CASE A -- only CAUTION outside work (regression for #349): a window that leaves exactly one
    // CAUTION candidate outside. Daily Rhythm must NOT discard the eligible in-work window.
    const cautionK = firstIndex((k) => k >= 1 && baselineList[k].label === 'CAUTION');
    const cautionWindow = cautionK >= 0 ? windowExcluding(cautionK) : null;
    check('DAILY RHYTHM (fixture A): the real baseline has a CAUTION candidate that can lie alone outside a work window', cautionWindow !== null);
    await setDailyWorkPreferences(dailyRhythmUserBase.id, { ...(cautionWindow ?? { workStart: '10:00', workEnd: '17:00' }), workDays: [1, 2, 3, 4, 5] });
    const dailyRhythmUserCautionOnly = await getUserById(dailyRhythmUserBase.id);
    const workoutCautionOnly = (await collectDayBuilderCandidates(dailyRhythmUserCautionOnly!, NOW)).find((c) => c.activityId === 'workout');
    check('DAILY RHYTHM (only CAUTION outside work): the original ranked list is kept (no CAUTION-only narrowing)', workoutCautionOnly?.timingCandidates.length === baselineList.length && workoutCautionOnly?.timingCandidates[0]?.start === baselineFirstStart);
    const cautionOnlyReady = await buildPersonalDailyGuidance(dailyRhythmUserCautionOnly!, NOW);
    const cautionOnlyRec = cautionOnlyReady.status === 'READY' ? cautionOnlyReady.guidance.recommendations.find((r) => r.activityFamily === 'WORKOUT') : undefined;
    check('DAILY RHYTHM (only CAUTION outside work): the eligible in-work WORKOUT recommendation is retained (previously dropped -- #349)', cautionOnlyReady.status === 'READY' && cautionOnlyRec !== undefined);
    check('DAILY RHYTHM DISPLAY/COMMIT CONSISTENCY (only CAUTION outside work): the displayed/committed timing.start is exactly the kept rank-1 candidate', cautionOnlyRec !== undefined && cautionOnlyRec.timing.start === workoutCautionOnly?.timingCandidates[0]?.start);

    // CASE B -- an eligible candidate outside work: Daily Rhythm narrows to the eligible outside-work set.
    const eligibleK = firstIndex((k) => isEligible(String(baselineList[k].label)));
    const eligibleWindow = eligibleK >= 0 ? windowExcluding(eligibleK) : null;
    check('DAILY RHYTHM (fixture B): the real baseline has a guidance-eligible candidate that can lie alone outside a work window', eligibleWindow !== null);
    await setDailyWorkPreferences(dailyRhythmUserBase.id, { ...(eligibleWindow ?? { workStart: '10:00', workEnd: '17:00' }), workDays: [1, 2, 3, 4, 5] });
    const dailyRhythmUserNarrowWork = await getUserById(dailyRhythmUserBase.id);
    const workoutNarrowWork = (await collectDayBuilderCandidates(dailyRhythmUserNarrowWork!, NOW)).find((c) => c.activityId === 'workout');
    check('DAILY RHYTHM (eligible outside-work candidate exists): rank-1 is exactly that outside-work candidate', eligibleK >= 0 && workoutNarrowWork?.timingCandidates[0] !== undefined && workoutNarrowWork.timingCandidates[0].start === baselineList[eligibleK].start);
    check('DAILY RHYTHM (eligible outside-work candidate exists): the surviving set is strictly narrower than the unfiltered baseline (a real preference, not a no-op)', (workoutNarrowWork?.timingCandidates.length ?? 0) < baselineList.length && (workoutNarrowWork?.timingCandidates.length ?? 0) > 0);

    // Non-workday (Daily Rhythm configured, but NOW's own weekday is not
    // among workDays) -> no workday restriction inherited, unchanged.
    await setDailyWorkPreferences(dailyRhythmUserBase.id, { workStart: '10:00', workEnd: '17:00', workDays: [0] }); // 2026-09-09 is a Wednesday (weekday 3), not Sunday (0)
    const dailyRhythmUserNonWorkday = await getUserById(dailyRhythmUserBase.id);
    const nonWorkdayCandidates = await collectDayBuilderCandidates(dailyRhythmUserNonWorkday!, NOW);
    const workoutNonWorkday = nonWorkdayCandidates.find((c) => c.activityId === 'workout');
    check('DAILY RHYTHM (non-configured workday): unchanged, no workday restriction inherited', workoutNonWorkday?.timingCandidates[0]?.start === baselineFirstStart && workoutNonWorkday?.timingCandidates.length === workoutBaseline?.timingCandidates.length);

    // Display/commit consistency (the critical requirement): the candidate
    // Daily Rhythm leaves at rank 1 above is EXACTLY the instant that reaches
    // guidance.recommendations[...].timing -- the same real
    // DailyGuidanceRecommendation Home renders AND the same value
    // HomeDashboard.tsx's handlePlanOpportunity passes to the existing
    // commit/re-verification call (candidateStart: item.start) -- proven
    // through the REAL, unmodified downstream engines.
    const narrowWorkReady = await buildPersonalDailyGuidance(dailyRhythmUserNarrowWork!, NOW);
    check('DAILY RHYTHM DISPLAY/COMMIT CONSISTENCY: buildPersonalDailyGuidance reaches READY for the Daily-Rhythm user', narrowWorkReady.status === 'READY');
    if (narrowWorkReady.status === 'READY') {
      const workoutRecs = narrowWorkReady.guidance.recommendations.filter((r) => r.activityFamily === 'WORKOUT');
      const workoutRecommendation = workoutRecs[0];
      check('DAILY RHYTHM DISPLAY/COMMIT CONSISTENCY: exactly one WORKOUT recommendation is present (no duplicates)', workoutRecs.length === 1);
      check(
        "DAILY RHYTHM DISPLAY/COMMIT CONSISTENCY: the recommendation's displayed/committed timing.start is EXACTLY the Daily-Rhythm-preferred (outside-work) instant",
        workoutRecommendation?.timing.start === workoutNarrowWork?.timingCandidates[0]?.start
      );
    }

    // The reordering rule itself, on fixed synthetic candidates (no engine
    // ranking involved), through the exact helper Home uses.
    const at = (hhmm: string) => new Date(`2026-09-09T${hhmm}:00+05:30`).toISOString();
    const cand = (from: string, to: string, label: string): any => ({ start: at(from), end: at(to), label, score: 5 });
    const ctx = (workStart: string, workEnd: string, workDays = [1, 2, 3, 4, 5]) => ({ targetDate: '2026-09-09', timezone: TZ, prefs: { workStart, workEnd, workDays } });
    const r1In = cand('11:00', '11:30', 'GOOD');
    const r2In = cand('14:00', '14:30', 'USABLE');
    const r3OutGood = cand('18:30', '19:00', 'USABLE');
    const r3OutCaution = cand('18:30', '19:00', 'CAUTION');
    const promoted = preferOutsideWorkForGuidance([r1In, r2In, r3OutGood], 'workout', ctx('10:00', '17:00'));
    check('DAILY RHYTHM (synthetic): an eligible non-rank-1 outside-work candidate is promoted to rank 1, and the in-work ones are deprioritized away', promoted.length === 1 && promoted[0] === r3OutGood);
    const cautionKept = preferOutsideWorkForGuidance([r1In, r2In, r3OutCaution], 'workout', ctx('10:00', '17:00'));
    check('DAILY RHYTHM (synthetic): a CAUTION-only outside-work candidate does not displace the eligible in-work ranking (original list kept)', cautionKept.length === 3 && cautionKept[0] === r1In && cautionKept[1] === r2In && cautionKept[2] === r3OutCaution);
    const allInside = preferOutsideWorkForGuidance([r1In, r2In], 'workout', ctx('09:00', '17:00'));
    check('DAILY RHYTHM (synthetic): all candidates inside work -> unchanged (existing fallback)', allInside.length === 2 && allInside[0] === r1In && allInside[1] === r2In);
    const notConfigured = preferOutsideWorkForGuidance([r1In, r2In, r3OutGood], 'workout', { targetDate: '2026-09-09', timezone: TZ, prefs: { workStart: null, workEnd: null, workDays: [] } } as any);
    check('DAILY RHYTHM (synthetic): no Daily Rhythm configured -> unchanged', notConfigured.length === 3 && notConfigured[0] === r1In);
    const mixedOutside = preferOutsideWorkForGuidance([r1In, r3OutGood, cand('19:30', '20:00', 'CAUTION')], 'workout', ctx('10:00', '17:00'));
    check('DAILY RHYTHM (synthetic): eligible + CAUTION outside work -> the outside set is kept, eligible first (Daily Rhythm behaviour unchanged)', mixedOutside.length === 2 && mixedOutside[0] === r3OutGood);

    // Restore to unconfigured so this doesn't leak into the shared
    // fixture user's later assertions below (none currently depend on
    // it, but matches this file's own "leave state clean" discipline).
    await clearDailyWorkPreferences(dailyRhythmUserBase.id);

    // ============================================================
    // FULL END-TO-END: READY with a real recommendation.
    // ============================================================
    const readyResult = await buildPersonalDailyGuidance(user, NOW);
    check('READY: a complete profile + at least one eligible Plan produces status READY', readyResult.status === 'READY');
    if (readyResult.status === 'READY') {
      check('READY: guidance.recommendations preserved verbatim from #104 (rank 1..N present)', readyResult.guidance.recommendations.every((r, i) => r.rank === i + 1));
      check('READY: selectedActivities contains metadata only for families actually in guidance.recommendations', Object.keys(readyResult.selectedActivities).every((family) => readyResult.guidance.recommendations.some((r) => r.activityFamily === family)));
      const deepWorkRecommendation = readyResult.guidance.recommendations.find((r) => r.activityFamily === 'DEEP_WORK');
      if (deepWorkRecommendation) {
        check('READY: DEEP_WORK selectedActivities metadata traces back to the real Plan (activityId=deep-work, source=PLAN)', readyResult.selectedActivities['DEEP_WORK']?.activityId === 'deep-work' && readyResult.selectedActivities['DEEP_WORK']?.source === 'PLAN');
      }
    }

    // ============================================================
    // DETERMINISM (real DB, same inputs).
    // ============================================================
    const secondReadyResult = await buildPersonalDailyGuidance(user, NOW);
    check('DETERMINISM: two calls with the identical user+now+Plans produce deeply-equal guidance.recommendations', JSON.stringify((readyResult as { guidance?: unknown }).guidance) === JSON.stringify((secondReadyResult as { guidance?: unknown }).guidance));
  } finally {
    // deletePlannedActivity only removes LOGGED/CANCELLED rows (never a
    // live UPCOMING commitment) -- every Plan this file creates stays
    // UPCOMING, so it must be cancelled first, matching the app's own
    // two-step cancel-then-delete flow (apps/web/lib/db.ts's own
    // cancelPlannedActivity/deletePlannedActivity pair).
    for (const planId of createdPlanIds) {
      await cancelPlannedActivity(user.id, planId);
      await deletePlannedActivity(user.id, planId);
    }
  }

  if (!allPassed) {
    console.error('\nSome Personal Guidance Orchestration (live-database) checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL PERSONAL GUIDANCE ORCHESTRATION (LIVE-DATABASE) CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
