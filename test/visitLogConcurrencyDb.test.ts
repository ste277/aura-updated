/**
 * Onboarding V1 PR 2 -- First-Run Reliability Correction: live-database
 * proof that `recordVisit` (db.ts) -- VisitLog's own pure analytics
 * writer, deliberately independent of onboarding -- is concurrency-safe.
 *
 * An earlier version of `recordVisit` also returned an `isFirstVisitEver`
 * signal consumed by onboarding; an empirical probe during this review
 * showed two simultaneous calls for a genuinely new user would, in 14 of
 * 15 trials, BOTH see "no row yet" and both insert, duplicating that
 * day's VisitLog row (a plain check-then-insert race, no DB-level
 * uniqueness). That coupling has been removed entirely (see
 * onboardingResolutionDb.test.ts for the durable, lock-free replacement),
 * and `recordVisit` itself is now wrapped in a per-user
 * `pg_advisory_xact_lock` -- the same established pattern already used by
 * dayConstructorAcceptancePersistence.ts/planMove.ts -- which this file
 * proves closes the race for VisitLog's own per-day dedup too.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/visitLogConcurrencyDb.test.ts
 */
import { upsertUserByEmail, recordVisit, beginTransaction } from '../apps/web/lib/db';

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

async function visitRowCount(userId: string): Promise<number> {
  const rows = await sql(`SELECT count(*)::int n FROM "VisitLog" WHERE "userId" = $1`, [userId]);
  return rows[0].n;
}

async function main() {
  // ============================================================
  // Baseline: a single call still writes exactly one row, and a second
  // call the same day is still correctly deduped (existing, pre-PR2
  // behavior, unchanged by the lock).
  // ============================================================
  {
    const u = await upsertUserByEmail({ email: 'test-visitlog-baseline@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    await sql(`DELETE FROM "VisitLog" WHERE "userId" = $1`, [u.id]);
    await recordVisit(u.id);
    check('1. a single call writes exactly one VisitLog row', (await visitRowCount(u.id)) === 1);
    await recordVisit(u.id);
    check('2. a second, sequential call the same day does not duplicate the row (existing per-day dedup, unchanged)', (await visitRowCount(u.id)) === 1);
  }

  // ============================================================
  // Concurrency: the actual regression this fix targets. Two simultaneous
  // tabs loading for the first time ever, three simultaneous calls.
  // ============================================================
  {
    let anomalies = 0;
    const TRIALS = 20;
    for (let trial = 1; trial <= TRIALS; trial++) {
      const u = await upsertUserByEmail({ email: `test-visitlog-concurrency-${trial}@example.com`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
      await sql(`DELETE FROM "VisitLog" WHERE "userId" = $1`, [u.id]);
      await Promise.all([recordVisit(u.id), recordVisit(u.id), recordVisit(u.id)]);
      const n = await visitRowCount(u.id);
      if (n !== 1) anomalies++;
      await sql(`DELETE FROM "VisitLog" WHERE "userId" = $1`, [u.id]);
    }
    check(`3. ${TRIALS}/${TRIALS} trials of three truly concurrent recordVisit calls for a brand-new user each wrote EXACTLY one VisitLog row (0 duplicate-row anomalies; the pre-fix probe measured ~93% failure on this exact scenario)`, anomalies === 0);
  }

  // ============================================================
  // The lock is scoped per-user: concurrent calls for TWO DIFFERENT users
  // must never block each other or interfere with each other's rows.
  // ============================================================
  {
    const u1 = await upsertUserByEmail({ email: 'test-visitlog-concurrency-userA@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    const u2 = await upsertUserByEmail({ email: 'test-visitlog-concurrency-userB@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    await sql(`DELETE FROM "VisitLog" WHERE "userId" = ANY($1::text[])`, [[u1.id, u2.id]]);
    const start = Date.now();
    await Promise.all([recordVisit(u1.id), recordVisit(u2.id)]);
    const elapsedMs = Date.now() - start;
    check('4. concurrent calls for two DIFFERENT users each write their own single row', (await visitRowCount(u1.id)) === 1 && (await visitRowCount(u2.id)) === 1);
    check('4b. the per-user lock does not serialize unrelated users onto a single global lock (completes quickly, not after some unrelated contention delay)', elapsedMs < 5000);
  }

  // ============================================================
  // VisitLog remains pure analytics: recordVisit's own return type
  // carries no onboarding signal at all (structural confirmation that the
  // decoupling is real, not just a convention).
  // ============================================================
  {
    const u = await upsertUserByEmail({ email: 'test-visitlog-no-signal@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    const result = await recordVisit(u.id);
    check('5. recordVisit returns nothing (void) -- no isFirstVisitEver/onboarding-shaped value for a caller to accidentally couple to', result === undefined);
  }

  if (!allPassed) {
    console.error('SOME VISITLOG CONCURRENCY DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL VISITLOG CONCURRENCY DB CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
