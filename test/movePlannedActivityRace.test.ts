/**
 * Daily Experience V1 PR D2 -- real DB concurrency proof for Move: exactly one
 * terminal outcome wins against Move, Done, Skip and Cancel, and a plan can
 * never fork into two successors. Both orderings are exercised (the loser is
 * staggered in on alternate iterations). Requires DATABASE_URL:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/movePlannedActivityRace.test.ts
 */
import { upsertUserByEmail, updateBirthProfile, createPlannedActivity, beginTransaction, logPlannedActivity, cancelPlannedActivity, skipPlannedActivity } from '../apps/web/lib/db';
import { movePlannedActivity, MovePlanError } from '../apps/web/lib/planMove';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const MIN = 60000; const HOUR = 3600000; const DAY = 86400000;
const minute = (ms: number) => Math.floor(ms / MIN) * MIN;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
const outcome = async (fn: () => Promise<unknown>): Promise<string> => { try { await fn(); return 'OK'; } catch (e) { return e instanceof MovePlanError ? e.code : 'ERR'; } };
const ROUNDS = 16;

async function main() {
  const U = await upsertUserByEmail({ email: 'test-move-race@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(U.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  let n = 0;
  const mk = async (tag: string) => createPlannedActivity({ userId: U.id, title: `${tag} ${Date.now()}-${n++}`, plannedStartAt: new Date(minute(Date.now()) + 10 * DAY + n * 3 * HOUR), plannedEndAt: new Date(minute(Date.now()) + 10 * DAY + n * 3 * HOUR + HOUR), durationMinutes: 60, windowType: 'NEUTRAL' });
  const dest = () => new Date(minute(Date.now()) + 60 * DAY + n++ * 3 * HOUR);
  const habits = async () => Number((await sql(`SELECT count(*)::int AS n FROM "HabitLog" WHERE "userId" = $1`, [U.id]))[0].n);
  const state = async (id: string) => ({ a: (await sql(`SELECT status, "loggedAt", "skippedAt", "habitLogId" FROM "PlannedActivity" WHERE id = $1`, [id]))[0], succ: await sql(`SELECT * FROM "PlannedActivity" WHERE "rescheduledFromPlanId" = $1`, [id]) });

  try {
    // ---- Move / Move, identical destination ----
    let mmSame = true; let mmDiff = true;
    for (let i = 0; i < ROUNDS; i++) {
      const a = await mk('MM-same'); const d = dest();
      const [x, y] = await Promise.all([movePlannedActivity(U.id, a.id, { newStartAt: d }).then((r) => ({ ok: true, to: r.to.id }), () => ({ ok: false, to: '' })), movePlannedActivity(U.id, a.id, { newStartAt: d }).then((r) => ({ ok: true, to: r.to.id }), () => ({ ok: false, to: '' }))]);
      const s = await state(a.id);
      if (!(x.ok && y.ok && x.to === y.to && s.succ.length === 1 && s.a.status === 'MOVED')) mmSame = false;

      const b = await mk('MM-diff'); const d1 = dest(); const d2 = dest();
      const [p, q] = await Promise.all([outcome(() => movePlannedActivity(U.id, b.id, { newStartAt: d1 })), outcome(() => movePlannedActivity(U.id, b.id, { newStartAt: d2 }))]);
      const s2 = await state(b.id);
      if (!(s2.succ.length === 1 && s2.a.status === 'MOVED' && [p, q].filter((o) => o === 'OK').length === 1 && [p, q].includes('ALREADY_MOVED'))) mmDiff = false;
    }
    check(`22. Move/Move, identical destination (x${ROUNDS}): both callers get the SAME successor and exactly one exists`, mmSame);
    check(`22. Move/Move, different destinations (x${ROUNDS}): exactly one wins, the loser gets ALREADY_MOVED, never A -> B and A -> C`, mmDiff);

    // ---- Move / Done, Move / Skip, Move / Cancel ----
    const kinds: Array<['Done' | 'Skip' | 'Cancel', (id: string) => Promise<unknown>]> = [
      ['Done', (id) => logPlannedActivity(U.id, id)],
      ['Skip', (id) => skipPlannedActivity(U.id, id)],
      ['Cancel', (id) => cancelPlannedActivity(U.id, id)],
    ];
    for (const [kind, rival] of kinds) {
      let ok = true; let moveWins = 0; let rivalWins = 0;
      for (let i = 0; i < ROUNDS; i++) {
        const a = await mk(`M-${kind}`); const d = dest();
        const h0 = await habits();
        const moveFirst = i % 2 === 0;
        const [m, r] = await Promise.all([
          moveFirst ? outcome(() => movePlannedActivity(U.id, a.id, { newStartAt: d })) : wait(6 + i).then(() => outcome(() => movePlannedActivity(U.id, a.id, { newStartAt: d }))),
          moveFirst ? wait(6).then(() => outcome(() => rival(a.id))) : outcome(() => rival(a.id)),
        ]);
        const s = await state(a.id); const h1 = await habits();
        if (s.a.status === 'MOVED') {
          moveWins++;
          if (!(m === 'OK' && r !== 'OK' && s.succ.length === 1 && s.a.loggedAt === null && s.a.skippedAt === null && s.a.habitLogId === null && h1 === h0)) ok = false;
        } else {
          rivalWins++;
          const expected = kind === 'Done' ? 'LOGGED' : kind === 'Skip' ? 'SKIPPED' : 'CANCELLED';
          if (!(s.a.status === expected && m === 'INVALID_STATE' && r === 'OK' && s.succ.length === 0)) ok = false;
          if (kind === 'Done' && !(s.a.loggedAt !== null && s.a.skippedAt === null && h1 === h0 + 1)) ok = false;
          if (kind === 'Skip' && !(s.a.skippedAt !== null && s.a.loggedAt === null && h1 === h0)) ok = false;
          if (kind === 'Cancel' && !(s.a.loggedAt === null && s.a.skippedAt === null && h1 === h0)) ok = false;
        }
      }
      const n0 = kind === 'Done' ? 23 : kind === 'Skip' ? 24 : 25;
      check(`${n0}. Move/${kind} (x${ROUNDS}): exactly one terminal outcome, never a hybrid (Move won ${moveWins}, ${kind} won ${rivalWins}); ${kind === 'Done' ? 'Done winner => one HabitLog and no B; Move winner => zero HabitLogs' : `${kind} winner => no successor`}`, ok && moveWins > 0 && rivalWins > 0);
    }

    // ---- global invariants ----
    const bad = await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1 AND (
        (status = 'MOVED' AND (NOT EXISTS (SELECT 1 FROM "PlannedActivity" s WHERE s."rescheduledFromPlanId" = "PlannedActivity".id) OR "loggedAt" IS NOT NULL OR "skippedAt" IS NOT NULL OR "habitLogId" IS NOT NULL))
        OR (status IN ('LOGGED','SKIPPED','CANCELLED') AND EXISTS (SELECT 1 FROM "PlannedActivity" s WHERE s."rescheduledFromPlanId" = "PlannedActivity".id)))`, [U.id]);
    const forks = await sql(`SELECT count(*)::int AS n FROM (SELECT "rescheduledFromPlanId" FROM "PlannedActivity" WHERE "userId" = $1 AND "rescheduledFromPlanId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1) t`, [U.id]);
    check('22-25. after every race: MOVED <=> exactly one successor and no execution fields; no LOGGED/SKIPPED/CANCELLED plan has a successor; no plan has two successors', Number(bad[0].n) === 0 && Number(forks[0].n) === 0);
    const dup = await outcome(async () => sql(`INSERT INTO "PlannedActivity" (id, "userId", title, "plannedStartAt", "plannedEndAt", "durationMinutes", "windowType", "rescheduledFromPlanId") SELECT $1, "userId", 'fork', "plannedStartAt", "plannedEndAt", 60, 'NEUTRAL', "rescheduledFromPlanId" FROM "PlannedActivity" WHERE "userId" = $2 AND "rescheduledFromPlanId" IS NOT NULL LIMIT 1`, [`fork-${Date.now()}`, U.id]));
    check('22. the database itself rejects a second successor (UNIQUE rescheduledFromPlanId is the backstop, independent of application locking)', dup === 'ERR');
  } finally {
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = $1`, [U.id]).catch(() => {});
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [U.id]).catch(() => {});
    await sql(`DELETE FROM "HabitLog" WHERE "userId" = $1`, [U.id]).catch(() => {});
  }
  if (!allPassed) { console.error('SOME MOVE RACE CHECKS FAILED'); process.exit(1); }
  console.log('ALL MOVE RACE CHECKS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
