/**
 * AURA-MP-1 -- live-database suite for the My People data and API
 * foundation. Requires a real, disposable Postgres with the full migration
 * chain applied (CI: day-constructor-acceptance-db-tests job). Run locally:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/myPeopleDb.test.ts
 *
 * Proves, through the REAL route handlers and db.ts:
 *   A. name-only person (switch on) + every optional field round-trips;
 *   B. partial PATCH preserves chart details byte-identically; a partial
 *      chart is a 400; chart:null clears all six chart columns together;
 *      the DB CHECK itself refuses a half chart;
 *   C. special days CRUD, one birthday per person (409), limits;
 *   D. ACCOUNT ISOLATION: user B gets 404 and changes nothing on every
 *      person / special-day route with user A's ids; the composite FK refuses
 *      a special day filed under another owner's person; /api/plans refuses
 *      A's person for B and the INSERT itself never stores a cross-owner link;
 *   E. ATOMIC DELETE: every reference cleaned in one transaction; plans and
 *      moments kept with their link cleared; an injected failure at the last
 *      step rolls EVERYTHING back;
 *   F. EXPORT: A's export holds exactly A's people, notes and special days.
 */
import { Pool } from 'pg';
import { createSessionToken } from '../apps/web/lib/auth';
import { createSavedPerson, deleteSavedPerson, getSavedPersonForOwner, upsertUserByEmail } from '../apps/web/lib/db';
import { GET as listPeople, POST as createPerson } from '../apps/web/app/api/people/route';
import { GET as getPerson, PATCH as patchPerson, DELETE as deletePerson } from '../apps/web/app/api/people/[personId]/route';
import { GET as listOccasions, POST as createOccasion } from '../apps/web/app/api/people/[personId]/occasions/route';
import { PATCH as patchOccasion, DELETE as deleteOccasion } from '../apps/web/app/api/people/[personId]/occasions/[occasionId]/route';
import { GET as upcoming } from '../apps/web/app/api/people/occasions/upcoming/route';
import { GET as exportData } from '../apps/web/app/api/users/export/route';
import { POST as createPlan } from '../apps/web/app/api/plans/route';

let allPassed = true;
function check(label: string, condition: boolean, detail?: unknown) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${!condition && detail !== undefined ? ` -- ${JSON.stringify(detail)}` : ''}`);
  if (!condition) allPassed = false;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows;

const fakeReq = (token: string | undefined, body?: unknown, url = 'http://localhost/api/people'): any => ({
  cookies: { get: (n: string) => (token !== undefined && n === 'as_session' ? { value: token } : undefined) },
  json: async () => body,
  headers: new Headers(),
  nextUrl: new URL(url),
});
type Res = { status: number; body: any };
const call = async (fn: (req: any, ctx?: any) => Promise<Response>, token: string, body?: unknown, params?: Record<string, string>, url?: string): Promise<Res> => {
  const res = await fn(fakeReq(token, body, url), params ? { params } : undefined);
  return { status: res.status, body: await res.json().catch(() => null) };
};

const CHART = { birthDate: '1992-03-14', birthTime: '08:15', birthTimezone: 'Asia/Kolkata', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707 };
const chartCols = async (id: string) => (await sql(`SELECT "birthDate", "birthTime", "birthTimezone", "birthCityName", "birthLatitude", "birthLongitude" FROM "SavedPerson" WHERE id = $1`, [id]))[0];

async function main() {
  process.env.AURA_MY_PEOPLE_ENABLED = '1'; // R1 F2: the authoritative server flag
  const tag = `mp1-${Date.now()}`;
  const mk = async (key: string) => {
    const u = await upsertUserByEmail({ email: `${key}-${tag}@mp1.aura.local`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
    return { ...u, token: createSessionToken(u.id, u.email) };
  };
  const A = await mk('a');
  const B = await mk('b');

  // ================= A. name-only + optional fields =================
  const ravi = await call(createPerson, A.token, { name: 'Ravi' });
  check('A1 POST name-only (switch on) -> 201, no chart, hasChartDetails false', ravi.status === 201 && ravi.body.birthDate === null && ravi.body.birthTime === null && ravi.body.hasChartDetails === false, ravi);
  const amma = await call(createPerson, A.token, { name: 'Amma', relationshipType: 'PARENT', relationshipLabel: 'Amma', locationName: 'Madurai', timezone: 'Asia/Kolkata', interests: ['Carnatic music'], notes: 'Private: knee surgery in Jan', chart: CHART });
  check('A2 POST with every optional field + chart -> 201, all stored', amma.status === 201 && amma.body.relationshipType === 'PARENT' && amma.body.notes === 'Private: knee surgery in Jan' && amma.body.interests[0] === 'Carnatic music' && amma.body.hasChartDetails === true, amma);
  const ammaDetail = await call(getPerson, A.token, undefined, { personId: amma.body.id });
  check('A3 GET detail: natalContext derived for a chart person', ammaDetail.status === 200 && Boolean(ammaDetail.body.natalContext?.janmaNakshatra));
  const raviDetail = await call(getPerson, A.token, undefined, { personId: ravi.body.id });
  check('A4 GET detail: natalContext null for a name-only person (no crash)', raviDetail.status === 200 && raviDetail.body.natalContext === null);

  // ================= B. partial PATCH preserves chart =================
  const before = await chartCols(amma.body.id);
  const p1 = await call(patchPerson, A.token, { name: 'Amma K', notes: 'Updated note' }, { personId: amma.body.id });
  const after = await chartCols(amma.body.id);
  check('B1 PATCH {name, notes} -> 200 and all six chart columns byte-identical', p1.status === 200 && JSON.stringify(before) === JSON.stringify(after) && p1.body.name === 'Amma K', { before, after });
  const p2 = await call(patchPerson, A.token, { birthTime: '09:00' }, { personId: amma.body.id });
  check('B2 PATCH with a partial chart -> 400 and the chart is unchanged', p2.status === 400 && JSON.stringify(await chartCols(amma.body.id)) === JSON.stringify(before));
  const p3 = await call(patchPerson, A.token, { chart: { ...CHART, birthTime: '10:30' } }, { personId: amma.body.id });
  check('B3 PATCH with a whole new chart replaces it whole', p3.status === 200 && p3.body.birthTime === '10:30');
  const ammaRow = await getSavedPersonForOwner(A.id, amma.body.id);
  check('B4 PATCH chart left every My People field intact', ammaRow?.notes === 'Updated note' && ammaRow?.relationshipLabel === 'Amma' && ammaRow?.interests[0] === 'Carnatic music');
  const clearChart = await call(patchPerson, A.token, { chart: null }, { personId: amma.body.id });
  const cleared = await chartCols(amma.body.id);
  check('B5 PATCH chart:null clears all six chart columns together', clearChart.status === 200 && Object.values(cleared).every((v) => v === null), cleared);
  await call(patchPerson, A.token, { chart: CHART }, { personId: amma.body.id });
  let checkRefused = false;
  try {
    await sql(`UPDATE "SavedPerson" SET "birthTime" = NULL WHERE id = $1`, [amma.body.id]);
  } catch (e: any) {
    checkRefused = /SavedPerson_chart_all_or_none/.test(e.message);
  }
  check('B6 the DB CHECK itself refuses a half chart (direct SQL)', checkRefused);

  // ================= C. special days =================
  const bday = await call(createOccasion, A.token, { kind: 'BIRTHDAY', month: 12, day: 5 }, { personId: ravi.body.id });
  check('C1 POST birthday (no year) -> 201 with a resolved next occurrence', bday.status === 201 && bday.body.year === null && typeof bday.body.next?.date === 'string', bday);
  const dup = await call(createOccasion, A.token, { kind: 'BIRTHDAY', month: 1, day: 1 }, { personId: ravi.body.id });
  check('C2 a second birthday for the same person -> 409', dup.status === 409);
  const leap = await call(createOccasion, A.token, { kind: 'ANNIVERSARY', month: 2, day: 29, year: 1992 }, { personId: ravi.body.id });
  check('C3 29 Feb 1992 anniversary -> 201', leap.status === 201);
  const badLeap = await call(createOccasion, A.token, { kind: 'ANNIVERSARY', month: 2, day: 29, year: 1991 }, { personId: ravi.body.id });
  check('C4 29 Feb 1991 -> 400', badLeap.status === 400);
  const patchYear = await call(patchOccasion, A.token, { year: 2023 }, { personId: ravi.body.id, occasionId: leap.body.id });
  check('C5 PATCH that makes an existing 29 Feb invalid (non-leap year) -> 400 (merged validation)', patchYear.status === 400);
  const patchLead = await call(patchOccasion, A.token, { remindDaysBefore: 0 }, { personId: ravi.body.id, occasionId: leap.body.id });
  check('C6 PATCH remindDaysBefore -> 200, other fields kept', patchLead.status === 200 && patchLead.body.remindDaysBefore === 0 && patchLead.body.year === 1992);
  const list = await call(listOccasions, A.token, undefined, { personId: ravi.body.id });
  check('C7 GET special days for Ravi -> 2', list.status === 200 && list.body.length === 2);
  const up = await call(upcoming, A.token, undefined, undefined, 'http://localhost/api/people/occasions/upcoming?days=60');
  check('C8 GET upcoming?days=60 -> 200, only A\'s, each with personName', up.status === 200 && Array.isArray(up.body) && up.body.every((x: any) => x.personName === 'Ravi' || x.personName === 'Amma K'));
  const upBad = await call(upcoming, A.token, undefined, undefined, 'http://localhost/api/people/occasions/upcoming?days=61');
  check('C9 GET upcoming?days=61 -> 400', upBad.status === 400);
  const peopleList = await call(listPeople, A.token);
  const raviRow = peopleList.body.find((p: any) => p.id === ravi.body.id);
  // R1 F5: the enabled LIST is the design 4.1 item -- nextOccasion and hasChartDetails, but never notes or detailed
  // birth fields (those stay available on the detail route and in the export).
  check('C10 GET /api/people (on) carries nextOccasion and the design 4.1 fields', raviRow?.nextOccasion?.kind !== undefined && 'hasChartDetails' in raviRow && 'relationshipLabel' in raviRow);
  const ammaRowList = peopleList.body.find((p: any) => p.id === amma.body.id);
  check('C10b R1 F5: the list never carries notes, interests, location, owner id or detailed birth fields', ['notes', 'interests', 'locationName', 'timezone', 'ownerUserId', 'birthDate', 'birthTime', 'birthTimezone', 'birthCityName', 'birthLatitude', 'birthLongitude'].every((k) => !(k in ammaRowList)), Object.keys(ammaRowList ?? {}));
  const ammaDetailAgain = await call(getPerson, A.token, undefined, { personId: amma.body.id });
  check('C10c R1 F5: the detail route still returns notes and birth details to the owner', ammaDetailAgain.body.notes === 'Updated note' && typeof ammaDetailAgain.body.birthTime === 'string');

  // ================= D. isolation =================
  const bPeopleBefore = await call(listPeople, B.token);
  check('D1 B\'s list never contains A\'s people', bPeopleBefore.status === 200 && !bPeopleBefore.body.some((p: any) => p.id === ravi.body.id || p.id === amma.body.id));
  const iso = [
    await call(getPerson, B.token, undefined, { personId: amma.body.id }),
    await call(patchPerson, B.token, { name: 'Hijacked', notes: 'x' }, { personId: amma.body.id }),
    await call(deletePerson, B.token, undefined, { personId: amma.body.id }),
    await call(listOccasions, B.token, undefined, { personId: ravi.body.id }),
    await call(createOccasion, B.token, { kind: 'ANNIVERSARY', month: 1, day: 1 }, { personId: ravi.body.id }),
    await call(patchOccasion, B.token, { month: 3 }, { personId: ravi.body.id, occasionId: bday.body.id }),
    await call(deleteOccasion, B.token, undefined, { personId: ravi.body.id, occasionId: bday.body.id }),
  ];
  check('D2 every person / special-day route with A\'s ids returns 404 for B', iso.every((r) => r.status === 404), iso.map((r) => r.status));
  const ammaAfterIso = await getSavedPersonForOwner(A.id, amma.body.id);
  const occAfterIso = await sql(`SELECT month FROM "PersonOccasion" WHERE id = $1`, [bday.body.id]);
  check('D3 ...and nothing of A\'s changed', ammaAfterIso?.name === 'Amma K' && ammaAfterIso?.notes === 'Updated note' && occAfterIso[0]?.month === 12);
  const upB = await call(upcoming, B.token, undefined, undefined, 'http://localhost/api/people/occasions/upcoming');
  check('D4 B\'s upcoming list is empty (never A\'s special days)', upB.status === 200 && upB.body.length === 0);
  const bPerson = await createSavedPerson(B.id, { name: 'B person', relationshipType: 'FRIEND' });
  let fkRefused = false;
  let fkError: unknown = 'inserted';
  try {
    await sql(`INSERT INTO "PersonOccasion" (id, "ownerUserId", "savedPersonId", kind, month, day) VALUES ($1, $2, $3, 'ANNIVERSARY', 1, 1)`, [`${tag}-x`, B.id, ravi.body.id]);
  } catch (e: any) {
    fkError = { code: e.code, constraint: e.constraint, message: e.message };
    fkRefused = e.code === '23503' && e.constraint === 'PersonOccasion_person_owner_fkey';
  }
  check('D5 the composite FK refuses a special day filed by B under A\'s person (direct SQL)', fkRefused, fkError);
  const start = new Date(Date.now() + 3 * 86_400_000);
  const end = new Date(start.getTime() + 45 * 60_000);
  const planBody = (title: string, savedPersonId: string) => ({ title, activityType: title, plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString(), durationMinutes: 45, windowType: 'NEUTRAL', savedPersonId });
  const crossPlan = await call(createPlan, B.token, planBody(`${tag} cross`, ravi.body.id));
  check('D6 POST /api/plans by B with A\'s person -> 404, no plan created', crossPlan.status === 404 && (await sql(`SELECT 1 FROM "PlannedActivity" WHERE title = $1`, [`${tag} cross`])).length === 0);
  const ownPlan = await call(createPlan, A.token, planBody(`${tag} coffee with Ravi`, ravi.body.id));
  const ownRow = (await sql(`SELECT "savedPersonId" FROM "PlannedActivity" WHERE id = $1`, [ownPlan.body?.id]))[0];
  check('D7 POST /api/plans by A with A\'s person -> created and linked', (ownPlan.status === 200 || ownPlan.status === 201) && ownRow?.savedPersonId === ravi.body.id, ownPlan);
  // The INSERT re-checks ownership in SQL: bypass the route and call the DB helper with a foreign id.
  const { createPlannedActivity } = await import('../apps/web/lib/db');
  const sneaky = await createPlannedActivity({ userId: B.id, title: `${tag} sneaky`, plannedStartAt: start, plannedEndAt: end, durationMinutes: 45, windowType: 'NEUTRAL', savedPersonId: ravi.body.id });
  check('D8 createPlannedActivity with a foreign savedPersonId stores NULL (never a cross-owner link)', sneaky.savedPersonId === null);

  // ================= E. atomic delete =================
  await sql(`UPDATE "User" SET "dayBuilderPriorityPersonIds" = $2 WHERE id = $1`, [A.id, [ravi.body.id, amma.body.id]]);
  await sql(`INSERT INTO "DayBuilderDismissal" ("userId", "localDate", "activityId", "personId") VALUES ($1, '2026-12-01', 'coffee-tea', $2) ON CONFLICT DO NOTHING`, [A.id, ravi.body.id]);
  await sql(`INSERT INTO "ReminderAttention" (id, "userId", "scheduledItemType", "scheduledItemId", "reminderAt") VALUES ($1, $2, 'PERSON_OCCASION', $3, now())`, [`${tag}-att`, A.id, bday.body.id]);
  await sql(
    `INSERT INTO "AuraMoment" (id, "ownerUserId", "publicToken", scope, source, "activityId", "activityTitle", "startAt", "endAt", timezone, "savedPersonId", "sharedPersonDisplayName")
     VALUES ($1, $2, $3, 'SHARED', 'PLAN', 'coffee-tea', 'Coffee', now(), now() + interval '1 hour', 'Asia/Kolkata', $4, 'Ravi')`,
    [`${tag}-moment`, A.id, `${tag}-token`, ravi.body.id]
  );
  const refsOf = async () => ({
    person: (await sql(`SELECT 1 FROM "SavedPerson" WHERE id = $1`, [ravi.body.id])).length,
    occasions: (await sql(`SELECT 1 FROM "PersonOccasion" WHERE "savedPersonId" = $1`, [ravi.body.id])).length,
    priority: (await sql(`SELECT "dayBuilderPriorityPersonIds" AS p FROM "User" WHERE id = $1`, [A.id]))[0].p as string[],
    dismissals: (await sql(`SELECT 1 FROM "DayBuilderDismissal" WHERE "userId" = $1 AND "personId" = $2`, [A.id, ravi.body.id])).length,
    attention: (await sql(`SELECT 1 FROM "ReminderAttention" WHERE id = $1`, [`${tag}-att`])).length,
    planLink: ((rows) => (rows.length === 0 ? 'MISSING' : rows[0].savedPersonId))(await sql(`SELECT "savedPersonId" FROM "PlannedActivity" WHERE id = $1`, [ownPlan.body?.id])),
    momentLink: (await sql(`SELECT "savedPersonId", "sharedPersonDisplayName" FROM "AuraMoment" WHERE id = $1`, [`${tag}-moment`]))[0],
  });
  const refsBefore = await refsOf();
  // Injected failure at the LAST step (the person DELETE itself), after every clean-up statement already ran.
  await sql(`CREATE OR REPLACE FUNCTION mp1_fail_delete() RETURNS trigger AS $$ BEGIN IF OLD.name = 'Ravi' AND OLD."ownerUserId" = '${A.id}' THEN RAISE EXCEPTION 'mp1 injected failure'; END IF; RETURN OLD; END $$ LANGUAGE plpgsql`);
  await sql(`CREATE TRIGGER mp1_fail_delete BEFORE DELETE ON "SavedPerson" FOR EACH ROW EXECUTE FUNCTION mp1_fail_delete()`);
  const failed = await call(deletePerson, A.token, undefined, { personId: ravi.body.id });
  await sql(`DROP TRIGGER mp1_fail_delete ON "SavedPerson"`);
  await sql(`DROP FUNCTION mp1_fail_delete()`);
  const refsAfterFailure = await refsOf();
  check('E1 injected failure at the final step -> 500 and EVERYTHING rolled back (person, special days, priority ids, dismissals, attention, links)', failed.status === 500 && JSON.stringify(refsAfterFailure) === JSON.stringify(refsBefore), { refsBefore, refsAfterFailure });
  const ok = await call(deletePerson, A.token, undefined, { personId: ravi.body.id });
  const refsAfter = await refsOf();
  check('E2 DELETE -> 200; person and special days gone', ok.status === 200 && refsAfter.person === 0 && refsAfter.occasions === 0);
  check('E3 id removed from dayBuilderPriorityPersonIds; other priority ids kept', !refsAfter.priority.includes(ravi.body.id) && refsAfter.priority.includes(amma.body.id));
  check('E4 Day Builder dismissals and special-day attention rows deleted', refsAfter.dismissals === 0 && refsAfter.attention === 0);
  const keptTitle = (await sql(`SELECT title FROM "PlannedActivity" WHERE id = $1`, [ownPlan.body?.id]))[0]?.title;
  check('E5 the linked plan is KEPT with its link cleared (title unchanged)', refsAfter.planLink === null && keptTitle === `${tag} coffee with Ravi`, { planLink: refsAfter.planLink, keptTitle });
  check('E6 the Aura Moment is KEPT, link cleared, display name kept (D6)', refsAfter.momentLink?.savedPersonId === null && refsAfter.momentLink?.sharedPersonDisplayName === 'Ravi');
  check('E7 deleting again -> 404', (await call(deletePerson, A.token, undefined, { personId: ravi.body.id })).status === 404);

  // ================= F. export =================
  const exp = await call(exportData, A.token);
  const expPeople = exp.body?.people ?? [];
  check('F1 A\'s export includes people[] with chart, notes, interests and special days', exp.status === 200 && expPeople.length === 1 && expPeople[0].id === amma.body.id && expPeople[0].notes === 'Updated note' && expPeople[0].birthTime === '08:15' && Array.isArray(expPeople[0].occasions));
  check('F2 A\'s export never includes B\'s people and carries no ownerUserId or natal context', !JSON.stringify(exp.body).includes(bPerson.id) && !('ownerUserId' in expPeople[0]) && !('natalContext' in expPeople[0]));
  const expB = await call(exportData, B.token);
  check('F3 B\'s export holds only B\'s person', expB.body.people.length === 1 && expB.body.people[0].id === bPerson.id);

  // cleanup
  await deleteSavedPerson(A.id, amma.body.id).catch(() => {});
  await deleteSavedPerson(B.id, bPerson.id).catch(() => {});
  await sql(`DELETE FROM "AuraMoment" WHERE id = $1`, [`${tag}-moment`]);
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
      console.error('\nSOME MY PEOPLE DB CHECKS FAILED');
      process.exit(1);
    }
    console.log('\nALL MY PEOPLE DB CHECKS PASSED');
    process.exit(0);
  });
