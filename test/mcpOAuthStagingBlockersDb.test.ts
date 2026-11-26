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
import { isStoreUnavailableError, MCP_PG_POOL_BOUNDS, setDeadlineClockForTests } from '../packages/mcp-tools/src/security/deadline';
import { AsyncLocalStorage } from 'async_hooks';
import { EventEmitter } from 'events';
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

      // AURA-MCP-CI-01 -- the aggregate limiter checks, with SEPARATED
      // responsibilities (post-merge run 45444221976 attempt 1: 476 / 477 /
      // 480 on a healthy limiter; PR #394 CI: limiter/control ratio up to 4.4).
      //
      //  A. SAFETY + PRODUCTION-DEADLINE ENFORCEMENT (2000 decisions, the
      //     production 1250 ms deadline, application pool bounds). Timing-free
      //     invariants only: 0 unexpected causes; admitted <= counted <= G;
      //     over-count only from ambiguous / late COMMITs; exact per-shard
      //     accounting (shard of decision i = i mod 16: admitted = min(30,
      //     completed), a 429 only on a FULL shard); the deadline is ENFORCED
      //     (every decision answered within 1250 ms + 500 ms scheduling slack,
      //     no admission later than 1250 ms + 250 ms); liveness (>= 1
      //     admission). Shedding under load is legitimate here, so there is no
      //     availability floor in A.
      //  B. AVAILABILITY + EXACT ACCOUNTING (extended budget, below): exactly
      //     G admitted, all 16 shards at 30, only 429s, exact per-shard
      //     accounting. Deterministic -- no timing at all.
      //  C. PERFORMANCE REGRESSION (extended budget): limiter flood duration vs
      //     a CONTROL flood of the same shape (3 x 5 connections, 2000 units of
      //     4 round trips, 16 hot advisory keys; no limiter code, no table) run
      //     immediately before and after it. ratio = limiterMs / max(control
      //     before, after); BEST of 3 paired trials must be <= R_MAX = 5.
      //     Persistent (genuine) degradation fails every trial; a transient
      //     environmental slowdown cannot fail all three. R_MAX = 5: >= 2x the
      //     worst healthy BEST-of-3 ratio observed (2.34 local, 1.80 CI) and
      //     above the worst healthy SINGLE trial anywhere (4.4); the injected
      //     degradation this must catch (+10 ms / statement in the limiter)
      //     measured 11.2 on CI (controls ~530 ms) and 44-66 locally. C is a performance gate only: correctness
      //     never depends on a timing ratio (A and B are timing-free).
      //  ENV. A control flood slower than 5000 ms (4x the deadline) means the
      //     environment is unusably slow: the run FAILS (never a vacuous pass).
      // Every sample is reported; there are no retries.
      const G = 480;
      const N = 2000;
      const SHARDS = 16;
      const DEADLINE = 1250;
      const R_MAX = 5;
      const ENV_MAX_MS = 5000;
      /**
       * AURA-MCP-CI-01 r5: decision-time evidence (test harness only; no runtime change). The limiter's
       * DECIDE statement reads every key's count UNDER ITS ROW LOCK (SELECT ... FOR UPDATE, sorted keys)
       * and returns it (`cnt`) with the verdict (`ok`). `observed(pool)` records, per request, the LAST
       * complete DECIDE result it ran (a missing-row retry re-runs DECIDE). Requests are identified by an
       * AsyncLocalStorage index set in flood(). This is the database's own serialization order -- the
       * capacity each transaction actually saw when it decided -- not response-completion order.
       */
      type DecideObs = { ok: boolean; complete: boolean; rows: { key: string; cnt: number; lim: number }[] };
      type FloodResult = { out: RateLimitDecision[]; latencies: number[]; admitted: number; by: Record<string, number>; ms: number; shardRows: Record<string, unknown>[]; shardSum: number; decide?: (DecideObs | undefined)[] };
      const decideAls = new AsyncLocalStorage<{ i: number; sink: (DecideObs | undefined)[] }>();
      type PoolLike = { connect: () => Promise<{ on: (...a: never[]) => unknown; off: (...a: never[]) => unknown; query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; release: (e?: Error) => void }>; query?: (...a: never[]) => unknown };
      const observed = (p: PoolLike) => ({
        ...(typeof p.query === 'function' ? { query: (p.query as (...a: unknown[]) => unknown).bind(p) } : {}),
        connect: async () => {
          const c = await p.connect();
          return { on: c.on.bind(c), off: c.off.bind(c), release: (e?: unknown) => c.release(e as Error | undefined), query: async (t: string, p2?: unknown[]) => {
            const res = await c.query(t, p2 as unknown[]);
            const st = decideAls.getStore();
            if (st && typeof t === 'string' && /^WITH want/.test(t) && Array.isArray(p2)) {
              const keys = (p2[0] as string[]).map(String);
              const lims = (p2[1] as number[]).map(Number);
              const limOf = new Map(keys.map((k, j) => [k, lims[j]]));
              st.sink[st.i] = { ok: res.rows[0]?.ok === true, complete: res.rows.length === keys.length, rows: res.rows.map((row) => ({ key: String(row.key), cnt: Number(row.cnt), lim: limOf.get(String(row.key)) ?? NaN })) };
            }
            return res;
          } };
        },
      });
      const flood = async (limiters: PostgresRateLimiter[]): Promise<FloodResult> => {
        await admin.query('TRUNCATE "McpRateLimitWindow"');
        const latencies: number[] = new Array(N).fill(0);
        const decide: (DecideObs | undefined)[] = new Array(N).fill(undefined);
        const t0 = Date.now();
        const out = await Promise.all(
          Array.from({ length: N }, (_, i) => decideAls.run({ i, sink: decide }, async () => {
            const s0 = Date.now();
            const d = await limiters[i % 3].check(buildPreAuthRules('preauth-mcp', `2001:db8:${(i % 500).toString(16)}::${i}`, { perAddress: 480, global: G, globalShards: SHARDS }, (n) => i % n));
            latencies[i] = Date.now() - s0;
            return d;
          })),
        );
        const by: Record<string, number> = {};
        for (const d of out) {
          const k = d.allowed ? 'admitted' : d.limitedBy === 'unavailable' ? `unavailable:${d.cause ?? 'none'}` : String(d.limitedBy);
          by[k] = (by[k] ?? 0) + 1;
        }
        const shardRows = await q(`SELECT "key", "count" FROM "McpRateLimitWindow" WHERE "key" LIKE 'preauth-mcp:global:%'`);
        return { out, latencies, admitted: by.admitted ?? 0, by, ms: Date.now() - t0, shardRows, shardSum: await counts('preauth-mcp:global:%'), decide };
      };
      /** A pg-like pool whose statements each take +ms (deterministic contention injection). */
      const slowed = (ms: number, extra: PoolConfig = {}) => {
        const real = pool(extra);
        return { connect: async () => {
          const c = await real.connect();
          return { on: c.on.bind(c), off: c.off.bind(c), query: async (t: string, p2?: unknown[]) => {
            if (ms) await sleep(ms);
            return c.query(t, p2 as unknown[]);
          }, release: (e?: unknown) => c.release(e as Error | undefined) };
        } };
      };
      const endSince = async (from: number) => {
        const fresh = pools.splice(from);
        await Promise.all(fresh.map((p) => endWithin(p, 5000)));
      };
      /** The control flood: the flood's concurrency and lock shape, without the limiter. */
      const controlFlood = async (ms: number) => {
        const m = pools.length;
        const ps = [0, 1, 2].map(() => slowed(ms, { connectionTimeoutMillis: 120_000 }));
        const t0 = Date.now();
        await Promise.all(Array.from({ length: N }, async (_, i) => {
          const c = await ps[i % 3].connect();
          try {
            await c.query("BEGIN; SET LOCAL statement_timeout = '60000ms'; SET LOCAL lock_timeout = '60000ms'");
            await c.query('SELECT pg_advisory_xact_lock(7700000 + $1::int)', [i % SHARDS]);
            await c.query('SELECT pg_advisory_xact_lock(7800000 + $1::int)', [i % 500]);
            await c.query('COMMIT');
          } finally {
            c.release();
          }
        }));
        const ms2 = Date.now() - t0;
        await endSince(m);
        return ms2;
      };
      const prodLimiters = (ms: number) => [0, 1, 2].map(() => createPostgresRateLimiter({ pool: observed((ms ? slowed(ms) : pool()) as never) as never, windowMs: 60_000 }));
      // C's limiter floods: the extended decision budget AND a long pool-checkout timeout (as the control floods
      // use), so they measure throughput -- with the application's 2 s checkout timeout a slow flood would end in
      // "checkout" failures at ~2 s and cap the ratio.
      const extLimiters = (ms: number) => [0, 1, 2].map(() => createPostgresRateLimiter({ pool: (ms ? slowed(ms, { connectionTimeoutMillis: 120_000 }) : pool({ connectionTimeoutMillis: 120_000 })) as never, windowMs: 60_000, decisionDeadlineMs: 30_000, lockTimeoutMs: 5000, statementTimeoutMs: 6000 }));
      const EXPECTED = new Set(['deadline', 'commit_timeout', 'commit_late']);
      const AMBIGUOUS = new Set(['commit_timeout', 'commit_late', 'commit_lost']);
      /** Shared, timing-free accounting (A and B). */
      /**
       * Shared, timing-free accounting (A, B and every C trial). AURA-MCP-CI-01 r3: per-shard and EXACT.
       * Decision i is charged to shard i mod 16 (deterministic pickShard). For every shard:
       *   - its stored count is at most its limit (30), and there is no row outside shards 0..15;
       *   - admitted <= counted (every admission is charged to ITS shard);
       *   - counted - admitted <= the ambiguous / late COMMITs on that shard (an unconfirmed COMMIT may
       *     have landed: conservative over-count, never an unexplained one);
       *   - a quota 429 only on a shard that is EXACTLY full (counted == 30).
       * Aggregate: admitted <= counted <= G (480); 0 unexpected causes.
       */
      const PER_SHARD = G / SHARDS;
      const accounting = (r: FloodResult) => {
        const reasons: string[] = [];
        const unexpected = r.out.filter((d) => !d.allowed && (d.limitedBy !== 'unavailable' ? d.limitedBy !== 'preauth-mcp' : !EXPECTED.has(String(d.cause ?? 'none')))).length;
        const counted = new Map<number, number>();
        for (const row of r.shardRows) {
          const m = /^preauth-mcp:global:g480n16:(\d+)$/.exec(String(row.key));
          const sh = m ? Number(m[1]) : NaN;
          if (!m || sh < 0 || sh >= SHARDS) {
            reasons.push(`unexpected limiter row ${String(row.key)}`);
            continue;
          }
          counted.set(sh, Number(row.count));
        }
        const total = [...counted.values()].reduce((x, y) => x + y, 0);
        let admittedTotal = 0;
        for (let sh = 0; sh < SHARDS; sh += 1) {
          const mine = r.out.filter((_, i) => i % SHARDS === sh);
          const adm = mine.filter((d) => d.allowed).length;
          const lim = mine.filter((d) => !d.allowed && d.limitedBy === 'preauth-mcp').length;
          const amb = mine.filter((d) => AMBIGUOUS.has(String(d.cause))).length;
          const cnt = counted.get(sh) ?? 0;
          admittedTotal += adm;
          if (cnt > PER_SHARD) reasons.push(`shard ${sh} counted ${cnt} > limit ${PER_SHARD}`);
          if (adm > cnt) reasons.push(`shard ${sh}: ${adm} admitted but only ${cnt} counted (admission charged to another shard)`);
          if (cnt - adm > amb) reasons.push(`shard ${sh}: over-count ${cnt - adm} not explained by ${amb} ambiguous / late COMMITs`);
          if (lim > 0 && cnt !== PER_SHARD) reasons.push(`shard ${sh}: ${lim} quota refusals while counted ${cnt} (a 429 only on an exactly full shard)`);
        }
        if (unexpected > 0) reasons.push(`${unexpected} unexpected failures`);
        if (!(admittedTotal <= total && total <= G)) reasons.push(`admitted ${admittedTotal} <= counted ${total} <= ${G} violated`);
        return reasons;
      };
      /**
       * A: safety + production-deadline enforcement on the live flood. The EXACT admission boundary
       * (1,250 ms on the limiter's monotonic clock) is verified separately and deterministically (synthetic
       * clock, below): the outer response clock is NOT used to judge admission timing. The outer clock only
       * bounds response completion (deadline + 500 ms scheduling allowance).
       */
      /** A as reviewed at head 54e323d6 (unchanged; kept as the reference for the r5 reproductions). */
      const checkABase = (r: FloodResult) => {
        const reasons = accounting(r);
        const maxLatency = Math.max(...r.latencies);
        if (r.latencies.length === N && maxLatency > DEADLINE + 500) reasons.push(`response completion not bounded: a decision took ${maxLatency} ms`);
        if (r.admitted < 1) reasons.push('no admission at all (liveness)');
        return { ok: reasons.length === 0, reasons, maxLatencyMs: maxLatency };
      };
      /**
       * AURA-MCP-CI-01 r5: quota-refusal validity at DECISION time (the final shard count alone cannot show
       * when a 429 was decided). For every decided request (admitted or 429):
       *   - its DECIDE evidence exists and is complete, and includes ITS OWN shard key (attribution);
       *   - no decision-time count exceeds that shard's final count (counts only grow inside the window);
       *   - an admission saw every key below its limit and ok = true;
       *   - a 429 saw ok = false with at least one key AT its limit (cnt >= lim) when it decided.
       * Ambiguous / late COMMITs: a transaction that bumped and whose COMMIT outcome is unknown is NOT
       * assumed to have landed; a later 429 is valid only if ITS OWN locked read saw the key full, which
       * already includes that COMMIT iff it landed first. Final over-count stays bounded by the ambiguous
       * COMMITs (accounting, unchanged).
       */
      const decisionTime = (r: FloodResult) => {
        const reasons: string[] = [];
        const finalCount = new Map(r.shardRows.map((row) => [String(row.key), Number(row.count)]));
        const bad: Record<string, string[]> = { missing: [], attribution: [], beyondFinal: [], admission: [], early: [] };
        r.out.forEach((d, i) => {
          if (!(d.allowed || d.limitedBy === 'preauth-mcp')) return;
          const o = r.decide?.[i];
          const own = `preauth-mcp:global:g480n16:${i % SHARDS}`;
          if (!o || !o.complete) return void bad.missing.push(`#${i}`);
          const ownRow = o.rows.find((x) => x.key === own);
          if (!ownRow) return void bad.attribution.push(`#${i}`);
          if (ownRow.cnt > (finalCount.get(own) ?? 0)) bad.beyondFinal.push(`#${i} saw ${ownRow.cnt} > final ${finalCount.get(own) ?? 0}`);
          if (d.allowed) {
            if (!(o.ok && o.rows.every((x) => x.cnt < x.lim))) bad.admission.push(`#${i}`);
          } else if (o.ok || !o.rows.some((x) => x.cnt >= x.lim)) {
            bad.early.push(`#${i} (shard ${i % SHARDS}) at decision-time count ${ownRow.cnt}/${ownRow.lim}`);
          }
        });
        if (bad.missing.length) reasons.push(`decision-time evidence missing for ${bad.missing.length} decided requests (${bad.missing.slice(0, 3).join(', ')})`);
        if (bad.attribution.length) reasons.push(`decision-time evidence not for the request's own shard: ${bad.attribution.slice(0, 3).join(', ')}`);
        if (bad.beyondFinal.length) reasons.push(`decision-time count above the final count: ${bad.beyondFinal.slice(0, 3).join(', ')}`);
        if (bad.admission.length) reasons.push(`admission decided without capacity: ${bad.admission.slice(0, 3).join(', ')}`);
        if (bad.early.length) reasons.push(`${bad.early.length} quota refusals decided below capacity: ${bad.early.slice(0, 3).join(', ')}`);
        return reasons;
      };
      const checkA = (r: FloodResult) => {
        const base = checkABase(r);
        const reasons = [...base.reasons, ...decisionTime(r)];
        return { ok: reasons.length === 0, reasons, maxLatencyMs: base.maxLatencyMs };
      };
      /** Exactness of one extended-budget flood (B, and every C trial): all decided, exactly G, 16 full shards, exact accounting. */
      const exactness = (r: FloodResult) => {
        const reasons = accounting(r);
        const decided = r.out.filter((d) => d.allowed || d.limitedBy === 'preauth-mcp').length;
        if (decided !== N) reasons.push(`${N - decided} requests not decided`);
        if (r.admitted !== G) reasons.push(`admitted ${r.admitted} != ${G}`);
        if (!(r.shardRows.length === SHARDS && r.shardRows.every((row) => Number(row.count) === PER_SHARD))) reasons.push('not all 16 shards exactly full');
        return reasons;
      };
      const envOk = (controlMs: number) => controlMs <= ENV_MAX_MS;
      const median = (xs: number[]) => {
        const s2 = [...xs].sort((x, y) => x - y);
        const m = s2.length >> 1;
        return s2.length % 2 ? s2[m] : (s2[m - 1] + s2[m]) / 2;
      };
      /**
       * C: performance regression (extended budget), injectable for deterministic fixtures. Three predefined
       * trials, each bracketed by control floods. EVERY trial must be correct (exactness, incl. all 2000
       * decided), EVERY control must pass the 5 s environment guard, and the BEST trial ratio must be
       * <= R_MAX, where ratio = limiterMs / MEDIAN of all six control floods of this check (one isolated
       * slow control can no longer inflate the denominator; a shared slowdown raises the median).
       */
      const makeCheckC = (deps: { control: (ms: number) => Promise<number>; trial: (ms: number) => Promise<FloodResult> }) => async (inj: { control: number; limiter: number[] }) => {
        const raw: { before: number; after: number; r: FloodResult }[] = [];
        for (let t = 0; t < 3; t += 1) {
          const before = await deps.control(inj.control);
          const r = await deps.trial(inj.limiter[t]);
          const after = await deps.control(inj.control);
          raw.push({ before, after, r });
        }
        const controls = raw.flatMap((x) => [x.before, x.after]);
        const controlMedian = median(controls);
        const trials = raw.map((x) => ({ before: x.before, after: x.after, limiterMs: x.r.ms, ratio: Math.round((x.r.ms / Math.max(1, controlMedian)) * 100) / 100, problems: exactness(x.r) }));
        const reasons: string[] = [];
        trials.forEach((t, i) => t.problems.length && reasons.push(`trial ${i + 1} incorrect: ${t.problems.slice(0, 3).join('; ')}`));
        controls.forEach((c, i) => !envOk(c) && reasons.push(`control ${i + 1} took ${c} ms > ${ENV_MAX_MS} ms (environment unusable)`));
        // AURA-MCP-CI-01 r5: measurement VALIDITY is decided first and separately from the threshold.
        const valid = reasons.length === 0;
        const best = Math.min(...trials.map((t) => t.ratio));
        if (best > R_MAX) reasons.push(`performance: best ratio ${best} > ${R_MAX}`);
        const verdict: 'pass' | 'exceeds' | 'invalid' = !valid ? 'invalid' : best <= R_MAX ? 'pass' : 'exceeds';
        return { ok: verdict === 'pass', valid, verdict, reasons, best, controlMedian, trials: trials.map(({ problems, ...t }) => ({ ...t, correct: problems.length === 0 })) };
      };
      type CResult = { ok: boolean; valid: boolean; verdict: 'pass' | 'exceeds' | 'invalid'; best: number };
      /** Only a VALID measurement above R_MAX establishes degradation detection (an invalid one fails the test). */
      const degradationDetected = (c: CResult) => c.valid && c.verdict === 'exceeds';
      /** Sustained-slowdown ranking: only on a VALID measurement. */
      const sustainedRanked = (c: CResult, healthy: number[]) => c.valid && c.best > Math.max(...healthy);
      const checkC = makeCheckC({
        control: (ms) => controlFlood(ms),
        trial: async (ms) => {
          const m = pools.length;
          const r = await flood(extLimiters(ms));
          await endSince(m);
          return r;
        },
      });
      const runs: Record<string, unknown>[] = [];
      const scenario = async (label: string, inj: { env: number; prod: number; cControl: number; cLimiter: number[] }) => {
        const envMs = await controlFlood(inj.env);
        const m = pools.length;
        const r = await flood(prodLimiters(inj.prod));
        await endSince(m);
        const A = checkA(r);
        const C = await checkC({ control: inj.cControl, limiter: inj.cLimiter });
        const row = { case: label, envControlMs: envMs, env: envOk(envMs), A: { ok: A.ok, reasons: A.reasons, floodMs: r.ms, maxLatencyMs: A.maxLatencyMs, admitted: r.admitted, counted: r.shardSum, outcomes: r.by }, C };
        runs.push(row);
        console.log(`  I2b-1 scenario ${JSON.stringify(row)}`);
        return { row, A, C, r, envMs };
      };
      let mark = 0;

      // 1. Healthy (twice).
      const healthyBests: number[] = [];
      for (let k = 1; k <= 2; k += 1) {
        const h = await scenario(`healthy #${k}`, { env: 0, prod: 0, cControl: 0, cLimiter: [0, 0, 0] });
        check(`I2b-1 healthy #${k}: environment usable, A (safety + deadline) passes, C (performance) passes`, h.row.env && h.A.ok && h.C.ok, h.row);
        healthyBests.push(h.C.best);
        // r5: live decision-time evidence (DB-observed, under row locks) covers every decided request, and
        // every live 429 saw its own shard at exactly 30 when it decided.
        const decidedIdx = h.r.out.map((d, i) => (d.allowed || d.limitedBy === 'preauth-mcp' ? i : -1)).filter((i) => i >= 0);
        const ownCnt = (i: number) => h.r.decide?.[i]?.rows.find((x) => x.key === `preauth-mcp:global:g480n16:${i % SHARDS}`)?.cnt;
        const quotaIdx = decidedIdx.filter((i) => !h.r.out[i].allowed);
        const evidence = { decided: decidedIdx.length, withEvidence: decidedIdx.filter((i) => h.r.decide?.[i]?.complete).length, quota: quotaIdx.length, quotaSawFull: quotaIdx.filter((i) => ownCnt(i) === PER_SHARD).length, admittedSawBelow: decidedIdx.filter((i) => h.r.out[i].allowed && (ownCnt(i) ?? 99) < PER_SHARD).length };
        console.log(`  I2b-1 healthy #${k} decision-time evidence: ${JSON.stringify(evidence)}`);
        check(`I2b-1 healthy #${k}: live decision-time evidence for every decided request; every 429 saw its shard full (30), every admission saw it below 30`, evidence.decided > 0 && evidence.withEvidence === evidence.decided && evidence.quotaSawFull === evidence.quota && evidence.admittedSawBelow === h.r.admitted, evidence);
      }
      // 2. Shared slowdown everywhere (+2 ms per statement in controls AND limiter).
      const shared = await scenario('shared slowdown +2 ms/statement', { env: 2, prod: 2, cControl: 2, cLimiter: [2, 2, 2] });
      check('I2b-1 shared slowdown: environment usable, A passes (shedding is legitimate under load), C passes (ratio stays low when both slow)', shared.row.env && shared.A.ok && shared.C.ok, shared.row);
      // 3. THE RESIDUAL: fast controls, then a HEALTHY limiter flood under temporary environmental contention
      //    (production flood +2 ms; also one of the three C trials +3 ms).
      const residual = await scenario('residual: fast controls + healthy limiter under temporary contention', { env: 0, prod: 2, cControl: 0, cLimiter: [3, 0, 0] });
      const completed = residual.r.out.filter((d) => d.allowed || d.limitedBy === 'preauth-mcp').length;
      // What CI-01 v1 would have decided on this same run (INFORMATIONAL: it depends on how fast this
      // environment's controls are relative to the injected contention).
      const v1 = (controlMs: number, done: number) => {
        const fl = Math.min(N, Math.floor(Math.floor((N * DEADLINE) / (2.5 * Math.max(1, controlMs))) / 2));
        return { floor: fl, ok: done >= fl };
      };
      const liveV1 = v1(residual.envMs, completed);
      console.log(`  I2b-1 residual under CI-01 v1 (informational): ${JSON.stringify({ completed, envControlMs: residual.envMs, v1Floor: liveV1.floor, v1Ok: liveV1.ok, admitted: residual.r.admitted })}`);
      // Deterministic reproduction of the v1 residual (fixed inputs): CI-recorded fast controls (run
      // 45588327851 healthy #3: 252 ms) and a healthy flood that shed under contention (1,500 of 2,000
      // completed, 0 unexpected) -> v1 floor 1,984 -> FAIL; the corrected design has no such floor in A.
      const replayV1 = v1(252, 1500);
      check('I2b-1 residual reproduced (deterministic replay): CI-01 v1 with fast controls (252 ms -> floor 1,984) FAILS a healthy flood that shed under contention (1,500 completed)', replayV1.floor === 1984 && !replayV1.ok, replayV1);
      check('I2b-1 live residual run: the healthy flood was under real contention (deadline shedding occurred) with exact accounting', (residual.r.by['unavailable:deadline'] ?? 0) > 0 && accounting(residual.r).length === 0, residual.r.by);
      check('I2b-1 residual corrected: A passes (shedding classified, deadline enforced, accounting exact) and C passes (best of 3 trials unaffected by one contended trial)', residual.A.ok && residual.C.ok && residual.row.env, residual.row);
      // 4. GENUINE limiter-only degradation: the LIMITER is persistently slow (+10 ms/statement in every limiter
      //    flood, ~5 s per 2000 decisions); controls are not. (+5 ms gave a best ratio as low as 10.5 locally --
      //    too close to R_MAX for CI's slower controls -- so the injected degradation is sized to stay well clear.)
      const degraded = await scenario('limiter-only degradation (+10 ms/statement in every limiter flood)', { env: 0, prod: 10, cControl: 0, cLimiter: [10, 10, 10] });
      check('I2b-1 limiter-only degradation is DETECTED: a VALID C measurement exceeds R_MAX (best of 3), while A stays safe', degradationDetected(degraded.C) && accounting(degraded.r).length === 0, degraded.row);
      // 4b. A SMALLER sustained limiter-only slowdown (+2 ms/statement; the independent review's case).
      const degraded2 = await scenario('limiter-only degradation (+2 ms/statement in every limiter flood)', { env: 0, prod: 2, cControl: 0, cLimiter: [2, 2, 2] });
      // Environment-independent assertion: the sustained slowdown raises EVERY trial, so its best ratio
      // ranks above both healthy bests from the same run, and accounting stays exact. Whether it also
      // crosses R_MAX depends on how large +2 ms/statement is relative to this runner's control flood
      // (locally 13-21x: detected; on slower CI controls it can fall below R_MAX). That threshold is a
      // documented limitation; the reviewer's masking case (one slow control) is asserted
      // deterministically in section 10.
      check('I2b-1 sustained limiter-only +2 ms: a VALID C measurement ranks above both healthy runs (every trial slowed), A stays safe', sustainedRanked(degraded2.C, healthyBests) && accounting(degraded2.r).length === 0, { best: degraded2.C.best, valid: degraded2.C.valid, healthyBests });
      console.log(`  I2b-1 sustained +2 ms vs R_MAX (informational): ${JSON.stringify({ best: degraded2.C.best, controlMedian: degraded2.C.controlMedian, R_MAX, detectedByRMax: degradationDetected(degraded2.C) })}`);
      check('I2b-1 the residual and genuine degradation are DISTINGUISHED (residual passes C, degradation exceeds R_MAX on a valid measurement)', residual.C.ok && degradationDetected(degraded.C), { residualBest: residual.C.best, degradedBest: degraded.C.best, degradedVerdict: degraded.C.verdict });
      // 5. An unusably slow environment is rejected (control flood +12 ms/statement).
      const slowEnvMs = await controlFlood(12);
      check('I2b-1 an unusably slow environment FAILS (control flood above 4x the deadline)', !envOk(slowEnvMs), { slowEnvMs, ENV_MAX_MS });
      // 6. Deterministic fault injection: A must fail.
      /**
       * AURA-MCP-CI-02 (PR #396 run 45783279199): wire-level COMMIT ground truth, recorded by the test pool and
       * independent of the limiter's own cause labels. Per request index (decideAls):
       *   acked   -- the server confirmed the COMMIT (tag "COMMIT"): it LANDED, even if the limiter had already
       *              given up (deadline) and answers commit_timeout / commit_late;
       *   refused -- explicit failure: the transaction was ROLLED BACK (injected refusal, or a non-COMMIT tag):
       *              nothing landed;
       *   unknown -- the COMMIT was sent but the connection failed / was destroyed before an answer: it may or
       *              may not have landed (the only genuinely ambiguous case).
       */
      type Wire = 'acked' | 'refused' | 'unknown';
      type WireLog = Map<number, Wire>;
      type FaultClient = { on: (...a: never[]) => unknown; off: (...a: never[]) => unknown; query: (t: string, p?: unknown[]) => Promise<unknown>; release: (e?: Error) => void };
      type FaultOpts = {
        refuseEvery?: number; refuseAt?: number; lateAt?: number; lateMs?: number;
        /** AURA-MCP-CI-02 r3: tag every limiter transaction with its request index (SET LOCAL aura_test.req) for the contribution trigger. */
        tag?: boolean;
        /** r3 harness negative controls, selected by REQUEST identity: a duplicate increment before COMMIT; a ROLLBACK reported as a lost connection. */
        duplicateFor?: Set<number>; lostRollbackFor?: Set<number>;
        /** r3 self-test: a fake connection source (no database). */
        source?: () => Promise<FaultClient>;
      };
      const faultyPool = (mode: 'decide' | 'commit_lost' | 'commit_refused', wire?: WireLog, opts: FaultOpts = {}) => {
        const real = opts.source ? undefined : pool();
        const connectOne = opts.source ?? (async () => (await (real as Pool).connect()) as unknown as FaultClient);
        let n = 0;
        const every = opts.refuseEvery ?? 10;
        const refuseAt = opts.refuseAt ?? 0;
        /** Injections that actually happened (r3: verified against the intended number). */
        const injected = { refused: [] as number[], late: [] as number[], duplicate: [] as number[], lostRollback: [] as number[] };
        const reqIndex = () => decideAls.getStore()?.i;
        const decidedKeys = new Map<number, string[]>(); // request -> the keys its DECIDE locked
        const mark = (i: number | undefined, w: Wire) => {
          if (wire && i !== undefined) wire.set(i, w);
        };
        return { injected, connect: async () => {
          const c = await connectOne();
          return { on: c.on.bind(c), off: c.off.bind(c), query: async (t: string, p2?: unknown[]) => {
            const i = reqIndex(); // stable request identity, captured before any await
            if (mode === 'decide' && /^WITH want/.test(t) && (n += 1) % 10 === 0) throw new Error('injected driver fault');
            if (i !== undefined && typeof t === 'string' && /^WITH want/.test(t) && Array.isArray(p2)) decidedKeys.set(i, (p2[0] as string[]).map(String));
            if (opts.tag && i !== undefined && typeof t === 'string' && t.startsWith('BEGIN;')) return c.query(`${t}; SET LOCAL aura_test.req = '${Number(i)}'`, p2 as unknown[]);
            if (mode !== 'decide' && t === 'COMMIT') {
              // AURA-MCP-CI-02 r3 (ticket 39419, COMMIT 2/3 ordering): this COMMIT's ordinal and every injection
              // decision are fixed HERE, before awaiting anything; later submissions and acknowledgement order
              // cannot change them.
              const k = (n += 1);
              const refuse = k % every === refuseAt;
              const late = !refuse && opts.lateAt !== undefined && k % every === opts.lateAt;
              if (i !== undefined && opts.duplicateFor?.has(i)) {
                // Negative control: the SAME transaction increments its global shard row a second time.
                injected.duplicate.push(i);
                await c.query(`UPDATE "McpRateLimitWindow" SET "count" = "count" + 1 WHERE "key" = ANY($1::text[]) AND "key" LIKE 'preauth-mcp:global:%'`, [decidedKeys.get(i) ?? []]);
              }
              if (i !== undefined && opts.lostRollbackFor?.has(i)) {
                injected.lostRollback.push(i);
                mark(i, 'unknown'); // the client never learns the outcome ...
                await c.query('ROLLBACK'); // ... but nothing commits
                throw new Error('Connection terminated unexpectedly');
              }
              if (refuse) {
                injected.refused.push(k);
                if (mode === 'commit_lost') {
                  mark(i, 'unknown'); // recorded BEFORE sending: a destroyed connection cannot leave it blank
                  await c.query('COMMIT'); // it LANDS, then the connection is "lost"
                  throw new Error('Connection terminated unexpectedly');
                }
                mark(i, 'refused'); // ROLLBACK (or a destroyed connection mid-transaction): nothing can land
                await c.query('ROLLBACK'); // the server refuses: nothing lands
                throw Object.assign(new Error('could not serialize access'), { code: '40001', severity: 'ERROR' });
              }
              if (late) injected.late.push(k);
              mark(i, 'unknown'); // sent, not yet answered
              let res: { command?: string };
              try {
                res = (await c.query('COMMIT')) as { command?: string };
              } catch (e) {
                // r3: a server ErrorResponse (SQLSTATE) to COMMIT is a definitive rejection; only a lost connection stays unknown.
                if (isServerSqlstate(e)) mark(i, 'refused');
                throw e;
              }
              mark(i, res.command === 'COMMIT' ? 'acked' : 'refused');
              // Deterministic LATE acknowledgement (decided above): the COMMIT has landed, the answer reaches the limiter after its deadline.
              if (late) await sleep(opts.lateMs ?? DEADLINE + 250);
              return res;
            }
            return c.query(t, p2 as unknown[]);
          }, release: (e?: unknown) => c.release(e as Error | undefined) };
        } };
      };
      const isServerSqlstate = (e: unknown) => !!e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string' && /^[0-9A-Z]{5}$/.test((e as { code: string }).code);
      /**
       * AURA-MCP-CI-02: COMMIT accounting against the wire ground truth. For every bucket (limiter row):
       *   admitted <= acked <= counted <= acked + unknown
       * i.e. counted >= admitted, and counted <= admitted + the INDEPENDENTLY identified ambiguous commits
       * (acked-but-late + unknown). An explicitly refused COMMIT contributes nothing; an under-count, an
       * unexplained over-count or a duplicate increment falls outside the bound. Per request: an admission
       * needs a confirmed COMMIT; an explicitly refused COMMIT is never admitted; "commit_failed" only with an
       * explicit refusal; the ambiguous labels only where a COMMIT was really sent and not refused. Optional cap:
       * every bucket stays within its limit (capacity invariant).
       */
      type CommitRec = { bucket: string; d: RateLimitDecision; wire?: Wire };
      const commitAccounting = (recs: CommitRec[], counted: Map<string, number>, cap?: number) => {
        const reasons: string[] = [];
        const per = new Map<string, { adm: number; acked: number; unknown: number; refused: number }>();
        for (const r of recs) {
          const b = per.get(r.bucket) ?? { adm: 0, acked: 0, unknown: 0, refused: 0 };
          if (r.d.allowed) b.adm += 1;
          if (r.wire === 'acked') b.acked += 1;
          if (r.wire === 'unknown') b.unknown += 1;
          if (r.wire === 'refused') b.refused += 1;
          per.set(r.bucket, b);
          const cause = r.d.limitedBy === 'unavailable' ? String(r.d.cause) : '';
          if (r.d.allowed && r.wire !== 'acked') reasons.push(`unsafe admission in ${r.bucket}: admitted with COMMIT ${r.wire ?? 'never sent'}`);
          if (cause === 'commit_failed' && r.wire !== 'refused') reasons.push(`commit_failed in ${r.bucket} without an explicit refusal (${r.wire ?? 'no COMMIT'})`);
          // An ambiguous label needs a COMMIT that was really attempted. (A refused COMMIT answered after the
          // deadline is legitimately "commit_timeout" to the limiter: it never learned the outcome.)
          if (AMBIGUOUS.has(cause) && r.wire === undefined) reasons.push(`${cause} in ${r.bucket} but no COMMIT was ever sent`);
        }
        for (const k of counted.keys()) if (!per.has(k)) per.set(k, { adm: 0, acked: 0, unknown: 0, refused: 0 });
        let adm = 0;
        let cnt = 0;
        let amb = 0;
        for (const [k, b] of per) {
          const c = counted.get(k) ?? 0;
          adm += b.adm;
          cnt += c;
          amb += b.acked - b.adm + b.unknown;
          if (c < b.acked) reasons.push(`under-count in ${k}: ${c} counted < ${b.acked} confirmed COMMITs`);
          if (c > b.acked + b.unknown) reasons.push(`over-count in ${k}: ${c} counted > ${b.acked} confirmed + ${b.unknown} ambiguous (${b.refused} refused COMMITs add nothing)`);
          if (cap !== undefined && c > cap) reasons.push(`${k} counted ${c} > limit ${cap}`);
        }
        return { ok: reasons.length === 0, reasons, admitted: adm, counted: cnt, ambiguous: amb };
      };
      // Deterministic checker coverage (synthetic; no database, no timing).
      {
        const ok: RateLimitDecision = { allowed: true, retryAfterSeconds: 0 };
        const failed: RateLimitDecision = { allowed: false, retryAfterSeconds: 1, limitedBy: 'unavailable', cause: 'commit_failed' };
        const late: RateLimitDecision = { allowed: false, retryAfterSeconds: 1, limitedBy: 'unavailable', cause: 'commit_timeout' };
        const r = (d: RateLimitDecision, wire?: Wire): CommitRec => ({ bucket: 'b', d, wire });
        const cnt = (n: number) => new Map([['b', n]]);
        const refusedOnly = [r(ok, 'acked'), r(ok, 'acked'), r(failed, 'refused'), r(failed, 'refused')];
        check('I2b-1 COMMIT accounting (synthetic): explicitly failed COMMITs add nothing -- 2 admitted + 2 refused, counted 2 PASSES', commitAccounting(refusedOnly, cnt(2)).ok, commitAccounting(refusedOnly, cnt(2)));
        check('I2b-1 COMMIT accounting (synthetic): a refused COMMIT that incremented (counted 3) FAILS', !commitAccounting(refusedOnly, cnt(3)).ok, commitAccounting(refusedOnly, cnt(3)).reasons);
        const lateSet = [r(ok, 'acked'), r(ok, 'acked'), r(late, 'acked'), r(late, 'acked'), r(late, 'unknown'), r(failed, 'refused')];
        const lateOk = [4, 5].every((n) => commitAccounting(lateSet, cnt(n)).ok);
        check('I2b-1 COMMIT accounting (synthetic): ambiguous late COMMITs may increment within the bound -- 2 admitted, 2 late-confirmed, 1 unknown: counted 4 and 5 PASS', lateOk, [4, 5].map((n) => commitAccounting(lateSet, cnt(n))));
        check('I2b-1 COMMIT accounting (synthetic): outside the bound FAILS -- counted 3 (< confirmed: under-count) and 6 (> confirmed + unknown)', !commitAccounting(lateSet, cnt(3)).ok && !commitAccounting(lateSet, cnt(6)).ok, [commitAccounting(lateSet, cnt(3)).reasons, commitAccounting(lateSet, cnt(6)).reasons]);
        check('I2b-1 COMMIT accounting (synthetic): a duplicate increment (3 admitted, no ambiguity, counted 4) FAILS', !commitAccounting([r(ok, 'acked'), r(ok, 'acked'), r(ok, 'acked')], cnt(4)).ok);
        check('I2b-1 COMMIT accounting (synthetic): refused stays refused -- an explicitly refused COMMIT reported as admitted FAILS', !commitAccounting([r(ok, 'refused')], cnt(0)).ok);
        check('I2b-1 COMMIT accounting (synthetic): unsafe admission -- admitted with an unconfirmed (unknown) or unsent COMMIT FAILS', !commitAccounting([r(ok, 'unknown')], cnt(1)).ok && !commitAccounting([r(ok)], cnt(1)).ok);
        check('I2b-1 COMMIT accounting (synthetic): misclassification FAILS -- commit_failed on a confirmed COMMIT, commit_timeout where no COMMIT was sent', !commitAccounting([r(failed, 'acked')], cnt(1)).ok && !commitAccounting([r(late)], cnt(0)).ok);
        check('I2b-1 COMMIT accounting (synthetic): a refused COMMIT answered after the deadline ("commit_timeout") is not admitted and adds nothing -- counted 0 PASSES, counted 1 FAILS', commitAccounting([r(late, 'refused')], cnt(0)).ok && !commitAccounting([r(late, 'refused')], cnt(1)).ok);
        check('I2b-1 COMMIT accounting (synthetic): capacity -- a bucket above its limit FAILS', !commitAccounting([r(ok, 'acked'), r(ok, 'acked')], cnt(2), 1).ok);
      }
      /**
       * AURA-MCP-CI-02 r3 (ticket 39419): INDEPENDENT TRANSACTION ATTRIBUTION. The wire record alone cannot
       * separate "an unknown acknowledgement that committed" from "a duplicate increment hidden behind an unknown
       * that never committed": both give acked + unknown = counted. Test-only instrumentation in the DISPOSABLE
       * database records each committed contribution atomically: an AFTER INSERT/UPDATE row trigger on the limiter
       * table writes (txid, request tag, key, delta) into ci02_txn_contrib INSIDE the limiter's own transaction, so
       * a row exists if and only if that transaction committed. The request tag comes from SET LOCAL aura_test.req,
       * which the test pool appends to the limiter's BEGIN (no extra round trip). It is installed only around the
       * scenarios that use it and dropped afterwards. No migration, no Production schema, no runtime change.
       *
       * Per request (bucket = its global shard row):
       *   acked   + 1 contribution -> confirmed (if admitted) / committed with a LATE acknowledgement (if not)
       *   acked   + 0              -> FAIL (acknowledged but nothing committed: under-count)
       *   refused + 0              -> rejected;     refused + 1 -> FAIL (an explicit rejection contributed)
       *   unknown + 1              -> committed, acknowledgement lost;  unknown + 0 -> did not commit
       *   no COMMIT + 1            -> FAIL;  > 1 contribution or > 1 transaction -> FAIL (duplicate increment)
       * Decisions: an admission must be "confirmed"; a committed but unadmitted request must carry an ambiguous
       * label (commit_timeout / commit_late / commit_lost). Buckets: stored count == the sum of attributed
       * contributions EXACTLY (no bound), within the shard limit; total within G. A contribution with no request
       * tag is UNRESOLVED and fails: an outcome the evidence cannot establish never satisfies the test silently.
       */
      type Contrib = { txid: string; req: string | null; key: string; delta: number };
      type Resolved = 'confirmed' | 'rejected' | 'committed_ack_late' | 'committed_ack_lost' | 'not_committed_ack_unknown' | 'no_commit';
      const attribution = (out: RateLimitDecision[], wire: WireLog, bucketOf: (i: number) => string, contribs: Contrib[], counted: Map<string, number>, cap: number, total: number) => {
        const reasons: string[] = [];
        const tally: Partial<Record<Resolved, number>> = {};
        const buckets = new Set(out.map((_, i) => bucketOf(i)));
        const onBuckets = contribs.filter((c) => buckets.has(c.key) && c.delta !== 0);
        const unresolved = onBuckets.filter((c) => c.req === null || !/^\d+$/.test(c.req) || Number(c.req) >= out.length);
        for (const c of unresolved) reasons.push(`unresolved contribution on ${c.key} (txid ${c.txid}, request tag ${String(c.req)})`);
        out.forEach((d, i) => {
          const mine = onBuckets.filter((c) => c.req === String(i) && c.key === bucketOf(i));
          const sum = mine.reduce((x, c) => x + c.delta, 0);
          const txids = new Set(mine.map((c) => c.txid));
          if (sum > 1 || txids.size > 1) reasons.push(`request ${i}: duplicate increment (${sum} in ${txids.size} transaction(s))`);
          if (sum < 0) reasons.push(`request ${i}: negative contribution ${sum}`);
          const committed = sum >= 1;
          const w = wire.get(i);
          let r: Resolved | undefined;
          if (w === 'acked') {
            if (committed) r = d.allowed ? 'confirmed' : 'committed_ack_late';
            else reasons.push(`request ${i}: acknowledged COMMIT left no contribution (under-count)`);
          } else if (w === 'refused') {
            if (committed) reasons.push(`request ${i}: explicitly rejected COMMIT contributed an increment`);
            else r = 'rejected';
          } else if (w === 'unknown') {
            r = committed ? 'committed_ack_lost' : 'not_committed_ack_unknown';
          } else if (committed) {
            reasons.push(`request ${i}: contribution without any COMMIT`);
          } else {
            r = 'no_commit';
          }
          if (r) tally[r] = (tally[r] ?? 0) + 1;
          const cause = d.limitedBy === 'unavailable' ? String(d.cause) : String(d.limitedBy ?? '');
          if (d.allowed && r !== 'confirmed') reasons.push(`request ${i}: unsafe admission (${r ?? 'unresolved'})`);
          if (!d.allowed && committed && !AMBIGUOUS.has(cause)) reasons.push(`request ${i}: committed but answered "${cause}" (only an ambiguous outcome may commit unadmitted)`);
        });
        let sumAll = 0;
        for (const k of new Set([...buckets, ...counted.keys()])) {
          const attributed = onBuckets.filter((c) => c.key === k).reduce((x, c) => x + c.delta, 0);
          const c = counted.get(k) ?? 0;
          sumAll += c;
          if (c !== attributed) reasons.push(`${k}: stored ${c} != ${attributed} attributed contributions`);
          if (c > cap) reasons.push(`${k}: stored ${c} > limit ${cap}`);
        }
        if (sumAll > total) reasons.push(`total ${sumAll} > capacity ${total}`);
        return { ok: reasons.length === 0, reasons, tally, unresolved: unresolved.length };
      };
      const installContrib = async () => {
        await admin.query('CREATE TABLE IF NOT EXISTS ci02_txn_contrib (id bigserial PRIMARY KEY, txid bigint NOT NULL, req text, key text NOT NULL, delta int NOT NULL)');
        await admin.query(`CREATE OR REPLACE FUNCTION ci02_contrib() RETURNS trigger LANGUAGE plpgsql AS $f$
          BEGIN
            INSERT INTO ci02_txn_contrib (txid, req, key, delta) VALUES (txid_current(), current_setting('aura_test.req', true), NEW."key",
              CASE WHEN TG_OP = 'INSERT' THEN NEW."count" WHEN NEW."windowStart" IS DISTINCT FROM OLD."windowStart" THEN NEW."count" ELSE NEW."count" - OLD."count" END);
            RETURN NEW;
          END $f$`);
        await admin.query('DROP TRIGGER IF EXISTS ci02_contrib ON "McpRateLimitWindow"');
        await admin.query('CREATE TRIGGER ci02_contrib AFTER INSERT OR UPDATE ON "McpRateLimitWindow" FOR EACH ROW EXECUTE FUNCTION ci02_contrib()');
        await admin.query('TRUNCATE ci02_txn_contrib');
      };
      const removeContrib = async () => {
        await admin.query('DROP TRIGGER IF EXISTS ci02_contrib ON "McpRateLimitWindow"');
        await admin.query('DROP FUNCTION IF EXISTS ci02_contrib()');
        await admin.query('DROP TABLE IF EXISTS ci02_txn_contrib');
      };
      const readContrib = async (): Promise<Contrib[]> => (await q('SELECT txid::text AS txid, req, key, delta FROM ci02_txn_contrib WHERE delta <> 0 ORDER BY id')).map((r) => ({ txid: String(r.txid), req: r.req === null ? null : String(r.req), key: String(r.key), delta: Number(r.delta) }));
      // Deterministic attribution coverage (synthetic; no database).
      {
        const ok: RateLimitDecision = { allowed: true, retryAfterSeconds: 0 };
        const failed: RateLimitDecision = { allowed: false, retryAfterSeconds: 1, limitedBy: 'unavailable', cause: 'commit_failed' };
        const tmo: RateLimitDecision = { allowed: false, retryAfterSeconds: 1, limitedBy: 'unavailable', cause: 'commit_timeout' };
        const lostD: RateLimitDecision = { allowed: false, retryAfterSeconds: 1, limitedBy: 'unavailable', cause: 'commit_lost' };
        const B = () => 'b';
        const ct = (req: number | null, txid: string, delta = 1): Contrib => ({ txid, req: req === null ? null : String(req), key: 'b', delta });
        const W = (...ws: (Wire | undefined)[]) => new Map(ws.flatMap((w, i) => (w ? [[i, w] as [number, Wire]] : [])));
        const att = (out: RateLimitDecision[], w: WireLog, cs: Contrib[], n: number, cap = 30) => attribution(out, w, B, cs, new Map([['b', n]]), cap, 480);
        // The exact ticket-39419 witness: A confirmed and incremented twice; B's acknowledgement is unknown and B never committed.
        const wOut = [ok, lostD];
        const wWire = W('acked', 'unknown');
        const wContrib = [ct(0, 't1'), ct(0, 't1')];
        const prevBound = commitAccounting(wOut.map((d, i) => ({ bucket: 'b', d, wire: wWire.get(i) })), new Map([['b', 2]]));
        const wAtt = att(wOut, wWire, wContrib, 2);
        check('I2b-1 attribution (39419 witness): one confirmed transaction increments twice + one unknown acknowledgement that never committed -- the previous aggregate bound ACCEPTS it, attribution REJECTS it', prevBound.ok && !wAtt.ok && wAtt.reasons.some((x) => x.includes('duplicate')), { prevBound: prevBound.ok, reasons: wAtt.reasons });
        const legit = att([ok, tmo, lostD, failed, lostD], W('acked', 'acked', 'unknown', 'refused', 'unknown'), [ct(0, 't1'), ct(1, 't2'), ct(2, 't3')], 3);
        check('I2b-1 attribution (synthetic): legitimate outcomes ACCEPTED -- confirmed, committed with late ack, committed with lost ack, explicit rejection, unknown ack that did not commit', legit.ok && legit.tally.confirmed === 1 && legit.tally.committed_ack_late === 1 && legit.tally.committed_ack_lost === 1 && legit.tally.rejected === 1 && legit.tally.not_committed_ack_unknown === 1, legit);
        check('I2b-1 attribution (synthetic): an explicit refusal that contributed FAILS', !att([failed], W('refused'), [ct(0, 't1')], 1).ok);
        check('I2b-1 attribution (synthetic): duplicate increment across two transactions of one request FAILS', !att([ok], W('acked'), [ct(0, 't1'), ct(0, 't2')], 2).ok);
        check('I2b-1 attribution (synthetic): under-count -- acknowledged COMMIT with no contribution, or stored < attributed, FAILS', !att([ok], W('acked'), [], 0).ok && !att([ok], W('acked'), [ct(0, 't1')], 0).ok);
        check('I2b-1 attribution (synthetic): stored count above the attributed sum FAILS (no aggregate slack)', !att([ok, lostD], W('acked', 'unknown'), [ct(0, 't1')], 2).ok);
        check('I2b-1 attribution (synthetic): unsafe admission -- admitted with an unknown, rejected or missing COMMIT FAILS', !att([ok], W('unknown'), [ct(0, 't1')], 1).ok && !att([ok], W('refused'), [], 0).ok && !att([ok], W(undefined), [], 0).ok);
        check('I2b-1 attribution (synthetic): committed but answered as an explicit failure ("commit_failed" with a contribution) FAILS', !att([failed], W('unknown'), [ct(0, 't1')], 1).ok);
        check('I2b-1 attribution (synthetic): an UNRESOLVED contribution (no request tag) FAILS -- it cannot silently satisfy the count', !att([lostD], W('unknown'), [ct(null, 't9')], 1).ok);
        check('I2b-1 attribution (synthetic): capacity -- a bucket above its limit FAILS', !att([ok, ok], W('acked', 'acked'), [ct(0, 't1'), ct(1, 't2')], 2, 1).ok);
      }
      // Deterministic late-COMMIT injection self-test (ticket 39419 COMMIT 2/3 ordering; fake client, no database).
      {
        const fakeSource = (acks: { i: number; release: () => void }[]) => async (): Promise<FaultClient> => ({
          on: () => undefined, off: () => undefined, release: () => undefined,
          query: (t: string) => (t === 'COMMIT' ? new Promise((res) => acks.push({ i: decideAls.getStore()?.i ?? -1, release: () => res({ command: 'COMMIT' }) })) : Promise.resolve({ command: t.split(' ')[0], rows: [] })),
        });
        const runOrder = async (order: 'in-order' | 'reverse', submissions: number) => {
          const acks: { i: number; release: () => void }[] = [];
          const wire: WireLog = new Map();
          const fp = faultyPool('commit_refused', wire, { refuseEvery: 1000, refuseAt: 1, lateAt: 2, lateMs: 40, source: fakeSource(acks) });
          const c = await fp.connect();
          const done: { i: number; ms: number }[] = [];
          const t0 = Date.now();
          const pending = Array.from({ length: submissions }, (_, i) => decideAls.run({ i, sink: [] }, () => c.query('COMMIT').then(() => done.push({ i, ms: Date.now() - t0 }), () => done.push({ i, ms: Date.now() - t0 }))));
          await new Promise((r) => setImmediate(r));
          await new Promise((r) => setImmediate(r));
          (order === 'in-order' ? [...acks] : [...acks].reverse()).forEach((a) => a.release());
          await Promise.all(pending);
          return { injected: fp.injected, wire: Object.fromEntries(wire), done, slow: done.filter((d) => d.ms >= 35).map((d) => d.i) };
        };
        const exactly = (inj: { refused: number[]; late: number[] }, want: { refused: number; late: number }) => inj.refused.length === want.refused && inj.late.length === want.late;
        for (const order of ['in-order', 'reverse'] as const) {
          const r = await runOrder(order, 3);
          check(`I2b-1 late-COMMIT injection (${order} acknowledgements, 3 concurrent COMMITs): exactly the 2nd submitted COMMIT is delayed, the 1st refused, the 3rd untouched`, exactly(r.injected, { refused: 1, late: 1 }) && r.injected.late[0] === 2 && r.slow.length === 1 && r.slow[0] === 1 && r.wire[0] === 'refused' && r.wire[1] === 'acked' && r.wire[2] === 'acked', r);
        }
        const missing = await runOrder('in-order', 1);
        check('I2b-1 late-COMMIT injection: when the intended injection does not occur (only 1 COMMIT), the exact-count verification FAILS', !exactly(missing.injected, { refused: 1, late: 1 }), missing.injected);
      }
      /** The flood's buckets: decision i is charged to global shard i mod 16. */
      const shardRecs = (res: FloodResult, wire: WireLog): CommitRec[] => res.out.map((d, i) => ({ bucket: `preauth-mcp:global:g480n16:${i % SHARDS}`, d, wire: wire.get(i) }));
      const shardCounts = (res: FloodResult) => new Map(res.shardRows.map((row) => [String(row.key), Number(row.count)]));
      const appLimiter = (p: unknown) => createPostgresRateLimiter({ pool: observed(p as never) as never, windowMs: 60_000 });
      mark = pools.length;
      const faulty = await flood([0, 1, 2].map(() => appLimiter(faultyPool('decide'))));
      await endSince(mark);
      const g4 = checkA(faulty);
      console.log(`  I2b-1 aggregate (injected driver faults) diagnostics: ${JSON.stringify({ outcomes: faulty.by, A: g4 })}`);
      check('I2b-1 negative control: injected pre-COMMIT driver faults are classified "driver" and FAIL A', !g4.ok && (faulty.by['unavailable:driver'] ?? 0) > 0, { outcomes: faulty.by, A: g4 });
      // AURA-MCP-CI-02 r3: the COMMIT scenarios run with the test-only contribution trigger (removed afterwards).
      await installContrib();
      try {
        const wireTally = (w: WireLog) => ({ acked: [...w.values()].filter((x) => x === 'acked').length, refused: [...w.values()].filter((x) => x === 'refused').length, unknown: [...w.values()].filter((x) => x === 'unknown').length });
        const shardOf = (i: number) => `preauth-mcp:global:g480n16:${i % SHARDS}`;
        mark = pools.length;
        await admin.query('TRUNCATE ci02_txn_contrib');
        const lostWire: WireLog = new Map();
        const lostPools = [0, 1, 2].map(() => faultyPool('commit_lost', lostWire, { tag: true }));
        const lost = await flood(lostPools.map((fp) => appLimiter(fp)));
        await endSince(mark);
        const g5 = checkA(lost);
        const lostAtt = attribution(lost.out, lostWire, shardOf, await readContrib(), shardCounts(lost), PER_SHARD, G);
        const lostInjected = lostPools.reduce((x, fp) => x + fp.injected.refused.length, 0);
        console.log(`  I2b-1 aggregate (post-send connection loss) diagnostics: ${JSON.stringify({ outcomes: lost.by, counted: lost.shardSum, wire: wireTally(lostWire), injected: lostInjected, attribution: lostAtt, A: { ok: g5.ok, reasons: g5.reasons } })}`);
        check('I2b-1 post-send driver failure: classified "commit_lost" (ambiguous accounting: counted may exceed admitted), never shedding -- it FAILS A', (lost.by['unavailable:commit_lost'] ?? 0) > 0 && !g5.ok && lost.admitted <= lost.shardSum && lost.shardSum <= G, { outcomes: lost.by, counted: lost.shardSum, A: g5 });
        check('I2b-1 post-send connection loss (attribution): every lost acknowledgement is resolved by the transaction evidence (committed, not admitted), stored == attributed per shard, no duplicate, within capacity', lostAtt.ok && lostAtt.unresolved === 0 && (lostAtt.tally.committed_ack_lost ?? 0) >= lost.by['unavailable:commit_lost'] && lostInjected > 0, { attribution: lostAtt, injected: lostInjected, outcomes: lost.by });

        mark = pools.length;
        await admin.query('TRUNCATE ci02_txn_contrib');
        const refusedWire: WireLog = new Map();
        const refusedPools = [0, 1, 2].map(() => faultyPool('commit_refused', refusedWire, { tag: true }));
        const refused = await flood(refusedPools.map((fp) => appLimiter(fp)));
        await endSince(mark);
        const g6 = checkA(refused);
        const refusedAcc = commitAccounting(shardRecs(refused, refusedWire), shardCounts(refused), PER_SHARD);
        const refusedAtt = attribution(refused.out, refusedWire, shardOf, await readContrib(), shardCounts(refused), PER_SHARD, G);
        const refusedDiag = { outcomes: refused.by, counted: refused.shardSum, wire: wireTally(refusedWire), accounting: refusedAcc, attribution: refusedAtt, A: { ok: g6.ok, reasons: g6.reasons } };
        console.log(`  I2b-1 aggregate (explicit COMMIT refusal) diagnostics: ${JSON.stringify(refusedDiag)}`);
        // AURA-MCP-CI-02: previously "counted === admitted". Run 45783279199 showed 365 admitted / 373 counted with
        // 8 commit_timeout responses; the logs cannot attribute the 8 extra increments to transactions. The
        // late-COMMIT mechanism is reproduced deterministically below; here every request is attributed.
        check('I2b-1 explicit COMMIT failure (server SQLSTATE): classified "commit_failed", and it FAILS A', (refused.by['unavailable:commit_failed'] ?? 0) > 0 && !g6.ok, refusedDiag);
        check('I2b-1 explicit COMMIT failure: refused COMMITs add nothing -- per shard admitted <= confirmed <= counted <= confirmed + unknown, no unsafe admission, no misclassification, every shard within 30', refusedAcc.ok && refusedAcc.counted === refused.shardSum && refused.shardSum <= G, refusedDiag);
        check('I2b-1 explicit COMMIT failure (attribution): every rejected COMMIT contributed nothing, every admission is a confirmed committed transaction, stored == attributed per shard, no unresolved contribution', refusedAtt.ok && refusedAtt.unresolved === 0 && (refusedAtt.tally.rejected ?? 0) >= (refused.by['unavailable:commit_failed'] ?? 0), refusedDiag);

        // Deterministic reproduction of the late-COMMIT mechanism behind run 45783279199: on each of 3 instances the
        // 1st COMMIT is explicitly refused and the 2nd lands but is acknowledged AFTER the 1250 ms production deadline
        // (commit_timeout). Injection decided at submission (ordinal captured before awaiting) and counted exactly.
        {
          const M = 60;
          const wire: WireLog = new Map();
          mark = pools.length;
          await admin.query('TRUNCATE ci02_txn_contrib');
          const fps = [0, 1, 2].map(() => faultyPool('commit_refused', wire, { refuseEvery: 1000, refuseAt: 1, lateAt: 2, lateMs: DEADLINE + 250, tag: true }));
          const lim = fps.map((fp) => createPostgresRateLimiter({ pool: fp as never, windowMs: 60_000 }));
          await admin.query('TRUNCATE "McpRateLimitWindow"');
          const sink: (DecideObs | undefined)[] = new Array(M).fill(undefined);
          const out = await Promise.all(Array.from({ length: M }, (_, i) => decideAls.run({ i, sink }, () => lim[i % 3].check(buildPreAuthRules('preauth-mcp', `2001:db8:c02::${i}`, { perAddress: 480, global: G, globalShards: SHARDS }, (n) => i % n)))));
          await sleep(400); // the late acknowledgements have returned
          await endSince(mark);
          const rows = await q(`SELECT "key", "count" FROM "McpRateLimitWindow" WHERE "key" LIKE 'preauth-mcp:global:%'`);
          const counted = new Map(rows.map((row) => [String(row.key), Number(row.count)]));
          const recs: CommitRec[] = out.map((d, i) => ({ bucket: shardOf(i), d, wire: wire.get(i) }));
          const acc = commitAccounting(recs, counted, PER_SHARD);
          const att = attribution(out, wire, shardOf, await readContrib(), counted, PER_SHARD, G);
          const by: Record<string, number> = {};
          for (const d of out) {
            const k = d.allowed ? 'admitted' : `${d.limitedBy}:${d.cause ?? 'none'}`;
            by[k] = (by[k] ?? 0) + 1;
          }
          const injected = { refused: fps.map((fp) => fp.injected.refused), late: fps.map((fp) => fp.injected.late) };
          const refusedIdx = [...wire].filter(([, w]) => w === 'refused').map(([i]) => i);
          const lateLanded = out.filter((d, i) => !d.allowed && d.cause === 'commit_timeout' && wire.get(i) === 'acked').length;
          const total = [...counted.values()].reduce((x, y) => x + y, 0);
          const diag = { outcomes: by, counted: total, injected, refused: refusedIdx.length, lateLanded, accounting: acc, attribution: att };
          console.log(`  I2b-1 COMMIT refusal + late acknowledgement (deterministic) diagnostics: ${JSON.stringify(diag)}`);
          check('I2b-1 COMMIT regression (deterministic): exactly the intended injections happened -- per instance the 1st COMMIT refused and the 2nd acknowledged late (ordinals [1] and [2])', injected.refused.every((r) => r.length === 1 && r[0] === 1) && injected.late.every((l) => l.length === 1 && l[0] === 2), injected);
          check('I2b-1 COMMIT regression (deterministic): 3 explicit refusals -> 3 "commit_failed", all refused, none counted', refusedIdx.length === 3 && (by['unavailable:commit_failed'] ?? 0) === 3 && refusedIdx.every((i) => !out[i].allowed && out[i].cause === 'commit_failed'), diag);
          check('I2b-1 COMMIT regression (deterministic): exactly the 3 late-acknowledged COMMITs committed unadmitted ("commit_timeout"), attributed as committed_ack_late', lateLanded === 3 && att.tally.committed_ack_late === 3, diag);
          check('I2b-1 COMMIT regression (deterministic): the pre-CI-02 assertion "counted === admitted" FAILS here (counted = admitted + 3 late)', total === acc.admitted + 3, diag);
          check('I2b-1 COMMIT regression (deterministic): the wire bound PASSES and independent attribution PASSES with every outcome resolved (stored == attributed per shard, within capacity)', acc.ok && att.ok && att.unresolved === 0 && total <= G, diag);
        }

        // Live attribution controls (ticket 39419): one bucket, request identity selects the injection.
        const liveAttr = async (inject: Pick<FaultOpts, 'duplicateFor' | 'lostRollbackFor'>, M: number) => {
          const wire: WireLog = new Map();
          mark = pools.length;
          await admin.query('TRUNCATE ci02_txn_contrib');
          await admin.query('TRUNCATE "McpRateLimitWindow"');
          const fp = faultyPool('commit_refused', wire, { refuseEvery: 1_000_000, refuseAt: -1, tag: true, ...inject });
          const lim = createPostgresRateLimiter({ pool: fp as never, windowMs: 60_000, decisionDeadlineMs: 30_000, lockTimeoutMs: 5000, statementTimeoutMs: 6000 });
          const sink: (DecideObs | undefined)[] = new Array(M).fill(undefined);
          const out: RateLimitDecision[] = [];
          for (let i = 0; i < M; i += 1) out.push(await decideAls.run({ i, sink }, () => lim.check(buildPreAuthRules('preauth-mcp', `2001:db8:c03::${i}`, { perAddress: 480, global: G, globalShards: SHARDS }, () => 0))));
          await endSince(mark);
          const rows = await q(`SELECT "key", "count" FROM "McpRateLimitWindow" WHERE "key" LIKE 'preauth-mcp:global:%'`);
          const counted = new Map(rows.map((row) => [String(row.key), Number(row.count)]));
          const bucket = () => 'preauth-mcp:global:g480n16:0';
          const prev = commitAccounting(out.map((d, i) => ({ bucket: bucket(), d, wire: wire.get(i) })), counted, PER_SHARD);
          const att = attribution(out, wire, bucket, await readContrib(), counted, PER_SHARD, G);
          return { out: out.map((d) => (d.allowed ? 'admitted' : `${d.limitedBy}:${d.cause}`)), wire: Object.fromEntries(wire), counted: Object.fromEntries(counted), injected: fp.injected, prevBound: prev.ok, attribution: att };
        };
        const okLost = await liveAttr({ lostRollbackFor: new Set([1]) }, 3);
        console.log(`  I2b-1 live attribution (unknown acknowledgement, never committed) diagnostics: ${JSON.stringify(okLost)}`);
        check('I2b-1 live attribution: an unknown acknowledgement whose transaction never committed is resolved as not committed -- 2 confirmed + 1 not committed, stored 2, ACCEPTED', okLost.attribution.ok && okLost.attribution.tally.confirmed === 2 && okLost.attribution.tally.not_committed_ack_unknown === 1 && okLost.counted['preauth-mcp:global:g480n16:0'] === 2 && okLost.injected.lostRollback.length === 1, okLost);
        const dupLost = await liveAttr({ duplicateFor: new Set([0]), lostRollbackFor: new Set([1]) }, 2);
        console.log(`  I2b-1 live attribution (39419 witness: duplicate + never-committed unknown) diagnostics: ${JSON.stringify(dupLost)}`);
        check('I2b-1 live attribution (39419 witness): a confirmed transaction that increments twice + an unknown acknowledgement that never commits -- stored 2 satisfies the previous bound, attribution REJECTS it', dupLost.prevBound && !dupLost.attribution.ok && dupLost.attribution.reasons.some((x) => x.includes('duplicate')) && dupLost.counted['preauth-mcp:global:g480n16:0'] === 2 && dupLost.injected.duplicate.length === 1 && dupLost.injected.lostRollback.length === 1, dupLost);
      } finally {
        await removeContrib();
      }
      // 7. Synthetic invalid outcomes.
      const synth = (d: RateLimitDecision): FloodResult => ({ out: Array.from({ length: N }, () => d), latencies: new Array(N).fill(10), admitted: d.allowed ? N : 0, by: {}, ms: 0, shardRows: [], shardSum: 0 });
      check('I2b-1 negative control: "0 admitted, 2000 unavailable (checkout)" FAILS A', !checkA(synth({ allowed: false, retryAfterSeconds: 1, limitedBy: 'unavailable', cause: 'checkout' })).ok);
      check('I2b-1 negative control: all shed by the deadline (0 admitted) FAILS A (liveness)', !checkA(synth({ allowed: false, retryAfterSeconds: 1, limitedBy: 'unavailable', cause: 'deadline' })).ok);
      const all429 = checkA(synth({ allowed: false, retryAfterSeconds: 5, limitedBy: 'preauth-mcp' }));
      check('I2b-1 negative control: a limiter that answers 429 to everything FAILS A (429 on shards that are not exactly full, no admission)', !all429.ok && all429.reasons.some((x) => x.includes('exactly full')), all429.reasons);
      const slowAnswer: FloodResult = { ...synth({ allowed: true, retryAfterSeconds: 0 }), latencies: new Array(N).fill(DEADLINE + 900) };
      check('I2b-1 negative control: responses completed long after the deadline FAIL A (response completion not bounded)', !checkA(slowAnswer).ok && checkA(slowAnswer).reasons.some((x) => x.startsWith('response completion not bounded')));
      // 8. AURA-MCP-CI-01 r3: independent-review fixtures (synthetic, deterministic).
      //    Each is shown ACCEPTED by the previous checker (frozen copy below, from head 535822ea) and
      //    REJECTED by the corrected one.
      const prevAccounting = (r: FloodResult) => {
        const reasons: string[] = [];
        const ambiguous = r.out.filter((d) => AMBIGUOUS.has(String(d.cause))).length;
        const shardCount = new Map(r.shardRows.map((row) => [Number(String(row.key).split(':').pop()), Number(row.count)]));
        let illegit429 = 0;
        let shortAdmit = 0;
        for (let sh = 0; sh < SHARDS; sh += 1) {
          const mine = r.out.filter((_, i) => i % SHARDS === sh);
          const adm = mine.filter((d) => d.allowed).length;
          const lim = mine.filter((d) => !d.allowed && d.limitedBy === 'preauth-mcp').length;
          if (lim > 0 && (shardCount.get(sh) ?? 0) < G / SHARDS) illegit429 += lim;
          if (adm !== Math.min(G / SHARDS, adm + lim)) shortAdmit += 1;
        }
        if (!(r.admitted <= r.shardSum && r.shardSum <= G)) reasons.push('agg');
        if (r.shardSum - r.admitted > ambiguous) reasons.push('over');
        if (illegit429 > 0) reasons.push('429');
        if (shortAdmit > 0) reasons.push('short');
        return reasons;
      };
      const prevCheckA = (r: FloodResult) => {
        const reasons = prevAccounting(r);
        const maxLatency = Math.max(...r.latencies);
        if (maxLatency > DEADLINE + 500) reasons.push('resp');
        if (r.out.filter((d, i) => d.allowed && r.latencies[i] > DEADLINE + 250).length > 0) reasons.push('late');
        if (r.admitted < 1) reasons.push('live');
        return reasons.length === 0;
      };
      const allow: RateLimitDecision = { allowed: true, retryAfterSeconds: 0 };
      const shedD: RateLimitDecision = { allowed: false, retryAfterSeconds: 1, limitedBy: 'unavailable', cause: 'deadline' };
      const quota: RateLimitDecision = { allowed: false, retryAfterSeconds: 1, limitedBy: 'preauth-mcp' };
      const fx = (out: RateLimitDecision[], latencies: number[], rows: [number, number][], decide?: (DecideObs | undefined)[]): FloodResult => ({
        out, latencies, admitted: out.filter((d) => d.allowed).length, by: {}, ms: 0,
        shardRows: rows.map(([sh, count]) => ({ key: `preauth-mcp:global:g480n16:${sh}`, count })),
        shardSum: rows.reduce((t, [, c]) => t + c, 0),
        ...(decide ? { decide } : {}),
      });
      /** Decision-time evidence for request i: its own shard key read at `cnt` (limit 30) and its address key well below 480. */
      const ev = (i: number, cnt: number, ok = cnt < PER_SHARD, shard = i % SHARDS): DecideObs => ({ ok, complete: true, rows: [{ key: `preauth-mcp:addr:fixture:${i}`, cnt: 0, lim: 480 }, { key: `preauth-mcp:global:g480n16:${shard}`, cnt, lim: PER_SHARD }] });
      const timeoutD: RateLimitDecision = { allowed: false, retryAfterSeconds: 1, limitedBy: 'unavailable', cause: 'commit_timeout' };
      /**
       * Shard-0 scenario builder: step k is request 16k (shard 0) with its decision and the count its DECIDE
       * saw (undefined = no evidence). Every other request is shed by the deadline (an expected cause).
       */
      const shard0 = (steps: [RateLimitDecision, number | undefined, number?][], final: number, latency?: (k: number) => number): FloodResult => {
        const out: RateLimitDecision[] = new Array(N).fill(shedD);
        const lat: number[] = new Array(N).fill(10);
        const dec: (DecideObs | undefined)[] = new Array(N).fill(undefined);
        steps.forEach(([d, cnt, shard], k) => {
          out[16 * k] = d;
          if (latency) lat[16 * k] = latency(k);
          if (cnt !== undefined) dec[16 * k] = ev(16 * k, cnt, d.allowed || d.cause === 'commit_timeout' ? cnt < PER_SHARD : false, shard);
        });
        return fx(out, lat, [[0, final]], dec);
      };
      const admits = (from: number, to: number): [RateLimitDecision, number][] => Array.from({ length: to - from }, (_, k) => [allow, from + k]);
      const fixtures: [string, FloodResult][] = [
        ['admission charged to the WRONG shard (decision 0 admitted, shard 1 counted 1)', fx([allow, ...Array(N - 1).fill(shedD)], new Array(N).fill(10), [[1, 1]])],
        ['a shard counted at 31 with 429s on that over-limit shard', fx(Array.from({ length: N }, (_, i) => (i % 16 === 0 ? (i < 480 ? allow : quota) : i === 1 ? allow : shedD)), new Array(N).fill(10), [[0, 31]])],
      ];
      for (const [label, r] of fixtures) {
        check(`I2b-1 review fixture (A accounting) -- previous checker ACCEPTED it, corrected checker REJECTS: ${label}`, prevCheckA(r) && !checkA(r).ok, { prev: prevCheckA(r), now: checkA(r).reasons });
      }
      // (r5: now with decision-time evidence: 29 admissions saw 0..28, the ambiguous COMMIT saw 29, the 429s saw 30;
      //  decision 1 is the shard-1 admission, which saw 0.)
      const legitAmb = fx(Array.from({ length: N }, (_, i) => (i % 16 === 0 ? (i < 29 * 16 ? allow : i === 29 * 16 ? timeoutD : quota) : i === 1 ? allow : shedD)), new Array(N).fill(10), [[0, 30], [1, 1]],
        Array.from({ length: N }, (_, i) => (i % 16 === 0 ? ev(i, Math.min(i / 16, 30), i / 16 < 30) : i === 1 ? ev(1, 0) : undefined)));
      check('I2b-1 legitimate ambiguity still passes: shard 0 full with 29 admitted + 1 commit_timeout and 429s afterwards', checkA(legitAmb).ok, checkA(legitAmb).reasons);
      check('I2b-1 previous checker shortcoming: it accepted an admission observed at 1,300 ms on the outer clock (250 ms admission slack)', prevCheckA(fx([allow, ...Array(N - 1).fill(shedD)], [1300, ...Array(N - 1).fill(1255)], [[0, 1]])));

      // 8b. AURA-MCP-CI-01 r5: quota-refusal validity at DECISION time (independent review of 54e323d6).
      //     `checkABase` is A exactly as reviewed (final-count rule only); `checkA` adds decisionTime().
      const decisionCases: [string, FloodResult, boolean, boolean][] = [
        // label, fixture, reviewed-head A accepts?, corrected A accepts?
        ['premature 429 at decision-time count 0, then the shard fills to 30 (the review\'s case)', shard0([[quota, 0], ...admits(0, 30)], 30), true, false],
        ['premature 429 below capacity (count 29) on a shard that ends full', shard0([...admits(0, 29), [quota, 29], [allow, 29]], 30), true, false],
        ['429 on a shard that never fills (count 29 final)', shard0([...admits(0, 29), [quota, 29]], 29), false, false],
        ['an ambiguous COMMIT cannot excuse an early 429: 429 decided at 29 before the commit_timeout landed (final 30)', shard0([...admits(0, 29), [quota, 29], [timeoutD, 29]], 30), true, false],
        ['a 429 with NO decision-time evidence', shard0([...admits(0, 30), [quota, undefined]], 30), true, false],
        ['a 429 whose evidence is for another shard (attribution)', shard0([...admits(0, 30), [quota, 30, 1]], 30), true, false],
        ['legitimate 429 at capacity (count 30)', shard0([...admits(0, 30), [quota, 30], [quota, 30]], 30), true, true],
        ['legitimate 429s that COMPLETE FIRST: the 429 response (1 ms) precedes every admission response (200-229 ms) and is first in request order', shard0([[quota, 30], ...admits(0, 30).reverse(), [quota, 30]], 30, (k) => (k === 0 ? 1 : 200 + k)), true, true],
        ['ambiguous COMMIT that landed: 29 admitted + 1 commit_timeout (saw 29) counted, then 429s at 30', shard0([...admits(0, 29), [timeoutD, 29], [quota, 30], [quota, 30]], 30), true, true],
        ['ambiguous COMMIT, no 429s: over-count 1 (30 counted, 29 admitted) explained by the commit_timeout', shard0([...admits(0, 29), [timeoutD, 29]], 30), true, true],
        ['unexplained over-count (30 counted, 29 admitted, no ambiguous COMMIT) stays rejected', shard0(admits(0, 29), 30), false, false],
      ];
      for (const [label, r, prevOk, nowOk] of decisionCases) {
        const prev = checkABase(r);
        const now = checkA(r);
        check(`I2b-1 r5 decision-time fixture: ${label} -> reviewed A ${prevOk ? 'accepts' : 'rejects'}, corrected A ${nowOk ? 'ACCEPTS' : 'REJECTS'}`, prev.ok === prevOk && now.ok === nowOk, { prev: prev.reasons, now: now.reasons });
      }

      // 9. EXACT admission deadline on the production limiter (default 1,250 ms), synthetic monotonic clock:
      //    the COMMIT acknowledgement instant decides; the outer response clock is not involved.
      const deadlineCases: [string, number, boolean, string | undefined][] = [
        ['COMMIT', 1249, true, undefined],
        ['COMMIT', 1250, false, 'commit_late'],
        ['COMMIT', 1300, false, 'commit_late'],
        ['DECIDE', 1300, false, 'deadline'],
        ['ROLLBACK', 1300, false, 'deadline'],
      ];
      try {
        for (const [phase, elapsed, allowed, cause] of deadlineCases) {
          let now = 10_000;
          const statements: string[] = [];
          setDeadlineClockForTests(() => now);
          const fake = { connect: async () => Object.assign(new EventEmitter(), {
            query: async (text: string) => {
              const verb = text.startsWith('WITH want') ? 'DECIDE' : text.split(/[\s;]/)[0];
              statements.push(verb);
              if (verb === phase) now += elapsed;
              if (verb === 'DECIDE') return { rows: [{ key: 'user:x', cnt: phase === 'ROLLBACK' ? 5 : 0, retry: 5, ok: phase !== 'ROLLBACK', bumped: phase === 'ROLLBACK' ? 0 : 1 }], rowCount: 1 };
              return { rows: [], rowCount: 1, command: verb };
            },
            release() {},
          }) };
          const d = await createPostgresRateLimiter({ pool: fake as never, windowMs: 60_000 }).check([{ key: 'user:x', limit: 5 }]);
          check(`I2b-1 exact admission deadline: ${phase} acknowledged at ${elapsed} ms -> ${allowed ? 'ADMITTED' : `refused (${cause})`}${phase !== 'COMMIT' ? ', COMMIT never sent' : ''}`, d.allowed === allowed && (allowed || d.cause === cause) && (phase === 'COMMIT' || !statements.includes('COMMIT')), { d, statements });
        }
      } finally {
        setDeadlineClockForTests(null);
      }

      // 10. C fixtures (injected trials / controls; deterministic).
      const healthyTrial = (): FloodResult => fx(Array.from({ length: N }, (_, i) => (i < G ? allow : quota)), new Array(N).fill(10), Array.from({ length: SHARDS }, (_, sh) => [sh, PER_SHARD] as [number, number]));
      const all429Trial = (): FloodResult => fx(new Array(N).fill(quota), new Array(N).fill(10), []);
      const oneUndecided = (): FloodResult => { const t = healthyTrial(); t.out[1999] = shedD; return t; };
      const cFixture = async (trials: (() => FloodResult)[], durations: number[], control: number) => {
        let k = 0;
        const c = makeCheckC({ control: async () => control, trial: async () => ({ ...trials[k](), ms: durations[k++] }) });
        return c({ control: 0, limiter: [0, 0, 0] });
      };
      // The previous C judged only the best ratio + "decided": an all-429 trial (2000 "decided") passed.
      const prevC = (trials: FloodResult[], durations: number[], control: number) => Math.min(...durations.map((d) => d / control)) <= R_MAX && trials.every((t) => t.out.filter((d) => d.allowed || d.limitedBy === 'preauth-mcp').length === N);
      const c1 = await cFixture([healthyTrial, all429Trial, healthyTrial], [180, 650, 900], 100);
      check('I2b-1 C fixture: an all-429 trial FAILS C even though another trial is healthy and supplies the best ratio (previous C accepted it)', prevC([healthyTrial(), all429Trial(), healthyTrial()], [180, 650, 900], 100) && !c1.ok && c1.reasons.some((x) => x.startsWith('trial 2 incorrect')), c1.reasons);
      const c2 = await cFixture([healthyTrial, healthyTrial, healthyTrial], [15_000, 15_000, 15_000], 5001);
      check('I2b-1 C fixture: bracketing controls above the 5 s environment guard FAIL C (previous C accepted ratio 3.0)', prevC([healthyTrial(), healthyTrial(), healthyTrial()], [15_000, 15_000, 15_000], 5001) && !c2.ok && c2.reasons.some((x) => x.includes('environment unusable')), c2.reasons);
      const c3 = await cFixture([healthyTrial, healthyTrial, oneUndecided], [180, 250, 900], 100);
      check('I2b-1 C fixture: one undecided request in a non-best trial FAILS C', !c3.ok && c3.reasons.some((x) => x.startsWith('trial 3 incorrect')), c3.reasons);
      // The review's +2 ms limiter-only case: trial ratios vs max(before, after) were 11.9 / 3.83 / 13.91 because
      // ONE control rose to 405 ms. With the median of all six controls, that isolated outlier no longer masks it.
      const reviewControls = [[142, 120], [405, 130], [102, 110]];
      const reviewLimiter = [1690, 1550, 1419];
      const prevBest = Math.min(...reviewLimiter.map((ms, i) => ms / Math.max(...reviewControls[i])));
      let kc = 0;
      const controlsSeq = reviewControls.flat();
      let kt = 0;
      const c4 = await makeCheckC({ control: async () => controlsSeq[kc++], trial: async () => ({ ...healthyTrial(), ms: reviewLimiter[kt++] }) })({ control: 0, limiter: [0, 0, 0] });
      check('I2b-1 C fixture: one isolated slow control (405 ms) no longer masks a sustained slowdown (previous best 3.83 passed; median-based C FAILS it)', prevBest < R_MAX && !c4.ok && c4.best > R_MAX, { prevBest: Math.round(prevBest * 100) / 100, now: c4.best, median: c4.controlMedian });

      // 10b. AURA-MCP-CI-01 r5: measurement validity vs threshold (independent review of 54e323d6). Both LIVE
      //      degradation assertions use degradationDetected / sustainedRanked; the reviewed head used
      //      "!C.ok && best > R_MAX" and "best > max(healthy)", which an INVALID measurement could satisfy.
      const prevDegradationDetected = (c: CResult) => !c.ok && c.best > R_MAX;
      const prevSustainedRanked = (c: CResult, healthy: number[]) => c.best > Math.max(...healthy);
      const fxHealthyBests = [2.5, 2.6];
      const cSeq = async (trials: (() => FloodResult)[], durations: number[], controls: number[]) => {
        let k = 0;
        let kc2 = 0;
        return makeCheckC({ control: async () => controls[kc2++], trial: async () => ({ ...trials[k](), ms: durations[k++] }) })({ control: 0, limiter: [0, 0, 0] });
      };
      const cv1 = await cSeq([healthyTrial, all429Trial, healthyTrial], [800, 800, 800], [100, 100, 100, 100, 100, 100]);
      const cv2 = await cSeq([healthyTrial, healthyTrial, healthyTrial], [800, 800, 800], [100, 100, 100, 5001, 100, 100]);
      const cv3 = await cSeq([healthyTrial, healthyTrial, healthyTrial], [800, 800, 800], [100, 100, 100, 100, 100, 100]);
      const cv4 = await cSeq([healthyTrial, healthyTrial, healthyTrial], [250, 260, 270], [100, 100, 100, 100, 100, 100]);
      for (const [label, c] of [['an all-429 MEASURED trial (ratio 8)', cv1], ['a 5,001 ms AFTER-control (ratio 8; median 100)', cv2]] as [string, CResult & { reasons: string[] }][]) {
        check(`I2b-1 r5 C validity: ${label} -> verdict INVALID; the reviewed head's degradation assertion ACCEPTED it, the corrected one REJECTS it`, c.verdict === 'invalid' && !c.valid && prevDegradationDetected(c) && !degradationDetected(c), { verdict: c.verdict, best: c.best, reasons: c.reasons });
        check(`I2b-1 r5 C validity: ${label} -> the reviewed head's sustained-slowdown assertion ACCEPTED it, the corrected one REJECTS it`, prevSustainedRanked(c, fxHealthyBests) && !sustainedRanked(c, fxHealthyBests), { verdict: c.verdict, best: c.best });
      }
      check('I2b-1 r5 C validity: a VALID measurement above R_MAX (ratio 8) -> verdict EXCEEDS; both degradation assertions accept it', cv3.valid && cv3.verdict === 'exceeds' && degradationDetected(cv3) && sustainedRanked(cv3, fxHealthyBests), { verdict: cv3.verdict, best: cv3.best });
      check('I2b-1 r5 C validity: a VALID measurement within R_MAX (ratio 2.5) -> verdict PASS (C ok); degradation is NOT detected', cv4.valid && cv4.verdict === 'pass' && cv4.ok && !degradationDetected(cv4) && !sustainedRanked(cv4, [3, 3]), { verdict: cv4.verdict, best: cv4.best });

      console.log(`  I2b-1 scenarios summary: ${JSON.stringify(runs.map((r) => ({ case: r.case, envControlMs: r.envControlMs, A: { ok: (r.A as { ok: boolean }).ok, floodMs: (r.A as { floodMs: number }).floodMs, maxLatencyMs: (r.A as { maxLatencyMs: number }).maxLatencyMs, admitted: (r.A as { admitted: number }).admitted, counted: (r.A as { counted: number }).counted }, C: r.C })))}`);

      mark = pools.length;
      const roomy = [0, 1, 2].map(() => createPostgresRateLimiter({ pool: pool(), windowMs: 60_000, decisionDeadlineMs: 30_000, lockTimeoutMs: 5000, statementTimeoutMs: 6000 }));
      const exact = await flood(roomy);
      await endSince(mark);
      console.log(`  I2b-1 aggregate (explicit budget) diagnostics: ${JSON.stringify({ elapsedMs: exact.ms, outcomes: exact.by })}`);
      check('I2b-1 aggregate: 2000 concurrent decisions from 500 networks on 3 instances -> exactly G (480) admitted, never more', exact.admitted === G && exact.shardSum === G, { admitted: exact.admitted, outcomes: exact.by, elapsedMs: exact.ms });
      check('I2b-1 aggregate: every one of the 16 shards stopped at its own limit (30)', exact.shardRows.length === 16 && exact.shardRows.every((r) => r.count === 30), exact.shardRows.map((r) => r.count));
      check('I2b-1 aggregate: rejections were limits (429), not failures', exact.out.every((d) => d.allowed || d.limitedBy === 'preauth-mcp'), exact.by);
      check('I2b-1 B exact per-shard accounting under the extended budget: admitted = min(30, completed) per shard, a 429 only on a full shard, invariants hold', accounting(exact).length === 0, accounting(exact));

      // AURA-MCP-CI-02 (runs 45635380561, 45640197925). The deadlock check
      // used to run its 400 decisions under the PRODUCTION 1250 ms deadline.
      // All 400 share the rows user:dl-a and client:dl-b, so the row locks
      // serialize them (by design), and every deadline starts at the same
      // instant. On a slower runner the tail of that queue was shed as
      // "unavailable" (cause deadline). That is fail-closed shedding, not a
      // deadlock: Postgres reported 0 deadlocks both times. It was also a weak
      // oracle: with lock_timeout (1000 ms) <= deadlock_timeout (1 s), a REAL
      // deadlock is cancelled as 55P03 lock_timeout before the detector runs,
      // so pg_stat_database.deadlocks stays 0. Now:
      //   (a) the deadlock property runs under an explicit budget whose
      //       lock_timeout exceeds deadlock_timeout, so a real deadlock would
      //       surface as SQLSTATE 40P01 and in the counter. Every SQLSTATE is
      //       recorded, and the counter is read as a delta after the backends
      //       exit (stats flushed);
      //   (b) negative control: a real opposite-order deadlock under the same
      //       lock_timeout IS caught (40P01, counter +1);
      //   (c) regression: the CI failure mode, made deterministic (+6 ms per
      //       statement => >= 2.4 s of serialized lock holds > 1250 ms). The
      //       production-deadline shortfall must be expected shedding, or a
      //       wait cut by the limiter's own SET LOCAL bound (57014 / 55P03, one
      //       per "driver" answer: PostgreSQL row-lock waits are not strictly
      //       FIFO, so an early waiter can be starved for the full 1000 ms
      //       statement_timeout -- measured in 6 of 25 local runs). Never 40P01.
      //       The pre-CI-02 "all admitted" assertion FAILS on that result.
      // Throughput under the production deadline stays covered by the
      // aggregate gate above.
      const big = 1_000_000;
      const DL_KEYS = ['client:dl-b', 'preauth-mcp:global:0', 'preauth-mcp:global:1', 'user:dl-a'];
      const deadlockSet = (i: number) => {
        const set = [{ key: 'user:dl-a', limit: big }, { key: 'client:dl-b', limit: big }, { key: `preauth-mcp:global:${i % 2}`, limit: big }];
        return i % 2 ? set.reverse() : set;
      };
      const DL_APP = 'aura-ci02-deadlock';
      /** A pool that records every error (and its SQLSTATE) raised underneath the limiter; optional +ms per statement. */
      const sqlSpy = (extra: PoolConfig, delayMs = 0) => {
        const real = pool({ application_name: DL_APP, ...extra });
        const errors: { code?: string; message: string; req?: number }[] = [];
        return { errors, connect: async () => {
          const c = await real.connect();
          return { on: c.on.bind(c), off: c.off.bind(c), query: async (t: string, p2?: unknown[]) => {
            if (delayMs > 0) await sleep(delayMs);
            try {
              return await c.query(t, p2 as unknown[]);
            } catch (e) {
              // AURA-MCP-CI-02 r3: each error carries the request that produced it (stable identity via decideAls).
              errors.push({ code: (e as { code?: string }).code, message: String((e as Error).message).slice(0, 80), req: decideAls.getStore()?.i });
              throw e;
            }
          }, release: (e?: unknown) => c.release(e as Error | undefined) };
        } };
      };
      /** pg_stat_database.deadlocks once every backend of this scenario has exited (exit flushes its pending stats). */
      const settledDeadlocks = async () => {
        for (let i = 0; i < 50 && Number((await q(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1`, [DL_APP]))[0].n) > 0; i += 1) await sleep(100);
        await sleep(200);
        await admin.query('SELECT pg_stat_clear_snapshot()');
        return Number((await q(`SELECT deadlocks::int AS n FROM pg_stat_database WHERE datname = current_database()`))[0].n);
      };
      const deadlockTimeoutMs = Number((await q(`SELECT setting::int AS ms FROM pg_settings WHERE name = 'deadlock_timeout'`))[0].ms);
      const DL_LOCK_TIMEOUT = 5000;
      check('I2b-1 deadlocks precondition: the explicit lock_timeout exceeds deadlock_timeout (a real deadlock reaches the detector)', DL_LOCK_TIMEOUT >= 2 * deadlockTimeoutMs, { lockTimeoutMs: DL_LOCK_TIMEOUT, deadlockTimeoutMs });
      const roomyFor = (p: unknown) => createPostgresRateLimiter({ pool: p as never, windowMs: 60_000, decisionDeadlineMs: 30_000, lockTimeoutMs: DL_LOCK_TIMEOUT, statementTimeoutMs: DL_LOCK_TIMEOUT + 1000 });
      const hotCounts = async () => Object.fromEntries((await q(`SELECT "key", "count" FROM "McpRateLimitWindow" WHERE "key" = ANY($1::text[]) ORDER BY "key"`, [DL_KEYS])).map((r) => [r.key, r.count]));

      // (a) the deadlock property, explicit budget.
      await admin.query('TRUNCATE "McpRateLimitWindow"');
      mark = pools.length;
      let dl0 = await settledDeadlocks();
      const dlPools = [0, 1, 2].map(() => sqlSpy({ max: 6, connectionTimeoutMillis: 30_000, query_timeout: 30_000 }));
      const dlLimiters = dlPools.map(roomyFor);
      const mixed = await Promise.all(Array.from({ length: 400 }, (_, i) => dlLimiters[i % 3].check(deadlockSet(i))));
      await endSince(mark);
      const dlDelta = (await settledDeadlocks()) - dl0;
      const dlErrors = dlPools.flatMap((p) => p.errors);
      const mixedBy: Record<string, number> = {};
      for (const d of mixed) {
        const k = d.allowed ? 'admitted' : `${d.limitedBy}:${d.cause ?? 'none'}`;
        mixedBy[k] = (mixedBy[k] ?? 0) + 1;
      }
      const hot = await hotCounts();
      check('I2b-1 deadlocks: 400 opposite-order multi-key decisions on 3 instances (explicit budget) -> all admitted, none failed', mixed.every((d) => d.allowed), mixedBy);
      check('I2b-1 deadlocks: every hot row counted exactly the admitted decisions (400 / 400 / 200 + 200)', hot['user:dl-a'] === 400 && hot['client:dl-b'] === 400 && hot['preauth-mcp:global:0'] === 200 && hot['preauth-mcp:global:1'] === 200, hot);
      check('I2b-1 deadlocks: no SQLSTATE 40P01 (deadlock) or 55P03 (lock timeout) and no other error underneath the limiter', dlErrors.length === 0, dlErrors.slice(0, 5));
      check('I2b-1 deadlocks: Postgres reports 0 new deadlocks (counter delta after the backends exited)', dlDelta === 0, dlDelta);

      // (b) negative control: the same oracle DOES see a real deadlock.
      await admin.query('TRUNCATE "McpRateLimitWindow"');
      await admin.query(`INSERT INTO "McpRateLimitWindow" ("key","windowStart","count","expiresAt") VALUES ('user:dl-x', now(), 0, now() + interval '1 hour'), ('user:dl-y', now(), 0, now() + interval '1 hour')`);
      mark = pools.length;
      dl0 = await settledDeadlocks();
      const rawPool = pool({ application_name: DL_APP, max: 2, query_timeout: 30_000 });
      const [ra, rb] = [await rawPool.connect(), await rawPool.connect()];
      const opposite = async (c: typeof ra, first: string, second: string) => {
        try {
          await c.query(`BEGIN; SET LOCAL lock_timeout = '${DL_LOCK_TIMEOUT}ms'; SET LOCAL statement_timeout = '${DL_LOCK_TIMEOUT + 1000}ms'`);
          await c.query(`SELECT 1 FROM "McpRateLimitWindow" WHERE "key" = $1 FOR UPDATE`, [first]);
          await sleep(150);
          await c.query(`SELECT 1 FROM "McpRateLimitWindow" WHERE "key" = $1 FOR UPDATE`, [second]);
          await c.query('COMMIT');
          return 'committed';
        } catch (e) {
          await c.query('ROLLBACK').catch(() => undefined);
          return String((e as { code?: string }).code);
        }
      };
      const raw = (await Promise.all([opposite(ra, 'user:dl-x', 'user:dl-y'), opposite(rb, 'user:dl-y', 'user:dl-x')])).sort();
      ra.release();
      rb.release();
      await endSince(mark);
      const rawDelta = (await settledDeadlocks()) - dl0;
      check('I2b-1 deadlock oracle (negative control): a real opposite-order deadlock under the same lock_timeout -> one 40P01, the other commits, counter +1', raw[0] === '40P01' && raw[1] === 'committed' && rawDelta >= 1, { outcomes: raw, deadlocksDelta: rawDelta });

      // (c) regression: the CI-02 failure mode, deterministic.
      await admin.query('TRUNCATE "McpRateLimitWindow"');
      mark = pools.length;
      dl0 = await settledDeadlocks();
      const slowDl = [0, 1, 2].map(() => sqlSpy({ max: 6 }, 6));
      const slowLimiters = slowDl.map(appLimiter); // production defaults: 1250 ms deadline, 1000 ms lock / statement timeouts
      const shedSink: (DecideObs | undefined)[] = new Array(400).fill(undefined);
      const shedOut = await Promise.all(Array.from({ length: 400 }, (_, i) => decideAls.run({ i, sink: shedSink }, () => slowLimiters[i % 3].check(deadlockSet(i)))));
      await endSince(mark);
      const shedDelta = (await settledDeadlocks()) - dl0;
      const shedBy: Record<string, number> = {};
      for (const d of shedOut) {
        const k = d.allowed ? 'admitted' : `${d.limitedBy}:${d.cause ?? 'none'}`;
        shedBy[k] = (shedBy[k] ?? 0) + 1;
      }
      const shedAdmitted = shedOut.filter((d) => d.allowed).length;
      const shedAmbiguous = shedOut.filter((d) => AMBIGUOUS.has(String(d.cause))).length;
      const shedCounted = (await hotCounts())['user:dl-a'] ?? 0;
      const shedCodes = slowDl.flatMap((p) => p.errors).filter((e) => e.code !== undefined);
      const shedDiag = { outcomes: shedBy, counted: shedCounted, sqlstates: shedCodes.slice(0, 5), deadlocksDelta: shedDelta };
      console.log(`  I2b-1 deadlocks regression (production deadline, +6 ms/statement) diagnostics: ${JSON.stringify(shedDiag)}`);
      check('I2b-1 deadlocks regression: a serialized hot-row queue longer than the 1250 ms production deadline sheds -- the pre-CI-02 "all admitted" assertion FAILS here', !shedOut.every((d) => d.allowed), shedDiag);
      const BOUNDED = new Set(['57014', '55P03']); // the limiter's own SET LOCAL statement_timeout / lock_timeout
      /**
       * AURA-MCP-CI-02 r3 (ticket 39419): REQUEST-SPECIFIC timeout attribution (replaces count matching, which let a
       * 57014 on a deadline-refused request satisfy an unrelated "driver" refusal). Every SQLSTATE must belong to
       * an identified request; 40P01 or any code other than 57014 / 55P03 fails; a bounded-wait code is permitted
       * only on a request that was itself SAFELY REFUSED ("unavailable"); and every "driver" refusal needs a
       * bounded-wait code of ITS OWN. Every other shortfall must be expected deadline shedding.
       */
      const timeoutAttribution = (out: RateLimitDecision[], errs: { code?: string; req?: number }[]) => {
        const reasons: string[] = [];
        const coded = errs.filter((e) => e.code !== undefined);
        for (const e of coded) {
          if (e.req === undefined || !Number.isInteger(e.req) || e.req < 0 || e.req >= out.length) reasons.push(`SQLSTATE ${e.code} not attributed to a request`);
          else if (e.code === '40P01') reasons.push(`request ${e.req}: 40P01 deadlock`);
          else if (!BOUNDED.has(String(e.code))) reasons.push(`request ${e.req}: unexpected SQLSTATE ${e.code}`);
          else if (out[e.req].allowed || out[e.req].limitedBy !== 'unavailable') reasons.push(`request ${e.req}: bounded-wait ${e.code} but the request was not safely refused`);
        }
        out.forEach((d, i) => {
          if (d.allowed) return;
          if (d.limitedBy !== 'unavailable') reasons.push(`request ${i}: refused as ${String(d.limitedBy)}`);
          else if (d.cause === 'driver') {
            if (!coded.some((e) => e.req === i && BOUNDED.has(String(e.code)))) reasons.push(`request ${i}: "driver" refusal without a bounded-wait SQLSTATE of its own`);
          } else if (!EXPECTED.has(String(d.cause))) reasons.push(`request ${i}: unexpected cause ${String(d.cause)}`);
        });
        return { ok: reasons.length === 0, reasons };
      };
      {
        const dl: RateLimitDecision = { allowed: false, retryAfterSeconds: 1, limitedBy: 'unavailable', cause: 'deadline' };
        const drv: RateLimitDecision = { allowed: false, retryAfterSeconds: 1, limitedBy: 'unavailable', cause: 'driver' };
        const okD: RateLimitDecision = { allowed: true, retryAfterSeconds: 0 };
        const w1 = timeoutAttribution([dl, drv], [{ code: '57014', req: 0 }]);
        const prevW1 = [dl, drv].filter((d) => d.cause === 'driver').length === [{ code: '57014' }].filter((e) => BOUNDED.has(e.code)).length;
        check('I2b-1 timeout attribution (39419 witness): a 57014 on a deadline-refused request does NOT satisfy an unrelated "driver" refusal (previous count matching accepted it)', prevW1 && !w1.ok && w1.reasons.some((x) => x.includes('request 1') && x.includes('of its own')), { prevCountMatching: prevW1, reasons: w1.reasons });
        check('I2b-1 timeout attribution (synthetic): a "driver" refusal with its OWN 57014 / 55P03, plus a 57014 on another safely refused request, PASSES', timeoutAttribution([drv, drv, dl, okD], [{ code: '57014', req: 0 }, { code: '55P03', req: 1 }, { code: '57014', req: 2 }]).ok);
        check('I2b-1 timeout attribution (synthetic): 40P01 FAILS even on a refused request; an unattributed SQLSTATE FAILS; a bounded-wait code on an ADMITTED request FAILS; an unexpected SQLSTATE FAILS', !timeoutAttribution([drv], [{ code: '40P01', req: 0 }]).ok && !timeoutAttribution([drv], [{ code: '57014' }]).ok && !timeoutAttribution([okD], [{ code: '57014', req: 0 }]).ok && !timeoutAttribution([drv], [{ code: '57014', req: 0 }, { code: '23505', req: 0 }]).ok);
      }
      const shedAttr = timeoutAttribution(shedOut, shedCodes);
      const shedDriver = shedOut.filter((d) => !d.allowed && d.limitedBy === 'unavailable' && d.cause === 'driver').length;
      check('I2b-1 deadlocks regression: every shortfall is expected deadline shedding (deadline / commit_timeout / commit_late) or a "driver" refusal attributed to ITS OWN bounded-wait 57014 / 55P03', shedAttr.ok, { ...shedDiag, driver: shedDriver, attribution: shedAttr });
      check('I2b-1 deadlocks regression: no 40P01 (deadlock), every SQLSTATE attributed to a safely refused request, and 0 new deadlocks', shedAttr.ok && shedCodes.every((e) => e.code !== '40P01') && shedDelta === 0, { ...shedDiag, attribution: shedAttr });
      check('I2b-1 deadlocks regression: admitted <= counted <= admitted + ambiguous COMMITs (shedding never admits extra)', shedAdmitted <= shedCounted && shedCounted <= shedAdmitted + shedAmbiguous, { admitted: shedAdmitted, counted: shedCounted, ambiguous: shedAmbiguous });

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
