/**
 * Live-database tests for Forward Planner V1 -- the full end-to-end
 * buildForwardPlannerResult() flow, plus buildForwardPlannerRequest()'s
 * own validation. Requires a real, reachable DATABASE_URL, same
 * convention as test/dailyGuidanceOrchestratorDb.test.ts -- NOT part of
 * ci.yml's math-core-tests job (no Postgres service provisioned there).
 *
 * Run locally with a real DATABASE_URL set:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/forwardPlannerOrchestrator.test.ts
 *
 * Reuses the SAME throwaway test user every other Daily Guidance /
 * Personal Guidance Orchestration live-DB test already uses (idempotent
 * via email upsert), and creates/cleans up its own throwaway
 * PlannedActivity rows in a finally block -- same convention as
 * dailyGuidanceOrchestratorDb.test.ts.
 */
import { upsertUserByEmail, updateBirthProfile, createPlannedActivity, cancelPlannedActivity, deletePlannedActivity, updateUserDayBuilderPrefs } from '../apps/web/lib/db';
import { buildForwardPlannerRequest, buildForwardPlannerResult } from '../apps/web/lib/forwardPlannerOrchestrator';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
// A fixed instant on a real day (a Wednesday), matching this repo's own
// established fixed-fake-"now" convention for DB tests.
const NOW = new Date('2026-09-09T04:00:00.000Z'); // 9:30 AM IST, Wednesday Sep 9 2026 local.

async function main() {
  const user0 = await upsertUserByEmail({ email: 'test-daily-guidance-owner@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const user = await updateBirthProfile(user0.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  await updateUserDayBuilderPrefs(user.id, { dayBuilderEnabled: true, dayBuilderMutedGroups: [], dayBuilderPriorities: [], dayBuilderPriorityPersonIds: [], dayBuilderPrioritiesPromptDismissed: true });

  const createdPlanIds: string[] = [];

  try {
    // ============================================================
    // REQUEST VALIDATION (pure, but exercised here alongside everything
    // else that already imports db.ts at module load time).
    // ============================================================
    check('VALIDATION: unknown activityId rejected', !buildForwardPlannerRequest({ activityId: 'not-a-real-activity', horizon: 'TOMORROW' }, NOW, TZ).ok);
    check('VALIDATION: missing activityId rejected', !buildForwardPlannerRequest({ horizon: 'TOMORROW' }, NOW, TZ).ok);
    check('VALIDATION: invalid horizon rejected', !buildForwardPlannerRequest({ activityId: 'deep-work', horizon: 'NEXT_MONTH' }, NOW, TZ).ok);
    check('VALIDATION: durationMinutes below 15 rejected', !buildForwardPlannerRequest({ activityId: 'deep-work', horizon: 'TOMORROW', durationMinutes: 10 }, NOW, TZ).ok);
    check('VALIDATION: durationMinutes above 360 rejected', !buildForwardPlannerRequest({ activityId: 'deep-work', horizon: 'TOMORROW', durationMinutes: 400 }, NOW, TZ).ok);
    check('VALIDATION: CUSTOM without dates rejected', !buildForwardPlannerRequest({ activityId: 'deep-work', horizon: 'CUSTOM' }, NOW, TZ).ok);
    const validRequest = buildForwardPlannerRequest({ activityId: 'deep-work', horizon: 'TOMORROW' }, NOW, TZ);
    check('VALIDATION: a well-formed TOMORROW request is accepted', validRequest.ok);

    // ============================================================
    // BIRTH_PROFILE_REQUIRED.
    // ============================================================
    const incompleteUser = { ...user, birthDate: null };
    const incompleteRequest = buildForwardPlannerRequest({ activityId: 'deep-work', horizon: 'SEVEN_DAYS' }, NOW, TZ);
    if (incompleteRequest.ok) {
      const incompleteResult = await buildForwardPlannerResult(incompleteUser, NOW, incompleteRequest.request);
      check('BIRTH_PROFILE_REQUIRED: missing birthDate -> status BIRTH_PROFILE_REQUIRED (no generic timing-only fallback)', incompleteResult.status === 'BIRTH_PROFILE_REQUIRED');
    }

    // ============================================================
    // READY -- full end-to-end, real personalization + real multi-day FIND.
    // ============================================================
    const sevenDayRequest = buildForwardPlannerRequest({ activityId: 'deep-work', horizon: 'SEVEN_DAYS' }, NOW, TZ);
    if (!sevenDayRequest.ok) throw new Error('sevenDayRequest validation unexpectedly failed');
    const readyResult = await buildForwardPlannerResult(user, NOW, sevenDayRequest.request);

    check('READY: a complete profile + a real everyday activity over 7 days produces status READY or NO_SUITABLE_WINDOW (both valid)', readyResult.status === 'READY' || readyResult.status === 'NO_SUITABLE_WINDOW');

    if (readyResult.status === 'READY') {
      check('READY: at most 3 options returned', readyResult.options.length <= 3);
      check('READY: at least 1 option returned (status would be NO_SUITABLE_WINDOW otherwise)', readyResult.options.length >= 1);
      check('READY: options are ranked 1..N with no gaps', readyResult.options.every((option, index) => option.rank === index + 1));
      check('READY: every option localDate falls within the requested range', readyResult.options.every((option) => option.localDate >= readyResult.range.startLocalDate && option.localDate <= readyResult.range.endLocalDate));
      check('READY: no two options share the same localDate (one-per-date policy)', new Set(readyResult.options.map((option) => option.localDate)).size === readyResult.options.length);
      check('READY: no option carries a CAUTION timing label', readyResult.options.every((option) => option.timingLabel !== 'CAUTION'));
      check('READY: activity resolved to the real catalog title, not a raw id', readyResult.activity.title !== 'deep-work' && readyResult.activity.title.length > 0);
      check('READY: options are sorted by the cross-day tuple -- no relevance-tier inversion', (() => {
        const RANK: Record<string, number> = { HIGHLY_RELEVANT: 0, RELEVANT: 1, BASELINE: 2 };
        for (let i = 1; i < readyResult.options.length; i++) {
          if (RANK[readyResult.options[i].personalRelevance] < RANK[readyResult.options[i - 1].personalRelevance]) return false;
        }
        return true;
      })());

      // Public contract guard: no internal provenance ever serialized.
      const serialized = JSON.stringify(readyResult);
      check('PUBLIC CONTRACT: no timingScore/muhurtaScore/auraFitScore/reasons/conflicts/metadata/engineVersion field name anywhere in the serialized result', !/"timingScore"|"muhurtaScore"|"auraFitScore"|"reasons"|"conflicts"|"metadata"|"engineVersion"|"ruleId"/.test(serialized));

      // ============================================================
      // DETERMINISM.
      // ============================================================
      const secondReadyResult = await buildForwardPlannerResult(user, NOW, sevenDayRequest.request);
      check('DETERMINISM: two calls with identical user+now+request produce deeply-equal results', JSON.stringify(readyResult) === JSON.stringify(secondReadyResult));

      // ============================================================
      // CONFLICT EXCLUSION -- real integration proof against the live
      // engine: take the actual first option this run produced, create a
      // real UPCOMING Plan that exactly overlaps it, rerun, and confirm
      // that date no longer appears (no same-day rescore/fallback -- the
      // whole date is dropped, matching this feature's own "drop the
      // candidate whole, never clip/move/split, never invent an intra-day
      // fallback" policy).
      // ============================================================
      const firstOption = readyResult.options[0];
      const blockingPlan = await createPlannedActivity({
        userId: user.id,
        title: 'Forward Planner conflict test block',
        activityId: null,
        plannedStartAt: new Date(firstOption.start),
        plannedEndAt: new Date(firstOption.end),
        durationMinutes: Math.round((new Date(firstOption.end).getTime() - new Date(firstOption.start).getTime()) / 60000),
        windowType: 'NEUTRAL',
      });
      createdPlanIds.push(blockingPlan.id);

      const afterConflictResult = await buildForwardPlannerResult(user, NOW, sevenDayRequest.request);
      if (afterConflictResult.status === 'READY') {
        check('CONFLICT EXCLUSION: the exact date blocked by a real overlapping UPCOMING Plan no longer appears among results', afterConflictResult.options.every((option) => option.localDate !== firstOption.localDate));
      } else {
        check('CONFLICT EXCLUSION: blocking the only eligible date correctly degrades to NO_SUITABLE_WINDOW, never an engine error', afterConflictResult.status === 'NO_SUITABLE_WINDOW');
      }
    }
  } finally {
    // deletePlannedActivity only removes LOGGED/CANCELLED rows (never a
    // live UPCOMING commitment) -- cancel-then-delete, matching the app's
    // own established two-step flow.
    for (const planId of createdPlanIds) {
      await cancelPlannedActivity(user.id, planId);
      await deletePlannedActivity(user.id, planId);
    }
  }

  if (!allPassed) {
    console.error('\nSome Forward Planner (live-database) checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL FORWARD PLANNER (LIVE-DATABASE) CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
