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
      //     before, after); BEST of 3 paired trials must be <= R_MAX = 8.
      //     Persistent (genuine) degradation fails every trial; a transient
      //     environmental slowdown cannot fail all three. R_MAX = 8 is ~2x the
      //     worst healthy ratio observed anywhere (4.4, CI) and well below the
      //     degradation this must catch (+10 ms / statement in the limiter:
      //     ratio ~25-60 locally). C is a performance gate only: correctness
      //     never depends on a timing ratio (A and B are timing-free).
      //  ENV. A control flood slower than 5000 ms (4x the deadline) means the
      //     environment is unusably slow: the run FAILS (never a vacuous pass).
      // Every sample is reported; there are no retries.
      const G = 480;
      const N = 2000;
      const SHARDS = 16;
      const DEADLINE = 1250;
      const R_MAX = 8;
      const ENV_MAX_MS = 5000;
      type FloodResult = { out: RateLimitDecision[]; latencies: number[]; admitted: number; by: Record<string, number>; ms: number; shardRows: Record<string, unknown>[]; shardSum: number };
      const flood = async (limiters: PostgresRateLimiter[]): Promise<FloodResult> => {
        await admin.query('TRUNCATE "McpRateLimitWindow"');
        const latencies: number[] = new Array(N).fill(0);
        const t0 = Date.now();
        const out = await Promise.all(
          Array.from({ length: N }, async (_, i) => {
            const s0 = Date.now();
            const d = await limiters[i % 3].check(buildPreAuthRules('preauth-mcp', `2001:db8:${(i % 500).toString(16)}::${i}`, { perAddress: 480, global: G, globalShards: SHARDS }, (n) => i % n));
            latencies[i] = Date.now() - s0;
            return d;
          }),
        );
        const by: Record<string, number> = {};
        for (const d of out) {
          const k = d.allowed ? 'admitted' : d.limitedBy === 'unavailable' ? `unavailable:${d.cause ?? 'none'}` : String(d.limitedBy);
          by[k] = (by[k] ?? 0) + 1;
        }
        const shardRows = await q(`SELECT "key", "count" FROM "McpRateLimitWindow" WHERE "key" LIKE 'preauth-mcp:global:%'`);
        return { out, latencies, admitted: by.admitted ?? 0, by, ms: Date.now() - t0, shardRows, shardSum: await counts('preauth-mcp:global:%') };
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
      const prodLimiters = (ms: number) => [0, 1, 2].map(() => createPostgresRateLimiter({ pool: (ms ? slowed(ms) : pool()) as never, windowMs: 60_000 }));
      // C's limiter floods: the extended decision budget AND a long pool-checkout timeout (as the control floods
      // use), so they measure throughput -- with the application's 2 s checkout timeout a slow flood would end in
      // "checkout" failures at ~2 s and cap the ratio.
      const extLimiters = (ms: number) => [0, 1, 2].map(() => createPostgresRateLimiter({ pool: (ms ? slowed(ms, { connectionTimeoutMillis: 120_000 }) : pool({ connectionTimeoutMillis: 120_000 })) as never, windowMs: 60_000, decisionDeadlineMs: 30_000, lockTimeoutMs: 5000, statementTimeoutMs: 6000 }));
      const EXPECTED = new Set(['deadline', 'commit_timeout', 'commit_late']);
      const AMBIGUOUS = new Set(['commit_timeout', 'commit_late', 'commit_lost']);
      /** Shared, timing-free accounting (A and B). */
      const accounting = (r: FloodResult) => {
        const reasons: string[] = [];
        const unexpected = r.out.filter((d) => !d.allowed && (d.limitedBy !== 'unavailable' ? d.limitedBy !== 'preauth-mcp' : !EXPECTED.has(String(d.cause ?? 'none')))).length;
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
        if (unexpected > 0) reasons.push(`${unexpected} unexpected failures`);
        if (!(r.admitted <= r.shardSum && r.shardSum <= G)) reasons.push('admitted <= counted <= G violated');
        if (r.shardSum - r.admitted > ambiguous) reasons.push('over-count not explained by ambiguous / late COMMITs');
        if (illegit429 > 0) reasons.push(`${illegit429} rate-limit refusals on shards that were not full`);
        if (shortAdmit > 0) reasons.push(`${shortAdmit} shards admitted fewer than min(30, completed)`);
        return reasons;
      };
      /** A: safety + production-deadline enforcement. */
      const checkA = (r: FloodResult) => {
        const reasons = accounting(r);
        const maxLatency = Math.max(...r.latencies);
        const lateAdmit = r.out.filter((d, i) => d.allowed && r.latencies[i] > DEADLINE + 250).length;
        if (r.latencies.length === N && maxLatency > DEADLINE + 500) reasons.push(`deadline not enforced: a decision took ${maxLatency} ms`);
        if (lateAdmit > 0) reasons.push(`${lateAdmit} admissions after the deadline`);
        if (r.admitted < 1) reasons.push('no admission at all (liveness)');
        return { ok: reasons.length === 0, reasons, maxLatencyMs: maxLatency };
      };
      /** C: performance regression -- best of 3 bracketed trials under the extended budget. */
      const checkC = async (inj: { control: number; limiter: number[] }) => {
        const trials: { controlMs: number; limiterMs: number; ratio: number; decided: number }[] = [];
        for (let t = 0; t < 3; t += 1) {
          const before = await controlFlood(inj.control);
          const m = pools.length;
          const r = await flood(extLimiters(inj.limiter[t]));
          await endSince(m);
          const after = await controlFlood(inj.control);
          const controlMs = Math.max(before, after);
          const decided = r.out.filter((d) => d.allowed || d.limitedBy === 'preauth-mcp').length;
          trials.push({ controlMs, limiterMs: r.ms, ratio: Math.round((r.ms / Math.max(1, controlMs)) * 100) / 100, decided });
        }
        const best = Math.min(...trials.map((x) => x.ratio));
        // Every trial must DECIDE all 2000 requests (admitted or 429) under the extended budget.
        return { ok: best <= R_MAX && trials.every((x) => x.decided === N), best, trials };
      };
      const envOk = (controlMs: number) => controlMs <= ENV_MAX_MS;
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
      for (let k = 1; k <= 2; k += 1) {
        const h = await scenario(`healthy #${k}`, { env: 0, prod: 0, cControl: 0, cLimiter: [0, 0, 0] });
        check(`I2b-1 healthy #${k}: environment usable, A (safety + deadline) passes, C (performance) passes`, h.row.env && h.A.ok && h.C.ok, h.row);
      }
      // 2. Shared slowdown everywhere (+2 ms per statement in controls AND limiter).
      const shared = await scenario('shared slowdown +2 ms/statement', { env: 2, prod: 2, cControl: 2, cLimiter: [2, 2, 2] });
      check('I2b-1 shared slowdown: environment usable, A passes (shedding is legitimate under load), C passes (ratio stays low when both slow)', shared.row.env && shared.A.ok && shared.C.ok, shared.row);
      // 3. THE RESIDUAL: fast controls, then a HEALTHY limiter flood under temporary environmental contention
      //    (production flood +2 ms; also one of the three C trials +3 ms).
      const residual = await scenario('residual: fast controls + healthy limiter under temporary contention', { env: 0, prod: 2, cControl: 0, cLimiter: [3, 0, 0] });
      const completed = residual.r.out.filter((d) => d.allowed || d.limitedBy === 'preauth-mcp').length;
      // What the earlier gates would have decided on this same run:
      const v1Floor = Math.min(N, Math.floor(Math.floor((N * DEADLINE) / (2.5 * Math.max(1, residual.envMs))) / 2)); // CI-01 v1: completed >= floor
      const s12Floor = G; // S12: fast sequential baseline -> admission floor saturates at G
      console.log(`  I2b-1 residual under earlier gates (informational): ${JSON.stringify({ completed, v1Floor, v1Ok: completed >= v1Floor, admitted: residual.r.admitted, s12Ok: residual.r.admitted >= s12Floor })}`);
      check('I2b-1 residual reproduced: the healthy flood under temporary contention shed decisions with fast controls (the CI-01 v1 completed-floor gate would FAIL it)', completed < v1Floor && (residual.r.by['unavailable:deadline'] ?? 0) > 0, { completed, v1Floor });
      check('I2b-1 residual corrected: A passes (shedding classified, deadline enforced, accounting exact) and C passes (best of 3 trials unaffected by one contended trial)', residual.A.ok && residual.C.ok && residual.row.env, residual.row);
      // 4. GENUINE limiter-only degradation: the LIMITER is persistently slow (+10 ms/statement in every limiter
      //    flood, ~5 s per 2000 decisions); controls are not. (+5 ms gave a best ratio as low as 10.5 locally --
      //    too close to R_MAX for CI's slower controls -- so the injected degradation is sized to stay well clear.)
      const degraded = await scenario('limiter-only degradation (+10 ms/statement in every limiter flood)', { env: 0, prod: 10, cControl: 0, cLimiter: [10, 10, 10] });
      check('I2b-1 limiter-only degradation is DETECTED: C fails (best of 3 above R_MAX), while A stays safe', !degraded.C.ok && degraded.C.best > R_MAX && accounting(degraded.r).length === 0, degraded.row);
      check('I2b-1 the residual and genuine degradation are DISTINGUISHED (residual passes C, degradation fails C)', residual.C.ok && !degraded.C.ok, { residualBest: residual.C.best, degradedBest: degraded.C.best });
      // 5. An unusably slow environment is rejected (control flood +12 ms/statement).
      const slowEnvMs = await controlFlood(12);
      check('I2b-1 an unusably slow environment FAILS (control flood above 4x the deadline)', !envOk(slowEnvMs), { slowEnvMs, ENV_MAX_MS });
      // 6. Deterministic fault injection: A must fail.
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
      const appLimiter = (p: unknown) => createPostgresRateLimiter({ pool: p as never, windowMs: 60_000 });
      mark = pools.length;
      const faulty = await flood([0, 1, 2].map(() => appLimiter(faultyPool('decide'))));
      await endSince(mark);
      const g4 = checkA(faulty);
      console.log(`  I2b-1 aggregate (injected driver faults) diagnostics: ${JSON.stringify({ outcomes: faulty.by, A: g4 })}`);
      check('I2b-1 negative control: injected pre-COMMIT driver faults are classified "driver" and FAIL A', !g4.ok && (faulty.by['unavailable:driver'] ?? 0) > 0, { outcomes: faulty.by, A: g4 });
      mark = pools.length;
      const lost = await flood([0, 1, 2].map(() => appLimiter(faultyPool('commit_lost'))));
      await endSince(mark);
      const g5 = checkA(lost);
      console.log(`  I2b-1 aggregate (post-send connection loss) diagnostics: ${JSON.stringify({ outcomes: lost.by, counted: lost.shardSum, A: g5 })}`);
      check('I2b-1 post-send driver failure: classified "commit_lost" (ambiguous accounting: counted may exceed admitted), never shedding -- it FAILS A', (lost.by['unavailable:commit_lost'] ?? 0) > 0 && !g5.ok && lost.admitted <= lost.shardSum && lost.shardSum <= G, { outcomes: lost.by, counted: lost.shardSum, A: g5 });
      mark = pools.length;
      const refused = await flood([0, 1, 2].map(() => appLimiter(faultyPool('commit_refused'))));
      await endSince(mark);
      const g6 = checkA(refused);
      console.log(`  I2b-1 aggregate (explicit COMMIT refusal) diagnostics: ${JSON.stringify({ outcomes: refused.by, counted: refused.shardSum, A: g6 })}`);
      check('I2b-1 explicit COMMIT failure (server SQLSTATE): classified "commit_failed", nothing counted for it, and it FAILS A', (refused.by['unavailable:commit_failed'] ?? 0) > 0 && !g6.ok && refused.shardSum === refused.admitted, { outcomes: refused.by, counted: refused.shardSum, A: g6 });
      // 7. Synthetic invalid outcomes.
      const synth = (d: RateLimitDecision): FloodResult => ({ out: Array.from({ length: N }, () => d), latencies: new Array(N).fill(10), admitted: d.allowed ? N : 0, by: {}, ms: 0, shardRows: [], shardSum: 0 });
      check('I2b-1 negative control: "0 admitted, 2000 unavailable (checkout)" FAILS A', !checkA(synth({ allowed: false, retryAfterSeconds: 1, limitedBy: 'unavailable', cause: 'checkout' })).ok);
      check('I2b-1 negative control: all shed by the deadline (0 admitted) FAILS A (liveness)', !checkA(synth({ allowed: false, retryAfterSeconds: 1, limitedBy: 'unavailable', cause: 'deadline' })).ok);
      const all429 = checkA(synth({ allowed: false, retryAfterSeconds: 5, limitedBy: 'preauth-mcp' }));
      check('I2b-1 negative control: a limiter that answers 429 to everything FAILS A (429 on shards that are not full, no admission)', !all429.ok && all429.reasons.some((x) => x.includes('not full')), all429.reasons);
      const slowAnswer: FloodResult = { ...synth({ allowed: true, retryAfterSeconds: 0 }), latencies: new Array(N).fill(DEADLINE + 900) };
      check('I2b-1 negative control: decisions answered long after the deadline FAIL A (deadline not enforced)', !checkA(slowAnswer).ok && checkA(slowAnswer).reasons.some((x) => x.startsWith('deadline not enforced')));
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
