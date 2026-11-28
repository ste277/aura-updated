/**
 * AURA-MP-4 (62025) -- Relationship Rhythms against the REAL route handlers
 * and a REAL disposable Postgres (migration 0058 applied). Run (CI:
 * day-constructor-acceptance-db-tests):
 *
 *   DATABASE_URL="postgresql://..." npx ts-node --project tsconfig.jsdom-tests.json test/myPeopleMp4RhythmsDb.test.ts
 *
 * Covers: migration shape and compatibility with existing rows; explicit
 * creation (new visible goal / existing goal) and nothing created otherwise;
 * ownership at the API and the database level; edit, pause, resume and
 * remove through the existing Life Rhythm routes; plans made for the rhythm
 * carrying the person (and Move keeping it); person deletion pausing and
 * unlinking rhythms while keeping history; forced interleavings in both
 * orders (person DELETE vs rhythm creation, vs planning for the rhythm and
 * vs resume) with the R1 barrier technique; atomic rollback; the switch.
 */
import { Pool, type PoolClient } from 'pg';

// AURA-AUTH-SESSION-01-I2: real database-backed v2 sessions (the v1 token API was removed).
const { createTestSessionToken, TEST_SESSION_COOKIE } = require('./authSessionTestSupport');
const db = require('../apps/web/lib/db');
const peopleRoute = require('../apps/web/app/api/people/route');
const personRoute = require('../apps/web/app/api/people/[personId]/route');
const rhythmsRoute = require('../apps/web/app/api/people/[personId]/rhythms/route');
const goalsRoute = require('../apps/web/app/api/goals/route');
const goalArchiveRoute = require('../apps/web/app/api/goals/[goalId]/archive/route');
const goalActivitiesRoute = require('../apps/web/app/api/goals/[goalId]/activities/route');
const rhythmSettingsRoute = require('../apps/web/app/api/goals/[goalId]/activities/[goalActivityId]/rhythm/route');
const dismissRoute = require('../apps/web/app/api/goals/[goalId]/activities/[goalActivityId]/dismiss/route');
const plansRoute = require('../apps/web/app/api/plans/route');
const moveRoute = require('../apps/web/app/api/plans/[planId]/move/route');

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${!condition && detail !== undefined ? ` -- ${JSON.stringify(detail).slice(0, 700)}` : ''}`);
  if (!condition) allPassed = false;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (text: string, values?: unknown[]) => pool.query(text, values);
const GATE_KEY = 620251;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

type Res = { status: number; body: any };
const req = (as: string | null, body?: unknown, url = 'http://localhost/'): any => ({
  cookies: { get: (n: string) => (n === TEST_SESSION_COOKIE && as ? { value: as } : undefined) },
  json: async () => body,
  headers: new Headers(),
  nextUrl: new URL(url),
});
const call = async (p: Promise<Response>): Promise<Res> => {
  try { const r = await p; return { status: r.status, body: await r.json().catch(() => null) }; } catch (err: any) { return { status: 500, body: { thrown: err?.code ?? String(err) } }; }
};

// ---------------- barrier machinery (as in the R1 test) ----------------
async function installBarriers() {
  await q(`CREATE TABLE IF NOT EXISTS mp4_gate (kind text NOT NULL, id text NOT NULL, PRIMARY KEY (kind, id))`);
  await q(`CREATE TABLE IF NOT EXISTS mp4_isolation (id text NOT NULL, isolation text NOT NULL)`);
  await q(`CREATE OR REPLACE FUNCTION mp4_pause() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE target text;
    BEGIN
      -- Nested IFs: PL/pgSQL does not short-circuit AND, and NEW.title
      -- exists only on GoalActivity.
      IF TG_TABLE_NAME = 'GoalActivity' AND TG_OP = 'UPDATE' THEN
        -- R1: gate a rhythm-settings write (it keeps the link) but never the
        -- person delete's own pause+unlink (which clears it).
        IF NEW."savedPersonId" IS NOT NULL THEN target := NEW.id; END IF;
      ELSIF TG_TABLE_NAME = 'GoalActivity' THEN
        target := NEW.title;
        IF NEW.title LIKE 'mp4-observe %' THEN
          INSERT INTO mp4_isolation VALUES (NEW.title, current_setting('transaction_isolation'));
        END IF;
        IF NEW.title LIKE 'mp4-fail %' THEN RAISE EXCEPTION 'synthetic rhythm insert failure'; END IF;
      ELSIF TG_TABLE_NAME = 'GoalActivityOccurrence' THEN target := NEW."goalActivityId";
      ELSIF TG_TABLE_NAME = 'SavedPerson' THEN target := OLD.id;
      END IF;
      IF target IS NOT NULL AND EXISTS (SELECT 1 FROM mp4_gate WHERE kind = TG_ARGV[0] AND id = target) THEN
        PERFORM pg_advisory_xact_lock(${GATE_KEY});
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$`);
  await q(`CREATE TRIGGER mp4_pause_rhythm_insert BEFORE INSERT ON "GoalActivity" FOR EACH ROW EXECUTE FUNCTION mp4_pause('rhythm-insert')`);
  await q(`CREATE TRIGGER mp4_pause_occurrence_insert BEFORE INSERT ON "GoalActivityOccurrence" FOR EACH ROW EXECUTE FUNCTION mp4_pause('occurrence-insert')`);
  await q(`CREATE TRIGGER mp4_pause_person_delete BEFORE DELETE ON "SavedPerson" FOR EACH ROW EXECUTE FUNCTION mp4_pause('person-delete')`);
  await q(`CREATE TRIGGER mp4_pause_rhythm_update BEFORE UPDATE ON "GoalActivity" FOR EACH ROW EXECUTE FUNCTION mp4_pause('rhythm-update')`);
}
async function removeBarriers() {
  await q(`DROP TRIGGER IF EXISTS mp4_pause_rhythm_insert ON "GoalActivity"`);
  await q(`DROP TRIGGER IF EXISTS mp4_pause_occurrence_insert ON "GoalActivityOccurrence"`);
  await q(`DROP TRIGGER IF EXISTS mp4_pause_person_delete ON "SavedPerson"`);
  await q(`DROP TRIGGER IF EXISTS mp4_pause_rhythm_update ON "GoalActivity"`);
  await q(`DROP FUNCTION IF EXISTS mp4_pause()`);
  await q(`DROP TABLE IF EXISTS mp4_gate`);
  await q(`DROP TABLE IF EXISTS mp4_isolation`);
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
async function race(gate: { kind: string; id: string; at: RegExp }, first: () => Promise<Res>, second: () => Promise<Res>, secondPattern: RegExp) {
  const holder: PoolClient = await pool.connect();
  await holder.query('SELECT pg_advisory_lock($1)', [GATE_KEY]);
  await q('INSERT INTO mp4_gate (kind, id) VALUES ($1, $2)', [gate.kind, gate.id]);
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
    await q('DELETE FROM mp4_gate WHERE kind = $1 AND id = $2', [gate.kind, gate.id]);
  }
}

async function main() {
  const tag = `mp4-${Date.now()}`;
  // Early in the owner's local day, so every plan below is "today or later this week".
  const zones = ['Pacific/Kiritimati', 'Pacific/Auckland', 'Australia/Sydney', 'Asia/Tokyo', 'Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu', 'Etc/GMT+12', 'Pacific/Pago_Pago'];
  const tz = zones.find((z) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: z, hour: '2-digit', hourCycle: 'h23' }).format(new Date())) <= 8)!;
  const user = await db.upsertUserByEmail({ email: `${tag}@mp4.aura.local`, cityName: 'Test', latitude: 0, longitude: 0, timezone: tz });
  const other = await db.upsertUserByEmail({ email: `${tag}-o@mp4.aura.local`, cityName: 'Test', latitude: 0, longitude: 0, timezone: tz });
  const token = await createTestSessionToken(user.id, user.email);
  const otherToken = await createTestSessionToken(other.id, other.email);
  const on = () => { process.env.AURA_MY_PEOPLE_ENABLED = '1'; };
  const off = () => { delete process.env.AURA_MY_PEOPLE_ENABLED; };
  on();

  const mkPerson = async (name: string, as = token) => (await call(peopleRoute.POST(req(as, { name })))).body.id as string;
  const rhythms = (personId: string, as: string | null = token) => call(rhythmsRoute.GET(req(as), { params: { personId } }));
  const createRhythm = (personId: string, body: any, as: string | null = token) => () => call(rhythmsRoute.POST(req(as, body), { params: { personId } }));
  const deletePerson = (personId: string, as = token) => () => call(personRoute.DELETE(req(as), { params: { personId } }));
  const goalCount = async (u = user.id) => Number((await q(`SELECT count(*) FROM "Goal" WHERE "userId" = $1`, [u])).rows[0].count);
  const gaCount = async (u = user.id) => Number((await q(`SELECT count(*) FROM "GoalActivity" WHERE "userId" = $1`, [u])).rows[0].count);
  const ga = async (id: string) => (await q(`SELECT * FROM "GoalActivity" WHERE id = $1`, [id])).rows[0];
  const plan = async (id: string) => (await q(`SELECT * FROM "PlannedActivity" WHERE id = $1`, [id])).rows[0];
  const exists = async (table: string, id: string) => ((await q(`SELECT 1 FROM "${table}" WHERE id = $1`, [id])).rowCount ?? 0) > 0;
  const newGoalBody = (personName: string, title: string, extra: any = {}) => ({ choice: 'CALL', title, targetPerWeek: 1, goal: { kind: 'NEW', title: `Stay close to ${personName}` }, ...extra });
  const base = Math.ceil(Date.now() / MINUTE) * MINUTE + HOUR;
  let slot = 0;
  const nextStart = () => new Date(base + (slot++) * 45 * MINUTE);
  const planFor = (goalActivityId: string | null, title: string, extra: any = {}) => {
    const start = nextStart();
    return () => call(plansRoute.POST(req(token, { title, activityType: 'Catch-up', activityId: 'catch-up', plannedStartAt: start.toISOString(), plannedEndAt: new Date(start.getTime() + 30 * MINUTE).toISOString(), durationMinutes: 30, windowType: 'NEUTRAL', ...(goalActivityId ? { goalActivityId } : {}), ...extra })));
  };
  const settings = (goalId: string, id: string, body: any, as = token) => () => call(rhythmSettingsRoute.PATCH(req(as, body), { params: { goalId, goalActivityId: id } }));

  // ================= migration shape and compatibility =================
  {
    const col = (await q(`SELECT is_nullable, data_type FROM information_schema.columns WHERE table_name = 'GoalActivity' AND column_name = 'savedPersonId'`)).rows[0];
    const fk = (await q(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'GoalActivity_person_owner_fkey'`)).rows[0];
    const idx = (await q(`SELECT indexdef FROM pg_indexes WHERE indexname = 'GoalActivity_savedPersonId_idx'`)).rows[0];
    check('0058: GoalActivity.savedPersonId is a nullable text column', col?.is_nullable === 'YES' && col?.data_type === 'text', col);
    check('0058: composite same-account FK (savedPersonId, userId) -> SavedPerson(id, ownerUserId), ON DELETE NO ACTION', /FOREIGN KEY \("savedPersonId", "userId"\) REFERENCES "SavedPerson"\(id, "ownerUserId"\)$/.test(fk?.def ?? ''), fk);
    check('0058: one partial index for linked rows only', /\("savedPersonId"\) WHERE \("savedPersonId" IS NOT NULL\)/.test(idx?.indexdef ?? ''), idx);
    const legacyGoal = await call(goalsRoute.POST(req(token, { title: `${tag} legacy goal` })));
    const legacyAct = await call(goalActivitiesRoute.POST(req(token, { title: 'Read', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } }), { params: { goalId: legacyGoal.body.id ?? legacyGoal.body.goal?.id } }));
    check('Existing Goals paths are unchanged: a goal and rhythm created the old way have no person (no backfill, no association)', legacyGoal.status < 300 && legacyAct.status < 300 && (await ga(legacyAct.body.id))?.savedPersonId === null, { legacyGoal, legacyAct });
    // Scoped to this test's own accounts: other suites in the same CI database may legitimately hold linked rows.
    const nonNull = Number((await q(`SELECT count(*) FROM "GoalActivity" WHERE "savedPersonId" IS NOT NULL AND "userId" = ANY($1::text[])`, [[user.id, other.id]])).rows[0].count);
    check('0058: none of this account\'s GoalActivity rows carries a person before MP-4 creates one', nonNull === 0, nonNull);
  }

  // ================= switch off =================
  const ravi = await mkPerson('Ravi');
  {
    off();
    const g0 = await goalCount(); const a0 = await gaCount();
    const get = await rhythms(ravi);
    const post = await createRhythm(ravi, newGoalBody('Ravi', 'Call Ravi'))();
    check('Switch OFF: GET and POST /api/people/:id/rhythms are 404 and nothing is created', get.status === 404 && post.status === 404 && (await goalCount()) === g0 && (await gaCount()) === a0, { get: get.status, post: post.status });
    on();
  }

  // ================= nothing created implicitly =================
  {
    const g0 = await goalCount(); const a0 = await gaCount();
    const p = await mkPerson('Meera');
    await call(personRoute.PATCH(req(token, { name: 'Meera K', notes: 'n' }), { params: { personId: p } }));
    check('Adding or editing a person creates no goal and no rhythm (R1)', (await goalCount()) === g0 && (await gaCount()) === a0);
    const bad = await createRhythm(p, { choice: 'CALL', title: 'Call Meera', targetPerWeek: 0, goal: { kind: 'NEW', title: 'Stay close to Meera' } })();
    const badChoice = await createRhythm(p, { choice: 'TEXT', title: 'x', targetPerWeek: 1, goal: { kind: 'NEW', title: 'g' } })();
    const noGoal = await createRhythm(p, { choice: 'CALL', title: 'Call Meera', targetPerWeek: 1 })();
    const spoofedActivity = await createRhythm(p, { choice: 'CALL', activityId: 'marriage', title: 'Call Meera', targetPerWeek: 1, goal: { kind: 'NEW', title: 'g' } })();
    check('Invalid requests (0 per week, unknown choice, no goal) are 400 and create nothing', bad.status === 400 && badChoice.status === 400 && noGoal.status === 400 && (await goalCount()) === g0 + (spoofedActivity.status === 201 ? 1 : 0), { bad: bad.status, badChoice: badChoice.status, noGoal: noGoal.status });
    check('A client activityId is ignored: the activity comes from the choice (Call -> catch-up)', spoofedActivity.status === 201 && (await ga(spoofedActivity.body.id)).activityId === 'catch-up', spoofedActivity);
    await call(dismissRoute.POST(req(token), { params: { goalId: spoofedActivity.body.goalId, goalActivityId: spoofedActivity.body.id } }));
  }

  // ================= explicit creation =================
  let raviRhythm: any;
  {
    const g0 = await goalCount();
    const r = await createRhythm(ravi, newGoalBody('Ravi', 'Call Ravi', { targetPerWeek: 2 }))();
    raviRhythm = r.body;
    const row = await ga(r.body.id);
    const goal = (await q(`SELECT * FROM "Goal" WHERE id = $1`, [r.body.goalId])).rows[0];
    check('Explicit "Keep in touch" with a NEW goal: one visible "Stay close to Ravi" goal and one weekly rhythm linked to Ravi', r.status === 201 && r.body.goalCreated === true && (await goalCount()) === g0 + 1 && goal?.title === 'Stay close to Ravi' && goal?.status === 'ACTIVE' && row.savedPersonId === ravi && row.rhythmKind === 'N_PER_WEEK' && row.rhythmTargetPerWeek === 2 && row.activityId === 'catch-up' && row.rhythmPreferredDurationMinutes === 30 && row.rhythmPausedAt === null, { r, row });
    const list = await rhythms(ravi);
    check('GET lists the rhythm with its goal, cadence and pause state', list.status === 200 && list.body.length === 1 && list.body[0].id === r.body.id && list.body[0].goalTitle === 'Stay close to Ravi' && list.body[0].paused === false, list.body);

    const existing = await call(goalsRoute.POST(req(token, { title: `${tag} Family` })));
    const existingId = existing.body.id ?? existing.body.goal?.id;
    const g1 = await goalCount();
    const a = await createRhythm(ravi, { choice: 'DINNER', title: 'Dinner with Ravi', targetPerWeek: 1, goal: { kind: 'EXISTING', goalId: existingId } })();
    check('Attach to an EXISTING goal: no new goal, the rhythm sits under the chosen goal (family-dinner)', a.status === 201 && a.body.goalCreated === false && a.body.goalId === existingId && (await goalCount()) === g1 && (await ga(a.body.id)).activityId === 'family-dinner', a);

    await call(goalArchiveRoute.POST(req(token), { params: { goalId: existingId } }));
    const archived = await createRhythm(ravi, { choice: 'CALL', title: 'Call Ravi again', targetPerWeek: 1, goal: { kind: 'EXISTING', goalId: existingId } })();
    check('An archived goal is refused (409) and nothing is created', archived.status === 409 && (await goalCount()) === g1);
    check('Rhythms under an archived goal are not listed on the person', (await rhythms(ravi)).body.length === 1);
  }

  // ================= ownership =================
  {
    const zed = await mkPerson('Zed', otherToken);
    const otherGoal = await call(goalsRoute.POST(req(otherToken, { title: `${tag} other goal` })));
    const otherGoalId = otherGoal.body.id ?? otherGoal.body.goal?.id;
    const g0 = await goalCount(); const a0 = await gaCount();
    const foreignPerson = await createRhythm(zed, newGoalBody('Zed', 'Call Zed'))();
    const foreignGoal = await createRhythm(ravi, { choice: 'CALL', title: 'Call Ravi', targetPerWeek: 1, goal: { kind: 'EXISTING', goalId: otherGoalId } })();
    const foreignList = await rhythms(ravi, otherToken);
    const noSession = await rhythms(ravi, null);
    check('Cross-account: another owner\'s person -> 404; another owner\'s goal -> 404; listing someone else\'s person -> 404; no session -> 401; nothing created', foreignPerson.status === 404 && foreignGoal.status === 404 && foreignList.status === 404 && noSession.status === 401 && (await goalCount()) === g0 && (await gaCount()) === a0, { foreignPerson: foreignPerson.status, foreignGoal: foreignGoal.status, foreignList: foreignList.status, noSession: noSession.status });
    const foreignEdit = await settings(raviRhythm.goalId, raviRhythm.id, { paused: true }, otherToken)();
    check('Cross-account edit / pause of the rhythm is 404 (existing Life Rhythm route ownership)', foreignEdit.status === 404 && (await ga(raviRhythm.id)).rhythmPausedAt === null);
    let dbError = '';
    try { await q(`UPDATE "GoalActivity" SET "savedPersonId" = $1 WHERE id = $2`, [zed, raviRhythm.id]); } catch (err: any) { dbError = err.code; }
    check('DATABASE level: linking a rhythm to another account\'s person is rejected by the composite FK (23503)', dbError === '23503', dbError);
    let bareDelete = '';
    try { await q(`DELETE FROM "SavedPerson" WHERE id = $1`, [ravi]); } catch (err: any) { bareDelete = err.code; }
    check('DATABASE level: deleting a person outside the app path while a rhythm is linked fails (NO ACTION) -- never a silently running unlinked rhythm', bareDelete === '23503' && (await exists('SavedPerson', ravi)), bareDelete);
  }

  // ================= lifecycle through the existing routes =================
  {
    const pause = await settings(raviRhythm.goalId, raviRhythm.id, { paused: true })();
    const afterPause = (await rhythms(ravi)).body[0];
    const resume = await settings(raviRhythm.goalId, raviRhythm.id, { paused: false })();
    const edit = await settings(raviRhythm.goalId, raviRhythm.id, { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 } })();
    const row = await ga(raviRhythm.id);
    check('Pause / resume / edit (existing route): state changes, the person link is kept throughout', pause.status === 200 && afterPause.paused === true && resume.status === 200 && edit.status === 200 && row.rhythmPausedAt === null && row.rhythmTargetPerWeek === 3 && row.savedPersonId === ravi, { pause: pause.status, resume: resume.status, edit: edit.status });
  }

  // ================= planning carries the person =================
  let raviPlanId = '';
  {
    const made = await planFor(raviRhythm.id, 'Call Ravi')();
    raviPlanId = made.body?.id ?? made.body?.plan?.id;
    const p = raviPlanId ? await plan(raviPlanId) : null;
    const occ = (await q(`SELECT 1 FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [raviRhythm.id])).rowCount;
    check('A plan made for the rhythm (POST /api/plans with goalActivityId) is linked to the person and counts as an occurrence', made.status === 200 && p?.savedPersonId === ravi && occ === 1, { made: made.status, body: made.body, link: p?.savedPersonId });
    check('R1 F2: the Plan success response reports the COMMITTED person association (same as the stored row)', made.body?.savedPersonId === p?.savedPersonId && made.body?.savedPersonId === ravi, { response: made.body?.savedPersonId, stored: p?.savedPersonId });
    const moved = await call(moveRoute.POST(req(token, { newStartAt: nextStart().toISOString() }), { params: { planId: raviPlanId } }));
    const succ = (await q(`SELECT * FROM "PlannedActivity" WHERE "rescheduledFromPlanId" = $1`, [raviPlanId])).rows[0];
    check('Moving that plan keeps the person on the new plan (MP-3 Move contract)', moved.status === 200 && succ?.savedPersonId === ravi, { moved: moved.status });
    const plain = await planFor(null, 'Unrelated plan')();
    check('A plan with no rhythm and no person stays unlinked', plain.status === 200 && (await plan(plain.body?.id ?? plain.body?.plan?.id))?.savedPersonId === null);
  }

  // ================= removal keeps history =================
  {
    const p = await mkPerson('Asha');
    const r = await createRhythm(p, newGoalBody('Asha', 'Walk with Asha', { choice: 'WALK' }))();
    const removed = await call(dismissRoute.POST(req(token), { params: { goalId: r.body.goalId, goalActivityId: r.body.id } }));
    const row = await ga(r.body.id);
    check('Remove (existing dismiss route): no longer listed on the person; the rhythm row and its goal are kept as history', removed.status === 200 && (await rhythms(p)).body.length === 0 && row?.status === 'DISMISSED' && (await exists('Goal', r.body.goalId)));
  }

  // ================= person deletion: pause + unlink, history kept =================
  {
    const before = await ga(raviRhythm.id);
    const del = await deletePerson(ravi)();
    const row = await ga(raviRhythm.id);
    const p = await plan(raviPlanId);
    const occ = (await q(`SELECT 1 FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [raviRhythm.id])).rowCount;
    check('Person DELETE with an ACTIVE linked rhythm: 200; the rhythm is PAUSED and unlinked; its goal, occurrence and plans are kept (plan link cleared)', before.rhythmPausedAt === null && del.status === 200 && row.rhythmPausedAt !== null && row.savedPersonId === null && row.status !== 'DISMISSED' && (await exists('Goal', raviRhythm.goalId)) && occ === 1 && p && p.savedPersonId === null, { del, row: { paused: row.rhythmPausedAt, link: row.savedPersonId } });
    const refused = await planFor(raviRhythm.id, 'Call Ravi after delete')();
    check('The paused rhythm accepts no new plan (existing RHYTHM_PAUSED rule) -- Aura stops proposing time with a removed person', refused.status >= 400 && refused.status < 500, refused);
  }

  await installBarriers();
  try {
    // ================= concurrency: person DELETE vs rhythm creation =================
    {
      const p = await mkPerson('Race create A');
      const title = `${tag} create A`;
      const r = await race({ kind: 'rhythm-insert', id: title, at: /INSERT INTO "GoalActivity"/ }, createRhythm(p, newGoalBody('A', title)), deletePerson(p), /"SavedPerson"/);
      const row = r.first.body?.id ? await ga(r.first.body.id) : null;
      check('Creation first, person DELETE second: the DELETE waits on the person row; both succeed; the new rhythm ends PAUSED and unlinked (goal kept)', r.paused && r.secondBlockedOn !== null && /FOR UPDATE/.test(r.secondBlockedOn) && r.first.status === 201 && r.second.status === 200 && row?.savedPersonId === null && row?.rhythmPausedAt !== null && (await exists('Goal', r.first.body.goalId)), { r, row: row && { link: row.savedPersonId, paused: row.rhythmPausedAt } });
    }
    {
      const p = await mkPerson('Race create B');
      const g0 = await goalCount(); const a0 = await gaCount();
      const r = await race({ kind: 'person-delete', id: p, at: /DELETE FROM "SavedPerson"/ }, deletePerson(p), createRhythm(p, newGoalBody('B', `${tag} create B`)), /"SavedPerson"/);
      check('Person DELETE first, creation second: creation waits on the person, then 404 -- no rhythm and no goal created', r.paused && r.secondBlockedOn !== null && /FOR KEY SHARE/.test(r.secondBlockedOn) && r.first.status === 200 && r.second.status === 404 && (await goalCount()) === g0 && (await gaCount()) === a0, r);
    }

    // ================= concurrency: person DELETE vs planning for the rhythm =================
    {
      const p = await mkPerson('Race plan A');
      const rh = (await createRhythm(p, newGoalBody('A', `${tag} plan A rhythm`))()).body;
      const r = await race({ kind: 'occurrence-insert', id: rh.id, at: /INSERT INTO "GoalActivityOccurrence"/ }, planFor(rh.id, 'Plan A'), deletePerson(p), /"SavedPerson"/);
      const madeId = r.first.body?.id ?? r.first.body?.plan?.id;
      const made = madeId ? await plan(madeId) : null;
      const row = await ga(rh.id);
      check('Planning first (person locked before the rhythm), person DELETE second: DELETE waits on the person; both 200, no deadlock; plan kept and unlinked; rhythm paused and unlinked', r.paused && r.secondBlockedOn !== null && /FOR UPDATE/.test(r.secondBlockedOn) && r.first.status === 200 && r.second.status === 200 && made?.savedPersonId === null && row.savedPersonId === null && row.rhythmPausedAt !== null, { r: { first: r.first.status, second: r.second.status, blocked: r.secondBlockedOn, body: r.first.status !== 200 ? r.first.body : undefined }, link: made?.savedPersonId });
    }
    {
      const p = await mkPerson('Race plan B');
      const rh = (await createRhythm(p, newGoalBody('B', `${tag} plan B rhythm`))()).body;
      const plans0 = Number((await q(`SELECT count(*) FROM "PlannedActivity" WHERE "userId" = $1`, [user.id])).rows[0].count);
      const r = await race({ kind: 'person-delete', id: p, at: /DELETE FROM "SavedPerson"/ }, deletePerson(p), planFor(rh.id, 'Plan B'), /"SavedPerson"/);
      const plans1 = Number((await q(`SELECT count(*) FROM "PlannedActivity" WHERE "userId" = $1`, [user.id])).rows[0].count);
      check('Person DELETE first, planning second: planning waits on the person, then the now-paused rhythm refuses the plan (4xx, never a deadlock 500); no plan written', r.paused && r.secondBlockedOn !== null && /FOR KEY SHARE/.test(r.secondBlockedOn) && r.first.status === 200 && r.second.status >= 400 && r.second.status < 500 && plans1 === plans0 && (await ga(rh.id)).rhythmPausedAt !== null, { r: { first: r.first.status, second: r.second.status, body: r.second.body } });
    }

    // ================= concurrency: person DELETE vs resume / edit (R1, D7) =================
    // Final state after EVERY ordering: the rhythm stays PAUSED and unlinked, and planning for it is refused.
    const planningRefused = async (rh: any) => { const r = await planFor(rh.id, 'Plan after race')(); return r.status >= 400 && r.status < 500; };
    const linkedPaused = async (personName: string, title: string) => {
      const p = await mkPerson(personName);
      const rh = (await createRhythm(p, newGoalBody(personName, title, { targetPerWeek: 4 }))()).body;
      await settings(rh.goalId, rh.id, { paused: true })();
      return { p, rh };
    };
    {
      // Resume first: the resume's UPDATE is paused holding the rhythm row; the DELETE then waits on it.
      const { p, rh } = await linkedPaused('Race resume A', `${tag} resume A`);
      const r = await race({ kind: 'rhythm-update', id: rh.id, at: /UPDATE "GoalActivity" SET/ }, settings(rh.goalId, rh.id, { paused: false }), deletePerson(p), /UPDATE "GoalActivity"/);
      const row = await ga(rh.id);
      check('Resume first, person DELETE second: the DELETE waits on the rhythm row; both 200; the rhythm ends PAUSED and unlinked (D7); planning is refused', r.paused && r.secondBlockedOn !== null && r.first.status === 200 && r.second.status === 200 && row.savedPersonId === null && row.rhythmPausedAt !== null && (await planningRefused(rh)), { r: { first: r.first.status, second: r.second.status, blocked: r.secondBlockedOn }, link: row.savedPersonId, paused: row.rhythmPausedAt });
    }
    {
      // Person DELETE first (paused after it paused+unlinked the rhythm); a resume sent for the linked rhythm waits, then must not reactivate it.
      const { p, rh } = await linkedPaused('Race resume B', `${tag} resume B`);
      const r = await race({ kind: 'person-delete', id: p, at: /DELETE FROM "SavedPerson"/ }, deletePerson(p), settings(rh.goalId, rh.id, { paused: false }), /"GoalActivity"/);
      const row = await ga(rh.id);
      check('Person DELETE first, resume second (62027): the resume waits on the rhythm row, then 409 PERSON_LINK_CHANGED; the rhythm stays PAUSED and unlinked, cadence unchanged; planning is refused', r.paused && r.secondBlockedOn !== null && r.first.status === 200 && r.second.status === 409 && r.second.body?.code === 'PERSON_LINK_CHANGED' && row.savedPersonId === null && row.rhythmPausedAt !== null && row.rhythmTargetPerWeek === 4 && (await planningRefused(rh)), { r: { first: r.first.status, second: r.second.status, body: r.second.body }, link: row.savedPersonId, paused: row.rhythmPausedAt });
    }
    {
      // Edit only, edit first: the edit applies, then the DELETE pauses and unlinks.
      const p = await mkPerson('Race edit A');
      const rh = (await createRhythm(p, newGoalBody('A', `${tag} edit A`, { targetPerWeek: 4 }))()).body;
      const r = await race({ kind: 'rhythm-update', id: rh.id, at: /UPDATE "GoalActivity" SET/ }, settings(rh.goalId, rh.id, { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 } }), deletePerson(p), /UPDATE "GoalActivity"/);
      const row = await ga(rh.id);
      check('Edit first, person DELETE second: both 200; the new cadence is kept and the rhythm ends PAUSED and unlinked; planning is refused', r.paused && r.secondBlockedOn !== null && r.first.status === 200 && r.second.status === 200 && row.rhythmTargetPerWeek === 3 && row.savedPersonId === null && row.rhythmPausedAt !== null && (await planningRefused(rh)), { r: { first: r.first.status, second: r.second.status }, row: { t: row.rhythmTargetPerWeek, link: row.savedPersonId, paused: row.rhythmPausedAt } });
    }
    {
      // Person DELETE first, edit only second.
      const p = await mkPerson('Race edit B');
      const rh = (await createRhythm(p, newGoalBody('B', `${tag} edit B`, { targetPerWeek: 4 }))()).body;
      const r = await race({ kind: 'person-delete', id: p, at: /DELETE FROM "SavedPerson"/ }, deletePerson(p), settings(rh.goalId, rh.id, { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 } }), /"GoalActivity"/);
      const row = await ga(rh.id);
      check('Person DELETE first, edit second: the edit waits, then 409 (its person is gone) and writes nothing; the rhythm stays PAUSED and unlinked; planning is refused', r.paused && r.secondBlockedOn !== null && r.first.status === 200 && r.second.status === 409 && row.rhythmTargetPerWeek === 4 && row.savedPersonId === null && row.rhythmPausedAt !== null && (await planningRefused(rh)), { r: { first: r.first.status, second: r.second.status }, row: { t: row.rhythmTargetPerWeek, link: row.savedPersonId, paused: row.rhythmPausedAt } });
    }
    {
      // A stale person screen: the deletion already committed; My People sends the person it acted for.
      const { p, rh } = await linkedPaused('Stale screen', `${tag} stale`);
      await deletePerson(p)();
      const stale = await settings(rh.goalId, rh.id, { paused: false, savedPersonId: p })();
      const row = await ga(rh.id);
      check('Stale person screen (deletion already committed, savedPersonId sent): 409, the rhythm stays PAUSED', stale.status === 409 && stale.body?.code === 'PERSON_LINK_CHANGED' && row.rhythmPausedAt !== null, stale);
      // Deliberately resuming an already-unlinked rhythm (e.g. from Goals) is still allowed.
      const deliberate = await settings(rh.goalId, rh.id, { paused: false })();
      const after = await ga(rh.id);
      const replanned = await planFor(rh.id, 'Plan after deliberate resume')();
      const replannedRow = replanned.body?.id ? await plan(replanned.body.id) : null;
      check('A deliberate resume of the already-unlinked rhythm still works (no permanent ban): active again; planning allowed; the plan has no person (response = stored)', deliberate.status === 200 && after.rhythmPausedAt === null && after.savedPersonId === null && replanned.status === 200 && replannedRow?.savedPersonId === null && replanned.body?.savedPersonId === null, { deliberate: deliberate.status, replanned: replanned.status });
    }
    // ================= R2: Remove (dismiss) against person DELETE =================
    const removeAs = (rh: any, personId?: string) => () => call(dismissRoute.POST(req(token, personId ? { savedPersonId: personId } : undefined), { params: { goalId: rh.goalId, goalActivityId: rh.id } }));
    const snapshot = async (id: string) => (await q(`SELECT to_jsonb(ga) AS j FROM "GoalActivity" ga WHERE id = $1`, [id])).rows[0].j;
    {
      // Remove first (its UPDATE paused, holding the rhythm row); the DELETE then waits on it.
      const p = await mkPerson('Race remove A');
      const rh = (await createRhythm(p, newGoalBody('A', `${tag} remove A`))()).body;
      const r = await race({ kind: 'rhythm-update', id: rh.id, at: /UPDATE "GoalActivity" SET status/ }, removeAs(rh, p), deletePerson(p), /UPDATE "GoalActivity"/);
      const row = await ga(rh.id);
      check('R2 Remove first (from the person page), person DELETE second: both 200; the rhythm is removed (DISMISSED, kept as history) and still paused and unlinked by the deletion', r.paused && r.secondBlockedOn !== null && r.first.status === 200 && r.second.status === 200 && row.status === 'DISMISSED' && row.savedPersonId === null && row.rhythmPausedAt !== null, { r: { first: r.first.status, second: r.second.status, blocked: r.secondBlockedOn }, row: { status: row.status, link: row.savedPersonId } });
    }
    {
      // Person DELETE first; a Remove sent from the person page waits, then must not change the preserved rhythm.
      const p = await mkPerson('Race remove B');
      const rh = (await createRhythm(p, newGoalBody('B', `${tag} remove B`))()).body;
      const r = await race({ kind: 'person-delete', id: p, at: /DELETE FROM "SavedPerson"/ }, deletePerson(p), removeAs(rh, p), /"GoalActivity"/);
      const row = await ga(rh.id);
      check('R2 person DELETE first, Remove second: the Remove waits on the rhythm row, then 409 PERSON_LINK_CHANGED; the rhythm stays SUGGESTED, PAUSED and unlinked', r.paused && r.secondBlockedOn !== null && r.first.status === 200 && r.second.status === 409 && r.second.body?.code === 'PERSON_LINK_CHANGED' && row.status !== 'DISMISSED' && row.savedPersonId === null && row.rhythmPausedAt !== null, { r: { first: r.first.status, second: r.second.status, body: r.second.body }, status: row.status });
    }
    {
      // Stale person page: the deletion already committed; the page's Remove carries the person.
      const p = await mkPerson('Stale remove');
      const rh = (await createRhythm(p, newGoalBody('S', `${tag} stale remove`))()).body;
      await deletePerson(p)();
      const before = await snapshot(rh.id);
      const stale = await removeAs(rh, p)();
      const unchanged = JSON.stringify(before) === JSON.stringify(await snapshot(rh.id));
      check('R2 stale person page Remove after deletion: 409 PERSON_LINK_CHANGED and the preserved rhythm is byte-for-byte unchanged (paused, unlinked, not removed)', stale.status === 409 && stale.body?.code === 'PERSON_LINK_CHANGED' && unchanged && before.status !== 'DISMISSED' && before.savedPersonId === null && before.rhythmPausedAt !== null, { stale: stale.status, unchanged });
      const resumed = await settings(rh.goalId, rh.id, { paused: false })();
      const replanned = await planFor(rh.id, 'Plan after stale remove and resume')();
      check('R2 a later deliberate Resume from Goals restores planning (plan 200, unlinked, response = stored)', resumed.status === 200 && replanned.status === 200 && replanned.body?.savedPersonId === null && (await plan(replanned.body.id))?.savedPersonId === null, { resumed: resumed.status, replanned: replanned.status });
    }
    {
      // Legitimate Remove still works: from a live person page, and from Goals (no body).
      const p = await mkPerson('Legit remove');
      const fromPage = (await createRhythm(p, newGoalBody('L', `${tag} legit page`))()).body;
      const fromGoals = (await createRhythm(p, newGoalBody('L', `${tag} legit goals`))()).body;
      const a = await removeAs(fromPage, p)();
      const b = await removeAs(fromGoals)();
      check('R2 legitimate Remove: from the person page (matching person) and from Goals (no body) both 200 -> DISMISSED, links kept', a.status === 200 && b.status === 200 && (await ga(fromPage.id)).status === 'DISMISSED' && (await ga(fromGoals.id)).status === 'DISMISSED' && (await ga(fromPage.id)).savedPersonId === p, { a: a.status, b: b.status });
      const wrong = await removeAs((await createRhythm(p, newGoalBody('L', `${tag} legit wrong`))()).body, ravi)();
      check('R2 a Remove naming a different person than the rhythm\'s is refused (409)', wrong.status === 409);
    }
    {
      // Unrelated rhythms and other accounts are unaffected.
      const legacyGoal = (await call(goalsRoute.POST(req(token, { title: `${tag} legacy R1` })))).body;
      const legacyId = legacyGoal.id ?? legacyGoal.goal?.id;
      const legacy = (await call(goalActivitiesRoute.POST(req(token, { title: 'Read R1', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } }), { params: { goalId: legacyId } }))).body;
      const pz = await settings(legacyId, legacy.id, { paused: true })();
      const rz = await settings(legacyId, legacy.id, { paused: false })();
      check('An unrelated rhythm (no person) pauses and resumes exactly as before', pz.status === 200 && rz.status === 200 && (await ga(legacy.id)).rhythmPausedAt === null);
      const dz = await call(dismissRoute.POST(req(token), { params: { goalId: legacyId, goalActivityId: legacy.id } }));
      check('An unrelated rhythm (no person) is removed exactly as before', dz.status === 200 && (await ga(legacy.id)).status === 'DISMISSED');
      const op = await mkPerson('Other R1', otherToken);
      const orh = (await call(rhythmsRoute.POST(req(otherToken, newGoalBody('Other', 'Call Other R1')), { params: { personId: op } }))).body;
      const mine = await mkPerson('Mine R1');
      await createRhythm(mine, newGoalBody('Mine', 'Call Mine R1'))();
      await deletePerson(mine)();
      const orow = await ga(orh.id);
      check('Another account\'s linked rhythm is untouched by this owner\'s person deletion', orow.savedPersonId === op && orow.rhythmPausedAt === null);
    }

    // ================= atomicity and isolation =================
    {
      const p = await mkPerson('Atomic');
      const g0 = await goalCount(); const a0 = await gaCount();
      const failed = await createRhythm(p, newGoalBody('Atomic', 'mp4-fail rhythm'))();
      check('A failing rhythm insert rolls back the NEW goal too (one transaction): nothing left behind', failed.status === 500 && (await goalCount()) === g0 && (await gaCount()) === a0, failed);
      const observed = await createRhythm(p, newGoalBody('Atomic', 'mp4-observe rhythm'))();
      const iso = (await q(`SELECT isolation FROM mp4_isolation WHERE id = 'mp4-observe rhythm'`)).rows[0]?.isolation;
      check('Rhythm creation runs at an explicit READ COMMITTED (MP-3-R2 contract)', observed.status === 201 && iso === 'read committed', iso);
    }
  } finally {
    await removeBarriers();
  }

  // ================= invariants and account deletion =================
  {
    const dangling = Number((await q(`SELECT count(*) FROM "GoalActivity" ga WHERE ga."savedPersonId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "SavedPerson" sp WHERE sp.id = ga."savedPersonId" AND sp."ownerUserId" = ga."userId")`)).rows[0].count);
    const activeOrphanPlans = Number((await q(`SELECT count(*) FROM "PlannedActivity" pa WHERE pa."savedPersonId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "SavedPerson" sp WHERE sp.id = pa."savedPersonId")`)).rows[0].count);
    check('Invariant: no rhythm or plan links to a missing or foreign person', dangling === 0 && activeOrphanPlans === 0, { dangling, activeOrphanPlans });
    const temp = await db.upsertUserByEmail({ email: `${tag}-gone@mp4.aura.local`, cityName: 'Test', latitude: 0, longitude: 0, timezone: tz });
    const tempToken = await createTestSessionToken(temp.id, temp.email);
    const tp = await mkPerson('Temp', tempToken);
    const tr = await createRhythm(tp, newGoalBody('Temp', 'Call Temp'), tempToken)();
    let accountDelete = 'ok';
    try { await q(`DELETE FROM "User" WHERE id = $1`, [temp.id]); } catch (err: any) { accountDelete = err.code; }
    check('Account deletion cascade still works with a linked rhythm (User -> SavedPerson and User -> GoalActivity in one statement)', tr.status === 201 && accountDelete === 'ok' && !(await exists('GoalActivity', tr.body.id)), accountDelete);
  }

  console.log(allPassed ? `\nALL MY PEOPLE MP-4 RHYTHMS DB CHECKS PASSED (${count})` : `\nMY PEOPLE MP-4 RHYTHMS DB CHECK(S) FAILED`);
}

main()
  .catch((err) => { console.error(err); allPassed = false; })
  .finally(async () => { await pool.end(); process.exit(allPassed ? 0 : 1); });
