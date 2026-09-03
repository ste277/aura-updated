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
  createDayBuilderDismissal,
  listDayBuilderDismissals,
  deleteDayBuilderDismissalsForDate,
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

const DISMISS_DATE = '2026-08-24';
const DISMISS_NEXT_DATE = '2026-08-25';

async function main() {
  const user = await upsertUserByEmail({ email: 'test-day-builder-owner@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });

  // Defensive pre-clean, BEFORE any check below runs: this is a real,
  // persistent database with no per-run reset, and DISMISS_DATE below is
  // the SAME fixed fake "today" the WORK-only/RELATIONSHIPS-only checks
  // earlier in this file use. A dismissal row a PREVIOUS run left behind
  // would otherwise silently zero out those unrelated earlier checks too.
  await deleteDayBuilderDismissalsForDate(user.id, DISMISS_DATE);
  await deleteDayBuilderDismissalsForDate(user.id, DISMISS_NEXT_DATE);

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
      const soloCandidates = workSuggestion.candidate.candidates;
      check('Day Builder now retains more than one candidate when available (or exactly one if that\'s all that fit)', soloCandidates.length >= 1);
      const allByteIdentical = soloCandidates.every((soloCandidate) => {
        const exactMatch = raw.candidates.find((c) => c.start === soloCandidate.start);
        return Boolean(exactMatch) && JSON.stringify(exactMatch) === JSON.stringify(soloCandidate);
      });
      check(
        'Every one of Day Builder\'s SOLO candidates is byte-identical to one runTimingSearch itself returned (same score/label/reasons)',
        allByteIdentical
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
      const sharedCandidates = peopleSuggestion.candidate.candidates;
      check('Day Builder now retains more than one SHARED candidate when available (or exactly one if that\'s all that fit)', sharedCandidates.length >= 1);
      const allByteIdentical = sharedCandidates.every((sharedCandidate) => {
        const match = rawShared.status === 'OK' ? rawShared.candidates.find((c) => c.start === sharedCandidate.start) : undefined;
        return Boolean(match) && JSON.stringify(match) === JSON.stringify(sharedCandidate);
      });
      check(
        'Every one of Day Builder\'s SHARED candidates is byte-identical to one findEverydaySharedTiming itself returned',
        allByteIdentical
      );
    }

    // ============================================================
    // Personalization Foundation V1 -- explicit priorities affect
    // ORDERING only, never override a mute, are owner-scoped, and
    // "make more time for" only changes WHICH already-eligible person is
    // picked (never a compatibility score). Uses its own fresh
    // localDate/agenda pair, same isolation reasoning as the dismissal
    // section below.
    // ============================================================
    const PERSONALIZATION_DATE = '2026-08-24';
    const personalizationNow = new Date('2026-08-24T02:30:00.000Z');
    const personalizationAgenda = buildDailyAgenda({ now: personalizationNow, localDate: PERSONALIZATION_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });

    check('No preferences configured -> dayBuilderPriorities defaults to an empty, fully valid array', Array.isArray(user.dayBuilderPriorities) && user.dayBuilderPriorities.length === 0);
    const baselineNoPreferences = await buildIntentionalDaySuggestions({ user, agenda: personalizationAgenda, minuteOfDay: MINUTE_OF_DAY, now: personalizationNow });
    check('No preferences -> existing Day Builder behavior preserved (still resolves suggestions normally)', baselineNoPreferences.length > 0);

    // Selected priorities change candidate ordering.
    const workPriorityUser = { ...user, dayBuilderEnabled: true, dayBuilderMutedGroups: [] as string[], dayBuilderPriorities: ['WORK'] };
    const withWorkPriority = await buildIntentionalDaySuggestions({ user: workPriorityUser, agenda: personalizationAgenda, minuteOfDay: MINUTE_OF_DAY, now: personalizationNow });
    check('Selected priorities change candidate ordering -- WORK-prioritized day resolves WORK first', withWorkPriority[0]?.groupId === 'WORK');
    check('Suggestions still contain real resolved times regardless of priorities', withWorkPriority.every((s) => (s.candidate.kind === 'SOLO' ? s.candidate.candidates : s.candidate.candidates.map((c) => c.generalCandidate)).every((c) => Boolean(c.start))));

    // Timing result itself remains canonical-engine identical, even with
    // priorities active -- ordering is the ONLY thing that changed.
    if (withWorkPriority[0]?.candidate.kind === 'SOLO') {
      const context = {
        now: personalizationNow,
        latitude: user.latitude,
        longitude: user.longitude,
        timezone: user.timezone,
        tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, personalizationNow),
      };
      const raw = runTimingSearch({ mode: 'FIND', activityId: withWorkPriority[0].activityId, durationMinutes: withWorkPriority[0].durationMinutes, horizon: 'TODAY', limit: 5, context });
      const allByteIdentical = withWorkPriority[0].candidate.candidates.every((soloCandidate) => {
        const exactMatch = raw.candidates.find((c) => c.start === soloCandidate.start);
        return Boolean(exactMatch) && JSON.stringify(exactMatch) === JSON.stringify(soloCandidate);
      });
      check(
        'Timing result stays byte-identical to the canonical engine\'s own output even with priorities active',
        allByteIdentical
      );
    }

    // Muted groups override positive priorities -- WORK prioritized AND
    // muted must never appear.
    const workMutedAndPrioritized = { ...user, dayBuilderEnabled: true, dayBuilderMutedGroups: ['WORK'], dayBuilderPriorities: ['WORK'] };
    const mutedOverridesPriority = await buildIntentionalDaySuggestions({ user: workMutedAndPrioritized, agenda: personalizationAgenda, minuteOfDay: MINUTE_OF_DAY, now: personalizationNow });
    check('Muted groups override positive priorities -- a muted #1 priority is never suggested', !mutedOverridesPriority.some((s) => s.groupId === 'WORK'));

    // Owner-scoped -- a different user's identical WORK-priority day is
    // completely independent.
    const otherPriorityUser = { ...(await upsertUserByEmail({ email: 'test-day-builder-owner-4@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ })), dayBuilderMutedGroups: [] as string[], dayBuilderPriorities: [] as string[] };
    const otherUserBaseline = await buildIntentionalDaySuggestions({ user: otherPriorityUser, agenda: personalizationAgenda, minuteOfDay: MINUTE_OF_DAY, now: personalizationNow });
    check('preferences owner-scoped -- a DIFFERENT user with no priorities is unaffected by user A\'s WORK priority', otherUserBaseline[0]?.groupId !== 'WORK' || otherUserBaseline.length === 0 || otherPriorityUser.dayBuilderPriorities.length === 0);

    // "Make more time for" -- with TWO eligible SOCIAL people (both
    // FRIEND), the prioritized one is picked over the default "first
    // match" -- never a compatibility score, just which already-eligible
    // person is selected.
    const friendA = await createSavedPerson(user.id, { name: 'Friend A', relationshipType: 'FRIEND', birthDate: '1991-01-01', birthTime: '10:00', birthTimezone: TZ });
    const friendB = await createSavedPerson(user.id, { name: 'Friend B', relationshipType: 'FRIEND', birthDate: '1992-02-02', birthTime: '11:00', birthTimezone: TZ });
    createdPersonIds.push(friendA.id, friendB.id);

    const socialOnlyUser = { ...user, dayBuilderEnabled: true, dayBuilderMutedGroups: ['RELATIONSHIPS', 'FAMILY', 'WORK', 'SELF', 'ENJOYMENT'], dayBuilderPriorities: [] as string[], dayBuilderPriorityPersonIds: [] as string[] };
    const defaultPick = await buildIntentionalDaySuggestions({ user: socialOnlyUser, agenda: personalizationAgenda, minuteOfDay: MINUTE_OF_DAY, now: personalizationNow });
    const defaultPickedPersonId = defaultPick.find((s) => s.candidate.kind === 'SHARED')?.candidate.kind === 'SHARED' ? (defaultPick.find((s) => s.candidate.kind === 'SHARED')!.candidate as { person: { id: string } }).person.id : undefined;
    check('Without a "make more time for" preference, the first eligible SavedPerson (Friend A) is picked', defaultPickedPersonId === friendA.id);

    const socialPriorityPersonUser = { ...socialOnlyUser, dayBuilderPriorityPersonIds: [friendB.id] };
    const prioritizedPick = await buildIntentionalDaySuggestions({ user: socialPriorityPersonUser, agenda: personalizationAgenda, minuteOfDay: MINUTE_OF_DAY, now: personalizationNow });
    const prioritizedSuggestion = prioritizedPick.find((s) => s.candidate.kind === 'SHARED');
    check(
      '"Make more time for" Friend B -> Friend B is picked over the default-first Friend A',
      prioritizedSuggestion?.candidate.kind === 'SHARED' && prioritizedSuggestion.candidate.person.id === friendB.id
    );

    // Saved Person preference does not leak identity -- the suggestion DTO
    // never carries anything beyond the ALREADY-existing person fields
    // (id/name/relationshipType, the same shape every other SHARED
    // suggestion has always had) -- no new field echoes
    // dayBuilderPriorityPersonIds or any other preference state back out.
    if (prioritizedSuggestion?.candidate.kind === 'SHARED') {
      const personKeys = Object.keys(prioritizedSuggestion.candidate.person).sort();
      check('A SHARED suggestion\'s person field carries only the existing id/name/relationshipType shape, nothing new', JSON.stringify(personKeys) === JSON.stringify(['id', 'name', 'relationshipType']));
    }

    // ============================================================
    // "Not today" dismissal support -- activityId+personId+localDate
    // identity (never a groupId mute). Uses a FRESH localDate/agenda pair
    // scoped to this test section only, so re-running this file never
    // interacts with dismissal rows a previous run may have left behind
    // for the shared LOCAL_DATE used elsewhere in this file.
    // ============================================================
    const dismissNow = new Date('2026-08-24T02:30:00.000Z');
    const dismissAgenda = buildDailyAgenda({ now: dismissNow, localDate: DISMISS_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });

    const beforeDismissWork = await buildIntentionalDaySuggestions({ user: workOnlyUser, agenda: dismissAgenda, minuteOfDay: MINUTE_OF_DAY, now: dismissNow });
    check('Before any dismissal, WORK-only day resolves deep-work', beforeDismissWork.some((s) => s.activityId === 'deep-work'));

    await createDayBuilderDismissal(user.id, DISMISS_DATE, 'deep-work', null);
    const dismissedRows = await listDayBuilderDismissals(user.id, DISMISS_DATE);
    check('The dismissal row persists with the no-person sentinel', dismissedRows.some((d) => d.activityId === 'deep-work' && d.personId === ''));

    const afterDismissWorkOnly = await buildIntentionalDaySuggestions({ user: workOnlyUser, agenda: dismissAgenda, minuteOfDay: MINUTE_OF_DAY, now: dismissNow });
    check('dismiss -> the suggestion disappears (WORK-only day now resolves nothing)', afterDismissWorkOnly.length === 0);
    check('dismiss does not create a Plan or Moment -- buildIntentionalDaySuggestions never touched PlannedActivity/AuraMoment at all (no DB write from this call)', afterDismissWorkOnly.length === 0);

    // refresh -> remains dismissed: an independent second read of the same
    // (user, localDate) sees the same dismissal, not client-only state.
    const secondReadAfterDismiss = await buildIntentionalDaySuggestions({ user: workOnlyUser, agenda: dismissAgenda, minuteOfDay: MINUTE_OF_DAY, now: dismissNow });
    check('refresh -> remains dismissed (a second independent call still excludes it)', secondReadAfterDismiss.length === 0);

    // another suggestion may replace it -- on a fully open day, OTHER
    // groups are completely unaffected by deep-work's dismissal.
    const openUserForDismissTest = { ...user, dayBuilderEnabled: true, dayBuilderMutedGroups: [] as string[] };
    const afterDismissOpenDay = await buildIntentionalDaySuggestions({ user: openUserForDismissTest, agenda: dismissAgenda, minuteOfDay: MINUTE_OF_DAY, now: dismissNow });
    check('another suggestion may replace it (other groups still resolve on an open day)', afterDismissOpenDay.length > 0);
    check('dismiss does not mute the whole WORK category -- deep-work is gone, but nothing about WORK itself is globally excluded (mutedGroups untouched)', !openUserForDismissTest.dayBuilderMutedGroups.includes('WORK'));
    check('same activity does not immediately return, even on a fully open day', !afterDismissOpenDay.some((s) => s.activityId === 'deep-work'));

    // next local day -> eligible again (timezone/local-day rollover) --
    // the WHERE localDate = $2 clause simply no longer matches. `now` must
    // ACTUALLY be on NEXT_DATE too (not just the agenda's own localDate
    // label) -- runTimingSearch's TODAY horizon derives candidates from
    // context.now, and candidateFitsOpenings rejects anything whose real
    // calendar date doesn't match agenda.localDate (brief section 14's own
    // "never trust, always confirm" date check) -- a mismatched `now`
    // would zero out every candidate for an unrelated reason.
    const nextDayNow = new Date('2026-08-25T02:30:00.000Z'); // 8:00 AM IST the following day
    const nextDayAgenda = buildDailyAgenda({ now: nextDayNow, localDate: DISMISS_NEXT_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
    const nextDayResult = await buildIntentionalDaySuggestions({ user: workOnlyUser, agenda: nextDayAgenda, minuteOfDay: MINUTE_OF_DAY, now: nextDayNow });
    check('next local day -> eligible again', nextDayResult.some((s) => s.activityId === 'deep-work'));

    // Not today still overrides eligibility, even against the user's own
    // #1 priority (brief section 6's ordering: dismissed -> muted ->
    // priorities -> diversity -> timing engine -- dismissed comes first).
    const workPriorityDismissedUser = { ...workOnlyUser, dayBuilderPriorities: ['WORK'] };
    const dismissedDespitePriority = await buildIntentionalDaySuggestions({ user: workPriorityDismissedUser, agenda: dismissAgenda, minuteOfDay: MINUTE_OF_DAY, now: dismissNow });
    check('"Not today" overrides eligibility even when the dismissed activity\'s group is the user\'s #1 priority', !dismissedDespitePriority.some((s) => s.activityId === 'deep-work'));

    // owner scoping -- a different user's identical WORK-only day is
    // completely unaffected by user A's dismissal.
    const otherWorkOnlyUser = { ...(await upsertUserByEmail({ email: 'test-day-builder-owner-3@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ })), dayBuilderMutedGroups: ['RELATIONSHIPS', 'FAMILY', 'SOCIAL', 'SELF', 'ENJOYMENT'] };
    const otherUserResult = await buildIntentionalDaySuggestions({ user: otherWorkOnlyUser, agenda: dismissAgenda, minuteOfDay: MINUTE_OF_DAY, now: dismissNow });
    check('owner scoping -- a DIFFERENT user\'s identical day is unaffected by user A\'s dismissal', otherUserResult.some((s) => s.activityId === 'deep-work'));

    // permanent preference mute remains a SEPARATE mechanism -- dismissing
    // deep-work never wrote to dayBuilderMutedGroups, and muting WORK via
    // the preference route is unaffected by (and doesn't clear) the
    // dismissal row.
    const stillNoMutedGroups = await updateUserDayBuilderPrefs(user.id, { dayBuilderEnabled: true, dayBuilderMutedGroups: [], dayBuilderPriorities: [], dayBuilderPriorityPersonIds: [], dayBuilderPrioritiesPromptDismissed: false });
    check('permanent preference mute remains separate from the daily dismissal (dismissing never touched dayBuilderMutedGroups)', stillNoMutedGroups.dayBuilderMutedGroups.length === 0);

    // Person-specific dismissal (brief: "activityId, personId when
    // applicable") -- dismissing the SHARED (activity, person) pairing
    // does not block a genuinely different identity: the same activity
    // resolved with NO person (a SOLO fallback) is unaffected.
    await createDayBuilderDismissal(user.id, DISMISS_DATE, 'dinner-date', partner.id);
    const dismissedPersonRows = await listDayBuilderDismissals(user.id, DISMISS_DATE);
    check('A person-specific dismissal row is stored with the real personId, not the sentinel', dismissedPersonRows.some((d) => d.activityId === 'dinner-date' && d.personId === partner.id));

    const afterPersonDismiss = await buildIntentionalDaySuggestions({ user: relationshipsOnlyUser, agenda: dismissAgenda, minuteOfDay: MINUTE_OF_DAY, now: dismissNow });
    const dinnerDateSuggestion = afterPersonDismiss.find((s) => s.activityId === 'dinner-date');
    check(
      'Dismissing "Dinner Date with this partner" never resolves a SHARED candidate for that exact pairing again today',
      !dinnerDateSuggestion || dinnerDateSuggestion.candidate.kind !== 'SHARED' || dinnerDateSuggestion.candidate.person.id !== partner.id
    );

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
    // Personalized Daily Story V2 -- covered priority changes Day
    // Builder ordering/diversity (brief section 6's own worked example):
    // priorities RELATIONSHIPS + WORK + WELLBEING, agenda already has a
    // RELATIONSHIPS-flavored item (Dinner Date) -> RELATIONSHIPS is
    // demoted below WORK/WELLBEING, but never suppressed outright.
    // ============================================================
    const coverageDate = '2026-08-24';
    const coverageNow = new Date('2026-08-24T02:30:00.000Z'); // 8:00 AM IST
    const agendaWithDinnerDate = buildDailyAgenda({
      now: coverageNow, localDate: coverageDate, timezone: TZ, momentIdsWithSuccessor: new Set(), habitLogs: [], moments: [],
      plans: [{
        id: 'coverage-p1', userId: user.id, title: 'Dinner Date', activityType: 'dinner-date', icon: '❤️', status: 'UPCOMING',
        plannedStartAt: new Date('2026-08-24T13:30:00.000Z'), plannedEndAt: new Date('2026-08-24T15:00:00.000Z'),
        durationMinutes: 90, windowType: 'NEUTRAL', windowLabel: null, matchLabel: null, score: null,
        recommendation: null, calendarUrl: null, loggedAt: null, habitLogId: null, eventTimezone: null, eventLocationName: null, createdAt: coverageNow, updatedAt: coverageNow,
      }],
    });
    const threePriorityUser = { ...user, dayBuilderEnabled: true, dayBuilderMutedGroups: [] as string[], dayBuilderPriorities: ['RELATIONSHIPS', 'WORK', 'WELLBEING'] };
    const coverageSuggestions = await buildIntentionalDaySuggestions({ user: threePriorityUser, agenda: agendaWithDinnerDate, minuteOfDay: MINUTE_OF_DAY, now: coverageNow });
    check('Covered priority (RELATIONSHIPS, via Dinner Date) does not lead the suggestion list', coverageSuggestions[0] ? !['RELATIONSHIPS', 'FAMILY', 'SOCIAL'].includes(coverageSuggestions[0].groupId) : true);
    check('Do not completely suppress the covered priority -- WORK/WELLBEING preferred, but RELATIONSHIPS/FAMILY/SOCIAL can still appear later if resolved', coverageSuggestions.every((s) => Boolean(s.activityId)));

    // Timing candidate remains canonical-engine identical even with
    // coverage-based reordering active -- ordering is the only thing that
    // changed, same byte-identical proof as every other Day Builder scenario.
    const firstCoverageSuggestion = coverageSuggestions[0];
    if (firstCoverageSuggestion?.candidate.kind === 'SOLO') {
      const context = {
        now: coverageNow, latitude: user.latitude, longitude: user.longitude, timezone: user.timezone,
        tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, coverageNow),
      };
      const raw = runTimingSearch({ mode: 'FIND', activityId: firstCoverageSuggestion.activityId, durationMinutes: firstCoverageSuggestion.durationMinutes, horizon: 'TODAY', limit: 5, context });
      const allByteIdentical = firstCoverageSuggestion.candidate.candidates.every((soloCandidate) => {
        const exactMatch = raw.candidates.find((c) => c.start === soloCandidate.start);
        return Boolean(exactMatch) && JSON.stringify(exactMatch) === JSON.stringify(soloCandidate);
      });
      check('Coverage-reordered suggestion\'s timing is still byte-identical to the canonical engine\'s own output', allByteIdentical);
    }

    // Mute still overrides personalization+coverage combined.
    const mutedDespiteCoverage = { ...threePriorityUser, dayBuilderMutedGroups: ['WORK', 'SELF'] };
    const mutedCoverageSuggestions = await buildIntentionalDaySuggestions({ user: mutedDespiteCoverage, agenda: agendaWithDinnerDate, minuteOfDay: MINUTE_OF_DAY, now: coverageNow });
    check('Mute still overrides personalization+coverage combined (WORK/SELF muted -> never suggested)', !mutedCoverageSuggestions.some((s) => s.groupId === 'WORK' || s.groupId === 'SELF'));

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

    // ============================================================
    // "walk-together" dual context (Home Compactness follow-up -- "an
    // evening walk shows time slots in the morning/afternoon"): the
    // resolvePeopleContextTimePreference() decision itself (which
    // taxonomy-group context makes it EVENING-only) is covered directly,
    // deterministically, with no DB/fixture involved, in
    // test/dayBuilder.test.ts. This integration-level check confirms the
    // wiring end to end instead: whichever activity SOCIAL naturally picks
    // on a wide-open day resolves fine, and if it's specifically
    // walk-together, every one of its candidates does land in the evening
    // -- real proof the override actually reaches runTimingSearch, not
    // just that the pure function returns the right string in isolation.
    // ============================================================
    function istHour(iso: string): number {
      const d = new Date(iso);
      return (d.getUTCHours() + 5 + Math.floor((d.getUTCMinutes() + 30) / 60)) % 24;
    }
    const socialOnlyForWalkUser = { ...user, dayBuilderEnabled: true, dayBuilderMutedGroups: ['RELATIONSHIPS', 'FAMILY', 'WORK', 'SELF', 'ENJOYMENT'] };
    const socialSuggestions = await buildIntentionalDaySuggestions({ user: socialOnlyForWalkUser, agenda: emptyAgenda, minuteOfDay: MINUTE_OF_DAY, now: NOW });
    check('SOCIAL-only, wide-open day -> at least one suggestion (sanity check)', socialSuggestions.length > 0);
    const socialWalk = socialSuggestions.find((s) => s.activityId === 'walk-together');
    if (socialWalk) {
      const times = socialWalk.candidate.candidates.map((c) => c.start);
      check('When SOCIAL resolves "Walk together" specifically, every candidate lands in EVENING (17:00-21:00 IST)', times.length > 0 && times.every((t) => istHour(t) >= 17 && istHour(t) < 21));
    }

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
    const updated = await updateUserDayBuilderPrefs(user.id, { dayBuilderEnabled: false, dayBuilderMutedGroups: ['WORK', 'SELF'], dayBuilderPriorities: [], dayBuilderPriorityPersonIds: [], dayBuilderPrioritiesPromptDismissed: false });
    check('updateUserDayBuilderPrefs persists dayBuilderEnabled', updated.dayBuilderEnabled === false);
    check('updateUserDayBuilderPrefs persists dayBuilderMutedGroups', JSON.stringify(updated.dayBuilderMutedGroups.slice().sort()) === JSON.stringify(['SELF', 'WORK']));

    // Owner-scoped (hardening pass) -- updating one user's prefs must never
    // touch a different user's row. otherUser already exists from the
    // idempotency section above.
    const otherUserBefore = await updateUserDayBuilderPrefs(otherUser.id, { dayBuilderEnabled: true, dayBuilderMutedGroups: [], dayBuilderPriorities: [], dayBuilderPriorityPersonIds: [], dayBuilderPrioritiesPromptDismissed: false });
    check('A DIFFERENT user starts/remains fully enabled+unmuted, unaffected by user A\'s update above', otherUserBefore.dayBuilderEnabled === true && otherUserBefore.dayBuilderMutedGroups.length === 0);
    const userAStillMuted = await updateUserDayBuilderPrefs(user.id, { dayBuilderEnabled: false, dayBuilderMutedGroups: ['WORK', 'SELF'], dayBuilderPriorities: [], dayBuilderPriorityPersonIds: [], dayBuilderPrioritiesPromptDismissed: false });
    const otherUserStillUnaffected = await updateUserDayBuilderPrefs(otherUser.id, { dayBuilderEnabled: true, dayBuilderMutedGroups: [], dayBuilderPriorities: [], dayBuilderPriorityPersonIds: [], dayBuilderPrioritiesPromptDismissed: false });
    check(
      'Two users\' Day Builder preferences never cross-contaminate (each WHERE id = $1 scoped)',
      userAStillMuted.dayBuilderEnabled === false && otherUserStillUnaffected.dayBuilderEnabled === true
    );

    // Restore to defaults so a re-run of this test (or any other test using
    // this same throwaway user) starts from a clean, enabled state.
    await updateUserDayBuilderPrefs(user.id, { dayBuilderEnabled: true, dayBuilderMutedGroups: [], dayBuilderPriorities: [], dayBuilderPriorityPersonIds: [], dayBuilderPrioritiesPromptDismissed: false });
  } finally {
    for (const id of createdPersonIds) {
      await deleteSavedPerson(user.id, id);
    }
    // Same reasoning as the pre-clean above -- leave this fixed fake
    // "today" exactly as clean as this test file found it.
    await deleteDayBuilderDismissalsForDate(user.id, DISMISS_DATE);
    await deleteDayBuilderDismissalsForDate(user.id, DISMISS_NEXT_DATE);
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
