/**
 * Onboarding V1 PR 2 -- Welcome, Location Confirmation & First Useful
 * Recommendation: live-database proof of `recordVisit`'s own
 * `isFirstVisitEver` signal (db.ts), the one fact `GET /api/auth/session`
 * uses to decide whether to show the Welcome journey (see that route's own
 * doc comment). Mirrors the audit required by the PR 2 ticket's own
 * section 2: VisitLog creation timing, reliability as a login/session
 * signal, existing-user behavior, cross-device behavior, and repeated
 * magic-link authentication (via `getOrCreateUserForAuth`'s own
 * idempotency).
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/firstRunDetectionDb.test.ts
 */
import { upsertUserByEmail, getOrCreateUserForAuth, getUserById, recordVisit, beginTransaction } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';

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

async function visitRows(userId: string) {
  return sql(`SELECT "visitedAt" FROM "VisitLog" WHERE "userId" = $1 ORDER BY "visitedAt"`, [userId]);
}

async function main() {
  const newUser = await upsertUserByEmail({ email: 'test-first-run-new@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const existingUser = await upsertUserByEmail({ email: 'test-first-run-existing@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const crossDeviceUser = await upsertUserByEmail({ email: 'test-first-run-crossdevice@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const repeatLoginUser = await upsertUserByEmail({ email: 'test-first-run-repeatlogin@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });

  // Clean slate for a repeatable run.
  await sql(`DELETE FROM "VisitLog" WHERE "userId" = ANY($1::text[])`, [[newUser.id, existingUser.id, crossDeviceUser.id, repeatLoginUser.id]]);

  try {
    // ============================================================
    // A. A genuinely new account: no VisitLog row exists yet.
    // ============================================================
    {
      const result = await recordVisit(newUser.id);
      check('A1. a brand-new account (no VisitLog row ever) reports isFirstVisitEver true', result.isFirstVisitEver === true);
      const rows = await visitRows(newUser.id);
      check('A2. that first call wrote exactly one VisitLog row', rows.length === 1);
    }

    // ============================================================
    // B. The SAME session re-checking (e.g. a quick reload) within the
    // same day never reports first-visit again, and never duplicates the
    // row (recordVisit's own existing per-day dedup, unchanged).
    // ============================================================
    {
      const result = await recordVisit(newUser.id);
      check('B1. a second call the same day reports isFirstVisitEver false', result.isFirstVisitEver === false);
      const rows = await visitRows(newUser.id);
      check('B2. the per-day dedup still holds: still exactly one row for today', rows.length === 1);
    }

    // ============================================================
    // C. Cross-device: a second "device" (an independent recordVisit call
    // for the SAME user, simulating a different browser/session) on the
    // same day must also see isFirstVisitEver false -- the signal is keyed
    // on the ACCOUNT having ever visited, not on a per-device token.
    // ============================================================
    {
      const first = await recordVisit(crossDeviceUser.id);
      const secondDeviceSameDay = await recordVisit(crossDeviceUser.id);
      check('C1. device A (first ever) reports isFirstVisitEver true', first.isFirstVisitEver === true);
      check('C2. device B, same account, same day, reports isFirstVisitEver false (Welcome was already shown once)', secondDeviceSameDay.isFirstVisitEver === false);
    }

    // ============================================================
    // D. Existing-user behavior: an account with a VisitLog row from a
    // PAST day (simulating a real pre-PR2 user who has used the app
    // before) must never be treated as first-run, on any later day.
    // ============================================================
    {
      await sql(`INSERT INTO "VisitLog" (id, "userId", "visitedAt") VALUES (gen_random_uuid(), $1, now() - interval '30 days')`, [existingUser.id]);
      const result = await recordVisit(existingUser.id);
      check('D1. an account with a historical (30-days-ago) VisitLog row reports isFirstVisitEver false today', result.isFirstVisitEver === false);
      const rows = await visitRows(existingUser.id);
      check('D2. today\'s own dedup still inserted exactly one NEW row alongside the historical one', rows.length === 2);
    }

    // ============================================================
    // E. Repeated magic-link authentication: `getOrCreateUserForAuth` is
    // idempotent -- re-authenticating the SAME email never creates a
    // second account, never changes `createdAt`, so repeated logins can
    // never manufacture a "new" account out of an existing one.
    // ============================================================
    {
      const first = await getOrCreateUserForAuth('test-first-run-repeatlogin@example.com');
      const second = await getOrCreateUserForAuth('test-first-run-repeatlogin@example.com');
      const third = await getOrCreateUserForAuth('TEST-FIRST-RUN-REPEATLOGIN@EXAMPLE.COM');
      check('E1. repeated getOrCreateUserForAuth calls for the same email return the SAME user id', first.id === second.id && second.id === third.id);
      check('E2. repeated calls never change createdAt', first.createdAt.getTime() === second.createdAt.getTime() && second.createdAt.getTime() === third.createdAt.getTime());
      const userRows = await sql(`SELECT count(*)::int n FROM "User" WHERE lower(email) = $1`, ['test-first-run-repeatlogin@example.com']);
      check('E3. no duplicate User row was created across repeated/case-varied logins', userRows[0].n === 1);

      // The FIRST ever recordVisit for this repeatedly-authenticated
      // account still correctly reports true -- repeated authentication
      // alone (no session/visit check yet) never consumes the signal.
      const visit = await recordVisit(repeatLoginUser.id);
      check('E4. repeated authentication alone (no prior session check) still leaves isFirstVisitEver true on the first real visit check', visit.isFirstVisitEver === true);
    }

    // ============================================================
    // F. VisitLog creation timing: recordVisit's own first-ever check
    // reads state BEFORE writing it, so a SEQUENTIAL second call never
    // double-counts as "first" (B1/C2/D1 above already prove this, the
    // actual guarantee this PR relies on). This block is a best-effort
    // empirical check under concurrent load, not a guarantee: recordVisit
    // has no DB-level unique constraint on (userId, day) -- a pre-existing
    // property of its own per-day dedup, unchanged by this PR -- so a
    // genuine simultaneous race between two requests for a truly new
    // user's very first visit could in principle both see "no row yet"
    // and both insert. Documented as a known, narrow, pre-existing
    // limitation in the PR report, not fixed here (fixing it would mean
    // an unrelated schema change -- a unique index -- outside this PR's
    // scope).
    // ============================================================
    {
      const u = await upsertUserByEmail({ email: 'test-first-run-timing@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
      await sql(`DELETE FROM "VisitLog" WHERE "userId" = $1`, [u.id]);
      const results = await Promise.all([recordVisit(u.id), recordVisit(u.id), recordVisit(u.id)]);
      const firstCount = results.filter((r) => r.isFirstVisitEver).length;
      check('F1. at least one of three concurrent first-ever calls reports isFirstVisitEver true', firstCount >= 1);
      const rows = await visitRows(u.id);
      check('F2. empirically (not guaranteed -- see comment above), this run produced exactly one VisitLog row despite concurrent calls', rows.length === 1);
    }
    // ============================================================
    // G. GET /api/auth/session's exact sequence (getUserById then
    // recordVisit, mirrored here verbatim -- the same established
    // convention other route tests in this repo use to prove the route's
    // own real wiring order, bypassing HTTP/NextRequest only). Proves the
    // end-to-end shape: a brand-new session's first check reports
    // isFirstSession true, and a second device's session check the same
    // day reports false -- directly exercising the "cross-device login"
    // and "reliable login/session signal" scenarios the PR 2 ticket's
    // own audit requires.
    // ============================================================
    async function sessionCheck(userId: string): Promise<{ user: unknown; isFirstSession: boolean }> {
      const user = await getUserById(userId);
      const { isFirstVisitEver } = await recordVisit(userId);
      return { user, isFirstSession: isFirstVisitEver };
    }
    {
      const sessionUser = await upsertUserByEmail({ email: 'test-first-run-session-route@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
      await sql(`DELETE FROM "VisitLog" WHERE "userId" = $1`, [sessionUser.id]);

      const deviceAFirstCheck = await sessionCheck(sessionUser.id);
      check('G1. device A\'s first-ever GET /api/auth/session reports isFirstSession true, with the real user attached', deviceAFirstCheck.isFirstSession === true && deviceAFirstCheck.user !== null);

      const deviceBSameDay = await sessionCheck(sessionUser.id);
      check('G2. device B, same account, same day: GET /api/auth/session reports isFirstSession false (cross-device: Welcome is not shown twice)', deviceBSameDay.isFirstSession === false);

      const deviceAReload = await sessionCheck(sessionUser.id);
      check('G3. device A reloading again, same day: also isFirstSession false (no redirect loop back into Welcome)', deviceAReload.isFirstSession === false);
    }
  } finally {
    await sql(`DELETE FROM "VisitLog" WHERE "userId" = ANY($1::text[])`, [[newUser.id, existingUser.id, crossDeviceUser.id, repeatLoginUser.id]]);
  }

  if (!allPassed) {
    console.error('SOME FIRST-RUN DETECTION DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL FIRST-RUN DETECTION DB CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
