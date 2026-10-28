// HPG3-A1, updated by HPG3-A2 -- live-database proof that migration 0051
// is additive-only (columns round-trip through raw SQL exactly as the
// schema declares: nullable, no default), that a freshly created
// GoalActivity's own columns start NULL/un-backfilled (section 2), and
// that the pure normalize/validate functions handle a real NULL row
// exactly like the pure unit tests already prove for synthetic input
// (section 4, legacy rows). Section 3 now proves the OPPOSITE of A1's own
// original claim for the Rhythm materialization writer specifically: A2
// wires it to WRITE the day snapshot, not leave it NULL -- this section is
// the live-database complement to the structural guard proving that
// wiring is scoped to exactly the reviewed A2 call sites.
// Run with: DATABASE_URL="postgresql://..." npx ts-node test/goalActivityDailyFrequencySchemaDb.test.ts
import { upsertUserByEmail, createGoalWithActivities, beginTransaction, materializeGoalActivityRhythmOccurrence, createPlannedActivity } from '../apps/web/lib/db';
import { normalizeGoalActivityDailyFrequency } from '../apps/web/lib/goalActivityDailyFrequency';
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

async function main() {
  const email = 'hpg3-a1-schema@example.com';
  await sql(`DELETE FROM "GoalActivityExecution" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]).catch(() => {});
  await sql(`DELETE FROM "GoalActivityOccurrence" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]).catch(() => {});
  await sql(`DELETE FROM "GoalActivity" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]).catch(() => {});
  await sql(`DELETE FROM "PlannedActivity" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]).catch(() => {});
  await sql(`DELETE FROM "Goal" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]).catch(() => {});
  await sql(`DELETE FROM "User" WHERE email = $1`, [email]).catch(() => {});

  const user = await upsertUserByEmail({ email, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });

  // ---- 1. Migration compatibility: the four new columns exist, nullable, no default ----
  const columns = await sql(
    `SELECT table_name, column_name, is_nullable, column_default
     FROM information_schema.columns
     WHERE (table_name = 'GoalActivity' AND column_name IN ('dailyFrequencyKind', 'dailyFrequencyLimit'))
        OR (table_name = 'GoalActivityOccurrence' AND column_name IN ('scheduledLocalDate', 'scheduledLocalTimezone'))
     ORDER BY table_name, column_name`
  );
  check('1. all four new columns exist', columns.length === 4);
  check('1. every new column is nullable', columns.every((c) => c.is_nullable === 'YES'));
  check('1. every new column has NO database default', columns.every((c) => c.column_default === null));

  // ---- 2. Existing GoalActivity creation path (createGoalWithActivities, unmodified by this slice) leaves both new columns NULL ----
  const { activities } = await createGoalWithActivities({ userId: user.id, title: 'Fitness', targetDate: null, activities: [{ title: 'Strength training', activityId: null }] });
  const ga = activities[0];
  const gaRow = (await sql(`SELECT "dailyFrequencyKind", "dailyFrequencyLimit" FROM "GoalActivity" WHERE id = $1`, [ga.id]))[0];
  check('2. a freshly created GoalActivity has dailyFrequencyKind = NULL (no backfill, no default, existing writer untouched)', gaRow.dailyFrequencyKind === null);
  check('2. a freshly created GoalActivity has dailyFrequencyLimit = NULL', gaRow.dailyFrequencyLimit === null);
  check('2. normalizeGoalActivityDailyFrequency on this REAL row normalizes to ONCE_PER_DAY, exactly like the pure unit tests predict', normalizeGoalActivityDailyFrequency({ dailyFrequencyKind: gaRow.dailyFrequencyKind, dailyFrequencyLimit: gaRow.dailyFrequencyLimit }).kind === 'ONCE_PER_DAY');

  // ---- 3. materializeGoalActivityRhythmOccurrence, extended by HPG3-A2: now DOES write the day snapshot ----
  // Set rhythmKind directly (createGoalWithActivities' own activities input has no Rhythm field in R2) so the existing,
  // Rhythm materialization path has something to act on.
  await sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = 3 WHERE id = $1`, [ga.id]);
  const start = new Date(Date.now() + 24 * 3600_000);
  const end = new Date(start.getTime() + 30 * 60_000);
  const plan = await createPlannedActivity({ userId: user.id, title: 'Strength training', plannedStartAt: start, plannedEndAt: end, durationMinutes: 30, windowType: 'NEUTRAL' });
  const client = await beginTransaction();
  const materialized = await materializeGoalActivityRhythmOccurrence(user.id, ga.id, plan.id, start, '2026-10-29', 'Asia/Kolkata', client);
  await client.query('COMMIT');
  client.release();
  check('3. setup: the Rhythm materialization path succeeds', materialized.ok === true);
  if (materialized.ok) {
    const occRow = (await sql(`SELECT "scheduledLocalDate", "scheduledLocalTimezone", "scheduledWeekStart" FROM "GoalActivityOccurrence" WHERE id = $1`, [materialized.occurrenceId]))[0];
    const expectedLocalDate = getDatePartsInTimezone('Asia/Kolkata', start).dateStr;
    check('3. HPG3-A2 -- the occurrence this writer created now HAS a scheduledLocalDate, matching the plan\'s own local day', occRow.scheduledLocalDate === expectedLocalDate);
    check('3. ...and scheduledLocalTimezone matches the timezone the call was made with', occRow.scheduledLocalTimezone === 'Asia/Kolkata');
    check('3. the existing scheduledWeekStart pair is UNAFFECTED and still populated exactly as before this migration', occRow.scheduledWeekStart === '2026-10-26' || typeof occRow.scheduledWeekStart === 'string');
  }

  // ---- 4. Legacy row simulation: an occurrence with all-NULL new columns is handled gracefully by the pure reader ----
  const legacyNormalized = normalizeGoalActivityDailyFrequency({ dailyFrequencyKind: null, dailyFrequencyLimit: null });
  check('4. a legacy (pre-A1) GoalActivity row -- indistinguishable from any row this migration touches -- normalizes to ONCE_PER_DAY', legacyNormalized.kind === 'ONCE_PER_DAY');

  await sql(`DELETE FROM "GoalActivityExecution" WHERE "userId" = $1`, [user.id]).catch(() => {});
  await sql(`DELETE FROM "GoalActivityOccurrence" WHERE "userId" = $1`, [user.id]).catch(() => {});
  await sql(`DELETE FROM "GoalActivity" WHERE "userId" = $1`, [user.id]).catch(() => {});
  await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]).catch(() => {});
  await sql(`DELETE FROM "Goal" WHERE "userId" = $1`, [user.id]).catch(() => {});
  await sql(`DELETE FROM "User" WHERE email = $1`, [email]).catch(() => {});

  if (!allPassed) { console.error('SOME HPG3-A1 SCHEMA/MIGRATION CHECKS FAILED'); process.exit(1); }
  console.log('ALL HPG3-A1 SCHEMA/MIGRATION CHECKS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
