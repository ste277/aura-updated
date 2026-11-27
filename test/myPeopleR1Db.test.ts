/**
 * AURA-MP-1 R1 (62007) -- live-database regression suite for findings F1-F5.
 * Real disposable Postgres (CI: day-constructor-acceptance-db-tests). Run:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/myPeopleR1Db.test.ts
 *
 *   F1  legacy edits of PARENT / CHILD / SIBLING with My People disabled (API);
 *   F2  the server flag alone decides; the public flag never enables the server;
 *       the capability header reports the server state;
 *   F3  impossible dates and bad coordinates -> controlled 400 through the routes;
 *   F4  DETERMINISTIC concurrency: two partial special-day updates forced to
 *       read the same row before either writes (row-lock barrier, FIFO release)
 *       can never persist a contradictory date; person / special-day limits
 *       hold under concurrent creates (trigger-delayed inserts); the database
 *       CHECKs refuse impossible dates on direct SQL;
 *   F5  the enabled list contract; `occasions` on create rejected; nested
 *       export carries no ownerUserId.
 */
import { Pool } from 'pg';
import { createSessionToken } from '../apps/web/lib/auth';
import { createSavedPerson, getSavedPersonForOwner, upsertUserByEmail } from '../apps/web/lib/db';
import { GET as listPeople, POST as createPerson } from '../apps/web/app/api/people/route';
import { GET as getPerson, PATCH as patchPerson } from '../apps/web/app/api/people/[personId]/route';
import { POST as createOccasion } from '../apps/web/app/api/people/[personId]/occasions/route';
import { PATCH as patchOccasion } from '../apps/web/app/api/people/[personId]/occasions/[occasionId]/route';
import { GET as upcoming } from '../apps/web/app/api/people/occasions/upcoming/route';
import { GET as exportData } from '../apps/web/app/api/users/export/route';

let allPassed = true;
function check(label: string, condition: boolean, detail?: unknown) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${!condition && detail !== undefined ? ` -- ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
  if (!condition) allPassed = false;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = async (t: string, p: unknown[] = []) => (await pool.query(t, p)).rows;
const fakeReq = (token: string, body?: unknown, url = 'http://localhost/api/people'): any => ({
  cookies: { get: (n: string) => (n === 'as_session' ? { value: token } : undefined) },
  json: async () => body,
  headers: new Headers(),
  nextUrl: new URL(url),
});
const call = async (fn: any, token: string, body?: unknown, params?: Record<string, string>, url?: string) => {
  try {
    const res: Response = await fn(fakeReq(token, body, url), params ? { params } : undefined);
    return { status: res.status, header: res.headers.get('x-aura-my-people'), body: await res.json().catch(() => null) as any, threw: null as string | null };
  } catch (e) {
    return { status: 0, header: null, body: null, threw: String(e) };
  }
};
const serverOn = () => { process.env.AURA_MY_PEOPLE_ENABLED = '1'; };
const serverOff = () => { delete process.env.AURA_MY_PEOPLE_ENABLED; };
const lockWaiters = async () => Number((await sql(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`))[0].n);
const waitFor = async (pred: () => Promise<boolean>, ms = 10000) => {
  const t = Date.now();
  while (!(await pred())) {
    if (Date.now() - t > ms) throw new Error('barrier timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};
const sqlState = async (text: string, params: unknown[]) => {
  try { await sql(text, params); return 'OK'; } catch (e: any) { return `${e.code}:${e.constraint ?? ''}`; }
};

async function main() {
  const tag = `mp1r1-${Date.now()}`;
  const mk = async (k: string) => {
    const u = await upsertUserByEmail({ email: `${k}-${tag}@mp1.aura.local`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
    return { ...u, token: createSessionToken(u.id, u.email) };
  };
  const A = await mk('a');
  const L = await mk('limits');

  // ================= F2 =================
  process.env.NEXT_PUBLIC_AURA_MY_PEOPLE = '1'; // presentation flag ON throughout: it must never enable the server
  serverOff();
  const off = await call(upcoming, A.token, undefined, undefined, 'http://localhost/api/people/occasions/upcoming');
  check('F2 server flag unset + public flag "1" -> server disabled (404)', off.status === 404);
  const offList = await call(listPeople, A.token);
  check('F2 disabled list response says x-aura-my-people: disabled', offList.header === 'disabled');
  process.env.AURA_MY_PEOPLE_ENABLED = 'true';
  check('F2 server flag "true" (not "1") -> still disabled', (await call(upcoming, A.token, undefined, undefined, 'http://localhost/api/people/occasions/upcoming')).status === 404);
  serverOn();
  const onList = await call(listPeople, A.token);
  check('F2 server flag "1" -> enabled; list says x-aura-my-people: enabled', onList.header === 'enabled' && (await call(upcoming, A.token, undefined, undefined, 'http://localhost/api/people/occasions/upcoming')).status === 200);

  // ================= F1 (API) =================
  serverOn();
  const ids: Record<string, string> = {};
  for (const type of ['PARENT', 'CHILD', 'SIBLING']) {
    const r = await call(createPerson, A.token, { name: `${type} one`, relationshipType: type, notes: `${type} note`, interests: ['tea'] });
    ids[type] = r.body.id;
  }
  serverOff();
  for (const type of ['PARENT', 'CHILD', 'SIBLING']) {
    const r = await call(patchPerson, A.token, { name: `${type} edited`, relationshipType: type }, { personId: ids[type] });
    const row = await getSavedPersonForOwner(A.id, ids[type]);
    check(`F1 OFF: legacy edit resubmitting unchanged ${type} -> 200; type, notes and interests kept`, r.status === 200 && row?.relationshipType === type && row?.name === `${type} edited` && row?.notes === `${type} note` && row?.interests[0] === 'tea', r);
    const nameOnly = await call(patchPerson, A.token, { name: `${type} again` }, { personId: ids[type] });
    check(`F1 OFF: edit without relationshipType -> 200, ${type} kept`, nameOnly.status === 200 && (await getSavedPersonForOwner(A.id, ids[type]))?.relationshipType === type);
  }
  const change = await call(patchPerson, A.token, { relationshipType: 'CHILD' }, { personId: ids.PARENT });
  check('F1 OFF: CHANGING PARENT -> CHILD is refused (400) and nothing changes', change.status === 400 && (await getSavedPersonForOwner(A.id, ids.PARENT))?.relationshipType === 'PARENT');
  const toLegacy = await call(patchPerson, A.token, { relationshipType: 'FAMILY' }, { personId: ids.SIBLING });
  check('F1 OFF: changing SIBLING -> FAMILY (a legacy type) is allowed', toLegacy.status === 200 && (await getSavedPersonForOwner(A.id, ids.SIBLING))?.relationshipType === 'FAMILY');
  serverOn();
  const back = await call(getPerson, A.token, undefined, { personId: ids.CHILD });
  check('F1 enable -> disable -> enable: CHILD, notes and interests preserved', back.body.relationshipType === 'CHILD' && back.body.notes === 'CHILD note' && back.body.interests[0] === 'tea' && back.body.name === 'CHILD again');

  // ================= F3 (routes) =================
  for (const on of [false, true]) {
    on ? serverOn() : serverOff();
    const t = on ? 'ON' : 'OFF';
    const bodies: Array<[string, Record<string, unknown>]> = [
      ['2023-02-30', { name: 'x', birthDate: '2023-02-30', birthTime: '08:00', birthTimezone: 'Asia/Kolkata' }],
      ['2021-04-31', { name: 'x', birthDate: '2021-04-31', birthTime: '08:00', birthTimezone: 'Asia/Kolkata' }],
      ['null latitude', { name: 'x', birthDate: '1990-01-01', birthTime: '08:00', birthTimezone: 'Asia/Kolkata', birthLatitude: null, birthLongitude: 80.27 }],
      ['string latitude', { name: 'x', birthDate: '1990-01-01', birthTime: '08:00', birthTimezone: 'Asia/Kolkata', birthLatitude: '13.08', birthLongitude: 80.27 }],
      ['latitude 95', { name: 'x', birthDate: '1990-01-01', birthTime: '08:00', birthTimezone: 'Asia/Kolkata', birthLatitude: 95, birthLongitude: 80.27 }],
    ];
    for (const [label, body] of bodies) {
      const r = await call(createPerson, A.token, body);
      check(`F3 ${t}: POST ${label} -> controlled 400 (no throw, no 500)`, r.status === 400 && !r.threw, r);
    }
    const patchBad = await call(patchPerson, A.token, { name: 'x', birthDate: '2023-02-30', birthTime: '08:00', birthTimezone: 'Asia/Kolkata' }, { personId: ids.PARENT });
    check(`F3 ${t}: PATCH impossible date -> 400`, patchBad.status === 400 && !patchBad.threw, patchBad);
  }
  const zeroRows = await sql(`SELECT count(*)::int AS n FROM "SavedPerson" WHERE "ownerUserId" = $1 AND ("birthLatitude" = 0 OR "birthLongitude" = 0)`, [A.id]);
  check('F3 no coordinate was ever coerced to 0', zeroRows[0].n === 0);

  // ================= F4 (deterministic concurrency) =================
  serverOn();
  const lp = await createSavedPerson(A.id, { name: 'Leap', relationshipType: 'FRIEND' });
  const runRace = async (first: Record<string, unknown>, second: Record<string, unknown>) => {
    const o = (await call(createOccasion, A.token, { kind: 'ANNIVERSARY', month: 2, day: 28, year: 2023 }, { personId: lp.id })).body;
    const blocker = await pool.connect();
    let a: ReturnType<typeof call> | undefined;
    let b: ReturnType<typeof call> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query(`SELECT 1 FROM "PersonOccasion" WHERE id = $1 FOR UPDATE`, [o.id]);
      const base = await lockWaiters();
      // Each request is queued behind the row lock IN ORDER (Postgres grants a
      // released row lock FIFO). A request that finishes without needing the
      // lock (e.g. refused by validation on an unprotected head) also releases
      // the barrier, so the test can never hang.
      let aDone = false;
      let bDone = false;
      a = call(patchOccasion, A.token, first, { personId: lp.id, occasionId: o.id }).finally(() => { aDone = true; });
      await waitFor(async () => aDone || (await lockWaiters()) >= base + 1);
      b = call(patchOccasion, A.token, second, { personId: lp.id, occasionId: o.id }).finally(() => { bDone = true; });
      await waitFor(async () => bDone || (await lockWaiters()) >= base + (aDone ? 1 : 2));
    } finally {
      await blocker.query('COMMIT').catch(() => {});
      blocker.release();
    }
    const [ra, rb] = await Promise.all([a!, b!]);
    const final = (await sql(`SELECT month, day, year FROM "PersonOccasion" WHERE id = $1`, [o.id]))[0];
    await sql(`DELETE FROM "PersonOccasion" WHERE id = $1`, [o.id]);
    return { ra, rb, final };
  };
  // Order 1: {day 29, year 2024} then {year 2023}: the second must be judged against 29 Feb -> refused.
  const r1 = await runRace({ day: 29, year: 2024 }, { year: 2023 });
  check('F4 race order 1: first wins (29 Feb 2024), second is validated against it and refused (400); final record valid', r1.ra.status === 200 && r1.rb.status === 400 && r1.final.month === 2 && r1.final.day === 29 && r1.final.year === 2024, r1);
  // Order 2: {year 2023} then {day 29, year 2024}: both valid in sequence -> final 29 Feb 2024.
  const r2 = await runRace({ year: 2023 }, { day: 29, year: 2024 });
  check('F4 race order 2: both apply in sequence; final 29 Feb 2024 (valid)', r2.ra.status === 200 && r2.rb.status === 200 && r2.final.day === 29 && r2.final.year === 2024, r2);
  // Order 3: {day 29} (no year => valid only with year null? existing year 2023 => invalid alone) -- validation alone.
  const r3 = await runRace({ year: null }, { day: 29 });
  check('F4 race order 3: {year:null} then {day:29} -> 29 Feb with unknown year (valid, leap-day semantics kept)', r3.ra.status === 200 && r3.rb.status === 200 && r3.final.day === 29 && r3.final.year === null, r3);

  // Database CHECKs (direct SQL, bypassing every application writer).
  const pid = lp.id;
  check('F4 DB CHECK refuses 31 April', (await sqlState(`INSERT INTO "PersonOccasion" (id, "ownerUserId", "savedPersonId", kind, month, day) VALUES ($1, $2, $3, 'ANNIVERSARY', 4, 31)`, [`${tag}-c1`, A.id, pid])).startsWith('23514:PersonOccasion_gregorian_date_check'));
  check('F4 DB CHECK refuses 30 February', (await sqlState(`INSERT INTO "PersonOccasion" (id, "ownerUserId", "savedPersonId", kind, month, day) VALUES ($1, $2, $3, 'ANNIVERSARY', 2, 30)`, [`${tag}-c2`, A.id, pid])).startsWith('23514:PersonOccasion_gregorian_date_check'));
  check('F4 DB CHECK refuses 29 Feb 2023 (known non-leap year)', (await sqlState(`INSERT INTO "PersonOccasion" (id, "ownerUserId", "savedPersonId", kind, month, day, year) VALUES ($1, $2, $3, 'ANNIVERSARY', 2, 29, 2023)`, [`${tag}-c3`, A.id, pid])).startsWith('23514:PersonOccasion_gregorian_date_check'));
  check('F4 DB CHECK accepts 29 Feb 2000 and 29 Feb with unknown year', (await sqlState(`INSERT INTO "PersonOccasion" (id, "ownerUserId", "savedPersonId", kind, month, day, year) VALUES ($1, $2, $3, 'ANNIVERSARY', 2, 29, 2000)`, [`${tag}-c4`, A.id, pid])) === 'OK' && (await sqlState(`INSERT INTO "PersonOccasion" (id, "ownerUserId", "savedPersonId", kind, label, month, day) VALUES ($1, $2, $3, 'OTHER', 'Puja', 2, 29)`, [`${tag}-c5`, A.id, pid])) === 'OK');
  check('F4 DB CHECK refuses 29 Feb 1900 (century, non-leap)', (await sqlState(`INSERT INTO "PersonOccasion" (id, "ownerUserId", "savedPersonId", kind, month, day, year) VALUES ($1, $2, $3, 'ANNIVERSARY', 2, 29, 1900)`, [`${tag}-c6`, A.id, pid])).startsWith('23514:'));
  check('F4 DB CHECK refuses year 1899 and an OTHER without a label', (await sqlState(`INSERT INTO "PersonOccasion" (id, "ownerUserId", "savedPersonId", kind, month, day, year) VALUES ($1, $2, $3, 'ANNIVERSARY', 1, 1, 1899)`, [`${tag}-c7`, A.id, pid])).startsWith('23514:PersonOccasion_year_check') && (await sqlState(`INSERT INTO "PersonOccasion" (id, "ownerUserId", "savedPersonId", kind, label, month, day) VALUES ($1, $2, $3, 'OTHER', '  ', 1, 1)`, [`${tag}-c8`, A.id, pid])).startsWith('23514:PersonOccasion_other_label_check'));
  check('F4 DB CHECK refuses an UPDATE that makes a stored 29 Feb (unknown year) contradictory', (await sqlState(`UPDATE "PersonOccasion" SET year = 2023 WHERE id = $1`, [`${tag}-c5`])).startsWith('23514:'));
  await sql(`DELETE FROM "PersonOccasion" WHERE "savedPersonId" = $1`, [pid]);

  // Limits under concurrency: inserts are slowed by a trigger so every request
  // would pass an unserialized count before any insert commits.
  const lim = await createSavedPerson(L.id, { name: 'Limit person', relationshipType: 'FRIEND' });
  for (let i = 1; i <= 9; i++) await sql(`INSERT INTO "PersonOccasion" (id, "ownerUserId", "savedPersonId", kind, label, month, day) VALUES ($1, $2, $3, 'OTHER', 'x', 3, $4)`, [`${tag}-l${i}`, L.id, lim.id, i]);
  await sql(`CREATE OR REPLACE FUNCTION mp1r1_slow() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.3); RETURN NEW; END $$ LANGUAGE plpgsql`);
  await sql(`CREATE TRIGGER mp1r1_slow_occ BEFORE INSERT ON "PersonOccasion" FOR EACH ROW WHEN (NEW."savedPersonId" = '${lim.id}') EXECUTE FUNCTION mp1r1_slow()`);
  const occRes = await Promise.all([1, 2, 3, 4, 5].map((i) => call(createOccasion, L.token, { kind: 'OTHER', label: `c${i}`, month: 4, day: i }, { personId: lim.id })));
  await sql(`DROP TRIGGER mp1r1_slow_occ ON "PersonOccasion"`);
  const occN = (await sql(`SELECT count(*)::int AS n FROM "PersonOccasion" WHERE "savedPersonId" = $1`, [lim.id]))[0].n;
  check('F4 special-day limit: 5 concurrent creates at 9 -> exactly one 201, four 409, total 10', occN === 10 && occRes.filter((r) => r.status === 201).length === 1 && occRes.filter((r) => r.status === 409).length === 4, { occN, s: occRes.map((r) => r.status) });
  await sql(`INSERT INTO "SavedPerson" (id, "ownerUserId", name, "relationshipType") SELECT $1 || g::text, $2, 'P' || g::text, 'OTHER' FROM generate_series(1, 198) g`, [`${tag}-p`, L.id]);
  await sql(`CREATE TRIGGER mp1r1_slow_person BEFORE INSERT ON "SavedPerson" FOR EACH ROW WHEN (NEW."ownerUserId" = '${L.id}') EXECUTE FUNCTION mp1r1_slow()`);
  const pRes = await Promise.all([1, 2, 3, 4].map((i) => call(createPerson, L.token, { name: `Concurrent ${i}` })));
  await sql(`DROP TRIGGER mp1r1_slow_person ON "SavedPerson"`);
  await sql(`DROP FUNCTION mp1r1_slow()`);
  const pN = (await sql(`SELECT count(*)::int AS n FROM "SavedPerson" WHERE "ownerUserId" = $1`, [L.id]))[0].n;
  check('F4 person limit: 4 concurrent creates at 199 -> exactly one 201, three 409, total 200', pN === 200 && pRes.filter((r) => r.status === 201).length === 1 && pRes.filter((r) => r.status === 409).length === 3, { pN, s: pRes.map((r) => r.status) });

  // ================= F5 =================
  serverOn();
  const list = await call(listPeople, A.token);
  const keys = new Set<string>(list.body.flatMap((r: any) => Object.keys(r)));
  check('F5 enabled list keys are exactly the design 4.1 item', JSON.stringify([...keys].sort()) === JSON.stringify(['hasChartDetails', 'id', 'name', 'nextOccasion', 'relationshipLabel', 'relationshipType']), [...keys]);
  serverOff();
  const legacyList = await call(listPeople, A.token);
  check('F5 disabled list keeps the legacy shape for existing consumers (no My People fields)', legacyList.body.every((r: any) => 'birthDate' in r && !('notes' in r)));
  for (const on of [true, false]) {
    on ? serverOn() : serverOff();
    const r = await call(createPerson, A.token, { name: 'Inline', occasions: [{ kind: 'BIRTHDAY', month: 1, day: 1 }], ...(on ? {} : { birthDate: '1990-01-01', birthTime: '08:00', birthTimezone: 'Asia/Kolkata' }) });
    check(`F5 ${on ? 'ON' : 'OFF'}: POST with occasions -> 400, nothing created`, r.status === 400 && (await sql(`SELECT 1 FROM "SavedPerson" WHERE "ownerUserId" = $1 AND name = 'Inline'`, [A.id])).length === 0, r);
  }
  serverOn();
  await call(createOccasion, A.token, { kind: 'BIRTHDAY', month: 5, day: 5 }, { personId: ids.CHILD });
  const exp = await call(exportData, A.token);
  check('Export: ownerUserId omitted at every level (person and nested special days); special days present', !JSON.stringify(exp.body.people).includes('ownerUserId') && exp.body.people.some((p: any) => p.occasions.length > 0));

  await sql(`DELETE FROM "SavedPerson" WHERE "ownerUserId" = ANY($1)`, [[A.id, L.id]]);
}

main()
  .catch((e) => { console.error(e); allPassed = false; })
  .finally(async () => {
    await pool.end();
    if (!allPassed) { console.error('\nSOME MY PEOPLE R1 DB CHECKS FAILED'); process.exit(1); }
    console.log('\nALL MY PEOPLE R1 DB CHECKS PASSED');
    process.exit(0);
  });
