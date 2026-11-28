/**
 * AURA-MR3 -- the UI <-> API seam for My Rhythm preferences, against a real
 * Postgres (CI: "Day Constructor acceptance DB tests" job).
 *
 * Every write here is the EXACT body the editor would send: the saved state
 * is read through the real GET /api/goals/:goalId read model, adapted with
 * savedRhythmSettingsFromActivity, edited as a draft, and turned into a PATCH
 * body by buildRhythmSettingsPatch -- then sent through the real PATCH route.
 * Scheduling consumers (weekly proposal, Plan My Day handoff) are then read
 * back to prove the saved preferences flow through. MR1/MR2's own suites
 * (myRhythmFoundationDb, myRhythmSchedulingDb) keep covering the backend
 * rules themselves; this file does not re-test them.
 */
import { PATCH as rhythmRoute } from '../apps/web/app/api/goals/[goalId]/activities/[goalActivityId]/rhythm/route';
import { GET as goalDetailRoute } from '../apps/web/app/api/goals/[goalId]/route';
import { POST as proposalRoute } from '../apps/web/app/api/daily-assistant/goal-rhythm/weekly-proposal/route';
import { POST as plansRoute } from '../apps/web/app/api/plans/route';
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, beginTransaction, listGoalActivitiesWithLinkedPlanStatus, loadGoalActivityRhythmFacts } from '../apps/web/lib/db';

import { getDatePartsInTimezone } from '../apps/web/lib/timezone';
import { getWeekdayForDateStr } from '../apps/web/lib/availabilityContext';
import { resolveGoalActivityHandoff } from '../apps/web/lib/planDayBootstrap';
import { buildRhythmSettingsPatch, draftFromSaved, savedRhythmSettingsFromActivity, type RhythmSettingsDraft } from '../apps/web/lib/rhythmPreferencesDraft';
import { createTestSessionToken, TEST_SESSION_COOKIE, verifyTestSessionToken } from './authSessionTestSupport';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const IST = 'Asia/Kolkata';
const EMAIL = 'mr3-ui-db@example.com';

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
const localHour = (iso: string) => Number(new Date(iso).toLocaleString('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: IST }));

async function main() {
  const cleanup = async () => {
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [EMAIL]);
    await sql(`DELETE FROM "Goal" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [EMAIL]);
  };
  await cleanup();
  try {
    const user = await upsertUserByEmail({ email: EMAIL, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: IST });
    await sql(`UPDATE "User" SET timezone = $2 WHERE id = $1`, [user.id, IST]);
    await updateBirthProfile(user.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: IST });
    const tok = await createTestSessionToken(user.id, user.email);

    const { goal, activities } = await createGoalWithActivities({ userId: user.id, title: 'MR3 Strength', targetDate: null, activities: [
      { title: 'Strength training', activityId: 'workout', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } },
      { title: 'Stretch', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 } },
    ] });
    const strength = activities.find((a) => a.title === 'Strength training')!;
    const stretch = activities.find((a) => a.title === 'Stretch')!;

    const load = async (id: string) => {
      const res: any = await goalDetailRoute(req(tok), { params: { goalId: goal.id } });
      const body = await res.json();
      return body.activities.find((a: any) => a.id === id);
    };
    const save = async (id: string, edit: (d: RhythmSettingsDraft) => RhythmSettingsDraft) => {
      const saved = savedRhythmSettingsFromActivity(await load(id));
      const body = buildRhythmSettingsPatch(edit(draftFromSaved(saved)), saved);
      if (body === null) return { status: 0, body: null as any, sent: null };
      const res: any = await rhythmRoute(req(tok, body), { params: { goalId: goal.id, goalActivityId: id } });
      return { status: res.status, body: await res.json(), sent: body };
    };
    const propose = async (id: string, week?: 'CURRENT' | 'NEXT') => {
      const r: any = await proposalRoute(req(tok, week ? { goalActivityId: id, week } : { goalActivityId: id }));
      return { status: r.status, body: await r.json() };
    };
    const planRows = async () => JSON.stringify(await sql(`SELECT * FROM "PlannedActivity" WHERE "userId" = $1 ORDER BY id`, [user.id]));

    // ---------------------------------------------------------------
    // 1. Scenario 1: 3x/week, Mon/Wed/Fri, Morning, 45 min.
    // ---------------------------------------------------------------
    const before = await load(strength.id);
    check('D0. a rhythm without preferences reads back as active with empty preferences', before.rhythmPaused === false && before.rhythmPreferences.preferredWeekdays.length === 0 && before.rhythmPreferences.preferredTimeOfDay === null && before.rhythmPreferences.preferredDurationMinutes === null);
    const s1 = await save(strength.id, (d) => ({ ...d, frequency: { kind: 'N_PER_WEEK', targetPerWeek: 3 }, preferredWeekdays: [1, 3, 5], preferredTimeOfDay: 'MORNING', durationText: '45' }));
    check('D1. the editor sends one PATCH with rhythm + all three preferences, accepted (200)', s1.status === 200 && s1.sent?.rhythm?.kind === 'N_PER_WEEK' && JSON.stringify(s1.sent?.preferences) === JSON.stringify({ preferredWeekdays: [1, 3, 5], preferredTimeOfDay: 'MORNING', preferredDurationMinutes: 45 }));
    const r1 = await load(strength.id);
    check('D2. reload: frequency and every preference persisted', r1.rhythm.kind === 'N_PER_WEEK' && r1.rhythm.targetPerWeek === 3 && JSON.stringify(r1.rhythmPreferences) === JSON.stringify({ preferredWeekdays: [1, 3, 5], preferredTimeOfDay: 'MORNING', preferredDurationMinutes: 45 }));
    const unchanged = await save(strength.id, (d) => d);
    check('D3. re-saving an untouched draft sends nothing (no spurious write)', unchanged.sent === null);

    // ---------------------------------------------------------------
    // 2. Editing each preference independently never resets the others.
    // ---------------------------------------------------------------
    const e1 = await save(strength.id, (d) => ({ ...d, preferredTimeOfDay: 'EVENING' }));
    check('D4. editing only the time sends only preferredTimeOfDay', e1.status === 200 && JSON.stringify(e1.sent) === JSON.stringify({ preferences: { preferredTimeOfDay: 'EVENING' } }));
    const afterTime = await load(strength.id);
    check('D5. ...and days/duration are untouched', JSON.stringify(afterTime.rhythmPreferences) === JSON.stringify({ preferredWeekdays: [1, 3, 5], preferredTimeOfDay: 'EVENING', preferredDurationMinutes: 45 }));
    const e2 = await save(strength.id, (d) => ({ ...d, durationText: '60' }));
    const e3 = await save(strength.id, (d) => ({ ...d, preferredWeekdays: [1, 2, 4, 5] }));
    const afterAll = await load(strength.id);
    check('D6. duration-only and days-only edits each persist alone', e2.status === 200 && e3.status === 200 && JSON.stringify(afterAll.rhythmPreferences) === JSON.stringify({ preferredWeekdays: [1, 2, 4, 5], preferredTimeOfDay: 'EVENING', preferredDurationMinutes: 60 }));

    // ---------------------------------------------------------------
    // 3. Clearing optional preferences returns to flexible.
    // ---------------------------------------------------------------
    const c1 = await save(strength.id, (d) => ({ ...d, preferredWeekdays: [], preferredTimeOfDay: null, durationText: '' }));
    const cleared = await load(strength.id);
    check('D7. clearing days/time/duration sends [] / null / null and reads back flexible', c1.status === 200 && JSON.stringify(c1.sent?.preferences) === JSON.stringify({ preferredWeekdays: [], preferredTimeOfDay: null, preferredDurationMinutes: null }) && cleared.rhythmPreferences.preferredWeekdays.length === 0 && cleared.rhythmPreferences.preferredTimeOfDay === null && cleared.rhythmPreferences.preferredDurationMinutes === null);
    check('D8. clearing preferences keeps the weekly frequency', cleared.rhythm.kind === 'N_PER_WEEK' && cleared.rhythm.targetPerWeek === 3);

    // ---------------------------------------------------------------
    // 4. Invalid combinations: the editor blocks them; the server agrees.
    // ---------------------------------------------------------------
    const savedNow = savedRhythmSettingsFromActivity(await load(strength.id));
    check('D9. editor refuses 3x/week on 2 days (no body built)', buildRhythmSettingsPatch({ ...draftFromSaved(savedNow), preferredWeekdays: [1, 3] }, savedNow) === null);
    const fpBefore = JSON.stringify(await sql(`SELECT * FROM "GoalActivity" WHERE id = $1`, [strength.id]));
    const raw: any = await rhythmRoute(req(tok, { preferences: { preferredWeekdays: [1, 3] } }), { params: { goalId: goal.id, goalActivityId: strength.id } });
    const rawDur: any = await rhythmRoute(req(tok, { preferences: { preferredDurationMinutes: 5 } }), { params: { goalId: goal.id, goalActivityId: strength.id } });
    check('D10. the same requests sent directly are rejected 400 and change nothing', raw.status === 400 && rawDur.status === 400 && JSON.stringify(await sql(`SELECT * FROM "GoalActivity" WHERE id = $1`, [strength.id])) === fpBefore);

    // Restore scenario 1 for the scheduling checks.
    await save(strength.id, (d) => ({ ...d, preferredWeekdays: [1, 3, 5], preferredTimeOfDay: 'MORNING', durationText: '45' }));

    // ---------------------------------------------------------------
    // 5. Saved preferences flow into scheduling (scenario 3/4/5).
    // ---------------------------------------------------------------
    const plansBefore = await planRows();
    const p = await propose(strength.id, 'NEXT');
    const proposals: any[] = p.body.proposals ?? [];
    check('D11. next-week proposal OK with 3 sessions', p.status === 200 && p.body.status === 'OK' && proposals.length === 3);
    check('D12. every proposed session is on Mon/Wed/Fri', proposals.every((x) => [1, 3, 5].includes(getWeekdayForDateStr(x.localDate))));
    check('D13. every proposed session is 45 minutes', proposals.every((x) => x.durationMinutes === 45 && new Date(x.end).getTime() - new Date(x.start).getTime() === 45 * 60000));
    check('D14. matched sessions are in the morning; any fallback is flagged', proposals.every((x) => (x.matchedPreferences ? localHour(x.start) >= 5 && localHour(x.start) < 12 : x.matchedPreferences === false)));
    check('D15. proposing (and then cancelling) creates no plan', (await planRows()) === plansBefore);

    const today = getDatePartsInTimezone(IST, new Date()).dateStr;
    const handoffDeps = { getSessionToken: () => tok, verifySession: (t: string) => verifyTestSessionToken(t), listGoalActivities: listGoalActivitiesWithLinkedPlanStatus, loadGoalActivityRhythmFacts };
    const handoff = await resolveGoalActivityHandoff(handoffDeps as any, goal.id, strength.id, today, IST);
    check('D16. "Just today" / Plan with Aura handoff carries the 45-minute duration and Morning preference', handoff.length === 1 && handoff[0].preferences?.preferredDurationMinutes === 45 && handoff[0].preferences?.preferredTimeOfDay === 'MORNING');

    // ---------------------------------------------------------------
    // 6. Pause / resume (scenario 6/7) with a confirmed plan in place.
    // ---------------------------------------------------------------
    const start = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const planRes: any = await plansRoute(req(tok, { title: 'Strength training', plannedStartAt: start.toISOString(), plannedEndAt: new Date(start.getTime() + 45 * 60000).toISOString(), durationMinutes: 45, windowType: 'NEUTRAL', goalActivityId: strength.id }));
    check('D17. setup: a confirmed goal-linked plan exists', planRes.status === 200 || planRes.status === 201);
    const confirmedBefore = await planRows();

    const pauseRes: any = await rhythmRoute(req(tok, { paused: true }), { params: { goalId: goal.id, goalActivityId: strength.id } });
    const paused = await load(strength.id);
    check('D18. Pause (the editor\'s { paused: true }) -> 200 and reads back paused', pauseRes.status === 200 && paused.rhythmPaused === true);
    check('D19. pausing preserved every preference and the frequency', JSON.stringify(paused.rhythmPreferences) === JSON.stringify({ preferredWeekdays: [1, 3, 5], preferredTimeOfDay: 'MORNING', preferredDurationMinutes: 45 }) && paused.rhythm.targetPerWeek === 3);
    check('D20. paused: no weekly suggestions for either week', (await propose(strength.id)).body.status === 'NOT_ELIGIBLE' && (await propose(strength.id, 'NEXT')).body.status === 'NOT_ELIGIBLE');
    check('D21. paused: the Plan My Day handoff is suppressed', (await resolveGoalActivityHandoff(handoffDeps as any, goal.id, strength.id, today, IST)).length === 0);
    check('D22. pausing left the confirmed plan byte-identical', (await planRows()) === confirmedBefore);
    const editWhilePaused = await save(strength.id, (d) => ({ ...d, durationText: '50' }));
    check('D23. editing while paused saves but does not resume', editWhilePaused.status === 200 && (await load(strength.id)).rhythmPaused === true);
    await save(strength.id, (d) => ({ ...d, durationText: '45' }));

    const resumeRes: any = await rhythmRoute(req(tok, { paused: false }), { params: { goalId: goal.id, goalActivityId: strength.id } });
    const resumed = await load(strength.id);
    check('D24. Resume -> 200; preferences restored exactly', resumeRes.status === 200 && resumed.rhythmPaused === false && JSON.stringify(resumed.rhythmPreferences) === JSON.stringify({ preferredWeekdays: [1, 3, 5], preferredTimeOfDay: 'MORNING', preferredDurationMinutes: 45 }));
    check('D25. resuming created no plan and changed no confirmed plan', (await planRows()) === confirmedBefore);
    const afterResume = await propose(strength.id, 'NEXT');
    check('D26. resumed: next-week suggestions are eligible again', afterResume.body.status === 'OK');
    const twice1: any = await rhythmRoute(req(tok, { paused: false }), { params: { goalId: goal.id, goalActivityId: strength.id } });
    check('D27. a duplicate Resume is harmless (200, still active, no plan change)', twice1.status === 200 && (await load(strength.id)).rhythmPaused === false && (await planRows()) === confirmedBefore);

    // ---------------------------------------------------------------
    // 7. Edit -> subsequent suggestions reflect it (scenario 8).
    // ---------------------------------------------------------------
    await save(strength.id, (d) => ({ ...d, preferredWeekdays: [2, 4, 6], preferredTimeOfDay: 'EVENING', durationText: '30' }));
    const p2 = await propose(strength.id, 'NEXT');
    const props2: any[] = p2.body.proposals ?? [];
    check('D28. after editing, next-week sessions use Tue/Thu/Sat and 30 min', p2.body.status === 'OK' && props2.length > 0 && props2.every((x) => [2, 4, 6].includes(getWeekdayForDateStr(x.localDate)) && x.durationMinutes === 30));
    check('D29. ...and matched sessions are now in the evening', props2.every((x) => (x.matchedPreferences ? localHour(x.start) >= 17 && localHour(x.start) < 21 : x.matchedPreferences === false)));

    // ---------------------------------------------------------------
    // 8. A rhythm with no optional preferences keeps working (scenario 9).
    // ---------------------------------------------------------------
    const plain = await load(stretch.id);
    const pPlain = await propose(stretch.id, 'NEXT');
    check('D30. a no-preference rhythm still proposes sessions with no preference constraint', plain.rhythmPreferences.preferredWeekdays.length === 0 && pPlain.body.status === 'OK' && (pPlain.body.proposals ?? []).length === 3);
    const freqOnly = await save(stretch.id, (d) => ({ ...d, frequency: { kind: 'N_PER_WEEK', targetPerWeek: 2 } }));
    check('D31. a frequency-only edit sends only { rhythm } (preferences never touched)', freqOnly.status === 200 && JSON.stringify(freqOnly.sent) === JSON.stringify({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } }));

    // ---------------------------------------------------------------
    // 9. Switching to a one-off clears preferences server-side.
    // ---------------------------------------------------------------
    const once = await save(strength.id, (d) => ({ ...d, frequency: { kind: 'NONE' } }));
    const onceRow = await load(strength.id);
    check('D32. "Once" sends only { rhythm: NONE }; server clears preferences and keeps the confirmed plan', once.status === 200 && JSON.stringify(once.sent) === JSON.stringify({ rhythm: { kind: 'NONE' } }) && onceRow.rhythm.kind === 'NONE' && onceRow.rhythmPreferences.preferredWeekdays.length === 0 && onceRow.rhythmPreferences.preferredDurationMinutes === null && (await planRows()) === confirmedBefore);
  } finally {
    await cleanup();
  }
  console.log(allPassed ? '\nALL MR3 UI DB CHECKS PASSED' : '\nSOME MR3 UI DB CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
