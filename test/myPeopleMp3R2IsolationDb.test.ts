/**
 * AURA-MP-3-R2 (62022) -- the special-day dismissal and deletion transactions
 * must not depend on the database's default isolation level. This test runs
 * every application connection with REPEATABLE READ as the session default
 * (default_transaction_isolation through the connection's `options`; only
 * this process's connections, nothing global or persistent), then:
 *   - records the EFFECTIVE isolation inside each affected transaction
 *     (dismissal, special-day DELETE, person DELETE) with a test-only trigger;
 *   - forces dismissal vs special-day DELETE and vs person DELETE in both
 *     orders, using real routes (the same barrier technique as the R1 test);
 *   - asserts no orphan dismissal and untouched unrelated reminder rows.
 * Run (CI: day-constructor-acceptance-db-tests):
 *
 *   DATABASE_URL="postgresql://..." npx ts-node --project tsconfig.jsdom-tests.json test/myPeopleMp3R2IsolationDb.test.ts
 */
import { Pool, type PoolClient } from 'pg';

// Before any application module creates its pool: REPEATABLE READ is the
// default for every connection this process opens.
const baseUrl = process.env.DATABASE_URL!;
const RR_URL = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}options=${encodeURIComponent('-c default_transaction_isolation=repeatable\\ read')}`;
process.env.DATABASE_URL = RR_URL;
delete process.env.AURA_DATABASE_URL;

// AURA-AUTH-SESSION-01-I2: real database-backed v2 sessions (the v1 token API was removed).
const { createTestSessionToken, TEST_SESSION_COOKIE } = require('./authSessionTestSupport');
const db = require('../apps/web/lib/db');
const { getDatePartsInTimezone } = require('../apps/web/lib/timezone');
const peopleRoute = require('../apps/web/app/api/people/route');
const personRoute = require('../apps/web/app/api/people/[personId]/route');
const occasionsRoute = require('../apps/web/app/api/people/[personId]/occasions/route');
const occasionRoute = require('../apps/web/app/api/people/[personId]/occasions/[occasionId]/route');
const dismissalRoute = require('../apps/web/app/api/people/occasions/[occasionId]/dismissal/route');

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${!condition && detail !== undefined ? ` -- ${JSON.stringify(detail).slice(0, 600)}` : ''}`);
  if (!condition) allPassed = false;
}

const pool = new Pool({ connectionString: RR_URL });
const q = (text: string, values?: unknown[]) => pool.query(text, values);
const GATE_KEY = 620221;

type Res = { status: number; body: any };
const req = (as: string, body?: unknown): any => ({
  cookies: { get: (n: string) => (n === TEST_SESSION_COOKIE ? { value: as } : undefined) },
  json: async () => body,
  headers: new Headers(),
  nextUrl: new URL('http://localhost/'),
});
// A handler that throws (e.g. a 40001 serialization failure) is what Next.js serves as a 500.
const call = async (p: Promise<Response>): Promise<Res> => {
  try { const r = await p; return { status: r.status, body: await r.json().catch(() => null) }; } catch (err: any) { return { status: 500, body: { thrown: err?.code ?? String(err) } }; }
};

async function installBarriers() {
  await q(`CREATE TABLE IF NOT EXISTS mp3r2_gate (kind text NOT NULL, id text NOT NULL, PRIMARY KEY (kind, id))`);
  await q(`CREATE TABLE IF NOT EXISTS mp3r2_isolation (kind text NOT NULL, id text NOT NULL, isolation text NOT NULL)`);
  // Records the transaction's effective isolation for watched rows (committed
  // with that transaction), and pauses it when the row is gated.
  await q(`CREATE OR REPLACE FUNCTION mp3r2_observe() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE target text;
    BEGIN
      IF TG_TABLE_NAME = 'ReminderAttention' THEN target := NEW."scheduledItemId"; ELSE target := OLD.id; END IF;
      IF target IS NOT NULL AND EXISTS (SELECT 1 FROM mp3r2_gate WHERE id = target) THEN
        INSERT INTO mp3r2_isolation VALUES (TG_ARGV[0], target, current_setting('transaction_isolation'));
        IF EXISTS (SELECT 1 FROM mp3r2_gate WHERE kind = TG_ARGV[0] AND id = target) THEN
          PERFORM pg_advisory_xact_lock(${GATE_KEY});
        END IF;
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$`);
  await q(`CREATE TRIGGER mp3r2_observe_attention BEFORE INSERT ON "ReminderAttention" FOR EACH ROW EXECUTE FUNCTION mp3r2_observe('attention')`);
  await q(`CREATE TRIGGER mp3r2_observe_occasion_delete BEFORE DELETE ON "PersonOccasion" FOR EACH ROW EXECUTE FUNCTION mp3r2_observe('occasion-delete')`);
  await q(`CREATE TRIGGER mp3r2_observe_person_delete BEFORE DELETE ON "SavedPerson" FOR EACH ROW EXECUTE FUNCTION mp3r2_observe('person-delete')`);
}
async function removeBarriers() {
  await q(`DROP TRIGGER IF EXISTS mp3r2_observe_attention ON "ReminderAttention"`);
  await q(`DROP TRIGGER IF EXISTS mp3r2_observe_occasion_delete ON "PersonOccasion"`);
  await q(`DROP TRIGGER IF EXISTS mp3r2_observe_person_delete ON "SavedPerson"`);
  await q(`DROP FUNCTION IF EXISTS mp3r2_observe()`);
  await q(`DROP TABLE IF EXISTS mp3r2_gate`);
  await q(`DROP TABLE IF EXISTS mp3r2_isolation`);
}

async function waitForLockWait(kind: 'advisory' | 'row', pattern: RegExp, ms: number): Promise<string | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const rows = (await q(`SELECT query, wait_event FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'`)).rows;
    const hit = rows.find((r: any) => (kind === 'advisory' ? r.wait_event === 'advisory' : r.wait_event !== 'advisory') && pattern.test(r.query));
    if (hit) return String(hit.query).replace(/\s+/g, ' ').trim();
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
}

/** Gate `first` at (kind, watched ids), start `second`, see it blocked on a row lock, release. */
async function race(gate: { kind: string; id: string; watch: string[]; at: RegExp }, first: () => Promise<Res>, second: () => Promise<Res>, secondPattern: RegExp) {
  const holder: PoolClient = await pool.connect();
  await holder.query('SELECT pg_advisory_lock($1)', [GATE_KEY]);
  await q('INSERT INTO mp3r2_gate (kind, id) VALUES ($1, $2)', [gate.kind, gate.id]);
  for (const w of gate.watch) await q(`INSERT INTO mp3r2_gate (kind, id) VALUES ('watch', $1) ON CONFLICT DO NOTHING`, [w]);
  let released = false;
  const release = async () => { if (!released) { released = true; await holder.query('SELECT pg_advisory_unlock($1)', [GATE_KEY]); } };
  try {
    const p1 = first();
    const paused = (await waitForLockWait('advisory', gate.at, 8000)) !== null;
    const p2 = second();
    const secondBlockedOn = paused ? await waitForLockWait('row', secondPattern, 3000) : null;
    await release();
    const [r1, r2] = await Promise.all([p1, p2]);
    return { first: r1, second: r2, paused, secondBlockedOn };
  } finally {
    await release();
    holder.release();
  }
}

async function main() {
  const tag = `mp3r2-${Date.now()}`;
  const TZ = 'Asia/Kolkata';
  const user = await db.upsertUserByEmail({ email: `${tag}@mp3r2.aura.local`, cityName: 'Test', latitude: 0, longitude: 0, timezone: TZ });
  const other = await db.upsertUserByEmail({ email: `${tag}-o@mp3r2.aura.local`, cityName: 'Test', latitude: 0, longitude: 0, timezone: TZ });
  const token = await createTestSessionToken(user.id, user.email);
  const [, tm, td] = (getDatePartsInTimezone(TZ, new Date()).dateStr as string).split('-').map(Number);
  process.env.AURA_MY_PEOPLE_ENABLED = '1';

  // ---- the precondition: REPEATABLE READ really is the default here ----
  {
    const c = await pool.connect();
    try {
      const def = (await c.query('SHOW default_transaction_isolation')).rows[0].default_transaction_isolation;
      await c.query('BEGIN');
      const inTx = (await c.query(`SELECT current_setting('transaction_isolation') AS i`)).rows[0].i;
      await c.query('ROLLBACK');
      check('Precondition: every connection of this process defaults to REPEATABLE READ (a plain BEGIN runs at repeatable read)', def === 'repeatable read' && inTx === 'repeatable read', { def, inTx });
    } finally { c.release(); }
  }

  const mkPerson = async (name: string) => (await call(peopleRoute.POST(req(token, { name })))).body.id as string;
  const mkDay = async (personId: string) => (await call(occasionsRoute.POST(req(token, { kind: 'BIRTHDAY', month: tm, day: td }), { params: { personId } }))).body.id as string;
  const dismiss = (occasionId: string) => () => call(dismissalRoute.POST(req(token, { scope: 'NOT_THIS_YEAR' }), { params: { occasionId } }));
  const deleteDay = (personId: string, occasionId: string) => () => call(occasionRoute.DELETE(req(token), { params: { personId, occasionId } }));
  const deletePerson = (personId: string) => () => call(personRoute.DELETE(req(token), { params: { personId } }));
  const rowsFor = async (id: string) => (await q(`SELECT "userId", "scheduledItemType" FROM "ReminderAttention" WHERE "scheduledItemId" = $1`, [id])).rows;
  const own = async (id: string) => (await rowsFor(id)).filter((r: any) => r.userId === user.id && r.scheduledItemType === 'PERSON_OCCASION').length;
  const unrelatedFor = async (id: string) => {
    await q(`INSERT INTO "ReminderAttention" (id, "userId", "scheduledItemType", "scheduledItemId", "reminderAt") VALUES ($1, $2, 'PLANNED_ACTIVITY', $3, now())`, [`${tag}-u1-${id}`, user.id, id]);
    await q(`INSERT INTO "ReminderAttention" (id, "userId", "scheduledItemType", "scheduledItemId", "reminderAt") VALUES ($1, $2, 'PERSON_OCCASION', $3, now())`, [`${tag}-u2-${id}`, other.id, id]);
  };
  const unrelatedIntact = async (id: string) => {
    const r = await rowsFor(id);
    return r.length === 2 && r.some((x: any) => x.scheduledItemType === 'PLANNED_ACTIVITY' && x.userId === user.id) && r.some((x: any) => x.scheduledItemType === 'PERSON_OCCASION' && x.userId === other.id);
  };
  const seen = async (ids: string[]) => (await q(`SELECT kind, isolation FROM mp3r2_isolation WHERE id = ANY($1::text[]) ORDER BY kind`, [ids])).rows.map((r: any) => `${r.kind}:${r.isolation}`);
  const exists = async (table: string, id: string) => ((await q(`SELECT 1 FROM "${table}" WHERE id = $1`, [id])).rowCount ?? 0) > 0;

  await installBarriers();
  try {
    {
      const p = await mkPerson('R2 day A'); const o = await mkDay(p); await unrelatedFor(o);
      const r = await race({ kind: 'attention', id: o, watch: [o], at: /INSERT INTO "ReminderAttention"/ }, dismiss(o), deleteDay(p, o), /DELETE FROM "PersonOccasion"/);
      const iso = await seen([o]);
      check('R2 dismissal and special-day DELETE each run at READ COMMITTED despite the REPEATABLE READ default', iso.length === 2 && iso.every((x) => x.endsWith(':read committed')) && iso.includes('attention:read committed') && iso.includes('occasion-delete:read committed'), iso);
      check('R2 dismissal first, special-day DELETE second (RR default): DELETE waited, both 200, no orphan, unrelated rows kept', r.paused && r.secondBlockedOn !== null && r.first.status === 200 && r.second.status === 200 && !(await exists('PersonOccasion', o)) && (await own(o)) === 0 && (await unrelatedIntact(o)), { r, own: await own(o) });
    }
    {
      const p = await mkPerson('R2 day B'); const o = await mkDay(p); await unrelatedFor(o);
      const r = await race({ kind: 'occasion-delete', id: o, watch: [o], at: /DELETE FROM "PersonOccasion"/ }, deleteDay(p, o), dismiss(o), /SELECT \* FROM "PersonOccasion"/);
      check('R2 special-day DELETE first, dismissal second (RR default): dismissal waited, then 404 (never a serialization 500), nothing written, unrelated rows kept', r.paused && r.secondBlockedOn !== null && r.first.status === 200 && r.second.status === 404 && (await own(o)) === 0 && (await unrelatedIntact(o)), r);
      check('R2 special-day DELETE ran at READ COMMITTED', (await seen([o])).join() === 'occasion-delete:read committed', await seen([o]));
    }
    {
      const p = await mkPerson('R2 person A'); const o = await mkDay(p); await unrelatedFor(o);
      const r = await race({ kind: 'attention', id: o, watch: [o, p], at: /INSERT INTO "ReminderAttention"/ }, dismiss(o), deletePerson(p), /FROM "PersonOccasion"/);
      const iso = await seen([o, p]);
      check('R2 dismissal and person DELETE (incl. its cascade) each run at READ COMMITTED despite the REPEATABLE READ default', iso.length === 3 && iso.every((x) => x.endsWith(':read committed')) && iso.includes('attention:read committed') && iso.includes('person-delete:read committed'), iso);
      check('R2 dismissal first, person DELETE second (RR default): DELETE waited, both 200, no orphan, unrelated rows kept', r.paused && r.secondBlockedOn !== null && r.first.status === 200 && r.second.status === 200 && !(await exists('SavedPerson', p)) && (await own(o)) === 0 && (await unrelatedIntact(o)), { r, own: await own(o) });
    }
    {
      const p = await mkPerson('R2 person B'); const o = await mkDay(p); await unrelatedFor(o);
      const r = await race({ kind: 'person-delete', id: p, watch: [o, p], at: /DELETE FROM "SavedPerson"/ }, deletePerson(p), dismiss(o), /SELECT \* FROM "PersonOccasion"/);
      check('R2 person DELETE first, dismissal second (RR default): dismissal waited, then 404 (never a serialization 500), nothing written, unrelated rows kept', r.paused && r.secondBlockedOn !== null && r.first.status === 200 && r.second.status === 404 && (await own(o)) === 0 && (await unrelatedIntact(o)), r);
      const iso = await seen([o, p]);
      check('R2 person DELETE and its cascade ran at READ COMMITTED', iso.length === 2 && iso.every((x) => x.endsWith(':read committed')), iso);
    }
    const orphans = (await q(`SELECT 1 FROM "ReminderAttention" ra WHERE ra."userId" = $1 AND ra."scheduledItemType" = 'PERSON_OCCASION' AND NOT EXISTS (SELECT 1 FROM "PersonOccasion" po WHERE po.id = ra."scheduledItemId")`, [user.id])).rowCount;
    check('R2: none of the owner\'s dismissals outlives its special day under a REPEATABLE READ default', orphans === 0, orphans);
  } finally {
    await removeBarriers();
  }
  console.log(allPassed ? `\nALL MY PEOPLE MP-3-R2 ISOLATION DB CHECKS PASSED (${count})` : `\nMY PEOPLE MP-3-R2 ISOLATION DB CHECK(S) FAILED`);
}

main()
  .catch((err) => { console.error(err); allPassed = false; })
  .finally(async () => { await pool.end(); process.exit(allPassed ? 0 : 1); });
