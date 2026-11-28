/**
 * AURA-MP-3-R1 (62020) -- deterministic concurrency regression for the two
 * 62019 findings, against the REAL route handlers and a REAL disposable
 * Postgres. Run (CI: day-constructor-acceptance-db-tests):
 *
 *   DATABASE_URL="postgresql://..." npx ts-node --project tsconfig.jsdom-tests.json test/myPeopleMp3R1ConcurrencyDb.test.ts
 *
 * F1: dismissal vs special-day DELETE and vs person DELETE.
 * F2: person DELETE vs Move, Home Move (executor -> real Move route) and
 *     Recomposition (real signed acceptance).
 * Every race runs in BOTH orders. Each operation is paused at a fixed point
 * with a test-only BEFORE trigger that waits on an advisory lock this test
 * holds. The other operation is started and must be seen BLOCKED on a row
 * lock at the expected statement before the pause is released, so the
 * interleaving is forced every run rather than left to timing. Asserted: both
 * HTTP outcomes (no 500 = no deadlock loser), no orphan dismissal, no link to
 * a deleted person, no partial Move, unrelated reminder rows untouched.
 * The triggers and the gate table exist only in this disposable database and
 * are dropped at the end.
 */
import { Pool, type PoolClient } from 'pg';

const { createSessionToken } = require('../apps/web/lib/auth');
const db = require('../apps/web/lib/db');
const { getDatePartsInTimezone } = require('../apps/web/lib/timezone');
const { createPlanExecutor } = require('../apps/web/lib/homeCompletion');
const { signRecompositionProposal } = require('../apps/web/lib/remainingDayRecompositionIntegrity');
const peopleRoute = require('../apps/web/app/api/people/route');
const personRoute = require('../apps/web/app/api/people/[personId]/route');
const occasionsRoute = require('../apps/web/app/api/people/[personId]/occasions/route');
const occasionRoute = require('../apps/web/app/api/people/[personId]/occasions/[occasionId]/route');
const dismissalRoute = require('../apps/web/app/api/people/occasions/[occasionId]/dismissal/route');
const plansRoute = require('../apps/web/app/api/plans/route');
const moveRoute = require('../apps/web/app/api/plans/[planId]/move/route');
const acceptRoute = require('../apps/web/app/api/day/recompose/accept/route');

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${!condition && detail !== undefined ? ` -- ${JSON.stringify(detail).slice(0, 700)}` : ''}`);
  if (!condition) allPassed = false;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (text: string, values?: unknown[]) => pool.query(text, values);
const GATE_KEY = 620201;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

type Res = { status: number; body: any };
const req = (as: string, body?: unknown): any => ({
  cookies: { get: (n: string) => (n === 'as_session' ? { value: as } : undefined) },
  json: async () => body,
  headers: new Headers(),
  nextUrl: new URL('http://localhost/'),
});
const call = async (p: Promise<Response>): Promise<Res> => { const r = await p; return { status: r.status, body: await r.json().catch(() => null) }; };

// ---------------- barrier machinery ----------------
async function installBarriers() {
  await q(`CREATE TABLE IF NOT EXISTS mp3r1_gate (kind text NOT NULL, id text NOT NULL, PRIMARY KEY (kind, id))`);
  await q(`CREATE OR REPLACE FUNCTION mp3r1_pause() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE target text;
    BEGIN
      IF TG_TABLE_NAME = 'ReminderAttention' THEN target := NEW."scheduledItemId";
      ELSIF TG_TABLE_NAME = 'PlannedActivity' THEN target := NEW."rescheduledFromPlanId";
      ELSE target := OLD.id; END IF;
      IF target IS NOT NULL AND EXISTS (SELECT 1 FROM mp3r1_gate WHERE kind = TG_ARGV[0] AND id = target) THEN
        PERFORM pg_advisory_xact_lock(${GATE_KEY});
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$`);
  await q(`CREATE TRIGGER mp3r1_pause_attention BEFORE INSERT ON "ReminderAttention" FOR EACH ROW EXECUTE FUNCTION mp3r1_pause('attention')`);
  await q(`CREATE TRIGGER mp3r1_pause_successor BEFORE INSERT ON "PlannedActivity" FOR EACH ROW EXECUTE FUNCTION mp3r1_pause('successor')`);
  await q(`CREATE TRIGGER mp3r1_pause_occasion_delete BEFORE DELETE ON "PersonOccasion" FOR EACH ROW EXECUTE FUNCTION mp3r1_pause('occasion-delete')`);
  await q(`CREATE TRIGGER mp3r1_pause_person_delete BEFORE DELETE ON "SavedPerson" FOR EACH ROW EXECUTE FUNCTION mp3r1_pause('person-delete')`);
}
async function removeBarriers() {
  await q(`DROP TRIGGER IF EXISTS mp3r1_pause_attention ON "ReminderAttention"`);
  await q(`DROP TRIGGER IF EXISTS mp3r1_pause_successor ON "PlannedActivity"`);
  await q(`DROP TRIGGER IF EXISTS mp3r1_pause_occasion_delete ON "PersonOccasion"`);
  await q(`DROP TRIGGER IF EXISTS mp3r1_pause_person_delete ON "SavedPerson"`);
  await q(`DROP FUNCTION IF EXISTS mp3r1_pause()`);
  await q(`DROP TABLE IF EXISTS mp3r1_gate`);
}

/** The first backend (other than ours) whose current statement matches and that waits on a lock of `kind`. */
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

interface RaceOutcome { first: Res; second: Res; paused: boolean; secondBlockedOn: string | null }
/**
 * Pause `first` at the gate (kind, id), start `second`, wait until `second` is
 * blocked on a row lock at a statement matching `secondPattern` (or give up
 * after 3 s -- an unfixed build often does not block at all), then release.
 */
async function race(gate: { kind: string; id: string; at: RegExp }, first: () => Promise<Res>, second: () => Promise<Res>, secondPattern: RegExp): Promise<RaceOutcome> {
  const holder: PoolClient = await pool.connect();
  await holder.query('SELECT pg_advisory_lock($1)', [GATE_KEY]);
  await q('INSERT INTO mp3r1_gate (kind, id) VALUES ($1, $2)', [gate.kind, gate.id]);
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
    await q('DELETE FROM mp3r1_gate WHERE kind = $1 AND id = $2', [gate.kind, gate.id]);
  }
}

const AT_ATTENTION_INSERT = /INSERT INTO "ReminderAttention"/;
const AT_SUCCESSOR_INSERT = /INSERT INTO "PlannedActivity"/;
const AT_PERSON_DELETE = /DELETE FROM "SavedPerson"/;
const AT_OCCASION_DELETE = /DELETE FROM "PersonOccasion"/;

async function main() {
  const tag = `mp3r1-${Date.now()}`;
  // A timezone where it is early in the local day, so every Move and
  // Recomposition destination below stays inside the owner's local today.
  const zones = ['Pacific/Kiritimati', 'Pacific/Auckland', 'Australia/Sydney', 'Asia/Tokyo', 'Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu', 'Etc/GMT+12', 'Pacific/Pago_Pago'];
  const nowAtStart = new Date();
  const tz = zones.find((z) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: z, hour: '2-digit', hourCycle: 'h23' }).format(nowAtStart)) <= 8)!;
  const user = await db.upsertUserByEmail({ email: `${tag}@mp3r1.aura.local`, cityName: 'Test', latitude: 0, longitude: 0, timezone: tz });
  const other = await db.upsertUserByEmail({ email: `${tag}-o@mp3r1.aura.local`, cityName: 'Test', latitude: 0, longitude: 0, timezone: tz });
  const token = createSessionToken(user.id, user.email);
  const today = getDatePartsInTimezone(tz, new Date()).dateStr as string;
  const [ty, tm, td] = today.split('-').map(Number);
  process.env.AURA_MY_PEOPLE_ENABLED = '1';

  const mkPerson = async (name: string) => (await call(peopleRoute.POST(req(token, { name })))).body.id as string;
  const mkDay = async (personId: string) => (await call(occasionsRoute.POST(req(token, { kind: 'BIRTHDAY', month: tm, day: td }), { params: { personId } }))).body.id as string;
  const dismiss = (occasionId: string) => () => call(dismissalRoute.POST(req(token, { scope: 'NOT_THIS_YEAR' }), { params: { occasionId } }));
  const deleteDay = (personId: string, occasionId: string) => () => call(occasionRoute.DELETE(req(token), { params: { personId, occasionId } }));
  const deletePerson = (personId: string) => () => call(personRoute.DELETE(req(token), { params: { personId } }));
  const attentionFor = async (id: string) => (await q(`SELECT "userId", "scheduledItemType", "reminderAt" FROM "ReminderAttention" WHERE "scheduledItemId" = $1 ORDER BY "scheduledItemType", "userId"`, [id])).rows;
  // The owner's own dismissals only: the other user's synthetic row keyed by the same id must SURVIVE (isolation).
  const orphanDismissals = async () => (await q(`SELECT ra.id FROM "ReminderAttention" ra WHERE ra."userId" = $1 AND ra."scheduledItemType" = 'PERSON_OCCASION' AND NOT EXISTS (SELECT 1 FROM "PersonOccasion" po WHERE po.id = ra."scheduledItemId")`, [user.id])).rowCount;
  const exists = async (table: string, id: string) => ((await q(`SELECT 1 FROM "${table}" WHERE id = $1`, [id])).rowCount ?? 0) > 0;

  await installBarriers();
  try {
    // ================= F1: dismissal vs deletion =================
    // Unrelated reminder rows that must survive every deletion below.
    const unrelatedFor = async (occasionId: string) => {
      await q(`INSERT INTO "ReminderAttention" (id, "userId", "scheduledItemType", "scheduledItemId", "reminderAt") VALUES ($1, $2, 'PLANNED_ACTIVITY', $3, now())`, [`${tag}-u1-${occasionId}`, user.id, occasionId]);
      await q(`INSERT INTO "ReminderAttention" (id, "userId", "scheduledItemType", "scheduledItemId", "reminderAt") VALUES ($1, $2, 'PERSON_OCCASION', $3, now())`, [`${tag}-u2-${occasionId}`, other.id, occasionId]);
    };
    const unrelatedIntact = async (occasionId: string) => {
      const rows = await attentionFor(occasionId);
      return rows.length === 2 && rows.some((r: any) => r.scheduledItemType === 'PLANNED_ACTIVITY' && r.userId === user.id) && rows.some((r: any) => r.scheduledItemType === 'PERSON_OCCASION' && r.userId === other.id);
    };
    const ownDismissals = async (occasionId: string) => (await attentionFor(occasionId)).filter((r: any) => r.userId === user.id && r.scheduledItemType === 'PERSON_OCCASION').length;

    {
      const p = await mkPerson('Day race A'); const o = await mkDay(p); await unrelatedFor(o);
      const r = await race({ kind: 'attention', id: o, at: AT_ATTENTION_INSERT }, dismiss(o), deleteDay(p, o), AT_OCCASION_DELETE);
      check('F1 occasion DELETE while a dismissal is mid-write: the DELETE waits on the day\'s row lock', r.paused && r.secondBlockedOn !== null, r);
      check('F1 occasion DELETE after dismissal: dismissal 200, DELETE 200, the day and its dismissal are both gone', r.first.status === 200 && r.second.status === 200 && !(await exists('PersonOccasion', o)) && (await ownDismissals(o)) === 0, { r, own: await ownDismissals(o) });
      check('F1 occasion DELETE after dismissal: unrelated reminder rows (other type, other user) untouched', await unrelatedIntact(o));
    }
    {
      const p = await mkPerson('Day race B'); const o = await mkDay(p); await unrelatedFor(o);
      const r = await race({ kind: 'occasion-delete', id: o, at: AT_OCCASION_DELETE }, deleteDay(p, o), dismiss(o), /SELECT \* FROM "PersonOccasion"/);
      check('F1 dismissal while an occasion DELETE is mid-way: the dismissal waits on the day\'s row lock', r.paused && r.secondBlockedOn !== null, r);
      check('F1 dismissal after occasion DELETE: DELETE 200, dismissal 404, nothing written', r.first.status === 200 && r.second.status === 404 && (await ownDismissals(o)) === 0 && (await unrelatedIntact(o)), r);
    }
    {
      const p = await mkPerson('Person race A'); const o = await mkDay(p); await unrelatedFor(o);
      const r = await race({ kind: 'attention', id: o, at: AT_ATTENTION_INSERT }, dismiss(o), deletePerson(p), /FROM "PersonOccasion"/);
      check('F1 person DELETE while a dismissal is mid-write: the DELETE waits on the person\'s special days BEFORE removing dismissals', r.paused && r.secondBlockedOn !== null && /FOR UPDATE/.test(r.secondBlockedOn), r);
      check('F1 person DELETE after dismissal: dismissal 200, DELETE 200, no orphan dismissal left', r.first.status === 200 && r.second.status === 200 && !(await exists('SavedPerson', p)) && (await ownDismissals(o)) === 0, { r, own: await ownDismissals(o) });
      check('F1 person DELETE after dismissal: unrelated reminder rows untouched', await unrelatedIntact(o));
    }
    {
      const p = await mkPerson('Person race B'); const o = await mkDay(p); await unrelatedFor(o);
      const r = await race({ kind: 'person-delete', id: p, at: AT_PERSON_DELETE }, deletePerson(p), dismiss(o), /SELECT \* FROM "PersonOccasion"/);
      check('F1 dismissal while a person DELETE is mid-way: the dismissal waits on the day\'s row lock', r.paused && r.secondBlockedOn !== null, r);
      check('F1 dismissal after person DELETE: DELETE 200, dismissal 404, nothing written', r.first.status === 200 && r.second.status === 404 && (await ownDismissals(o)) === 0 && (await unrelatedIntact(o)), r);
    }
    check('F1: none of the owner\'s PERSON_OCCASION dismissals outlives its special day', (await orphanDismissals()) === 0);

    // ================= F2: person deletion vs plan replacement =================
    const base = Math.ceil(Date.now() / MINUTE) * MINUTE + HOUR;
    const at = (h: number) => new Date(base + h * HOUR);
    let slot = 0;
    const nextSlot = () => (slot += 0.75) - 0.75; // 45-minute steps, 30-minute plans
    const mkPlan = async (personId: string, title: string, flexible = false) => {
      const start = at(nextSlot());
      const res = await call(plansRoute.POST(req(token, { title, activityType: 'Catch-up', plannedStartAt: start.toISOString(), plannedEndAt: new Date(start.getTime() + 30 * MINUTE).toISOString(), durationMinutes: 30, windowType: 'NEUTRAL', savedPersonId: personId })));
      if (res.status !== 200) throw new Error(`plan create ${res.status} ${JSON.stringify(res.body)}`);
      if (flexible) await q(`UPDATE "PlannedActivity" SET "schedulingMode" = 'FLEXIBLE' WHERE id = $1`, [res.body.id]);
      return res.body.id as string;
    };
    const plan = async (id: string) => (await q(`SELECT * FROM "PlannedActivity" WHERE id = $1`, [id])).rows[0];
    const successorsOf = async (id: string) => (await q(`SELECT * FROM "PlannedActivity" WHERE "rescheduledFromPlanId" = $1`, [id])).rows;

    const viaMove = (planId: string) => { const to = at(nextSlot()); return () => call(moveRoute.POST(req(token, { newStartAt: to.toISOString() }), { params: { planId } })); };
    const viaHomeMove = (planId: string) => {
      const to = at(nextSlot());
      return async (): Promise<Res> => {
        const fetchImpl = async (url: string, init: any) => moveRoute.POST(req(token, JSON.parse(init.body)), { params: { planId: String(url).match(/\/plans\/([^/]+)\/move$/)![1] } });
        const out = await createPlanExecutor(fetchImpl).move(planId, to.toISOString());
        return { status: out.status === 'MOVED' ? 200 : 500, body: out };
      };
    };
    const viaRecomposition = (planId: string) => {
      const to = at(nextSlot());
      return async (): Promise<Res> => {
        const r = await plan(planId);
        const generatedAt = new Date();
        const proposalToken = signRecompositionProposal(user.id, {
          generatedAt, targetDate: getDatePartsInTimezone(tz, generatedAt).dateStr, timezone: tz, summary: { state: 'CHANGES_PROPOSED' },
          decisions: [{ decision: 'MOVE', planId, title: r.title, current: { start: r.plannedStartAt, end: r.plannedEndAt }, to: { start: to, end: new Date(to.getTime() + 30 * MINUTE) } }],
        });
        return call(acceptRoute.POST(req(token, { proposalToken })));
      };
    };

    const scenarios: Array<[string, (id: string) => () => Promise<Res>, boolean]> = [
      ['Move', viaMove, false],
      ['Home Move', viaHomeMove, false],
      ['Recomposition', viaRecomposition, true],
    ];
    for (const [name, op, flexible] of scenarios) {
      // Order A: the replacement is mid-write (successor INSERT paused, source plan locked); then the person DELETE.
      {
        const p = await mkPerson(`${name} race A`);
        const src = await mkPlan(p, `${name} race A plan`, flexible);
        const r = await race({ kind: 'successor', id: src, at: AT_SUCCESSOR_INSERT }, op(src), deletePerson(p), /"SavedPerson"/);
        const s = await plan(src); const next = await successorsOf(src);
        check(`F2 ${name} first, person DELETE second: the DELETE waits on the person row (lock taken before the plan), never on the plan`, r.paused && r.secondBlockedOn !== null && /SELECT id FROM "SavedPerson"/.test(r.secondBlockedOn), r);
        check(`F2 ${name} first, person DELETE second: both 200 (no deadlock), source MOVED, one successor, person gone, no link left to it`, r.first.status === 200 && r.second.status === 200 && s.status === 'MOVED' && next.length === 1 && !(await exists('SavedPerson', p)) && s.savedPersonId === null && next[0].savedPersonId === null, { r: { first: r.first.status, second: r.second.status, body: r.second.body }, s: s.status, link: s.savedPersonId, next: next.map((x: any) => x.savedPersonId) });
      }
      // Order B: the person DELETE is mid-way (person and its days locked); then the replacement.
      {
        const p = await mkPerson(`${name} race B`);
        const src = await mkPlan(p, `${name} race B plan`, flexible);
        const r = await race({ kind: 'person-delete', id: p, at: AT_PERSON_DELETE }, deletePerson(p), op(src), /"SavedPerson"/);
        const s = await plan(src); const next = await successorsOf(src);
        check(`F2 person DELETE first, ${name} second: the replacement waits on the person row before locking the plan`, r.paused && r.secondBlockedOn !== null && /FOR KEY SHARE/.test(r.secondBlockedOn), r);
        check(`F2 person DELETE first, ${name} second: both 200 (no deadlock), source MOVED and unlinked, one unlinked successor, history kept`, r.first.status === 200 && r.second.status === 200 && s.status === 'MOVED' && s.savedPersonId === null && next.length === 1 && next[0].savedPersonId === null && next[0].title === s.title, { r: { first: r.first.status, second: r.second.status, body: r.second.body }, s: s.status, next: next.length });
      }
    }
    check('F2: no plan links to a person that does not exist', (await q(`SELECT 1 FROM "PlannedActivity" pa WHERE pa."savedPersonId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "SavedPerson" sp WHERE sp.id = pa."savedPersonId")`)).rowCount === 0);

    // ---- steady state still intact: a link survives Move while the person lives ----
    {
      const p = await mkPerson('Steady');
      const src = await mkPlan(p, 'Steady linked plan');
      const r = await viaMove(src)();
      check('Steady state: Move keeps the link to a living person', r.status === 200 && (await successorsOf(src))[0]?.savedPersonId === p, r);
    }
  } finally {
    await removeBarriers();
  }

  console.log(allPassed ? `\nALL MY PEOPLE MP-3-R1 CONCURRENCY DB CHECKS PASSED (${count})` : `\nMY PEOPLE MP-3-R1 CONCURRENCY DB CHECK(S) FAILED`);
}

main()
  .catch(async (err) => { console.error(err); allPassed = false; })
  .finally(async () => { await pool.end(); process.exit(allPassed ? 0 : 1); });
