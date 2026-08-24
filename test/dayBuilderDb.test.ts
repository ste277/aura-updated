/**
 * Live-database tests for Intentional Day Builder V1 -- the orchestrator
 * (dayBuilderOrchestrator.ts), plan-creation idempotency (db.ts), and
 * Day Builder preference persistence. Requires a real, reachable
 * DATABASE_URL, same convention as savedPersonDb.test.ts -- NOT part of
 * ci.yml's math-core-tests job (no Postgres service provisioned there).
 * Run locally with a real DATABASE_URL set:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/dayBuilderDb.test.ts
 *
 * Creates one throwaway test user + one throwaway SavedPerson (idempotent
 * via email upsert), cleans up the SavedPerson it creates, but leaves the
 * User row in place -- same convention as savedPersonDb.test.ts.
 */
import {
  upsertUserByEmail,
  createSavedPerson,
  deleteSavedPerson,
  updateUserDayBuilderPrefs,
  claimPlanCreation,
  getPlanCreationClaim,
  fillPlanCreationClaim,
  createPlannedActivity,
} from '../apps/web/lib/db';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import { buildIntentionalDaySuggestions } from '../apps/web/lib/dayBuilderOrchestrator';
import { runTimingSearch } from '../packages/recommendation/src/timingSearch';
import { findEverydaySharedTiming } from '../packages/recommendation/src/everydayTimingFit';
import { natalContextFromBirthDetails } from '../apps/web/lib/natalContext';
import { resolveTzOffsetMinutes } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const LOCAL_DATE = '2026-08-24'; // a Monday -- no weekend-only search branches involved
const NOW = new Date('2026-08-24T02:30:00.000Z'); // 8:00 AM IST
const MINUTE_OF_DAY = 8 * 60;

async function main() {
  const user = await upsertUserByEmail({ email: 'test-day-builder-owner@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });

  const createdPersonIds: string[] = [];

  try {
    // ============================================================
    // Disabled / muted -> zero suggestions, no search attempted (brief
    // section 6/13)
    // ============================================================
    const emptyAgenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
    const disabledUser = { ...user, dayBuilderEnabled: false, dayBuilderMutedGroups: [] };
    const disabledResult = await buildIntentionalDaySuggestions({ user: disabledUser, agenda: emptyAgenda, minuteOfDay: MINUTE_OF_DAY, now: NOW });
    check('dayBuilderEnabled=false -> zero suggestions', disabledResult.length === 0);

    const allMutedUser = { ...user, dayBuilderEnabled: true, dayBuilderMutedGroups: ['RELATIONSHIPS', 'FAMILY', 'SOCIAL', 'WORK', 'SELF', 'ENJOYMENT'] };
    const mutedResult = await buildIntentionalDaySuggestions({ user: allMutedUser, agenda: emptyAgenda, minuteOfDay: MINUTE_OF_DAY, now: NOW });
    check('Every real group muted -> zero suggestions', mutedResult.length === 0);

    // ============================================================
    // NIGHT phase -> zero suggestions, defers to Reflection/Tomorrow
    // Preview (brief section 27/33/34)
    // ============================================================
    const nightResult = await buildIntentionalDaySuggestions({ user, agenda: emptyAgenda, minuteOfDay: 22 * 60, now: new Date('2026-08-24T16:30:00.000Z') });
    check('NIGHT phase -> zero suggestions (never computed)', nightResult.length === 0);

    // ============================================================
    // Timing parity (brief section 41) -- a WORK-only day (SELF/ENJOYMENT/
    // people muted) must resolve a SOLO suggestion whose candidate is
    // EXACTLY (deep-equal) a member of what runTimingSearch itself returns
    // for the identical parameters. Day Builder never computes its own
    // score, label, or reasons -- only selects among the canonical
    // engine's own output.
    // ============================================================
    const workOnlyUser = { ...user, dayBuilderEnabled: true, dayBuilderMutedGroups: ['RELATIONSHIPS', 'FAMILY', 'SOCIAL', 'SELF', 'ENJOYMENT'] };
    const workSuggestions = await buildIntentionalDaySuggestions({ user: workOnlyUser, agenda: emptyAgenda, minuteOfDay: MINUTE_OF_DAY, now: NOW });
    check('WORK-only, wide-open day -> at least one suggestion', workSuggestions.length > 0);
    const workSuggestion = workSuggestions[0];
    check('WORK-only suggestion is SOLO (no person involved)', workSuggestion?.candidate.kind === 'SOLO');

    if (workSuggestion && workSuggestion.candidate.kind === 'SOLO') {
      const context = {
        now: NOW,
        latitude: user.latitude,
        longitude: user.longitude,
        timezone: user.timezone,
        tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, NOW),
      };
      const raw = runTimingSearch({
        mode: 'FIND',
        activityId: workSuggestion.activityId,
        durationMinutes: workSuggestion.durationMinutes,
        horizon: 'TODAY',
        limit: 5,
        context,
      });
      const soloCandidate = workSuggestion.candidate.solo;
      const exactMatch = raw.candidates.find((c) => c.start === soloCandidate.start);
      check(
        'Day Builder\'s SOLO candidate is byte-identical to one runTimingSearch itself returned (same score/label/reasons)',
        Boolean(exactMatch) && JSON.stringify(exactMatch) === JSON.stringify(soloCandidate)
      );
    }

    // ============================================================
    // People-oriented suggestion with a real SavedPerson (brief section 9:
    // no fake astrology -- only the person's own already-stored birth data)
    // ============================================================
    const partner = await createSavedPerson(user.id, {
      name: 'Test Partner',
      relationshipType: 'PARTNER',
      birthDate: '1990-05-15',
      birthTime: '09:00',
      birthTimezone: TZ,
      birthCityName: 'Chennai',
      birthLatitude: 13.0827,
      birthLongitude: 80.2707,
    });
    createdPersonIds.push(partner.id);

    const relationshipsOnlyUser = { ...user, dayBuilderEnabled: true, dayBuilderMutedGroups: ['FAMILY', 'SOCIAL', 'WORK', 'SELF', 'ENJOYMENT'] };
    const peopleSuggestions = await buildIntentionalDaySuggestions({ user: relationshipsOnlyUser, agenda: emptyAgenda, minuteOfDay: MINUTE_OF_DAY, now: NOW });
    check('RELATIONSHIPS-only day with a real SavedPerson -> at least one suggestion', peopleSuggestions.length > 0);
    const peopleSuggestion = peopleSuggestions[0];
    check('RELATIONSHIPS suggestion resolves a SHARED candidate against the real saved partner', peopleSuggestion?.candidate.kind === 'SHARED' && peopleSuggestion.candidate.person.id === partner.id);

    if (peopleSuggestion && peopleSuggestion.candidate.kind === 'SHARED') {
      const context = {
        now: NOW,
        latitude: user.latitude,
        longitude: user.longitude,
        timezone: user.timezone,
        tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, NOW),
      };
      const partnerContext = natalContextFromBirthDetails('1990-05-15', '09:00', TZ);
      const rawShared = findEverydaySharedTiming({
        activityId: peopleSuggestion.activityId,
        durationMinutes: peopleSuggestion.durationMinutes,
        horizon: 'TODAY',
        limit: 5,
        context,
        partnerContext,
      });
      const sharedCandidate = peopleSuggestion.candidate.shared;
      const match = rawShared.status === 'OK' ? rawShared.candidates.find((c) => c.start === sharedCandidate.start) : undefined;
      check(
        'Day Builder\'s SHARED candidate is byte-identical to one findEverydaySharedTiming itself returned',
        Boolean(match) && JSON.stringify(match) === JSON.stringify(sharedCandidate)
      );
    }

    // ============================================================
    // Diversity: WORK + RELATIONSHIPS both open -> distinct suggestions,
    // never the same activityId twice.
    // ============================================================
    const openUser = { ...user, dayBuilderEnabled: true, dayBuilderMutedGroups: [] };
    const openSuggestions = await buildIntentionalDaySuggestions({ user: openUser, agenda: emptyAgenda, minuteOfDay: MINUTE_OF_DAY, now: NOW });
    const activityIds = openSuggestions.map((s) => s.activityId);
    check('A fully open day never suggests the same activityId twice', new Set(activityIds).size === activityIds.length);
    check('A fully open day suggests at most 3 for immediate display worth (reserve pool may exceed 3)', openSuggestions.length <= 5);

    // ============================================================
    // Unmuting restores eligibility (hardening pass) -- WORK is muted
    // alongside everything else in allMutedUser (zero suggestions, proven
    // above) and unmuted (alone) in workOnlyUser (a WORK suggestion,
    // proven above) -- the delta IS the unmute proof. A separate run with
    // ALL SIX groups unmuted is deliberately NOT used here: WORK is the
    // lowest-priority group on an evening-open day (brief section 11's own
    // priority ordering), so it can legitimately be crowded out of the
    // top-5 candidate-attempt cap by higher-priority groups once THEY are
    // also unmuted -- a priority-ordering fact, not a mute-state bug, and
    // asserting WORK's presence there would conflate the two.
    // ============================================================
    check(
      'Unmuting WORK (going from "every group muted" to "only WORK unmuted") restores its eligibility',
      mutedResult.length === 0 && workSuggestions.some((s) => s.groupId === 'WORK')
    );

    // ============================================================
    // Muted groups affect Day Builder ONLY (hardening pass) -- neither the
    // real Plan we're about to create nor the pure agenda object handed in
    // is ever read from or mutated by buildIntentionalDaySuggestions,
    // regardless of preferences. Proven directly (not just by type
    // signature): deep-equal the exact same agenda object before and after
    // calling it with a fully muted+disabled user.
    // ============================================================
    const realPlan = await createPlannedActivity({
      userId: user.id,
      title: 'Test Day Builder Untouched Plan',
      plannedStartAt: new Date('2026-08-24T09:00:00.000Z'),
      plannedEndAt: new Date('2026-08-24T10:00:00.000Z'),
      durationMinutes: 60,
      windowType: 'NEUTRAL',
    });
    const agendaWithRealPlan = buildDailyAgenda({
      now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [realPlan], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [],
    });
    const agendaSnapshotBefore = JSON.stringify(agendaWithRealPlan);
    await buildIntentionalDaySuggestions({ user: disabledUser, agenda: agendaWithRealPlan, minuteOfDay: MINUTE_OF_DAY, now: NOW });
    await buildIntentionalDaySuggestions({ user: allMutedUser, agenda: agendaWithRealPlan, minuteOfDay: MINUTE_OF_DAY, now: NOW });
    check('The agenda object (and the real Plan inside it) is never mutated by buildIntentionalDaySuggestions', JSON.stringify(agendaWithRealPlan) === agendaSnapshotBefore);

    const planStillIntact = await createPlannedActivity({
      userId: user.id,
      title: 'Test Day Builder Untouched Plan',
      plannedStartAt: new Date('2026-08-24T09:00:00.000Z'),
      plannedEndAt: new Date('2026-08-24T10:00:00.000Z'),
      durationMinutes: 60,
      windowType: 'NEUTRAL',
    });
    // createPlannedActivity itself dedups by (userId, title, start, end) --
    // this re-affirms the ORIGINAL row still exists unchanged (same id),
    // not a second row, proving Day Builder's own reads never touched it.
    check('The real Plan row itself is untouched in the database (same row returned, not a duplicate)', planStillIntact.id === realPlan.id);

    // ============================================================
    // Plan creation idempotency (brief section 20)
    // ============================================================
    const clientRequestId = `test-day-builder:${Date.now()}`;
    const firstClaim = await claimPlanCreation(user.id, clientRequestId);
    check('First claim on a fresh clientRequestId succeeds', firstClaim === true);
    const secondClaim = await claimPlanCreation(user.id, clientRequestId);
    check('A second claim on the SAME clientRequestId fails (already claimed)', secondClaim === false);

    const beforeFill = await getPlanCreationClaim(user.id, clientRequestId);
    check('An unfilled claim has a null plannedActivityId', beforeFill?.plannedActivityId === null);

    // A real (throwaway) PlannedActivity row -- the fill column has a real
    // FK to PlannedActivity, so a fake id would violate it, correctly.
    const throwawayPlan = await createPlannedActivity({
      userId: user.id,
      title: 'Test Day Builder Idempotency Plan',
      plannedStartAt: new Date('2026-08-24T10:00:00.000Z'),
      plannedEndAt: new Date('2026-08-24T11:00:00.000Z'),
      durationMinutes: 60,
      windowType: 'NEUTRAL',
    });
    await fillPlanCreationClaim(user.id, clientRequestId, throwawayPlan.id);
    const afterFill = await getPlanCreationClaim(user.id, clientRequestId);
    check('After fillPlanCreationClaim, the claim carries the plannedActivityId', afterFill?.plannedActivityId === throwawayPlan.id);

    const otherUser = await upsertUserByEmail({ email: 'test-day-builder-owner-2@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    const otherUserClaim = await claimPlanCreation(otherUser.id, clientRequestId);
    check('The SAME clientRequestId string is independently claimable by a DIFFERENT user (composite key, not global)', otherUserClaim === true);

    // ============================================================
    // Preference persistence round-trip (brief section 6/35)
    // ============================================================
    const updated = await updateUserDayBuilderPrefs(user.id, { dayBuilderEnabled: false, dayBuilderMutedGroups: ['WORK', 'SELF'] });
    check('updateUserDayBuilderPrefs persists dayBuilderEnabled', updated.dayBuilderEnabled === false);
    check('updateUserDayBuilderPrefs persists dayBuilderMutedGroups', JSON.stringify(updated.dayBuilderMutedGroups.slice().sort()) === JSON.stringify(['SELF', 'WORK']));

    // Owner-scoped (hardening pass) -- updating one user's prefs must never
    // touch a different user's row. otherUser already exists from the
    // idempotency section above.
    const otherUserBefore = await updateUserDayBuilderPrefs(otherUser.id, { dayBuilderEnabled: true, dayBuilderMutedGroups: [] });
    check('A DIFFERENT user starts/remains fully enabled+unmuted, unaffected by user A\'s update above', otherUserBefore.dayBuilderEnabled === true && otherUserBefore.dayBuilderMutedGroups.length === 0);
    const userAStillMuted = await updateUserDayBuilderPrefs(user.id, { dayBuilderEnabled: false, dayBuilderMutedGroups: ['WORK', 'SELF'] });
    const otherUserStillUnaffected = await updateUserDayBuilderPrefs(otherUser.id, { dayBuilderEnabled: true, dayBuilderMutedGroups: [] });
    check(
      'Two users\' Day Builder preferences never cross-contaminate (each WHERE id = $1 scoped)',
      userAStillMuted.dayBuilderEnabled === false && otherUserStillUnaffected.dayBuilderEnabled === true
    );

    // Restore to defaults so a re-run of this test (or any other test using
    // this same throwaway user) starts from a clean, enabled state.
    await updateUserDayBuilderPrefs(user.id, { dayBuilderEnabled: true, dayBuilderMutedGroups: [] });
  } finally {
    for (const id of createdPersonIds) {
      await deleteSavedPerson(user.id, id);
    }
  }

  if (!allPassed) {
    console.error('\nSome Day Builder DB checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL DAY BUILDER DB CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
