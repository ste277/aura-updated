// AUTH-SESSION-01 local overhead benchmark (throwaway loopback cluster).
// Not an Aura migration: creates bench-only tables in a scratch database.
const { Pool } = require('pg');
const crypto = require('crypto');

// Disposable loopback database only; supplied by the operator, never committed.
const URL = process.env.BENCH_DATABASE_URL || '';
if (!URL || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new globalThis.URL(URL).hostname)) {
  console.error('Set BENCH_DATABASE_URL to a disposable loopback database.');
  process.exit(1);
}
const N_USERS = 10000, N_SESS = 100000, ITER = 4000;

function pct(a, p) { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
function fmt(a) { return `p50 ${pct(a, 0.5).toFixed(3)} ms  p95 ${pct(a, 0.95).toFixed(3)} ms  p99 ${pct(a, 0.99).toFixed(3)} ms`; }
const now = () => Number(process.hrtime.bigint()) / 1e6;

async function setup(pool) {
  await pool.query(`DROP TABLE IF EXISTS "AuthSession"; DROP TABLE IF EXISTS "User";`);
  const cols = Array.from({ length: 22 }, (_, i) => `c${i} TEXT DEFAULT 'value-${i}-xxxxxxxxxxxxxxxx'`).join(',');
  await pool.query(`CREATE TABLE "User" (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, latitude FLOAT8 DEFAULT 13.08, longitude FLOAT8 DEFAULT 80.27, "createdAt" TIMESTAMPTZ(3) DEFAULT now(), ${cols})`);
  await pool.query(`CREATE TABLE "AuthSession" ("idHash" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(), "expiresAt" TIMESTAMPTZ(3) NOT NULL, "revokedAt" TIMESTAMPTZ(3), "revokeReason" TEXT)`);
  await pool.query(`CREATE INDEX ON "AuthSession"("userId") WHERE "revokedAt" IS NULL; CREATE INDEX ON "AuthSession"("expiresAt");`);
  await pool.query(`INSERT INTO "User"(id,email) SELECT gen_random_uuid()::text, 'u'||g||'@example.test' FROM generate_series(1,${N_USERS}) g`);
  await pool.query(`INSERT INTO "AuthSession"("idHash","userId","expiresAt","revokedAt")
    SELECT encode(sha256(convert_to('s'||g,'UTF8')),'base64'), (SELECT id FROM "User" OFFSET (g % ${N_USERS}) LIMIT 1),
           now() + interval '30 days', CASE WHEN g % 5 = 0 THEN now() ELSE NULL END
    FROM generate_series(1,${N_SESS}) g`);
  await pool.query('ANALYZE');
}

async function main() {
  const pool = new Pool({ connectionString: URL }); // pg defaults, same as lib/db.ts (max 10)
  await setup(pool);
  const sess = (await pool.query(`SELECT "idHash","userId" FROM "AuthSession" WHERE "revokedAt" IS NULL LIMIT 2000`)).rows;
  const pick = (i) => sess[i % sess.length];

  const qUser = `SELECT * FROM "User" WHERE id = $1`;
  const qSess = `SELECT "userId" FROM "AuthSession" WHERE "idHash"=$1 AND "userId"=$2 AND "revokedAt" IS NULL AND "expiresAt" > now()`;
  const qJoin = `SELECT u.* FROM "AuthSession" s JOIN "User" u ON u.id = s."userId" WHERE s."idHash"=$1 AND s."userId"=$2 AND s."revokedAt" IS NULL AND s."expiresAt" > now()`;

  for (let i = 0; i < 500; i++) { const s = pick(i); await pool.query(qSess, [s.idHash, s.userId]); await pool.query(qUser, [s.userId]); } // warm

  const res = {};
  for (const [name, fn] of [
    ['A getUserById only (today)', (s) => pool.query(qUser, [s.userId])],
    ['B session lookup only', (s) => pool.query(qSess, [s.idHash, s.userId])],
    ['C session lookup + getUserById (2 round trips)', async (s) => { await pool.query(qSess, [s.idHash, s.userId]); await pool.query(qUser, [s.userId]); }],
    ['D joined session+user (1 round trip)', (s) => pool.query(qJoin, [s.idHash, s.userId])],
  ]) {
    const t = [];
    for (let i = 0; i < ITER; i++) { const s = pick(i); const a = now(); await fn(s); t.push(now() - a); }
    res[name] = t; console.log(name.padEnd(48), fmt(t));
  }

  // Plan check
  const plan = (await pool.query(`EXPLAIN (ANALYZE, BUFFERS) ${qSess.replace('$1', `'${sess[0].idHash}'`).replace('$2', `'${sess[0].userId}'`)}`)).rows.map((r) => r['QUERY PLAN']);
  // Literal ids in the plan are synthetic, but are redacted from the output anyway.
  console.log('\nPLAN B:\n  ' + plan.join('\n  ').replace(/'[^']*'::text/g, "'<redacted>'::text"));

  // Concurrency / pool: 50 concurrent "requests", pool max 10.
  for (const conc of [10, 50]) {
    for (const [name, fn] of [
      ['today (1 query)', (s) => pool.query(qUser, [s.userId])],
      ['naive (2 queries)', async (s) => { await pool.query(qSess, [s.idHash, s.userId]); await pool.query(qUser, [s.userId]); }],
      ['joined (1 query)', (s) => pool.query(qJoin, [s.idHash, s.userId])],
    ]) {
      const lat = []; let i = 0; const start = now();
      await Promise.all(Array.from({ length: conc }, async () => { while (i < ITER) { const s = pick(i++); const a = now(); await fn(s); lat.push(now() - a); } }));
      const wall = now() - start;
      console.log(`conc=${String(conc).padEnd(3)} ${name.padEnd(18)} ${fmt(lat)}  throughput ${(ITER / wall * 1000).toFixed(0)} req/s  waiting=${pool.waitingCount}`);
    }
  }

  // CPU cost of token primitives
  const key = crypto.createHmac('sha256', 'x'.repeat(48)).update('aura-session-v2').digest();
  const body = Buffer.from(JSON.stringify({ typ: 'aura.session', v: 2, sid: crypto.randomBytes(32).toString('base64url'), uid: crypto.randomUUID(), iat: Date.now(), exp: Date.now() + 1e9 })).toString('base64url');
  const sig = crypto.createHmac('sha256', key).update(body).digest('base64url');
  let a = now(); for (let i = 0; i < 100000; i++) { const e = crypto.createHmac('sha256', key).update(body).digest('base64url'); crypto.timingSafeEqual(Buffer.from(e), Buffer.from(sig)); JSON.parse(Buffer.from(body, 'base64url').toString()); crypto.createHash('sha256').update('sid').digest('base64url'); }
  console.log(`\nverify+parse+sha256 per token: ${((now() - a) / 100000 * 1000).toFixed(2)} µs`);
  a = now(); for (let i = 0; i < 100000; i++) crypto.randomBytes(32); console.log(`randomBytes(32): ${((now() - a) / 100000 * 1000).toFixed(2)} µs`);

  // Cleanup statement cost (bounded batch)
  a = now(); const del = await pool.query(`DELETE FROM "AuthSession" WHERE ctid IN (SELECT ctid FROM "AuthSession" WHERE "revokedAt" < now() + interval '1 minute' LIMIT 5000)`);
  console.log(`cleanup batch: ${del.rowCount} rows in ${(now() - a).toFixed(1)} ms`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
