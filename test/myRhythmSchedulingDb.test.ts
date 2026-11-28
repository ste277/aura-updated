/**
 * AURA-MR2 -- My Rhythm scheduling preferences and next-week planning, against
 * a disposable Postgres (full migration chain) and the REAL timing engine,
 * through the real route handlers. Clock-independent: every planning
 * assertion targets NEXT week, which is always wholly in the future.
 *
 * Proves: proposals honour weekday / time-of-day / duration preferences and
 * Daily Rhythm work hours, the engine's Panchang ranking still picks the time,
 * proposing never writes, next-week acceptance needs explicit confirmation and
 * creates goal-linked plans in the right week without duplicates, Home exposes
 * paused/active state and the CONFIRMED next session, paused rhythms are
 * excluded consistently (Home, Plan My Day suggestions and handoff, weekly
 * proposal), resume restores eligibility, Plan My Day honours the preferred
 * time of day, and a non-IST user's week boundaries are computed in their zone.
 *
 * Never touches staging/Production: DATABASE_URL must be a disposable DB.
 */
import { POST as proposalRoute } from '../apps/web/app/api/daily-assistant/goal-rhythm/weekly-proposal/route';
import { POST as acceptRoute } from '../apps/web/app/api/daily-assistant/goal-rhythm/weekly-accept/route';
import { GET as homeRhythmRoute } from '../apps/web/app/api/daily-assistant/goal-rhythm/route';
import { PATCH as rhythmRoute } from '../apps/web/app/api/goals/[goalId]/activities/[goalActivityId]/rhythm/route';
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, beginTransaction, getUserById, setDailyWorkPreferences, listGoalActivitiesWithLinkedPlanStatus } from '../apps/web/lib/db';

import { getDatePartsInTimezone, resolveTzOffsetMinutes } from '../apps/web/lib/timezone';
import { resolveRhythmPlanningWeek } from '../apps/web/lib/goalActivityRhythmPreferences';
import { getWeekdayForDateStr } from '../apps/web/lib/availabilityContext';
import { buildHomeGoalRhythmSuggestions, resolveGoalRhythmCardActions, type GoalRhythmHomeResponse } from '../apps/web/lib/homeGoalRhythmSuggestions';
import { resolveAutomaticGoalDemand, resolveGoalActivityHandoff } from '../apps/web/lib/planDayBootstrap';
import { createRealGoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import { loadGoalActivityRhythmFacts } from '../apps/web/lib/db';
import { runTimingSearchWithDailyRhythm } from '../apps/web/lib/timingSearchDailyRhythm';
import { buildPersonalMuhurtaContextForUser } from '../apps/web/lib/natalContext';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { createRealDayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { buildExplicitRangeWindow } from '../apps/web/lib/goalRhythmWeeklyAcceptance';
import { describeTimeOfDayCompromise } from '../apps/web/lib/goalRhythmWeeklyProposal';
import { createTestSessionToken, TEST_SESSION_COOKIE, verifyTestSessionToken } from './authSessionTestSupport';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const IST = 'Asia/Kolkata';
const LA = 'America/Los_Angeles';

function req(token: string, body?: unknown): any {
  return { cookies: { get: (n: string) => (n === TEST_SESSION_COOKIE ? { value: token } : undefined) }, headers: new Headers(), nextUrl: new URL('http://localhost/x'), json: async () => body };
}
async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try {
    const r = await c.query(text, params);
    await c.query('COMMIT');
    return r.rows;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
const propose = async (tok: string, goalActivityId: string, week?: unknown) => {
  const r: any = await proposalRoute(req(tok, week === undefined ? { goalActivityId } : { goalActivityId, week }));
  return { status: r.status, body: await r.json() };
};
const accept = async (tok: string, goalActivityId: string, acceptanceId: string, sessions: unknown[], week?: unknown) => {
  const r: any = await acceptRoute(req(tok, week === undefined ? { goalActivityId, acceptanceId, sessions } : { goalActivityId, acceptanceId, sessions, week }));
  return { status: r.status, body: await r.json() };
};
const home = async (tok: string): Promise<Extract<GoalRhythmHomeResponse, { status: 'OK' }>> => (await (await homeRhythmRoute(req(tok))).json()) as any;
const patch = async (tok: string, goalId: string, id: string, body: unknown) => (await rhythmRoute(req(tok, body), { params: { goalId, goalActivityId: id } })).status;
const localHour = (iso: string, tz: string) => Number(new Date(iso).toLocaleString('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }));
const planCount = async (userId: string) => (await sql(`SELECT COUNT(*)::int AS c FROM "PlannedActivity" WHERE "userId" = $1`, [userId]))[0].c;

async function makeUser(email: string, timezone: string) {
  await sql(`DELETE FROM "PlannedActivity" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]);
  await sql(`DELETE FROM "Goal" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]);
  const lat = timezone === IST ? 13.0827 : 34.0522;
  const lon = timezone === IST ? 80.2707 : -118.2437;
  const city = timezone === IST ? 'Chennai' : 'Los Angeles';
  const user = await upsertUserByEmail({ email, cityName: city, latitude: lat, longitude: lon, timezone });
  await sql(`UPDATE "User" SET timezone = $2, latitude = $3, longitude = $4, "cityName" = $5 WHERE id = $1`, [user.id, timezone, lat, lon, city]);
  await updateBirthProfile(user.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: city, birthLatitude: lat, birthLongitude: lon, birthTimezone: timezone });
  return { user, tok: await createTestSessionToken(user.id, user.email) };
}

async function main() {
  const emails = ['mr2-sched-a@example.com', 'mr2-sched-b@example.com', 'mr2-sched-la@example.com'];
  const cleanup = async () => {
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" IN (SELECT id FROM "User" WHERE email = ANY($1))`, [emails]);
    await sql(`DELETE FROM "Goal" WHERE "userId" IN (SELECT id FROM "User" WHERE email = ANY($1))`, [emails]);
  };
  try {
    // ================================================================
    // User A (IST): "Run" 2x/week, Mon/Wed/Fri, MORNING, 45 min.
    // ================================================================
    const { user: userA, tok: tokA } = await makeUser(emails[0], IST);
    const today = getDatePartsInTimezone(IST, new Date()).dateStr;
    const next = resolveRhythmPlanningWeek(today, 'NEXT');
    const { goal, activities } = await createGoalWithActivities({ userId: userA.id, title: 'MR2 Fitness', targetDate: null, activities: [{ title: 'Run', activityId: 'running', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } }] });
    const run = activities[0];
    check('S0. setup: preferences saved (Mon/Wed/Fri, MORNING, 45)', (await patch(tokA, goal.id, run.id, { preferences: { preferredWeekdays: [1, 3, 5], preferredTimeOfDay: 'MORNING', preferredDurationMinutes: 45 } })) === 200);

    const plansBefore = await planCount(userA.id);
    const p = await propose(tokA, run.id, 'NEXT');
    check('S1. proposing creates nothing (no plan written before explicit confirmation)', p.status === 200 && (await planCount(userA.id)) === plansBefore);
    check('S2. NEXT proposal is for next Monday..Sunday and offers 2 sessions', p.body.status === 'OK' && p.body.week === 'NEXT' && p.body.weekStartDate === next.startDate && p.body.weekEndDate === next.endDate && p.body.proposals.length === 2);
    const proposals: any[] = p.body.proposals ?? [];
    check('S3. every session is on a preferred weekday inside next week', proposals.every((x) => [1, 3, 5].includes(getWeekdayForDateStr(x.localDate)) && x.localDate >= next.startDate && x.localDate <= next.endDate));
    check('S4. every session uses the preferred 45-minute duration', proposals.every((x) => x.durationMinutes === 45 && new Date(x.end).getTime() - new Date(x.start).getTime() === 45 * 60000));
    check('S5. matched sessions start in the morning; any fallback is explained', proposals.every((x) => (x.matchedPreferences ? localHour(x.start, IST) >= 5 && localHour(x.start, IST) < 12 : (x.notes ?? []).includes(describeTimeOfDayCompromise('MORNING')))));
    check('S6. sessions are on distinct days', new Set(proposals.map((x) => x.localDate)).size === proposals.length);

    // Panchang/Aura Fit ranking still decides: each matched session is the engine's
    // own best MORNING candidate for that day (same context, single-day search).
    const userRow = (await getUserById(userA.id))!;
    const now = new Date();
    const ctx = { now, latitude: userRow.latitude, longitude: userRow.longitude, timezone: IST, tzOffsetMinutes: resolveTzOffsetMinutes(IST, now), personalContext: buildPersonalMuhurtaContextForUser(userRow) };
    let rankingOk = true;
    for (const x of proposals.filter((y) => y.matchedPreferences)) {
      const top = runTimingSearchWithDailyRhythm({ mode: 'FIND', activityId: 'running', durationMinutes: 45, dateRange: { start: x.localDate, end: x.localDate }, timePreference: 'MORNING', limit: 10, context: ctx } as any, IST, { workStart: null, workEnd: null, workDays: [] });
      const best = [...top.candidates].sort((a, b) => b.score - a.score)[0];
      if (!best || best.score > x.score) rankingOk = false;
    }
    check("S7. Panchang ranking is preserved: no matched session scores below the engine's best morning slot that day", rankingOk);
    check('S7b. sessions carry the engine reasons/labels (explainable)', proposals.every((x) => typeof x.label === 'string' && Array.isArray(x.reasons)));

    // Explicit confirmation of NEXT week.
    const sessions = proposals.map((x) => ({ localDate: x.localDate, start: x.start, end: x.end }));
    const acceptanceId = `mr2-acc-${Date.now()}`;
    const a1 = await accept(tokA, run.id, acceptanceId, sessions, 'NEXT');
    check('S8. explicit acceptance of next week -> both ACCEPTED', a1.status === 200 && a1.body.acceptedCount === 2 && a1.body.failedCount === 0);
    const occ = await sql(`SELECT o."scheduledWeekStart", p.status, p."plannedStartAt" FROM "GoalActivityOccurrence" o JOIN "PlannedActivity" p ON p.id = o."plannedActivityId" WHERE o."goalActivityId" = $1 ORDER BY p."plannedStartAt"`, [run.id]);
    check('S9. two goal-linked UPCOMING plans with occurrences frozen to next week', occ.length === 2 && occ.every((o: any) => o.scheduledWeekStart === next.startDate && o.status === 'UPCOMING'));
    check('S10. remaining for next week is now 0', a1.body.remainingThisWeek === 0);
    const snapshot = JSON.stringify(await sql(`SELECT * FROM "PlannedActivity" WHERE "userId" = $1 ORDER BY id`, [userA.id]));

    const a2 = await accept(tokA, run.id, acceptanceId, sessions, 'NEXT');
    check('S11. replaying the same confirmation -> ALREADY_ACCEPTED, no new plan', a2.body.alreadyAcceptedCount === 2 && (await planCount(userA.id)) === plansBefore + 2);
    const nextFriOrOther = [next.startDate, addDays(next.startDate, 2), addDays(next.startDate, 4)].find((d) => !sessions.some((s) => s.localDate === d))!;
    const extraStart = new Date(`${nextFriOrOther}T02:30:00.000Z`);
    const a3 = await accept(tokA, run.id, `mr2-acc-extra-${Date.now()}`, [{ localDate: nextFriOrOther, start: extraStart.toISOString(), end: new Date(extraStart.getTime() + 45 * 60000).toISOString() }], 'NEXT');
    check('S12. a session beyond the weekly target is refused (no duplicate)', a3.body.acceptedCount === 0 && a3.body.failedCount === 1 && (await planCount(userA.id)) === plansBefore + 2);
    const p2 = await propose(tokA, run.id, 'NEXT');
    check('S13. with next week full, the proposal is NOT_ELIGIBLE', p2.body.status === 'NOT_ELIGIBLE');
    const wrongWeek = await accept(tokA, run.id, `mr2-acc-cw-${Date.now()}`, [{ localDate: nextFriOrOther, start: extraStart.toISOString(), end: new Date(extraStart.getTime() + 45 * 60000).toISOString() }]);
    check("S14. a next-week date submitted as CURRENT is still refused (OUTSIDE_CURRENT_WEEK) -- existing semantics", wrongWeek.body.sessions?.[0]?.reason === 'OUTSIDE_CURRENT_WEEK');
    check('S15. invalid week values are rejected (400) by both routes', (await propose(tokA, run.id, 'LATER')).status === 400 && (await accept(tokA, run.id, 'x', sessions, 'later')).status === 400);
    check('S16. none of the refused requests changed the existing plans', JSON.stringify(await sql(`SELECT * FROM "PlannedActivity" WHERE "userId" = $1 ORDER BY id`, [userA.id])) === snapshot);

    // Home: confirmed next session; next week no longer open.
    const h1 = await home(tokA);
    const firstAccepted = occ[0];
    check('S17. Home exposes the CONFIRMED next session (the earliest accepted plan)', h1.status === 'OK' && h1.nextOccurrenceByGoalActivityId?.[run.id]?.start === new Date(firstAccepted.plannedStartAt).toISOString());
    check('S18. Home: next week is complete for this rhythm (not in nextWeekCandidates)', !(h1.nextWeekCandidates ?? []).some((c) => c.goalActivityId === run.id));

    // ================================================================
    // Pause / resume -- consistent exclusion everywhere; plans unchanged.
    // ================================================================
    check('S19. pause -> 200', (await patch(tokA, goal.id, run.id, { paused: true })) === 200);
    const h2 = await home(tokA);
    check('S20. Home lists the rhythm as paused, still showing its confirmed next session', (h2.pausedRhythms ?? []).some((x) => x.goalActivityId === run.id && x.nextOccurrence?.start === new Date(firstAccepted.plannedStartAt).toISOString()));
    check('S21. paused: absent from Home this-week and next-week demand', !h2.candidates.some((c) => c.goalActivityId === run.id) && !(h2.nextWeekCandidates ?? []).some((c) => c.goalActivityId === run.id));
    check('S22. paused: weekly proposal NOT_ELIGIBLE for both weeks', (await propose(tokA, run.id)).body.status === 'NOT_ELIGIBLE' && (await propose(tokA, run.id, 'NEXT')).body.status === 'NOT_ELIGIBLE');
    const autoDeps = { ...createRealGoalDemandCandidatesDeps(), verifySession: () => verifyTestSessionToken(tokA) };
    const autoPaused: any = await resolveAutomaticGoalDemand(autoDeps as any, today, IST, []);
    check('S23. paused: Plan My Day does not auto-suggest it', autoPaused.status === 'OK' && !autoPaused.suggestions.some((c: any) => c.goalActivityId === run.id));
    const handoffDeps = { verifySession: autoDeps.verifySession, listGoalActivities: listGoalActivitiesWithLinkedPlanStatus, loadGoalActivityRhythmFacts };
    const handoffPaused = await resolveGoalActivityHandoff(handoffDeps as any, goal.id, run.id, today, IST);
    check('S24. paused: the Goal -> Plan My Day handoff no longer previews it (MR1 preview inconsistency resolved)', handoffPaused.length === 0);
    check('S25. pausing left the confirmed plans byte-identical', JSON.stringify(await sql(`SELECT * FROM "PlannedActivity" WHERE "userId" = $1 ORDER BY id`, [userA.id])) === snapshot);

    check('S26. resume -> 200', (await patch(tokA, goal.id, run.id, { paused: false })) === 200);
    const handoffResumed = await resolveGoalActivityHandoff(handoffDeps as any, goal.id, run.id, today, IST);
    const h3 = await home(tokA);
    check('S27. resumed: no longer listed as paused', !(h3.pausedRhythms ?? []).some((x) => x.goalActivityId === run.id));
    check('S28. resumed: the handoff is available again and carries the time/duration preferences', handoffResumed.length === 1 && handoffResumed[0].preferences?.preferredTimeOfDay === 'MORNING' && handoffResumed[0].preferences?.preferredDurationMinutes === 45);

    // ================================================================
    // Consistent weekday interpretation across Home, Plan My Day, proposal.
    // ================================================================
    const todayDow = getWeekdayForDateStr(today);
    const otherDows = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== todayDow).slice(0, 2);
    const { goal: g2, activities: acts2 } = await createGoalWithActivities({ userId: userA.id, title: 'MR2 Reading', targetDate: null, activities: [
      { title: 'Read today', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 1 } },
      { title: 'Read other days', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 1 } },
    ] });
    const readToday = acts2.find((x) => x.title === 'Read today')!;
    const readOther = acts2.find((x) => x.title === 'Read other days')!;
    await patch(tokA, g2.id, readToday.id, { preferences: { preferredWeekdays: [todayDow] } });
    await patch(tokA, g2.id, readOther.id, { preferences: { preferredWeekdays: otherDows } });
    const auto2: any = await resolveAutomaticGoalDemand(autoDeps as any, today, IST, []);
    check('C1. Plan My Day auto-suggests the rhythm preferred today', auto2.suggestions.some((c: any) => c.goalActivityId === readToday.id));
    check('C2. Plan My Day does NOT auto-suggest the rhythm not preferred today', !auto2.suggestions.some((c: any) => c.goalActivityId === readOther.id));
    const view = buildHomeGoalRhythmSuggestions(await home(tokA));
    const vToday = view.find((s) => s.goalActivityId === readToday.id);
    const vOther = view.find((s) => s.goalActivityId === readOther.id);
    check('C3. Home: preferred-today rhythm keeps its "today" action; the other gets none', !!vToday && vToday.notPreferredToday !== true && !!vOther && vOther.notPreferredToday === true && resolveGoalRhythmCardActions(vOther, true).todayHandoff === null);
    const pOther = await propose(tokA, readOther.id);
    check('C4. weekly proposal for the other rhythm never offers today', pOther.body.status !== 'OK' || pOther.body.proposals.every((x: any) => x.localDate !== today && otherDows.includes(getWeekdayForDateStr(x.localDate))));

    // ================================================================
    // Plan My Day preview honours the preferred time of day (real engine).
    // ================================================================
    const previewDate = addDays(next.startDate, 1);
    const window = buildExplicitRangeWindow(previewDate, IST, new Date());
    const preview: any = await handleDayConstructorPreviewRequest({
      getSession: () => ({ userId: userA.id }),
      getUser: async () => getUserById(userA.id),
      getBody: async () => ({ targetDate: previewDate, constructionWindowSource: 'EXPLICIT_RANGE', explicitStart: window.explicitStart, explicitEnd: window.explicitEnd, intents: [{ id: 'mr2-evening', title: 'Run', activityId: 'running', durationMinutes: 45, flexibility: 'FLEXIBLE', timePreference: 'EVENING' }] }),
      now: () => new Date(),
      createOrchestratorDeps: createRealDayConstructorOrchestratorDeps,
    } as any);
    const placed = preview.body?.preview?.constructedDay?.proposedItems?.[0];
    check('M1. Plan My Day preview accepts timePreference (200)', preview.httpStatus === 200);
    check('M2. a placed item honours EVENING (17:00-21:00 local), or is deferred rather than misplaced', !placed || (localHour(placed.start, IST) >= 17 && localHour(placed.start, IST) < 21));

    // ================================================================
    // Daily Rhythm work hours stay respected (user B, Mon-Fri 09:00-18:00).
    // 'workout' is a PERSONAL activity for Daily Rhythm ('running' is unclassified).
    // ================================================================
    const { user: userB, tok: tokB } = await makeUser(emails[1], IST);
    await setDailyWorkPreferences(userB.id, { workStart: '09:00', workEnd: '18:00', workDays: [1, 2, 3, 4, 5] });
    const { activities: actsB } = await createGoalWithActivities({ userId: userB.id, title: 'MR2 Work-aware', targetDate: null, activities: [{ title: 'Workout', activityId: 'workout', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 } }] });
    const pB = await propose(tokB, actsB[0].id, 'NEXT');
    const workdayInside = (x: any) => [1, 2, 3, 4, 5].includes(getWeekdayForDateStr(x.localDate)) && localHour(x.start, IST) >= 9 && localHour(x.end, IST) <= 18 && localHour(x.start, IST) < 18;
    check('R0. setup: the work-aware proposal returned sessions', pB.body.status === 'OK' && pB.body.proposals.length > 0);
    check('R1. personal sessions on workdays are outside work hours unless explained as a fallback', pB.body.status === 'OK' && pB.body.proposals.every((x: any) => !workdayInside(x) || (x.notes ?? []).length > 0));

    // ================================================================
    // Timezone: a Los Angeles user's next week is computed in LA.
    // ================================================================
    const { user: userLA, tok: tokLA } = await makeUser(emails[2], LA);
    const todayLA = getDatePartsInTimezone(LA, new Date()).dateStr;
    const nextLA = resolveRhythmPlanningWeek(todayLA, 'NEXT');
    const { goal: gLA, activities: actsLA } = await createGoalWithActivities({ userId: userLA.id, title: 'MR2 LA', targetDate: null, activities: [{ title: 'Run', activityId: 'running', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } }] });
    await patch(tokLA, gLA.id, actsLA[0].id, { preferences: { preferredWeekdays: [2, 4] } });
    const pLA = await propose(tokLA, actsLA[0].id, 'NEXT');
    check('T1. LA next week bounds are LA-local Monday..Sunday', pLA.body.weekStartDate === nextLA.startDate && pLA.body.weekEndDate === nextLA.endDate);
    check('T2. LA sessions fall on Tue/Thu in LA local time, labelled with the LA date', pLA.body.status === 'OK' && pLA.body.proposals.every((x: any) => getDatePartsInTimezone(LA, new Date(x.start)).dateStr === x.localDate && [2, 4].includes(getWeekdayForDateStr(x.localDate))));
    const laSessions = (pLA.body.proposals ?? []).map((x: any) => ({ localDate: x.localDate, start: x.start, end: x.end }));
    const aLA = await accept(tokLA, actsLA[0].id, `mr2-la-${Date.now()}`, laSessions, 'NEXT');
    const laOcc = await sql(`SELECT "scheduledWeekStart", "scheduledWeekTimezone" FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [actsLA[0].id]);
    check('T3. LA acceptance freezes the LA week (scheduledWeekStart = LA next Monday, timezone LA)', aLA.body.acceptedCount === laSessions.length && laOcc.length === laSessions.length && laOcc.every((o: any) => o.scheduledWeekStart === nextLA.startDate && o.scheduledWeekTimezone === LA));
  } finally {
    await cleanup().catch((e) => console.error('cleanup failed', e));
  }
  if (!allPassed) {
    console.error('\nSome checks FAILED.');
    process.exit(1);
  }
  console.log('\nAll checks passed.');
  process.exit(0);
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
