/**
 * AURA-MCP-02-I2b-S2 -- the three staging-blocker fixes against a REAL
 * Postgres database (migration 0052):
 *   I2b-R-2  hung server, held row locks, terminated connections, pool
 *            isolation, store timeouts through the full OAuth flow;
 *   I2b-1    sharded global ceiling: exact aggregate across instances,
 *            per-address exactness, no deadlocks, window rollover, cleanup
 *            race;
 *   I2b-R-3  /64 rotation and shared-NAT behaviour with the shared limiter.
 *
 * Needs DATABASE_URL pointing at a DISPOSABLE database with the full
 * migration chain applied (CI: "Database migration validation"; locally a
 * throwaway Postgres). Truncates the two MCP tables only; refuses a
 * non-loopback database outside CI. Synthetic users and clients only.
 */
import * as net from 'net';
import { Pool, type PoolConfig } from 'pg';
import { createPostgresAdapterStore } from '../packages/mcp-tools/src/auth/postgresAdapter';
import { createPostgresRateLimiter, type PostgresRateLimiter } from '../packages/mcp-tools/src/security/postgresRateLimit';
import { isStoreUnavailableError, MCP_PG_POOL_BOUNDS } from '../packages/mcp-tools/src/security/deadline';
import { buildPreAuthRules } from '../packages/mcp-tools/src/security/preAuthRules';
import { handleRemoteMcpRequest } from '../packages/mcp-tools/src/http/remoteMcpHandler';
import type { McpAuditEvent } from '../packages/mcp-tools/src/security/audit';
import type { RateLimitDecision } from '../packages/mcp-tools/src/security/rateLimit';
import { Browser, CLIENT, USER_A, authorize, check, connect, redeemCode, sharedKeys, sleep, startCluster, summary } from './mcpOAuthI2bHarness';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required (a disposable database with migrations applied)');
  process.exit(1);
}
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname) && process.env.CI !== 'true') {
  console.error('refusing to run against a non-loopback database outside CI');
  process.exit(1);
}
process.on('beforeExit', () => {
  console.error('FAIL test ended before its summary');
  process.exit(1);
});

const pools: Pool[] = [];
function pool(extra: PoolConfig = {}): Pool {
  const p = new Pool({ connectionString: url, ...MCP_PG_POOL_BOUNDS, ...extra });
  p.on('error', () => undefined); // terminated idle clients must not crash the test
  pools.push(p);
  return p;
}
const timed = async <T>(work: Promise<T>): Promise<{ value: T; ms: number }> => {
  const t0 = Date.now();
  const value = await work;
  return { value, ms: Date.now() - t0 };
};
const endWithin = (p: Pool, ms: number) => Promise.race([p.end().then(() => true), sleep(ms).then(() => false)]);
const MCP = { resourceUrl: 'http://127.0.0.1:3999/api/mcp', authorizationServer: 'http://127.0.0.1:3999' };
const mcpReq = (token = 'synthetic-invalid-token') =>
  new Request(MCP.resourceUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });

async function main() {
  const admin = pool({ max: 3 });
  const q = async (sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows;
  const counts = async (like: string) => Number((await q(`SELECT coalesce(sum("count"),0)::int AS s FROM "McpRateLimitWindow" WHERE "key" LIKE $1`, [like]))[0].s);
  try {
    await admin.query('TRUNCATE "McpOAuthPayload", "McpRateLimitWindow"');
    const keys = sharedKeys();

    // ---------------------------------------------------------- R-2: hung server (accepts TCP, never answers)
    {
      const sockets = new Set<net.Socket>();
      const blackhole = net.createServer((s) => {
        sockets.add(s);
        s.on('error', () => undefined);
      });
      await new Promise<void>((r) => blackhole.listen(0, '127.0.0.1', r));
      const port = (blackhole.address() as net.AddressInfo).port;
      const hung = new Pool({ connectionString: `postgresql://synthetic@127.0.0.1:${port}/none`, ...MCP_PG_POOL_BOUNDS });
      hung.on('error', () => undefined);
      const limiter = createPostgresRateLimiter({ pool: hung, windowMs: 60_000 });
      const decisions = await Promise.all(Array.from({ length: 20 }, () => timed(limiter.check(buildPreAuthRules('preauth-mcp', '203.0.113.9', { perAddress: 120, global: 6000 })))));
      const worst = Math.max(...decisions.map((d) => d.ms));
      check('R-2 hung DB: 20 limiter decisions all deny "unavailable" within 2 s', decisions.every((d) => !d.value.allowed && d.value.limitedBy === 'unavailable') && worst <= 2000, worst);
      const store = createPostgresAdapterStore({ db: hung, fieldKeys: keys.cookieKeys });
      const found = await timed(new store.factory('AccessToken').find('synthetic-token').then(() => 'answered', (e) => e));
      check('R-2 hung DB: store read fails with StoreUnavailableError within 3.5 s (never "not found")', isStoreUnavailableError(found.value) && found.ms <= 3500, found.ms);
      await sleep(2200); // let pending checkouts hit connectionTimeoutMillis
      check('R-2 hung DB: pool.end() completes', await endWithin(hung, 5000));
      for (const s of sockets) s.destroy();
      blackhole.close();
    }

    // ---------------------------------------------------------- R-2: held locks, pool isolation, terminated connections
    {
      const limiterPool = pool({ application_name: 'aura-s2-limiter' });
      const storePool = pool({ application_name: 'aura-s2-store' });
      const limiter = createPostgresRateLimiter({ pool: limiterPool, windowMs: 60_000 });
      const store = createPostgresAdapterStore({ db: storePool, fieldKeys: keys.cookieKeys });
      const Session = new store.factory('Session');
      await Session.upsert('synthetic-session-1', { accountId: USER_A, uid: 'synthetic-uid-1' } as never, 600);
      const rules = [{ key: 'preauth-mcp:global:3', limit: 1000 }, { key: 'preauth-mcp:addr:v4:203.0.113.50', limit: 1000 }];
      await limiter.check(rules); // rows exist (count 1)

      const holder = await admin.connect();
      await holder.query('BEGIN');
      await holder.query(`SELECT 1 FROM "McpRateLimitWindow" WHERE "key" = ANY($1::text[]) FOR UPDATE`, [rules.map((r) => r.key)]);
      const t0 = Date.now();
      const pending = Promise.all(Array.from({ length: 50 }, () => timed(limiter.check(rules))));
      await sleep(150);
      const storeRead = await timed(Session.findByUid('synthetic-uid-1'));
      const held = await pending;
      // Abandoned backends are bounded server-side by lock_timeout (1000 ms).
      await sleep(1100);
      const lockWaiters = Number((await q(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'aura-s2-limiter' AND wait_event_type = 'Lock'`))[0].n);
      await holder.query('ROLLBACK');
      holder.release();
      const worst = Math.max(...held.map((d) => d.ms));
      const fastest = Math.min(...held.map((d) => d.ms));
      check('R-2 lock held: 50 decisions all deny within 1.5 s, 0 admitted while the lock is held', held.every((d) => !d.value.allowed && d.value.limitedBy === 'unavailable') && worst <= 1500, { worst, admitted: held.filter((d) => d.value.allowed).length });
      check('R-2 lock held: every deny is bounded by the client deadline (fastest and slowest within 1.5 s)', fastest <= 1500, fastest);
      check('R-2 lock held: abandoned server-side waits end within lock_timeout (no limiter backend still waiting on the held lock)', lockWaiters === 0, lockWaiters);
      check('R-2 lock held: counters unchanged by the denied decisions', (await counts('preauth-mcp:addr:v4:203.0.113.50')) === 1);
      check('R-2 pool isolation: store reads succeed while the limiter pool is saturated', storeRead.value?.accountId === USER_A && storeRead.ms < 1000, storeRead.ms);
      check('R-2 recovery: after the lock is released the next decision is admitted on a clean connection', (await limiter.check(rules)).allowed && (await counts('preauth-mcp:addr:v4:203.0.113.50')) === 2);
      check('R-2 hygiene: no limiter connection left idle in a transaction', Number((await q(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'aura-s2-limiter' AND state LIKE 'idle in transaction%'`))[0].n) === 0);
      check('timing: held-lock scenario finished promptly', Date.now() - t0 < 3000, Date.now() - t0);

      // Database failure DURING the limiter update: backends terminated while they wait.
      const holder2 = await admin.connect();
      await holder2.query('BEGIN');
      await holder2.query(`SELECT 1 FROM "McpRateLimitWindow" WHERE "key" = ANY($1::text[]) FOR UPDATE`, [rules.map((r) => r.key)]);
      const slow = createPostgresRateLimiter({ pool: limiterPool, windowMs: 60_000, lockTimeoutMs: 5000, statementTimeoutMs: 6000, decisionDeadlineMs: 6000 });
      const inflight = Promise.all(Array.from({ length: 5 }, () => slow.check(rules)));
      await sleep(300);
      const killed = Number((await q(`SELECT count(*)::int AS n FROM (SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'aura-s2-limiter' AND pid <> pg_backend_pid()) t`))[0].n);
      const terminated: RateLimitDecision[] = await inflight;
      await holder2.query('ROLLBACK');
      holder2.release();
      check('R-2 terminated mid-update: every decision denies "unavailable" (fail closed)', killed >= 1 && terminated.every((d) => !d.allowed && d.limitedBy === 'unavailable'), { killed, terminated });
      check('R-2 terminated mid-update: no partial increment', (await counts('preauth-mcp:addr:v4:203.0.113.50')) === 2);
      check('R-2 terminated mid-update: the pool recovers (next decision admitted)', (await limiter.check(rules)).allowed);
    }

    // ---------------------------------------------------------- R-2: store timeout through the full OAuth flow (503, nothing issued)
    {
      const storePool = pool({ application_name: 'aura-s2-store-flow' });
      const audits: McpAuditEvent[] = [];
      const store = createPostgresAdapterStore({ db: storePool, fieldKeys: keys.cookieKeys });
      const c = await startCluster(2, { keys, audit: (e) => audits.push(e), refreshTokens: { enabled: true } }, () => ({ adapterStore: store }));
      try {
        const out = await authorize(c, new Browser(c.origin, USER_A), { consent: true });
        const holder = await admin.connect();
        await holder.query('BEGIN');
        await holder.query('LOCK TABLE "McpOAuthPayload" IN ACCESS EXCLUSIVE MODE');
        const tok = await timed(redeemCode(c, out.code as string, out.verifier));
        const auth = await timed(authorize(c, new Browser(c.origin, USER_A), { consent: true }));
        await holder.query('ROLLBACK');
        holder.release();
        await sleep(1000);
        check('R-2 store hung: token request -> 503 within 3.5 s, no access or refresh token', tok.value.status === 503 && !tok.value.json.access_token && !tok.value.json.refresh_token && tok.ms <= 3500, [tok.value, tok.ms]);
        check('R-2 store hung: authorization -> no code', !auth.value.code, auth.value);
        check('R-2 store hung: no access token row written, even after the lock is released (late completion)', Number((await q(`SELECT count(*)::int AS n FROM "McpOAuthPayload" WHERE "model" = 'AccessToken'`))[0].n) === 0);
        check('audit: store_unavailable recorded', audits.some((e) => e.outcome === 'store_unavailable'));
        const again = await connect(c, USER_A);
        check('R-2 store recovery: a fresh connection completes once the store answers', again.token?.status === 200 && !!again.token.json.access_token);
      } finally {
        await c.close();
      }
    }

    // ---------------------------------------------------------- I2b-1: exactness with sharding, three instances
    {
      await admin.query('TRUNCATE "McpRateLimitWindow"');
      const instances: PostgresRateLimiter[] = [0, 1, 2].map(() => createPostgresRateLimiter({ pool: pool({ max: 6 }), windowMs: 60_000 }));
      const perAddr = await Promise.all(Array.from({ length: 300 }, (_, i) => instances[i % 3].check(buildPreAuthRules('preauth-mcp', '198.51.100.20', { perAddress: 50, global: 6000 }))));
      check('I2b-1 exactness: 300 concurrent decisions on 3 instances, one address limit 50 -> exactly 50', perAddr.filter((d) => d.allowed).length === 50, perAddr.filter((d) => d.allowed).length);
      check('I2b-1 exactness: global shards counted exactly the admitted requests', (await counts('preauth-mcp:global:%')) === 50);

      // I2b-S10 / S11 / S12 (run 45372768632; S10 review P2-3; S11 review
      // R-P2-2). The 2000-decision flood at the SAME concurrency is a
      // regression GATE under the production 1250 ms deadline and the
      // application pool bounds (5 per instance). It passes only if:
      //   - no decision failed unexpectedly: causes checkout / driver /
      //     internal / commit_failed (explicit COMMIT refusal) / commit_lost
      //     (connection failed after COMMIT was sent) all FAIL the gate;
      //     expected shedding is deadline / commit_timeout / commit_late;
      //   - admitted <= counted <= G, and any over-count is explained by the
      //     genuinely ambiguous / late COMMITs (commit_timeout + commit_late +
      //     commit_lost);
      //   - availability: admitted >= min(G, 1/2 x capacity), where capacity is
      //     anchored to an INDEPENDENT runner control -- plain PostgreSQL
      //     transactions on a session-local TEMP table, with the same three
      //     round trips as a warm limiter decision (BEGIN+SET LOCAL, UPDATE,
      //     COMMIT) but none of the limiter's code:
      //        capacity = instances x connections x deadline / (K x controlLatency)
      //     K = 4 is FIXED: a cold limiter decision is ~7 round trips (BEGIN,
      //     DECIDE, ROLLBACK, BEGIN, INSERT, DECIDE, COMMIT) vs the control's 3
      //     (x2.33), times ~1.7 for lock contention on 16 hot shard rows. A
      //     slower LIMITER therefore cannot lower its own floor; a slower
      //     RUNNER lowers it proportionally.
      // Negative controls prove the gate fails on: injected pre-COMMIT driver
      // faults, post-send connection loss, explicit COMMIT refusal, a
      // limiter-only slowdown, and the "0 admitted, 2000 unavailable" outcome.
      const G = 480;
      const CONN = 5; // MCP_PG_POOL_BOUNDS.max (the application's per-instance pool)
      const DEADLINE = 1250;
      const K = 4;
      type FloodResult = { out: RateLimitDecision[]; admitted: number; by: Record<string, number>; ms: number; shardRows: Record<string, unknown>[]; shardSum: number };
      const flood = async (limiters: PostgresRateLimiter[]): Promise<FloodResult> => {
        await admin.query('TRUNCATE "McpRateLimitWindow"');
        const t0 = Date.now();
        const out = await Promise.all(
          Array.from({ length: 2000 }, (_, i) => limiters[i % 3].check(buildPreAuthRules('preauth-mcp', `2001:db8:${(i % 500).toString(16)}::${i}`, { perAddress: 480, global: G, globalShards: 16 }))),
        );
        const by: Record<string, number> = {};
        for (const d of out) {
          const k = d.allowed ? 'admitted' : d.limitedBy === 'unavailable' ? `unavailable:${d.cause ?? 'none'}` : String(d.limitedBy);
          by[k] = (by[k] ?? 0) + 1;
        }
        const shardRows = await q(`SELECT "key", "count" FROM "McpRateLimitWindow" WHERE "key" LIKE 'preauth-mcp:global:%'`);
        return { out, admitted: by.admitted ?? 0, by, ms: Date.now() - t0, shardRows, shardSum: await counts('preauth-mcp:global:%') };
      };
      type Connectable = { connect(): Promise<{ query(t: string, p?: unknown[]): Promise<unknown>; release(e?: unknown): void }> };
      /** Independent runner control: plain transactions on a TEMP table (no limiter code, no MCP table). */
      const runnerControl = async (p: Connectable) => {
        const c = await p.connect();
        try {
          await c.query('CREATE TEMP TABLE IF NOT EXISTS s12_runner_control (k int PRIMARY KEY, n int NOT NULL)');
          await c.query('INSERT INTO s12_runner_control VALUES (1, 0) ON CONFLICT (k) DO NOTHING');
          const n = 40;
          const t0 = Date.now();
          for (let i = 0; i < n; i += 1) {
            await c.query("BEGIN; SET LOCAL statement_timeout = '1000ms'; SET LOCAL lock_timeout = '1000ms'");
            await c.query('UPDATE s12_runner_control SET n = n + 1 WHERE k = 1 RETURNING n');
            await c.query('COMMIT');
          }
          const latencyMs = Math.max(0.05, (Date.now() - t0) / n);
          await c.query('DROP TABLE IF EXISTS s12_runner_control');
          const capacity = Math.floor((3 * CONN * DEADLINE) / (K * latencyMs));
          return { controlLatencyMs: Math.round(latencyMs * 100) / 100, K, capacity, threshold: Math.min(G, Math.floor(capacity / 2)) };
        } finally {
          c.release();
        }
      };
      const EXPECTED = new Set(['deadline', 'commit_timeout', 'commit_late']);
      const AMBIGUOUS = new Set(['commit_timeout', 'commit_late', 'commit_lost']);
      const gate = (r: FloodResult, threshold: number) => {
        const unexpected = r.out.filter((d) => !d.allowed && (d.limitedBy !== 'unavailable' ? d.limitedBy !== 'preauth-mcp' : !EXPECTED.has(String(d.cause ?? 'none')))).length;
        const ambiguous = r.out.filter((d) => AMBIGUOUS.has(String(d.cause))).length;
        const reasons: string[] = [];
        if (unexpected > 0) reasons.push(`${unexpected} unexpected failures`);
        if (!(r.admitted <= r.shardSum && r.shardSum <= G)) reasons.push('admitted <= counted <= G violated');
        if (r.shardSum - r.admitted > ambiguous) reasons.push('over-count not explained by ambiguous / late COMMITs');
        if (r.admitted < threshold) reasons.push(`availability ${r.admitted} < threshold ${threshold}`);
        return { ok: reasons.length === 0, reasons, unexpected, ambiguous };
      };
      const appLimiter = (p: unknown) => createPostgresRateLimiter({ pool: p as never, windowMs: 60_000 });
      /** A pool whose statements each take +10 ms (a starved runner). */
      const slowPool = () => {
        const real = pool();
        return { connect: async () => {
          const c = await real.connect();
          return { on: c.on.bind(c), off: c.off.bind(c), query: async (t: string, p2?: unknown[]) => {
            await sleep(10);
            return c.query(t, p2 as unknown[]);
          }, release: (e?: unknown) => c.release(e as Error | undefined) };
        } };
      };

      // (a) production deadline, real runner.
      const ctl = await runnerControl(pool() as unknown as Connectable);
      const safe = await flood([0, 1, 2].map(() => appLimiter(pool())));
      const g1 = gate(safe, ctl.threshold);
      const diag = { runnerControl: ctl, elapsedMs: safe.ms, outcomes: safe.by, counted: safe.shardSum, gate: g1 };
      console.log(`  I2b-1 aggregate (production deadline, app pool bounds) diagnostics: ${JSON.stringify(diag)}`);
      check('I2b-1 aggregate gate (production 1250 ms deadline): no unexpected failure, admitted <= counted <= G (over-count only from ambiguous / late COMMITs), availability >= the INDEPENDENTLY anchored floor', g1.ok, diag);

      // (b) a SHARED slowdown (the whole runner / database is slow): the
      // independent control sees it too, so the floor drops proportionally.
      const sharedCtl = await runnerControl(slowPool() as unknown as Connectable);
      const shared = await flood([0, 1, 2].map(() => appLimiter(slowPool())));
      const g2 = gate(shared, sharedCtl.threshold);
      const sharedDiag = { runnerControl: sharedCtl, elapsedMs: shared.ms, outcomes: shared.by, counted: shared.shardSum, gate: g2 };
      console.log(`  I2b-1 aggregate (shared slowdown, production deadline) diagnostics: ${JSON.stringify(sharedDiag)}`);
      check('I2b-1 shared slowdown (runner and database both +10 ms/statement): fewer than G admitted, the shortfall is expected shedding only, and the gate passes against the independently measured floor', shared.admitted < G && (shared.by['unavailable:deadline'] ?? 0) > 0 && g2.ok, sharedDiag);

      // (c) a LIMITER-ONLY slowdown (an implementation regression): the runner
      // control is unaffected, so the floor stays high and the gate FAILS.
      const g3 = gate(shared, ctl.threshold);
      check('I2b-1 negative control: a limiter-only slowdown cannot lower its own floor -- the same slow result FAILS against the real runner control', !g3.ok && g3.reasons.some((r) => r.startsWith('availability')), { threshold: ctl.threshold, admitted: shared.admitted, gate: g3 });

      // (d) injected pre-COMMIT driver faults.
      const faultyPool = (mode: 'decide' | 'commit_lost' | 'commit_refused') => {
        const real = pool();
        let n = 0;
        return { connect: async () => {
          const c = await real.connect();
          return { on: c.on.bind(c), off: c.off.bind(c), query: async (t: string, p2?: unknown[]) => {
            if (mode === 'decide' && /^WITH want/.test(t) && (n += 1) % 10 === 0) throw new Error('injected driver fault');
            if (mode !== 'decide' && t === 'COMMIT' && (n += 1) % 10 === 0) {
              if (mode === 'commit_lost') {
                await c.query('COMMIT'); // it LANDS, then the connection is "lost"
                throw new Error('Connection terminated unexpectedly');
              }
              await c.query('ROLLBACK'); // the server refuses: nothing lands
              throw Object.assign(new Error('could not serialize access'), { code: '40001', severity: 'ERROR' });
            }
            return c.query(t, p2 as unknown[]);
          }, release: (e?: unknown) => c.release(e as Error | undefined) };
        } };
      };
      const faulty = await flood([0, 1, 2].map(() => appLimiter(faultyPool('decide'))));
      const g4 = gate(faulty, ctl.threshold);
      console.log(`  I2b-1 aggregate (injected driver faults) diagnostics: ${JSON.stringify({ outcomes: faulty.by, gate: g4 })}`);
      check('I2b-1 negative control: injected pre-COMMIT driver faults are classified "driver" and FAIL the gate', !g4.ok && (faulty.by['unavailable:driver'] ?? 0) > 0, { outcomes: faulty.by, gate: g4 });
      const lost = await flood([0, 1, 2].map(() => appLimiter(faultyPool('commit_lost'))));
      const g5 = gate(lost, ctl.threshold);
      console.log(`  I2b-1 aggregate (post-send connection loss) diagnostics: ${JSON.stringify({ outcomes: lost.by, counted: lost.shardSum, gate: g5 })}`);
      check('I2b-1 post-send driver failure: classified "commit_lost" (ambiguous accounting: counted may exceed admitted), never shedding -- it FAILS the gate', (lost.by['unavailable:commit_lost'] ?? 0) > 0 && !g5.ok && lost.admitted <= lost.shardSum && lost.shardSum <= G, { outcomes: lost.by, counted: lost.shardSum, gate: g5 });
      const refused = await flood([0, 1, 2].map(() => appLimiter(faultyPool('commit_refused'))));
      const g6 = gate(refused, ctl.threshold);
      console.log(`  I2b-1 aggregate (explicit COMMIT refusal) diagnostics: ${JSON.stringify({ outcomes: refused.by, counted: refused.shardSum, gate: g6 })}`);
      check('I2b-1 explicit COMMIT failure (server SQLSTATE): classified "commit_failed", nothing counted for it, and it FAILS the gate', (refused.by['unavailable:commit_failed'] ?? 0) > 0 && !g6.ok && refused.shardSum === refused.admitted, { outcomes: refused.by, counted: refused.shardSum, gate: g6 });
      const allDown: FloodResult = { out: Array.from({ length: 2000 }, () => ({ allowed: false, retryAfterSeconds: 1, limitedBy: 'unavailable', cause: 'checkout' as const })), admitted: 0, by: {}, ms: 0, shardRows: [], shardSum: 0 };
      check('I2b-1 negative control: "0 admitted, 2000 unavailable" FAILS the gate', !gate(allDown, ctl.threshold).ok);
      const allShed: FloodResult = { ...allDown, out: allDown.out.map((d) => ({ ...d, cause: 'deadline' as const })) };
      check('I2b-1 negative control: even pure deadline shedding with 0 admitted FAILS the availability floor', !gate(allShed, ctl.threshold).ok && ctl.threshold > 0, { threshold: ctl.threshold });

      const roomy = [0, 1, 2].map(() => createPostgresRateLimiter({ pool: pool(), windowMs: 60_000, decisionDeadlineMs: 30_000, lockTimeoutMs: 5000, statementTimeoutMs: 6000 }));
      const exact = await flood(roomy);
      console.log(`  I2b-1 aggregate (explicit budget) diagnostics: ${JSON.stringify({ elapsedMs: exact.ms, outcomes: exact.by })}`);
      check('I2b-1 aggregate: 2000 concurrent decisions from 500 networks on 3 instances -> exactly G (480) admitted, never more', exact.admitted === G && exact.shardSum === G, { admitted: exact.admitted, outcomes: exact.by, elapsedMs: exact.ms });
      check('I2b-1 aggregate: every one of the 16 shards stopped at its own limit (30)', exact.shardRows.length === 16 && exact.shardRows.every((r) => r.count === 30), exact.shardRows.map((r) => r.count));
      check('I2b-1 aggregate: rejections were limits (429), not failures', exact.out.every((d) => d.allowed || d.limitedBy === 'preauth-mcp'), exact.by);

      await admin.query('TRUNCATE "McpRateLimitWindow"');
      const big = 1_000_000;
      const mixed = await Promise.all(
        Array.from({ length: 400 }, (_, i) => {
          const set = [{ key: 'user:dl-a', limit: big }, { key: 'client:dl-b', limit: big }, { key: `preauth-mcp:global:${i % 2}`, limit: big }];
          return instances[i % 3].check(i % 2 ? set.reverse() : set);
        }),
      );
      check('I2b-1 deadlocks: 400 opposite-order multi-key decisions on 3 instances -> all admitted, none failed', mixed.every((d) => d.allowed), mixed.filter((d) => !d.allowed).map((d) => d.limitedBy).slice(0, 5));
      const deadlocks = Number((await q(`SELECT deadlocks::int AS n FROM pg_stat_database WHERE datname = current_database()`))[0].n);
      check('I2b-1 deadlocks: Postgres reports 0 deadlocks', deadlocks === 0, deadlocks);

      // Boundaries and window rollover (1 s windows).
      const short = createPostgresRateLimiter({ pool: pool({ max: 3 }), windowMs: 1000 });
      const b = [await short.check([{ key: 'user:edge', limit: 2 }]), await short.check([{ key: 'user:edge', limit: 2 }]), await short.check([{ key: 'user:edge', limit: 2 }])];
      check('I2b-1 boundary: exactly the limit admitted, limit + 1 denied with Retry-After >= 1', b[0].allowed && b[1].allowed && !b[2].allowed && b[2].limitedBy === 'user' && b[2].retryAfterSeconds >= 1, b);
      await sleep(1300);
      const after = await short.check([{ key: 'user:edge', limit: 2 }]);
      const row = (await q(`SELECT "count", "expiresAt" > now() AS live FROM "McpRateLimitWindow" WHERE "key" = 'user:edge'`))[0];
      check('I2b-1 rollover: after expiry the window restarts at 1 (reset only once expired)', after.allowed && row.count === 1 && row.live === true, row);

      // Cleanup racing decisions on an expired row: no spurious "unavailable".
      await admin.query(`INSERT INTO "McpRateLimitWindow" ("key","windowStart","count","expiresAt") VALUES ('user:race', now() - interval '2 hours', 9, now() - interval '1 hour')`);
      const cleaner = createPostgresRateLimiter({ pool: pool({ max: 2 }), windowMs: 60_000 });
      const racing = await Promise.all([
        ...Array.from({ length: 60 }, (_, i) => instances[i % 3].check([{ key: 'user:race', limit: 40 }])),
        ...Array.from({ length: 10 }, () => cleaner.cleanupExpired().then(() => ({ allowed: true, retryAfterSeconds: 0 }) as RateLimitDecision)),
      ]);
      const decided = racing.slice(0, 60);
      check('I2b-1 cleanup race: decisions on a row being cleaned up never fail; exactly the limit admitted',
        decided.every((d) => d.allowed || d.limitedBy === 'user') && decided.filter((d) => d.allowed).length === 40, decided.filter((d) => !d.allowed && d.limitedBy !== 'user').length);
    }

    // ---------------------------------------------------------- I2b-R-3 with the shared limiter: /64 rotation, shared NAT, client isolation
    {
      await admin.query('TRUNCATE "McpRateLimitWindow"');
      const pre = createPostgresRateLimiter({ pool: pool(), windowMs: 60_000 });
      const statuses: number[] = [];
      for (let i = 0; i < 1000; i += 50) {
        const batch = await Promise.all(
          Array.from({ length: 50 }, (_, j) =>
            handleRemoteMcpRequest(mcpReq(), { config: MCP, verifyAccessToken: async () => null, preAuthRateLimiter: pre, clientAddress: `2001:db8:5:6:${(i + j).toString(16)}:1:2:3` }).then((r) => r.status),
          ),
        );
        statuses.push(...batch);
      }
      check('R-3 rotation: 1,000 addresses inside one /64 share one 120/min budget (120 reach auth, 880 throttled)', statuses.filter((s) => s === 401).length === 120 && statuses.filter((s) => s === 429).length === 880, [statuses.filter((s) => s === 401).length]);
      const neighbour = await handleRemoteMcpRequest(mcpReq(), { config: MCP, verifyAccessToken: async () => null, preAuthRateLimiter: pre, clientAddress: '2001:db8:5:7::1' });
      check('R-3 rotation: the neighbouring /64 has its own budget', neighbour.status === 401);

      // Shared NAT: 50 users behind one IPv4. Pre-auth shared, post-auth per user.
      await admin.query('TRUNCATE "McpRateLimitWindow"');
      const post = createPostgresRateLimiter({ pool: pool(), windowMs: 60_000 });
      const audits: McpAuditEvent[] = [];
      for (let round = 0; round < 3; round += 1) {
        await Promise.all(
          Array.from({ length: 50 }, (_, u) =>
            handleRemoteMcpRequest(mcpReq(`user-${u}`), {
              config: MCP,
              verifyAccessToken: async (t) => ({ userId: `synthetic-nat-${t}`, clientId: CLIENT, scopes: ['aura.planning.read'] }),
              preAuthRateLimiter: pre,
              clientAddress: '192.0.2.44',
              rateLimiter: post,
              rateLimits: { perUser: 2, perClient: 10_000 },
              audit: (e) => audits.push(e),
            }),
          ),
        );
      }
      const outcomes = audits.reduce<Record<string, number>>((m, e) => ({ ...m, [e.outcome]: (m[e.outcome] ?? 0) + 1 }), {});
      check('R-3 shared NAT: one IPv4 shares the 120 pre-auth budget (30 of 150 throttled before auth)', outcomes.preauth_throttled === 30, outcomes);
      check('R-3 shared NAT: post-auth limits stay per user (no user exceeds 2; others unaffected)', outcomes.rate_limited === 20 && 150 - 30 - 20 === 100, outcomes);

      // Client isolation: one client at its ceiling does not consume another's.
      const iso = await Promise.all(Array.from({ length: 12 }, (_, i) => post.check([{ key: `user:iso-${i}`, limit: 5 }, { key: 'client:iso-a', limit: 8 }])));
      const other = await post.check([{ key: 'user:iso-x', limit: 5 }, { key: 'client:iso-b', limit: 8 }]);
      check('Client isolation: client A capped at its ceiling (8 of 12); client B unaffected', iso.filter((d) => d.allowed).length === 8 && other.allowed);
    }

    // ---------------------------------------------------------- 429 vs 503 end to end with the real limiter
    {
      await admin.query('TRUNCATE "McpRateLimitWindow"');
      const pre = createPostgresRateLimiter({ pool: pool(), windowMs: 60_000 });
      const deps = (addr: string) => ({ config: MCP, verifyAccessToken: async () => null, preAuthRateLimiter: pre, clientAddress: addr, preAuthLimits: { perAddress: 2, global: 6000 }, pickShard: () => 0 });
      const s = [];
      for (let i = 0; i < 3; i += 1) s.push((await handleRemoteMcpRequest(mcpReq(), deps('198.51.100.90'))).status);
      check('429: over the per-address limit -> 429', JSON.stringify(s) === '[401,401,429]', s);
      const holder = await admin.connect();
      await holder.query('BEGIN');
      await holder.query(`SELECT 1 FROM "McpRateLimitWindow" WHERE "key" = 'preauth-mcp:global:g6000n16:0' FOR UPDATE`);
      const r = await timed(handleRemoteMcpRequest(mcpReq(), deps('198.51.100.91')));
      await holder.query('ROLLBACK');
      holder.release();
      check('503: limiter blocked by a held lock -> 503 + Retry-After within 1.5 s (not 429, not admitted)', r.value.status === 503 && r.value.headers.get('retry-after') === '1' && r.ms <= 1500, [r.value.status, r.ms]);
    }

    check('pools: every pool ends cleanly', (await Promise.all(pools.filter((p) => p !== admin).map((p) => endWithin(p, 5000)))).every(Boolean));
  } finally {
    await admin.query('TRUNCATE "McpOAuthPayload", "McpRateLimitWindow"').catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
  summary('AURA-MCP-02-I2b-S2 staging-blocker DB');
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : 'error');
  process.exit(1);
});
