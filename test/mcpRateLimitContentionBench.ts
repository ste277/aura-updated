/**
 * AURA-MCP-02-I2b-S2 (I2b-1) -- pre-auth limiter contention benchmark. NOT a
 * CI test: it measures, it does not assert. Run against a DISPOSABLE local
 * database with migration 0052 applied:
 *
 *   DATABASE_URL=postgresql://user@127.0.0.1:5432/throwaway \
 *   BASELINE_LIMITER=/path/to/main/postgresRateLimit.ts \
 *   npx ts-node test/mcpRateLimitContentionBench.ts
 *
 * BASELINE_LIMITER is the pre-S2 implementation (e.g. extracted with
 * `git show ba93d7e:packages/mcp-tools/src/security/postgresRateLimit.ts`);
 * without it only the S2 scenarios run.
 *
 * Scenarios (limits set far above the load, so every decision is admitted
 * and only contention is measured):
 *   before:addr-only baseline limiter, per-address rule only
 *   addr-only        S2 limiter, per-address rule only (the reference ceiling)
 *   before:global    baseline limiter, one global row + per-address (main)
 *   s2:global-1      S2 limiter, ONE global row + per-address (statement change only)
 *   s2:sharded       S2 limiter, 16 global shards + per-address (what ships)
 * `rtt` adds a client-side delay after every statement response, standing in
 * for a network round trip to a remote database (locks stay held through it).
 */
import { Pool } from 'pg';
import { createPostgresRateLimiter, type PgPoolLike } from '../packages/mcp-tools/src/security/postgresRateLimit';
import { buildPreAuthRules } from '../packages/mcp-tools/src/security/preAuthRules';
import type { McpRateLimiter, RateLimitRule } from '../packages/mcp-tools/src/security/rateLimit';

const url = process.env.DATABASE_URL;
if (!url || !['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) {
  console.error('DATABASE_URL must point at a disposable loopback database');
  process.exit(1);
}
const DECISIONS = Number(process.env.BENCH_DECISIONS ?? 4000);
const HUGE = 1_000_000_000;

type Factory = (pool: PgPoolLike) => McpRateLimiter;
const s2: Factory = (pool) => createPostgresRateLimiter({ pool, windowMs: 600_000 });
// eslint-disable-next-line @typescript-eslint/no-require-imports
const baseline: Factory | undefined = process.env.BASELINE_LIMITER ? (pool) => require(process.env.BASELINE_LIMITER as string).createPostgresRateLimiter({ pool, windowMs: 600_000 }) : undefined;

const addr = (i: number) => `198.51.${(i >> 8) & 255}.${i & 255}`;
const rulesFor: Record<string, (i: number) => RateLimitRule[]> = {
  'addr-only': (i) => [{ key: `preauth-mcp:addr:v4:${addr(i % 1000)}`, limit: HUGE }],
  'before:addr-only': (i) => [{ key: `preauth-mcp:addr:${addr(i % 1000)}`, limit: HUGE }],
  'before:global': (i) => [{ key: 'preauth-mcp:global', limit: HUGE }, { key: `preauth-mcp:addr:${addr(i % 1000)}`, limit: HUGE }],
  's2:global-1': (i) => buildPreAuthRules('preauth-mcp', addr(i % 1000), { perAddress: HUGE, global: HUGE, globalShards: 1 }),
  's2:sharded': (i) => buildPreAuthRules('preauth-mcp', addr(i % 1000), { perAddress: HUGE, global: HUGE, globalShards: 16 }),
};

function withRtt(pool: Pool, ms: number): PgPoolLike {
  if (ms === 0) return pool as unknown as PgPoolLike;
  const delay = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));
  return {
    query: (t: string, p?: unknown[]) => pool.query(t, p).then(delay),
    connect: async () => {
      const c = await pool.connect();
      return { query: (t: string, p?: unknown[]) => c.query(t, p).then(delay), release: (e?: unknown) => c.release(e as Error | undefined) } as never;
    },
  } as unknown as PgPoolLike;
}

async function run(name: string, factory: Factory, poolSize: number, concurrency: number, rtt: number) {
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query('TRUNCATE "McpRateLimitWindow"');
  await admin.end();
  const pool = new Pool({ connectionString: url, max: poolSize, connectionTimeoutMillis: 5000 });
  pool.on('error', () => undefined);
  const limiter = factory(withRtt(pool, rtt));
  const total = rtt > 0 ? Math.min(DECISIONS, 1500) : DECISIONS;
  // Steady state: every key the run uses already has its row (and the pool is warm).
  for (let i = 0; i < 1000; i += 50) await Promise.all(Array.from({ length: 50 }, (_, j) => limiter.check(rulesFor[name](i + j))));
  const lat: number[] = [];
  let next = 0;
  let denied = 0;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const i = next++;
        if (i >= total) return;
        const s = performance.now();
        const d = await limiter.check(rulesFor[name](i));
        lat.push(performance.now() - s);
        if (!d.allowed) denied += 1;
      }
    }),
  );
  const secs = (performance.now() - t0) / 1000;
  await pool.end();
  lat.sort((a, b) => a - b);
  const pct = (p: number) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))].toFixed(1);
  return { scenario: name, pool: poolSize, conc: concurrency, rttMs: rtt, perSec: Math.round(total / secs), p50: pct(0.5), p99: pct(0.99), denied };
}

const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];

async function main() {
  const REPEATS = Number(process.env.BENCH_REPEATS ?? 3);
  const scenarios: [string, Factory][] = [
    ...(baseline ? ([['before:addr-only', baseline], ['before:global', baseline]] as [string, Factory][]) : []),
    ['addr-only', s2],
    ['s2:global-1', s2],
    ['s2:sharded', s2],
  ];
  const configs: [number, number, number][] = [[5, 1, 0], [5, 10, 0], [5, 50, 0], [20, 50, 0], [20, 100, 0], [20, 50, 1]];
  const out: Record<string, unknown>[] = [];
  for (const [poolSize, conc, rtt] of configs) {
    const acc = new Map<string, { perSec: number[]; p50: number[]; p99: number[]; denied: number }>();
    for (let r = 0; r < REPEATS; r += 1) {
      // Rotate the order each repeat so warm-up and drift do not favour one scenario.
      const order = scenarios.map((_, i) => scenarios[(i + r) % scenarios.length]);
      for (const [name, f] of order) {
        const res = await run(name, f, poolSize, conc, rtt);
        const a = acc.get(name) ?? { perSec: [], p50: [], p99: [], denied: 0 };
        a.perSec.push(res.perSec);
        a.p50.push(Number(res.p50));
        a.p99.push(Number(res.p99));
        a.denied += res.denied;
        acc.set(name, a);
      }
    }
    const ref = median(acc.get('addr-only')?.perSec ?? [1]);
    for (const [name] of scenarios) {
      const a = acc.get(name) as { perSec: number[]; p50: number[]; p99: number[]; denied: number };
      out.push({ scenario: name, pool: poolSize, conc, rttMs: rtt, perSec: median(a.perSec), vsAddrOnly: `${Math.round((100 * median(a.perSec)) / ref)}%`, p50: median(a.p50), p99: median(a.p99), denied: a.denied });
    }
  }
  console.table(out);
  console.log(JSON.stringify(out));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
