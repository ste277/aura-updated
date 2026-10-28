/**
 * Birth Data Correctness B2 -- the three production birth-date writers are invariant to the PostgreSQL SESSION TimeZone and to the application's process TZ (DB-backed).
 *
 * B1 proved that the writers handed PostgreSQL the bare string '1990-06-15': on a server whose TimeZone is east of UTC that is stored as the PREVIOUS UTC day, every reader
 * then recovered the wrong civil date, and the natal context, the REAL timing search and the constructed day changed with the database server's timezone. B2 stores the
 * explicit UTC-midnight surrogate instead. This suite proves it end to end, through the REAL writers and readers, for each database timezone:
 *
 *   MATRIX  (each cell is a separate OS process, so the pool's session TimeZone is real: `options=-c TimeZone=...` in the connection string)
 *             database TimeZone  UTC | Asia/Kolkata | Pacific/Auckland | America/Los_Angeles | America/New_York   (process TZ = UTC)
 *             process TZ         Asia/Kolkata and America/Los_Angeles against the Asia/Kolkata database, Asia/Kolkata against the UTC database
 *   per cell:  updateBirthProfile, createSavedPerson and updateSavedPerson each store exactly the UTC-midnight surrogate and read back the same civil date;
 *              the real natal context equals the one derived straight from the civil facts; the real orchestrator + REAL timing search build the same constructed day
 *   ACROSS cells: every observable (stored instants, natal context, candidate lists / orders / timing fits / placements / deferred set) is identical.
 *   PARITY:    on a UTC session the canonical value equals the legacy bare-string value for EVERY date 1900-2100 (correctly written UTC data is unchanged), while on
 *              Asia/Kolkata the legacy value differed for every one of them -- the defect, shown in SQL.
 *   DIAGNOSTIC: the read-only operator query (deploy/diagnostics/birth-date-surrogate-check.sql) counts non-midnight surrogates and returns aggregates only.
 *
 * Synthetic users only. Requires DATABASE_URL (fresh, 43 migrations).
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { upsertUserByEmail, updateBirthProfile, getUserById, createSavedPerson, updateSavedPerson, replaceUserAvailabilityConfiguration, beginTransaction } from '../apps/web/lib/db';
import { buildPersonalMuhurtaContextForUser, natalContextFromBirthDetails } from '../apps/web/lib/natalContext';
import { localDateTimeToUTC } from '../apps/web/lib/timezone';
import { orchestrateConstructDay, createRealDayConstructorOrchestratorDeps, type ConstructDayRequest } from '../apps/web/lib/dayConstructorOrchestrator';
import { FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';
import { fixtureAnchorMonday, addCivilDays, realClockReferenceForFixture } from './lifecycleFixtureCalendar';

const TZ = 'Asia/Kolkata';
const ANCHOR_MONDAY = fixtureAnchorMonday(realClockReferenceForFixture(), TZ);
const PLANNING_DATE = addCivilDays(ANCHOR_MONDAY, 4); // the anchored Friday: the planning day of the constructor probe

interface BirthCase { civil: string; time: string; tz: string; updatedCivil: string }
const CASES: BirthCase[] = [
  { civil: '1990-06-15', time: '08:30', tz: 'Asia/Kolkata', updatedCivil: '1990-06-16' },
  { civil: '1990-06-15', time: '23:30', tz: 'America/Los_Angeles', updatedCivil: '1991-01-01' },
  { civil: '1985-01-01', time: '00:15', tz: 'Pacific/Auckland', updatedCivil: '1984-12-31' },
  { civil: '2000-02-29', time: '12:00', tz: 'America/New_York', updatedCivil: '2000-03-01' },
  { civil: '1970-03-08', time: '12:00', tz: 'Europe/London', updatedCivil: '1970-03-09' },
];

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(text, params); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

// ======================================================================
// CHILD: one (database TimeZone, process TZ) cell. Prints one JSON line.
// ======================================================================
async function child() {
  const label = process.env.B2_LABEL as string;
  const email = `test-b2-birth-${label}@example.com`;
  const u0 = await upsertUserByEmail({ email, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const cleanup = async () => { await sql(`DELETE FROM "SavedPerson" WHERE "ownerUserId" = $1`, [u0.id]); await sql(`DELETE FROM "UserAvailabilityPeriod" WHERE "userId" = $1`, [u0.id]); await sql(`UPDATE "User" SET "availabilityConfigured" = false, "birthDate" = NULL WHERE id = $1`, [u0.id]); };
  await cleanup();
  try {
    const session = (await sql(`SELECT current_setting('TimeZone') AS tz`))[0].tz as string;
    const utcOf = async (table: string, id: string) => (await sql(`SELECT to_char("birthDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS t FROM "${table}" WHERE ${table === 'User' ? 'id' : 'id'} = $1`, [id]))[0].t as string;
    const rows: any[] = [];
    for (const c of CASES) {
      await updateBirthProfile(u0.id, { birthDate: c.civil, birthTime: c.time, birthCityName: 'X', birthLatitude: 1, birthLongitude: 1, birthTimezone: c.tz });
      const user = (await getUserById(u0.id))!;
      const ctx: any = buildPersonalMuhurtaContextForUser(user);
      const expected: any = natalContextFromBirthDetails(c.civil, c.time, c.tz);
      const created = await createSavedPerson(u0.id, { name: 'p', relationshipType: 'OTHER', birthDate: c.civil, birthTime: c.time, birthTimezone: c.tz });
      const createdStored = await utcOf('SavedPerson', created.id);
      const createdIso = created.birthDate.toISOString();
      const updated = await updateSavedPerson(u0.id, created.id, { name: 'p', relationshipType: 'OTHER', birthDate: c.updatedCivil, birthTime: c.time, birthTimezone: c.tz });
      const updatedStored = await utcOf('SavedPerson', created.id);
      rows.push({
        civil: c.civil,
        user: { stored: await utcOf('User', u0.id), iso: user.birthDate!.toISOString(), roundTrip: user.birthDate!.toISOString().slice(0, 10) === c.civil, natal: { nakshatra: ctx.janmaNakshatra, rashi: ctx.janmaRashi, index: ctx.natalNakshatraIndex, moon: ctx.moonElement }, natalMatchesCivilFacts: JSON.stringify(ctx) === JSON.stringify(expected) || (ctx.janmaNakshatra === expected.janmaNakshatra && ctx.janmaRashi === expected.janmaRashi && ctx.natalNakshatraIndex === expected.natalNakshatraIndex), birthMoment: localDateTimeToUTC(user.birthDate!.toISOString().slice(0, 10), c.time, c.tz).toISOString(), expectedMoment: localDateTimeToUTC(c.civil, c.time, c.tz).toISOString() },
        savedCreate: { stored: createdStored, iso: createdIso, roundTrip: createdIso.slice(0, 10) === c.civil },
        savedUpdate: { stored: updatedStored, iso: updated.birthDate.toISOString(), roundTrip: updated.birthDate.toISOString().slice(0, 10) === c.updatedCivil },
      });
    }
    // The REAL production path: real orchestrator deps (real personal muhurta context from the stored profile, real timing search) over the same request.
    await updateBirthProfile(u0.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
    await replaceUserAvailabilityConfiguration(u0.id, [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })));
    const user = (await getUserById(u0.id))!;
    const now = localDateTimeToUTC(PLANNING_DATE, '08:00', TZ);
    const intents = FULL_ACTIVITY_CATALOG.slice(0, 5).map((a, i) => ({ id: `i${i}`, title: a.id, activityId: a.id, durationMinutes: [60, 90, 120, 60, 90][i], flexibility: 'FLEXIBLE' as const, originalOrder: i }));
    const request = { targetDate: PLANNING_DATE, timezone: TZ, constructionWindowSource: 'EXPLICIT_RANGE', now, explicitStart: localDateTimeToUTC(PLANNING_DATE, '09:00', TZ), explicitEnd: localDateTimeToUTC(PLANNING_DATE, '17:00', TZ), intents } as unknown as ConstructDayRequest;
    const result: any = await orchestrateConstructDay(request, createRealDayConstructorOrchestratorDeps(user, now));
    const day = result.status === 'READY' ? result.preview.constructedDay : undefined;
    console.log('B2CHILD ' + JSON.stringify({
      label, sessionTimeZone: session, processTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, processTzEnv: process.env.TZ ?? null, rows,
      constructor: day ? { placed: day.proposedItems.map((i: any) => `${i.intentId}|${i.start.toISOString()}|${i.end.toISOString()}|${i.timingFit}|${i.candidateOrder}`), deferred: day.deferredItems.map((d: any) => `${d.intentId}|${d.primaryReason}`) } : { status: result.status },
    }));
  } finally { await cleanup(); }
}

// ======================================================================
// PARENT: the matrix and the shared assertions.
// ======================================================================
let allPassed = true;
function check(label: string, condition: boolean) { console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`); if (!condition) allPassed = false; }

function runCell(label: string, dbTimeZone: string, processTz: string): any {
  const base = process.env.DATABASE_URL as string;
  const options = encodeURIComponent(`-c TimeZone=${dbTimeZone}`);
  const url = `${base}${base.includes('?') ? '&' : '?'}options=${options}`;
  const tsNode = require.resolve('ts-node/dist/bin');
  const out = execFileSync(process.execPath, [tsNode, __filename], { env: { ...process.env, B2_CHILD: '1', B2_LABEL: label, TZ: processTz, DATABASE_URL: url }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const line = out.split('\n').find((l) => l.startsWith('B2CHILD '));
  if (!line) throw new Error(`cell ${label}: no result line`);
  return JSON.parse(line.slice('B2CHILD '.length));
}

async function parent() {
  const CELLS: Array<[string, string, string]> = [
    ['utc-utc', 'UTC', 'UTC'], ['kolkata-utc', 'Asia/Kolkata', 'UTC'], ['auckland-utc', 'Pacific/Auckland', 'UTC'], ['la-utc', 'America/Los_Angeles', 'UTC'], ['newyork-utc', 'America/New_York', 'UTC'],
    ['kolkata-kolkata', 'Asia/Kolkata', 'Asia/Kolkata'], ['kolkata-la', 'Asia/Kolkata', 'America/Los_Angeles'], ['utc-kolkata', 'UTC', 'Asia/Kolkata'],
  ];
  const results: Record<string, any> = {};
  for (const [label, db, proc] of CELLS) { results[label] = runCell(label, db, proc); console.log(`     cell ${label}: database TimeZone ${results[label].sessionTimeZone}, process TZ ${results[label].processTimeZone}`); }
  const cells = Object.entries(results);

  // ICU reports Asia/Kolkata under its legacy alias Asia/Calcutta.
  const canonicalZone = (z: string) => (z === 'Asia/Calcutta' ? 'Asia/Kolkata' : z);
  check('THE MATRIX IS REAL: every cell ran in its own process with the requested database session TimeZone and process TZ (the writers really executed under 5 database timezones and 3 process timezones)', CELLS.every(([label, db, proc]) => results[label].sessionTimeZone === db && canonicalZone(results[label].processTimeZone) === proc));

  const canonical = (civil: string) => `${civil}T00:00:00.000Z`;
  const storedOk = cells.every(([, r]) => r.rows.every((x: any, i: number) => x.user.stored === canonical(CASES[i].civil) && x.user.iso === canonical(CASES[i].civil) && x.savedCreate.stored === canonical(CASES[i].civil) && x.savedCreate.iso === canonical(CASES[i].civil) && x.savedUpdate.stored === canonical(CASES[i].updatedCivil) && x.savedUpdate.iso === canonical(CASES[i].updatedCivil)));
  check('STORAGE: for EVERY database timezone and process TZ, updateBirthProfile, createSavedPerson and updateSavedPerson store exactly the UTC-midnight surrogate of the civil date (1990-06-15 -> 1990-06-15T00:00:00.000Z), including the update to a different date', storedOk);
  check('USER round trip: write the civil date, read the profile, the same YYYY-MM-DD, in every cell', cells.every(([, r]) => r.rows.every((x: any) => x.user.roundTrip)));
  check('SAVED PERSON round trip: createSavedPerson AND updateSavedPerson read back exactly the civil date written, in every cell', cells.every(([, r]) => r.rows.every((x: any) => x.savedCreate.roundTrip && x.savedUpdate.roundTrip)));
  check('NATAL INVARIANT: the real natal context read back from the stored profile equals the context derived straight from the civil facts, in every cell, and the derived astronomical birth instant is the same', cells.every(([, r]) => r.rows.every((x: any) => x.user.natalMatchesCivilFacts && x.user.birthMoment === x.user.expectedMoment)));
  const natalOf = (r: any) => JSON.stringify(r.rows.map((x: any) => x.user.natal));
  const reference = results['utc-utc'];
  check('NATAL ACROSS CELLS: changing only the database timezone (or the process TZ) yields byte-identical Nakshatra / Rashi / natal index for all 5 synthetic profiles', cells.every(([, r]) => natalOf(r) === natalOf(reference)) && reference.rows.every((x: any) => typeof x.user.natal.nakshatra === 'string'));
  const ctorOf = (r: any) => JSON.stringify(r.constructor);
  check(`TIMING SEARCH / CONSTRUCTOR INVARIANT: the real orchestrator with the real timing search builds the IDENTICAL day in every cell (${reference.constructor.placed?.length} placed, deferred ${JSON.stringify(reference.constructor.deferred)}: candidate order, start, timing fit and the deferred set all equal)`, Array.isArray(reference.constructor.placed) && reference.constructor.placed.length >= 1 && cells.every(([, r]) => ctorOf(r) === ctorOf(reference)));

  // ---- parity with correctly written UTC data, and the defect shown in SQL
  const parity = async (zone: string) => {
    const c = await beginTransaction();
    try {
      await c.query(`SET LOCAL TIME ZONE '${zone}'`);
      const r = await c.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE (d::date::text)::timestamptz = (d::date::text || 'T00:00:00.000Z')::timestamptz)::int AS same FROM generate_series('1900-01-01'::timestamp, '2100-12-31'::timestamp, '1 day') AS g(d)`);
      await c.query('COMMIT');
      return r.rows[0] as { total: number; same: number };
    } finally { c.release(); }
  };
  const utc = await parity('UTC'); const kolkata = await parity('Asia/Kolkata'); const auckland = await parity('Pacific/Auckland');
  check(`UTC PARITY: on a UTC session the canonical surrogate equals the LEGACY bare-string value for ALL ${utc.total} dates 1900-2100 (correctly written UTC data is semantically unchanged by B2)`, utc.total === 73414 && utc.same === utc.total);
  check(`THE DEFECT, in SQL: the legacy bare-string value differed from the canonical surrogate for every one of the ${kolkata.total} dates on an Asia/Kolkata session (${kolkata.total - kolkata.same} differ) and on Pacific/Auckland (${auckland.total - auckland.same} differ)`, kolkata.same === 0 && auckland.same === 0);

  // ---- the read-only operator diagnostic
  const diagnosticSql = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'diagnostics', 'birth-date-surrogate-check.sql'), 'utf8');
  const runDiagnostic = async () => { const c = await beginTransaction(); try { await c.query('SET TRANSACTION READ ONLY'); const r = await c.query(diagnosticSql.replace(/--.*$/gm, '')); await c.query('COMMIT'); return r; } finally { c.release(); } };
  const emailD = 'test-b2-diagnostic@example.com';
  const du = await upsertUserByEmail({ email: emailD, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  try {
    await sql(`DELETE FROM "SavedPerson" WHERE "ownerUserId" = $1`, [du.id]);
    await sql(`UPDATE "User" SET "birthDate" = NULL WHERE id = $1`, [du.id]);
    const before = await runDiagnostic();
    const at = (rs: { rows: any[] }, table: string) => rs.rows.find((r) => r.table_name === table);
    await sql(`UPDATE "User" SET "birthDate" = '1990-06-14T18:30:00.000Z', "birthTime" = '08:30', "birthTimezone" = $2 WHERE id = $1`, [du.id, TZ]);
    for (const iso of ['1985-01-01T00:00:00.000Z', '1990-06-14T18:30:00.000Z', '1984-12-31T12:00:00.000Z', '1990-06-15T07:00:00.000Z', '1990-06-15T00:00:00.001Z']) {
      const p = await createSavedPerson(du.id, { name: 'p', relationshipType: 'OTHER', birthDate: '1990-06-15', birthTime: '08:30', birthTimezone: TZ });
      await sql(`UPDATE "SavedPerson" SET "birthDate" = $2::timestamptz WHERE id = $1`, [p.id, iso]);
    }
    const after = await runDiagnostic();
    check('DIAGNOSTIC SHAPE: exactly one row per table with exactly the columns table_name, rows_with_birth_date, non_midnight_utc_rows (counts only: no id, name, date, time or coordinate column exists in the result)', after.rows.length === 2 && JSON.stringify(after.fields.map((f: { name: string }) => f.name)) === JSON.stringify(['table_name', 'rows_with_birth_date', 'non_midnight_utc_rows']) && after.rows.map((r: any) => r.table_name).sort().join() === 'SavedPerson,User');
    check('DIAGNOSTIC COUNTS: a User surrogate at 18:30Z and four SavedPerson surrogates off UTC midnight (18:30Z, 12:00Z, 07:00Z and 00:00:00.001Z) are counted; the UTC-midnight row is not', Number(at(after, 'User').non_midnight_utc_rows) - Number(at(before, 'User').non_midnight_utc_rows) === 1 && Number(at(after, 'SavedPerson').non_midnight_utc_rows) - Number(at(before, 'SavedPerson').non_midnight_utc_rows) === 4 && Number(at(after, 'SavedPerson').rows_with_birth_date) - Number(at(before, 'SavedPerson').rows_with_birth_date) === 5);
    const sessionIndependent = async (zone: string) => { const c = await beginTransaction(); try { await c.query(`SET LOCAL TIME ZONE '${zone}'`); const r = await c.query(diagnosticSql.replace(/--.*$/gm, '')); await c.query('COMMIT'); return JSON.stringify(r.rows); } finally { c.release(); } };
    check('DIAGNOSTIC IS SESSION-TIMEZONE INDEPENDENT: the same counts under UTC, Asia/Kolkata and America/Los_Angeles sessions (the time-of-day is taken with AT TIME ZONE \'UTC\')', (await sessionIndependent('UTC')) === (await sessionIndependent('Asia/Kolkata')) && (await sessionIndependent('UTC')) === (await sessionIndependent('America/Los_Angeles')));
    const rowsBefore = await sql(`SELECT count(*)::int AS n FROM "User"`); await runDiagnostic(); const rowsAfter = await sql(`SELECT count(*)::int AS n FROM "User"`);
    check('THE DIAGNOSTIC WRITES NOTHING: it ran inside a READ ONLY transaction and the row counts are unchanged', rowsBefore[0].n === rowsAfter[0].n);
  } finally {
    await sql(`DELETE FROM "SavedPerson" WHERE "ownerUserId" = $1`, [du.id]);
    await sql(`UPDATE "User" SET "birthDate" = NULL WHERE id = $1`, [du.id]);
    for (const [label] of CELLS) await sql(`DELETE FROM "User" WHERE email = $1`, [`test-b2-birth-${label}@example.com`]).catch(() => {});
    await sql(`DELETE FROM "User" WHERE email = $1`, [emailD]).catch(() => {});
  }
  if (!allPassed) { console.error('SOME BIRTH DATE WRITERS DB CHECKS FAILED'); process.exitCode = 1; return; }
  console.log('ALL BIRTH DATE WRITERS DB CHECKS PASSED');
}

(process.env.B2_CHILD === '1' ? child() : parent()).then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
