/**
 * AURA-AUTH-SESSION-01-I1 R1 (39233) -- reproduction of the independent
 * findings 39232-01, 39232-02 and the expiry clarification, run unchanged
 * against BOTH the reviewed head (864da6f, "before") and the R1 head ("after").
 * It only OBSERVES and prints JSON; it asserts nothing, so the same script
 * documents the defect and its correction.
 *
  *   DATABASE_URL=postgresql://...@127.0.0.1:PORT/DB TS_NODE_TRANSPILE_ONLY=1 npx ts-node AURA_AUTH_SESSION_01_I1_R1_EVIDENCE/repro/reproFindings.ts
 *
 * Disposable loopback database only; synthetic users only.
 */
import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';
import { Pool } from 'pg';
import * as dbLib from '../../apps/web/lib/authSessionDb';
import * as store from '../../apps/web/lib/authSessionStore';

const url = process.env.DATABASE_URL || '';
if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  console.error('DATABASE_URL must be a disposable loopback database.');
  process.exit(1);
}
const admin = new Pool({ connectionString: url, max: 3, application_name: 'r1-repro-admin' });
const out: Record<string, unknown> = {};

/** A pool that never answers a query: every attempt can only end by its deadline. */
function stallingPool(counter: { connects: number }) {
  const client = {
    query: () => new Promise(() => {}),
    on() {},
    off() {},
    release() {},
  };
  return { connect: async () => (counter.connects++, client) } as unknown as Pool;
}

/** Wraps a real pool to count checkouts (one checkout per attempt). */
function countingPool(real: Pool, counter: { connects: number }) {
  return new Proxy(real, {
    get(t, p, r) {
      if (p === 'connect') return () => (counter.connects++, t.connect());
      const v = Reflect.get(t, p, r);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  }) as Pool;
}

async function timed<T>(p: Promise<T>) {
  const t = performance.now();
  try {
    const v = await p;
    return { ok: true, value: v, ms: Math.round(performance.now() - t) };
  } catch (e) {
    const err = e as { reason?: string; outcome?: string; name?: string };
    return { ok: false, reason: err.reason ?? err.name, outcome: err.outcome ?? '(none)', ms: Math.round(performance.now() - t) };
  }
}

async function main() {
  const uid = randomUUID();
  await admin.query(`INSERT INTO "User" (id, email, "cityName", latitude, longitude) VALUES ($1, $2, 'Chennai', 13.08, 80.27)`, [uid, `r1-repro-${uid}@example.test`]);
  const pool = dbLib.createSessionPool(url);
  try {
    // 39232-01 (a): an outcome that can only end by deadline (stalled server).
    const c1 = { connects: 0 };
    const idHash = 'A'.repeat(43);
    const r1 = await timed(store.revokeAuthSession(stallingPool(c1), idHash, 'logout'));
    out['01a_stalled_revoke'] = { ...r1, attempts: c1.connects, callerBudgetMs: 2000 };

    // 39232-01 (b): a CONFIRMED lock_timeout must not be retried.
    const s = await store.createAuthSession(pool, uid);
    const c2 = { connects: 0 };
    const locker = await admin.connect();
    await locker.query('BEGIN');
    await locker.query('LOCK TABLE "AuthSession" IN ACCESS EXCLUSIVE MODE');
    const r2 = await timed(store.revokeAuthSession(countingPool(pool, c2), s.idHash, 'logout'));
    await locker.query('ROLLBACK');
    locker.release();
    const still = (await admin.query(`SELECT "revokedAt" FROM "AuthSession" WHERE "idHash" = $1`, [s.idHash])).rows[0];
    out['01b_locked_revoke'] = { ...r2, attempts: c2.connects, dbRevoked: still?.revokedAt != null };

    // 39232-02: a caller-transaction INSERT that is then rolled back.
    const tx = await admin.connect();
    await tx.query('BEGIN');
    const prov = await store.createAuthSessionInTransaction(tx as never, uid);
    await tx.query('ROLLBACK');
    tx.release();
    const committed = await store.createAuthSession(pool, uid);
    const rowAfterRollback = (await admin.query(`SELECT 1 FROM "AuthSession" WHERE "idHash" = $1`, [(prov as { idHash: string }).idHash])).rows.length;
    out['02_provisional_after_rollback'] = {
      provisionalKeys: Object.keys(prov).sort(),
      committedKeys: Object.keys(committed).sort(),
      sameShapeAsCommitted: JSON.stringify(Object.keys(prov).sort()) === JSON.stringify(Object.keys(committed).sort()),
      exposesSid: 'sid' in (prov as object),
      exposesState: (prov as { state?: string }).state ?? '(no state field)',
      rowExistsAfterRollback: rowAfterRollback === 1,
    };

    // Expiry: elapsed hours of the stored lifetime, and of the TTL expression
    // across a DST transition in several session time zones.
    const fresh = await store.createAuthSession(pool, uid);
    const life = (await admin.query(`SELECT EXTRACT(EPOCH FROM ("expiresAt" - "createdAt")) / 3600 AS h FROM "AuthSession" WHERE "idHash" = $1`, [fresh.idHash])).rows[0].h;
    const ttlSql = (dbLib as unknown as { SESSION_TTL_SQL?: string }).SESSION_TTL_SQL ?? 'make_interval(days => 30)';
    const zones: Record<string, string> = {};
    for (const [tz, at] of [
      ['UTC', '2026-03-07 12:00:00'],
      ['America/New_York', '2026-03-07 12:00:00'],
      ['America/New_York', '2026-10-31 12:00:00'],
      ['Europe/London', '2026-03-28 12:00:00'],
      ['Australia/Lord_Howe', '2026-03-28 12:00:00'],
      ['Asia/Kolkata', '2026-03-07 12:00:00'],
    ]) {
      const c = await admin.connect();
      try {
        await c.query(`SET TIME ZONE '${tz}'`);
        const h = (await c.query(`SELECT EXTRACT(EPOCH FROM (($1::timestamptz + ${ttlSql}) - $1::timestamptz)) / 3600 AS h`, [`${at} ${tz}`])).rows[0].h;
        zones[`${tz} @ ${at}`] = `${Number(h)} h`;
      } finally {
        await c.query('RESET TIME ZONE').catch(() => {});
        c.release();
      }
    }
    out['05_expiry'] = { ttlSqlEvaluated: ttlSql, storedLifetimeHours: Number(life), elapsedHoursByZone: zones };
  } finally {
    await pool.end().catch(() => {});
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [uid]).catch(() => {});
    await admin.end();
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error('repro failed', e instanceof Error ? e.message : e);
  process.exit(1);
});
