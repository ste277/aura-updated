/**
 * AURA-MP-1 -- feature-switch ROLLBACK compatibility (design 11.5, owner R2).
 * Live database (CI: day-constructor-acceptance-db-tests job). Run locally:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/myPeopleSwitchRollbackDb.test.ts
 *
 *   1. switch ON:  create a name-only person (notes, interests, label,
 *      special days) and a chart person, through the real routes;
 *   2. switch OFF: every existing People screen API, Shared Muhurtham, the
 *      everyday shared timing route, Day Builder, Ask Aura, plans and export
 *      keep working with that name-only person -- no 500, no throw -- the
 *      legacy contract holds, and NOTHING saved is lost or altered by a
 *      legacy edit;
 *   3. switch ON again: every My People field and special day is unchanged.
 */
import { Pool } from 'pg';

import { getSavedPersonForOwner, getUserById, updateBirthProfile, upsertUserByEmail, deleteSavedPerson } from '../apps/web/lib/db';
import { GET as listPeople, POST as createPerson } from '../apps/web/app/api/people/route';
import { GET as getPerson, PATCH as patchPerson, DELETE as deletePerson } from '../apps/web/app/api/people/[personId]/route';
import { GET as listOccasions, POST as createOccasion } from '../apps/web/app/api/people/[personId]/occasions/route';
import { PATCH as patchOccasion, DELETE as deleteOccasion } from '../apps/web/app/api/people/[personId]/occasions/[occasionId]/route';
import { GET as upcoming } from '../apps/web/app/api/people/occasions/upcoming/route';
import { GET as exportData } from '../apps/web/app/api/users/export/route';
import { POST as createPlan } from '../apps/web/app/api/plans/route';
import { POST as muhurthamSearch } from '../apps/web/app/api/muhurtham-search/route';
import { POST as sharedTiming } from '../apps/web/app/api/timing-search/shared/route';
import { buildIntentionalDaySuggestions } from '../apps/web/lib/dayBuilderOrchestrator';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import { orchestrateAskAura, AskAuraOrchestratorDeps } from '../apps/web/lib/askAuraOrchestrator';
import { parseAskAuraRequest } from '../packages/recommendation/src/askAuraIntent';
import { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';
import { getDatePartsInTimezone, addDaysToDateStr } from '../apps/web/lib/timezone';
import { createTestSessionToken, TEST_SESSION_COOKIE } from './authSessionTestSupport';

let allPassed = true;
function check(label: string, condition: boolean, detail?: unknown) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${!condition && detail !== undefined ? ` -- ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
  if (!condition) allPassed = false;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows;
const fakeReq = (token: string, body?: unknown, url = 'http://localhost/api/people'): any => ({
  cookies: { get: (n: string) => (n === TEST_SESSION_COOKIE ? { value: token } : undefined) },
  json: async () => body,
  headers: new Headers(),
  nextUrl: new URL(url),
});
const call = async (fn: (req: any, ctx?: any) => Promise<Response>, token: string, body?: unknown, params?: Record<string, string>, url?: string) => {
  const res = await fn(fakeReq(token, body, url), params ? { params } : undefined);
  return { status: res.status, body: await res.json().catch(() => null) as any };
};
// R1 F2: the AUTHORITATIVE server flag. The public presentation flag is set
// to '1' throughout to prove it can never keep the server enabled.
const setSwitch = (on: boolean) => {
  process.env.NEXT_PUBLIC_AURA_MY_PEOPLE = '1';
  if (on) process.env.AURA_MY_PEOPLE_ENABLED = '1';
  else delete process.env.AURA_MY_PEOPLE_ENABLED;
};
const TZ = 'Asia/Kolkata';
const CHART = { birthDate: '1993-07-21', birthTime: '06:40', birthTimezone: TZ, birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707 };

async function main() {
  const tag = `mp1rb-${Date.now()}`;
  const owner = await upsertUserByEmail({ email: `owner-${tag}@mp1.aura.local`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(owner.id, { birthDate: '1990-01-15', birthTime: '07:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const token = await createTestSessionToken(owner.id, owner.email);
  const today = getDatePartsInTimezone(TZ, new Date()).dateStr;
  const range = { start: addDaysToDateStr(today, 3), end: addDaysToDateStr(today, 9) };

  // ===================== 1. switch ON =====================
  setSwitch(true);
  const meera = await call(createPerson, token, { name: 'Meera', relationshipType: 'SIBLING', relationshipLabel: 'Akka', interests: ['Kolam', 'Cricket'], notes: 'Private: new job in March', locationName: 'Coimbatore' });
  const priya = await call(createPerson, token, { name: 'Priya', relationshipType: 'PARTNER', chart: CHART });
  const extra = await call(createPerson, token, { name: 'Temp Person' });
  check('1.1 ON: name-only Meera (SIBLING, label, interests, notes) and chart person Priya created', meera.status === 201 && priya.status === 201 && extra.status === 201, { meera, priya });
  const bday = await call(createOccasion, token, { kind: 'BIRTHDAY', month: 2, day: 29 }, { personId: meera.body.id });
  const other = await call(createOccasion, token, { kind: 'OTHER', label: 'Housewarming', month: 12, day: 14, year: 2025, remindDaysBefore: 3 }, { personId: meera.body.id });
  check('1.2 ON: two special days saved for Meera (29 Feb, no year; OTHER with a year)', bday.status === 201 && other.status === 201);
  const snapshot = async () => {
    const row = await getSavedPersonForOwner(owner.id, meera.body.id);
    const occ = await sql(`SELECT kind, label, calendar, month, day, year, "remindDaysBefore" FROM "PersonOccasion" WHERE "savedPersonId" = $1 ORDER BY kind`, [meera.body.id]);
    return { label: row?.relationshipLabel, interests: row?.interests, notes: row?.notes, locationName: row?.locationName, occ };
  };
  const snapOn = await snapshot();

  // ===================== 2. switch OFF =====================
  setSwitch(false);
  const list = await call(listPeople, token);
  const meeraRow = list.body?.find?.((p: any) => p.id === meera.body.id);
  check('2.1 OFF: GET /api/people -> 200; the name-only person is listed with null chart fields and hasChartDetails false', list.status === 200 && meeraRow?.birthDate === null && meeraRow?.hasChartDetails === false, list);
  check('2.2 OFF: the list response omits My People fields (notes, interests) -- legacy shape', meeraRow && !('notes' in meeraRow) && !('interests' in meeraRow) && !('nextOccasion' in meeraRow));
  const detail = await call(getPerson, token, undefined, { personId: meera.body.id });
  check('2.3 OFF: GET detail -> 200 with natalContext null (no crash on null birth fields)', detail.status === 200 && detail.body.natalContext === null && !('notes' in detail.body));
  const legacyEdit = await call(patchPerson, token, { name: 'Meera R', relationshipType: 'FRIEND' }, { personId: meera.body.id });
  check('2.4 OFF: a legacy edit of a name-only person (name + relationship, no chart keys) -> 200', legacyEdit.status === 200 && legacyEdit.body.name === 'Meera R', legacyEdit);
  const priyaLegacyEdit = await call(patchPerson, token, { name: 'Priya', relationshipType: 'PARTNER', ...CHART, birthTime: '06:45' }, { personId: priya.body.id });
  check('2.5 OFF: a legacy full-body edit of a chart person still replaces the chart (unchanged behaviour)', priyaLegacyEdit.status === 200 && priyaLegacyEdit.body.birthTime === '06:45');
  check('2.6 OFF: the legacy edit did NOT touch any My People data', JSON.stringify(await snapshot()) === JSON.stringify(snapOn), { now: await snapshot(), snapOn });
  check('2.7 OFF: writing a My People field is refused (400) and changes nothing', (await call(patchPerson, token, { notes: 'overwrite' }, { personId: meera.body.id })).status === 400 && (await getSavedPersonForOwner(owner.id, meera.body.id))?.notes === snapOn.notes);
  check('2.8 OFF: legacy create contract -- name-only POST is a 400', (await call(createPerson, token, { name: 'Nobody' })).status === 400);
  const occRoutes = [
    await call(listOccasions, token, undefined, { personId: meera.body.id }),
    await call(createOccasion, token, { kind: 'ANNIVERSARY', month: 1, day: 1 }, { personId: meera.body.id }),
    await call(patchOccasion, token, { month: 3 }, { personId: meera.body.id, occasionId: bday.body.id }),
    await call(deleteOccasion, token, undefined, { personId: meera.body.id, occasionId: bday.body.id }),
    await call(upcoming, token, undefined, undefined, 'http://localhost/api/people/occasions/upcoming'),
  ];
  check('2.9 OFF: every special-day route is 404', occRoutes.every((r) => r.status === 404), occRoutes.map((r) => r.status));
  check('2.10 OFF: ...and the special-day rows are still in the database', JSON.stringify((await snapshot()).occ) === JSON.stringify(snapOn.occ));

  const sharedMeera = await call(muhurthamSearch, token, { activityId: 'start-journey', dateRange: range, scope: 'SHARED', savedPersonId: meera.body.id });
  check('2.11 OFF: SHARED Muhurtham with a name-only person -> friendly 422 CHART_DETAILS_REQUIRED (never a 500)', sharedMeera.status === 422 && sharedMeera.body.code === 'CHART_DETAILS_REQUIRED' && /birth details/.test(sharedMeera.body.error), sharedMeera);
  const sharedPriya = await call(muhurthamSearch, token, { activityId: 'start-journey', dateRange: range, scope: 'SHARED', savedPersonId: priya.body.id });
  check('2.12 OFF: SHARED Muhurtham with a chart person -> 200 (existing behaviour preserved)', sharedPriya.status === 200, { status: sharedPriya.status, error: sharedPriya.body?.error });
  const everyday = await call(sharedTiming, token, { activityId: 'coffee-tea', durationMinutes: 45, dateRange: range, savedPersonId: meera.body.id });
  check('2.13 OFF: everyday shared timing with a name-only person -> 200 (partner side neutral)', everyday.status === 200, { status: everyday.status, error: everyday.body?.error });

  const user = (await getUserById(owner.id))!;
  const NOW = new Date();
  const localNow = getDatePartsInTimezone(TZ, NOW);
  const agenda = buildDailyAgenda({ now: NOW, localDate: localNow.dateStr, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  let dayBuilderOk = true;
  let dayBuilderError: unknown = null;
  try {
    // SOCIAL only, Meera (now FRIEND) as the priority person: the shared path runs for a name-only person.
    const socialOnly = { ...user, dayBuilderEnabled: true, dayBuilderMutedGroups: ['RELATIONSHIPS', 'FAMILY', 'WORK', 'SELF', 'ENJOYMENT'], dayBuilderPriorityPersonIds: [meera.body.id] };
    await buildIntentionalDaySuggestions({ user: socialOnly, agenda, minuteOfDay: 9 * 60, now: NOW });
  } catch (err) {
    dayBuilderOk = false;
    dayBuilderError = String(err);
  }
  check('2.14 OFF: Day Builder with a name-only priority person runs without error', dayBuilderOk, dayBuilderError);

  const context: DailyAssistantContext = { now: NOW, latitude: user.latitude, longitude: user.longitude, timezone: TZ, tzOffsetMinutes: 330 };
  const deps: AskAuraOrchestratorDeps = { userId: owner.id, user, context, activeWindow: 'NEUTRAL' };
  const askEveryday = await orchestrateAskAura(parseAskAuraRequest('Best time for a date with Meera this weekend', { now: NOW }), deps).catch((e) => ({ thrown: String(e) }) as any);
  check('2.15 OFF: Ask Aura everyday shared find with a name-only person -> a normal answer (no throw)', !('thrown' in askEveryday) && typeof askEveryday.message === 'string', askEveryday);
  const askMarriage = await orchestrateAskAura(parseAskAuraRequest('Find the best wedding date for Meera and me next month.', { now: NOW, timezone: TZ }), deps).catch((e) => ({ thrown: String(e) }) as any);
  check('2.16 OFF: Ask Aura SHARED Muhurtham search with a name-only person -> the friendly "add birth details" reply', !('thrown' in askMarriage) && /birth details/.test(askMarriage.message ?? ''), askMarriage);
  const askCheck = await orchestrateAskAura(parseAskAuraRequest('Is 10 AM tomorrow good for Meera and me to get married?', { now: NOW, timezone: TZ }), deps).catch((e) => ({ thrown: String(e) }) as any);
  check('2.17 OFF: Ask Aura SHARED Muhurtham check with a name-only person -> the friendly reply', !('thrown' in askCheck) && /birth details/.test(askCheck.message ?? ''), askCheck);

  const start = new Date(Date.now() + 4 * 86_400_000);
  const end = new Date(start.getTime() + 45 * 60_000);
  const plan = await call(createPlan, token, { title: `${tag} coffee`, activityType: 'coffee', plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString(), durationMinutes: 45, windowType: 'NEUTRAL', savedPersonId: meera.body.id });
  const planLink = (await sql(`SELECT "savedPersonId" FROM "PlannedActivity" WHERE id = $1`, [plan.body?.id]))[0];
  check('2.18 OFF: /api/plans still creates the plan, and IGNORES savedPersonId (no link written)', (plan.status === 200 || plan.status === 201) && planLink && planLink.savedPersonId === null, plan);

  const exp = await call(exportData, token);
  const expMeera = exp.body?.people?.find((p: any) => p.id === meera.body.id);
  check('2.19 OFF: export still includes the name-only person with notes and both special days', exp.status === 200 && expMeera?.notes === snapOn.notes && expMeera?.occasions?.length === 2);
  const del = await call(deletePerson, token, undefined, { personId: extra.body.id });
  check('2.20 OFF: deleting a name-only person works (atomic delete is always on)', del.status === 200 && (await getSavedPersonForOwner(owner.id, extra.body.id)) === null);

  // ===================== 3. switch ON again =====================
  setSwitch(true);
  const back = await call(getPerson, token, undefined, { personId: meera.body.id });
  check('3.1 ON again: every My People field is back, unchanged', back.status === 200 && back.body.relationshipLabel === 'Akka' && back.body.notes === snapOn.notes && JSON.stringify(back.body.interests) === JSON.stringify(snapOn.interests) && back.body.locationName === 'Coimbatore', back.body);
  check('3.2 ON again: both special days are back, unchanged', back.body.occasions?.length === 2 && JSON.stringify((await snapshot()).occ) === JSON.stringify(snapOn.occ));
  check('3.3 ON again: the legacy edit made while off is kept (name Meera R, FRIEND)', back.body.name === 'Meera R' && back.body.relationshipType === 'FRIEND');
  const upOn = await call(upcoming, token, undefined, undefined, 'http://localhost/api/people/occasions/upcoming?days=60');
  check('3.4 ON again: special-day routes live again', upOn.status === 200 && Array.isArray(upOn.body));

  await deleteSavedPerson(owner.id, meera.body.id).catch(() => {});
  await deleteSavedPerson(owner.id, priya.body.id).catch(() => {});
  await sql(`DELETE FROM "PlannedActivity" WHERE title LIKE $1`, [`${tag}%`]);
}

main()
  .catch((err) => {
    console.error(err);
    allPassed = false;
  })
  .finally(async () => {
    await pool.end();
    if (!allPassed) {
      console.error('\nSOME MY PEOPLE SWITCH ROLLBACK CHECKS FAILED');
      process.exit(1);
    }
    console.log('\nALL MY PEOPLE SWITCH ROLLBACK CHECKS PASSED');
    process.exit(0);
  });
