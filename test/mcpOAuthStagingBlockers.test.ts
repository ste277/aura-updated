/**
 * AURA-MCP-02-I2b-S2 -- offline tests for the three staging-blocker fixes
 * (no database; synthetic users/clients; 127.0.0.1 only):
 *   I2b-R-3  canonical IPv4/IPv6 parsing, /32 and /64 bucketing, unresolved
 *            addresses -> one bounded shared bucket (never global-only),
 *            spoofed/forwarding headers ignored, audit without values;
 *   I2b-1    global-ceiling sharding: shard limits sum to EXACTLY the
 *            ceiling, random shard choice, aggregate never exceeded;
 *   I2b-R-2  deadline/single-flight helpers; the Postgres limiter against
 *            fake pools (hung checkout, hung query, rejected query, late
 *            connection) -> deny "unavailable" within the deadline and the
 *            connection destroyed; 503 (not 429) for infrastructure failures
 *            on the authorization server and /api/mcp; an unavailable store
 *            never yields a code or token.
 * The real-database counterparts are in mcpOAuthStagingBlockersDb.test.ts.
 */
import { isIP } from 'net';
import { randomBytes, randomInt } from 'crypto';
import {
  fetchAddressRequest,
  formatIpv6,
  nodeAddressRequest,
  normalizeIp,
  parseClientAddressSource,
  parseIp,
  rateLimitAddressKey,
  resolveClientAddress,
  resolveClientAddressDetailed,
  UNRESOLVED_ADDRESS_KEY,
} from '../packages/mcp-tools/src/security/clientAddress';
import { buildPreAuthRules, defaultGlobalShards, globalShardLimits } from '../packages/mcp-tools/src/security/preAuthRules';
import { isStoreUnavailableError, singleFlight, StoreUnavailableError, withDeadline } from '../packages/mcp-tools/src/security/deadline';
import { createPostgresRateLimiter, type PgPoolLike } from '../packages/mcp-tools/src/security/postgresRateLimit';
import { createPostgresAdapterStore } from '../packages/mcp-tools/src/auth/postgresAdapter';
import { createMemoryAdapterStore } from '../packages/mcp-tools/src/auth/memoryAdapter';
import type { OAuthStore } from '../packages/mcp-tools/src/auth/oauthStore';
import { createFixedWindowRateLimiter, type McpRateLimiter } from '../packages/mcp-tools/src/security/rateLimit';
import { handleRemoteMcpRequest } from '../packages/mcp-tools/src/http/remoteMcpHandler';
import type { McpAuditEvent } from '../packages/mcp-tools/src/security/audit';
import { Browser, CLIENT, USER_A, authorize, check, connect, redeemCode, sharedKeys, sleep, startCluster, summary } from './mcpOAuthI2bHarness';

const fails = (fn: () => unknown) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

// A test that stops early (a promise that never settles) must fail, not exit 0.
process.on('beforeExit', () => {
  console.error('FAIL test ended before its summary');
  process.exit(1);
});

async function main() {
  // ------------------------------------------------------------ I2b-R-3: canonical parser
  {
    const equivalent: [string, string][] = [
      ['2001:db8::1', '2001:db8::1'],
      ['2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
      ['2001:DB8:0:0:0:0:0:1', '2001:db8::1'],
      ['2001:db8:0::0:1', '2001:db8::1'],
      ['2001:db8:0:0:1:0:0:1', '2001:db8::1:0:0:1'], // first of two equal runs
      ['2001:db8:0:1:1:1:1:1', '2001:db8:0:1:1:1:1:1'], // single zero group not compressed
      ['::', '::'],
      ['::1', '::1'],
      ['0:0:0:0:0:0:0:1', '::1'],
      ['1::', '1::'],
      ['fe80::1', 'fe80::1'],
      ['64:ff9b::192.0.2.33', '64:ff9b::c000:221'],
      [' 2001:db8::1\t', '2001:db8::1'],
    ];
    const bad = equivalent.filter(([i, o]) => normalizeIp(i) !== o);
    check('R-3 parser: IPv6 spellings give the RFC 5952 canonical form', bad.length === 0, bad.map(([i]) => [i, normalizeIp(i)]));
    const mapped = ['203.0.113.9', '::ffff:203.0.113.9', '::FFFF:203.0.113.9', '::ffff:cb00:7109', '0:0:0:0:0:ffff:cb00:7109', '0000:0000:0000:0000:0000:ffff:203.0.113.9'];
    check('R-3 parser: both IPv4-mapped forms normalise to the IPv4 address', mapped.every((m) => normalizeIp(m) === '203.0.113.9'), mapped.map(normalizeIp));
    check('R-3 parser: IPv4-mapped forms share the IPv4 /32 bucket', new Set(mapped.map(rateLimitAddressKey)).size === 1 && rateLimitAddressKey('::ffff:cb00:7109') === 'v4:203.0.113.9');
    const rejected = [
      'fe80::1%eth0', 'fe80::1%25eth0', '[2001:db8::1]', '[2001:db8::1]:443', '203.0.113.9:443', '2001:db8::1/64', '203.0.113.9, 198.51.100.1',
      '203.0.113.9\r\nx-evil: 1', '2001:db8::1\n', '1.2.3.04', '01.2.3.4', '256.1.1.1', '1.2.3', '1.2.3.4.5', '1:2:3:4:5:6:7:8:9', '1::2::3', ':::', '1:2:3:4:5:6:7::8:9',
      'g::1', '12345::1', '', ' ', 'localhost', 'not-an-ip', '2001:db8::1 2001:db8::2', `${'1:'.repeat(30)}1`, '::ffff:1.2.3.4.5', '1.2.3.4::', '::1.2.3.4:5',
      'a'.repeat(46), '0x7f.0.0.1', '127.1',
    ];
    const accepted = rejected.filter((r) => normalizeIp(r) !== null);
    check('R-3 parser: zone ids, brackets, ports, prefixes, lists, CR/LF, garbage and over-long values rejected', accepted.length === 0, accepted);
    // Agreement with Node for every value we accept, and canonical round trip (fuzz).
    let disagreements = 0;
    let roundTrip = 0;
    for (let i = 0; i < 2000; i += 1) {
      const h = Array.from({ length: 8 }, () => (randomInt(3) === 0 ? 0 : randomInt(0x10000)));
      const canon = formatIpv6(h);
      const long = h.map((x) => x.toString(16).padStart(4, '0').toUpperCase()).join(':');
      const parsed = parseIp(long);
      const mappedForm = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff;
      if (!mappedForm && (parsed?.address !== canon || normalizeIp(canon) !== canon)) roundTrip += 1;
      if (isIP(canon) !== 6) disagreements += 1;
    }
    check('R-3 parser fuzz: 2000 random addresses -- uncompressed and canonical spellings agree, Node accepts every canonical form', roundTrip === 0 && disagreements === 0, { roundTrip, disagreements });
  }

  // ------------------------------------------------------------ I2b-R-3: /64 and /32 bucketing
  {
    const inSlash64 = Array.from({ length: 1000 }, () => `2001:db8:1:2:${randomBytes(8).toString('hex').match(/.{4}/g)?.join(':')}`);
    check('R-3 buckets: 1,000 addresses in one /64 share one key', new Set(inSlash64.map(rateLimitAddressKey)).size === 1 && rateLimitAddressKey(inSlash64[0]) === 'v6:2001:db8:1:2::/64');
    check('R-3 buckets: a different /64 has its own key', rateLimitAddressKey('2001:db8:1:3::1') === 'v6:2001:db8:1:3::/64');
    check('R-3 buckets: IPv4 is per /32', rateLimitAddressKey('203.0.113.9') === 'v4:203.0.113.9' && rateLimitAddressKey('203.0.113.10') === 'v4:203.0.113.10');
    check('R-3 buckets: invalid / empty input -> the shared unresolved bucket, never a new one',
      [null, undefined, '', 'fe80::1%eth0', 'garbage', '1.2.3.4:80'].every((v) => rateLimitAddressKey(v as string) === UNRESOLVED_ADDRESS_KEY));
    check('R-3 buckets: equivalent spellings of one IPv6 address give one key', new Set(['2001:db8:1:2::5', '2001:0DB8:0001:0002:0000:0000:0000:0005', '2001:db8:1:2:0:0:0:5'].map(rateLimitAddressKey)).size === 1);
  }

  // ------------------------------------------------------------ I2b-R-3: resolution, spoofing, reasons
  {
    const hdr = (h: Record<string, string>) => fetchAddressRequest({ headers: new Headers(h) });
    const real = parseClientAddressSource('header:x-real-ip');
    const vercel = parseClientAddressSource('header:x-vercel-forwarded-for');
    const r = (h: Record<string, string>, s = real) => resolveClientAddressDetailed(hdr(h), s);
    check('R-3 resolve: trusted header canonicalised', resolveClientAddress(hdr({ 'x-real-ip': '2001:0DB8::0001' }), real) === '2001:db8::1');
    check('R-3 resolve: reasons are fixed codes (missing / list / invalid / repeated / no_source)',
      JSON.stringify([
        r({}),
        r({ 'x-real-ip': '198.51.100.1, 203.0.113.9' }),
        r({ 'x-real-ip': 'fe80::1%eth0' }),
        resolveClientAddressDetailed(nodeAddressRequest({ headers: { 'x-real-ip': ['1.2.3.4', '5.6.7.8'] } }), real),
        resolveClientAddressDetailed(hdr({ 'x-real-ip': '1.2.3.4' }), { kind: 'none' }),
      ]) ===
        JSON.stringify([
          { kind: 'unresolved', reason: 'missing' },
          { kind: 'unresolved', reason: 'list' },
          { kind: 'unresolved', reason: 'invalid' },
          { kind: 'unresolved', reason: 'repeated' },
          { kind: 'unresolved', reason: 'no_source' },
        ]),
    );
    const spoof = { 'x-forwarded-for': '198.51.100.7', forwarded: 'for=198.51.100.7', 'cf-connecting-ip': '198.51.100.7', 'true-client-ip': '198.51.100.7', 'x-client-ip': '198.51.100.7' };
    check('R-3 resolve: forwarding headers other than the configured one are never read',
      r(spoof).kind === 'unresolved' && r(spoof, vercel).kind === 'unresolved' && resolveClientAddress(hdr({ ...spoof, 'x-real-ip': '203.0.113.9' }), real) === '203.0.113.9');
    check('R-3 resolve: configuring X-Forwarded-For / Forwarded / cf-connecting-ip is still refused', ['header:x-forwarded-for', 'header:forwarded', 'header:cf-connecting-ip'].every((s) => fails(() => parseClientAddressSource(s))));
  }

  // ------------------------------------------------------------ I2b-1: shard arithmetic and aggregate bound
  {
    let worst = 0;
    for (let g = 1; g <= 3000; g += 1) {
      const n = defaultGlobalShards(g);
      const lim = globalShardLimits(g, n);
      if (lim.reduce((a, b) => a + b, 0) !== g || lim.some((x) => x < 1)) worst += 1;
      for (const k of [1, 2, 3, 7, 16, 64]) {
        if (k > g) continue;
        if (globalShardLimits(g, k).reduce((a, b) => a + b, 0) !== g) worst += 1;
      }
    }
    check('I2b-1 shards: for every ceiling 1..3000 and shard count, shard limits sum to EXACTLY the ceiling (never more)', worst === 0, worst);
    check('I2b-1 shards: default 6000 -> 16 shards of 375; small ceilings stay one exact row', JSON.stringify(globalShardLimits(6000, defaultGlobalShards(6000))) === JSON.stringify(new Array(16).fill(375)) && defaultGlobalShards(12) === 1 && defaultGlobalShards(150) === 1);
    check('I2b-1 shards: invalid shard counts refused (0, > ceiling, > 64, non-integer)', [[10, 0], [10, 11], [10_000, 65], [10, 1.5]].every(([g, n]) => fails(() => globalShardLimits(g, n))));
    const rules = buildPreAuthRules('preauth-mcp', '2001:db8:1:2::77', { perAddress: 120, global: 6000 }, () => 5);
    check('I2b-1 rules: one global shard + the /64 address bucket', JSON.stringify(rules) === JSON.stringify([{ key: 'preauth-mcp:global:g6000n16:5', limit: 375 }, { key: 'preauth-mcp:addr:v6:2001:db8:1:2::/64', limit: 120 }]), rules);
    const unresolved = buildPreAuthRules('preauth-as', null, { perAddress: 120, global: 6000 });
    check('I2b-1 rules: no address -> shared unresolved bucket with the per-address limit (never global-only)', unresolved.length === 2 && unresolved[1].key === 'preauth-as:addr:unresolved' && unresolved[1].limit === 120);
    const seen = new Map<string, number>();
    for (let i = 0; i < 16_000; i += 1) {
      const k = buildPreAuthRules('preauth-mcp', '203.0.113.9', { perAddress: 120, global: 6000 })[0].key;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    check('I2b-1 rules: shard choice is random and covers every shard, independent of the address', seen.size === 16 && Math.min(...seen.values()) > 800, Object.fromEntries(seen));
    check('I2b-1 rules: invalid limits refused (global < perAddress, non-integer, bad picker)',
      fails(() => buildPreAuthRules('preauth-mcp', null, { perAddress: 10, global: 5 })) && fails(() => buildPreAuthRules('preauth-mcp', null, { perAddress: 1.5, global: 5 })) && fails(() => buildPreAuthRules('preauth-mcp', null, { perAddress: 1, global: 500 }, () => 99)));
    // Aggregate under saturation, with an exact (in-memory) limiter: 40,000 requests from 4,000 /64s.
    const lim = createFixedWindowRateLimiter({ windowMs: 60_000, maxKeys: 100_000 });
    let admitted = 0;
    for (let i = 0; i < 40_000; i += 1) if (lim.check(buildPreAuthRules('preauth-mcp', `2001:db8:${(i % 4000).toString(16)}::1`, { perAddress: 120, global: 6000 })).allowed) admitted += 1;
    check('I2b-1 aggregate: 40,000 requests from 4,000 networks -> exactly the 6000 ceiling admitted, not one more', admitted === 6000, admitted);
  }

  // ------------------------------------------------------------ I2b-R-2: helpers
  {
    const t0 = Date.now();
    const hung = await withDeadline(new Promise(() => undefined), 100).then(() => 'resolved', (e) => e);
    check('R-2 withDeadline: a hung operation rejects with StoreUnavailableError(timeout) at the deadline', isStoreUnavailableError(hung) && (hung as StoreUnavailableError).reason === 'timeout' && Date.now() - t0 < 400);
    const driver = await withDeadline(Promise.reject(Object.assign(new Error('password authentication failed for user "x" at 10.0.0.1'), { code: '28P01' })), 1000).then(() => null, (e) => e);
    check('R-2 withDeadline: driver errors become a generic StoreUnavailableError (no driver message, 503, not exposed)',
      isStoreUnavailableError(driver) && !String(driver.message).includes('password') && driver.statusCode === 503 && driver.expose === false);
    let running = 0;
    let maxRunning = 0;
    let runs = 0;
    const task = singleFlight(async () => {
      running += 1;
      runs += 1;
      maxRunning = Math.max(maxRunning, running);
      await sleep(50);
      running -= 1;
    });
    await Promise.all(Array.from({ length: 20 }, () => task()));
    await task();
    check('R-2 singleFlight: 20 overlapping cleanups -> one in flight, the rest skipped; runs again once idle', maxRunning === 1 && runs === 2, { maxRunning, runs });
  }

  // ------------------------------------------------------------ I2b-R-2: Postgres limiter against fake pools
  {
    type Released = { err: unknown };
    const fakePool = (behaviour: { connect?: 'hang' | 'late' | 'ok'; query?: (text: string) => Promise<unknown> }) => {
      const released: Released[] = [];
      const queries: string[] = [];
      const client = {
        query: (text: string) => {
          queries.push(text.trim().split(/\s+/)[0]);
          return (behaviour.query ? behaviour.query(text) : Promise.resolve({ rows: [], rowCount: 0 })) as Promise<{ rows: never[]; rowCount: number }>;
        },
        release: (err?: unknown) => {
          released.push({ err });
        },
      };
      const pool: PgPoolLike = {
        query: () => Promise.resolve({ rows: [], rowCount: 0 }),
        connect: () =>
          behaviour.connect === 'hang' ? new Promise(() => undefined) : behaviour.connect === 'late' ? sleep(300).then(() => client) : Promise.resolve(client),
      };
      return { pool, released, queries };
    };
    const rules = [{ key: 'preauth-mcp:global:0', limit: 10 }, { key: 'preauth-mcp:addr:v4:203.0.113.9', limit: 5 }];

    const a = fakePool({ connect: 'hang' });
    let t0 = Date.now();
    const d1 = await createPostgresRateLimiter({ pool: a.pool, windowMs: 60_000, decisionDeadlineMs: 150 }).check(rules);
    check('R-2 limiter: exhausted/hung pool checkout -> deny "unavailable" at the deadline', !d1.allowed && d1.limitedBy === 'unavailable' && Date.now() - t0 < 500, [d1, Date.now() - t0]);

    const b = fakePool({ connect: 'late' });
    const d2 = await createPostgresRateLimiter({ pool: b.pool, windowMs: 60_000, decisionDeadlineMs: 100 }).check(rules);
    await sleep(400);
    check('R-2 limiter: a connection that arrives after the deadline is returned unused and clean (no query, no transaction)',
      !d2.allowed && d2.limitedBy === 'unavailable' && b.queries.length === 0 && b.released.length === 1 && b.released[0].err === undefined);

    const c = fakePool({ query: (text) => (text.startsWith('BEGIN') ? Promise.resolve({ rows: [], rowCount: 0 }) : new Promise(() => undefined)) });
    t0 = Date.now();
    const d3 = await createPostgresRateLimiter({ pool: c.pool, windowMs: 60_000, decisionDeadlineMs: 150 }).check(rules);
    check('R-2 limiter: a hung statement -> deny at the deadline and the connection is destroyed (never returned mid-transaction)',
      !d3.allowed && d3.limitedBy === 'unavailable' && Date.now() - t0 < 500 && c.released.length === 1 && c.released[0].err instanceof Error);
    check('R-2 limiter: transaction-local lock and statement timeouts are set in the BEGIN message', c.queries[0] === 'BEGIN;');

    const e = fakePool({ query: (text) => (text.startsWith('BEGIN') ? Promise.resolve({ rows: [], rowCount: 0 }) : Promise.reject(new Error('canceling statement due to lock timeout'))) });
    const d4 = await createPostgresRateLimiter({ pool: e.pool, windowMs: 60_000 }).check(rules);
    check('R-2 limiter: a server-side timeout error -> deny "unavailable", connection destroyed', !d4.allowed && d4.limitedBy === 'unavailable' && e.released.length === 1 && e.released[0].err instanceof Error);

    check('R-2 limiter: invalid timeout options refused', fails(() => createPostgresRateLimiter({ pool: a.pool, windowMs: 60_000, lockTimeoutMs: 0 })) && fails(() => createPostgresRateLimiter({ pool: a.pool, windowMs: 60_000, decisionDeadlineMs: 1.5 })));

    // Store: every query bounded; failures are StoreUnavailableError, never "not found".
    const hungDb = { query: () => new Promise<never>(() => undefined) };
    const store = createPostgresAdapterStore({ db: hungDb, fieldKeys: sharedKeys().cookieKeys, queryDeadlineMs: 150 });
    const Code = new store.factory('AuthorizationCode');
    t0 = Date.now();
    const found = await Code.find('synthetic-code').then(() => 'found-or-missing', (err) => err);
    check('R-2 store: a hung query -> StoreUnavailableError at the deadline (not "not found")', isStoreUnavailableError(found) && Date.now() - t0 < 500);
    check('R-2 store: upsert / consume / revoke / list all fail closed the same way',
      (await Promise.all([Code.upsert('x', { accountId: USER_A } as never, 60), Code.consume('x'), store.revokeUserClientGrants(USER_A, CLIENT), store.listUserGrants(USER_A)].map((p) => p.then(() => false, isStoreUnavailableError)))).every(Boolean));
    let cleanupCalls = 0;
    const slowCleanupDb = {
      query: (text: string) => {
        if (text.startsWith('DELETE')) {
          cleanupCalls += 1;
          return sleep(200).then(() => ({ rows: [], rowCount: 0 }));
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      },
    };
    const store2 = createPostgresAdapterStore({ db: slowCleanupDb, fieldKeys: sharedKeys().cookieKeys, cleanupEvery: 1 });
    const S = new store2.factory('Session');
    await Promise.all(Array.from({ length: 30 }, (_, i) => S.upsert(`s${i}`, { accountId: USER_A } as never, 60)));
    check('R-2 store: opportunistic cleanup is single-flight (30 writes, cleanup every write -> 1 DELETE in flight)', cleanupCalls === 1, cleanupCalls);
  }

  // ------------------------------------------------------------ 429 vs 503 on /api/mcp
  {
    const config = { resourceUrl: 'http://127.0.0.1:3999/api/mcp', authorizationServer: 'http://127.0.0.1:3999' };
    const audits: McpAuditEvent[] = [];
    const unavailableLimiter: McpRateLimiter = { check: async () => ({ allowed: false, retryAfterSeconds: 1, limitedBy: 'unavailable' }) };
    const okVerifier = async () => ({ userId: USER_A, clientId: CLIENT, scopes: ['aura.planning.read'] });
    const req = () => new Request(config.resourceUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-token' }, body: '{}' });
    const pre = await handleRemoteMcpRequest(req(), { config, verifyAccessToken: okVerifier, preAuthRateLimiter: unavailableLimiter, clientAddress: '203.0.113.9', audit: (e) => audits.push(e) });
    check('503 MCP: pre-auth limiter unavailable -> 503 temporarily_unavailable + Retry-After (not 429)', pre.status === 503 && pre.headers.get('retry-after') === '1' && (await pre.json()).error === 'temporarily_unavailable');
    const post = await handleRemoteMcpRequest(req(), { config, verifyAccessToken: okVerifier, rateLimiter: unavailableLimiter });
    check('503 MCP: post-auth limiter unavailable -> 503', post.status === 503);
    const storeDown = await handleRemoteMcpRequest(req(), { config, verifyAccessToken: async () => { throw new StoreUnavailableError('timeout'); } });
    check('503 MCP: token store unavailable during verification -> 503 (not 401, never a pass)', storeDown.status === 503);
    const otherErr = await handleRemoteMcpRequest(req(), { config, verifyAccessToken: async () => { throw new Error('bug'); } });
    check('MCP: any other verifier error is still a 401 rejection', otherErr.status === 401);
    const capacity: McpRateLimiter = { check: async () => ({ allowed: false, retryAfterSeconds: 7, limitedBy: 'capacity' }) };
    const cap = await handleRemoteMcpRequest(req(), { config, verifyAccessToken: okVerifier, preAuthRateLimiter: capacity, clientAddress: '203.0.113.9' });
    check('429 MCP: a real limit (incl. in-memory capacity) stays 429 with its Retry-After', cap.status === 429 && cap.headers.get('retry-after') === '7');
    check('audit: 503 outcomes recorded as limiter_unavailable / store_unavailable', audits.some((e) => e.outcome === 'limiter_unavailable' && e.status === 503));

    // Unresolved addresses: one bounded shared bucket; malformed values audited without the value.
    const lim = createFixedWindowRateLimiter({ windowMs: 60_000 });
    const call = (clientAddress: string | null, clientAddressProblem?: 'missing' | 'invalid' | 'list' | 'repeated' | 'no_source') =>
      handleRemoteMcpRequest(req(), { config, verifyAccessToken: async () => null, preAuthRateLimiter: lim, clientAddress, clientAddressProblem, preAuthLimits: { perAddress: 3, global: 1000 }, audit: (e) => audits.push(e) }).then((r) => r.status);
    const statuses: number[] = [];
    for (const v of ['fe80::1%eth0', 'garbage', null, '[::1]:80', '203.0.113.9:443']) statuses.push(await call(v, v === null ? 'missing' : undefined));
    check('R-3 MCP: malformed / missing addresses share ONE bucket (3 allowed, then 429), never global-only', JSON.stringify(statuses) === '[401,401,401,429,429]', statuses);
    const unresolvedAudits = audits.filter((e) => e.event === 'mcp.address_unresolved');
    check('R-3 MCP: unresolved addresses audited with a reason code only (no address value in any event)',
      unresolvedAudits.length === 5 && unresolvedAudits.every((e) => ['invalid', 'missing'].includes(String(e.errorCode))) && !JSON.stringify(audits).includes('fe80') && !JSON.stringify(audits).includes('garbage'));
    const rot: number[] = [];
    for (let i = 0; i < 6; i += 1) rot.push(await call(`2001:db8:aa:bb:${randomBytes(2).toString('hex')}::${i + 1}`));
    const other = await call('2001:db8:aa:bc::1');
    check('R-3 MCP: rotating addresses inside one /64 shares one budget; the neighbouring /64 is independent', JSON.stringify(rot) === '[401,401,401,429,429,429]' && other === 401, [rot, other]);
  }

  // ------------------------------------------------------------ 503 on the authorization server; nothing issued
  {
    const audits: McpAuditEvent[] = [];
    const unavailableLimiter: McpRateLimiter = { check: async () => ({ allowed: false, retryAfterSeconds: 1, limitedBy: 'unavailable' }) };
    const c1 = await startCluster(1, { audit: (e) => audits.push(e), preAuth: { limiter: unavailableLimiter, addressSource: { kind: 'socket' } } });
    try {
      const r = await fetch(`${c1.origin}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=authorization_code&code=x' });
      check('503 AS: pre-auth limiter unavailable -> 503 temporarily_unavailable + Retry-After', r.status === 503 && r.headers.get('retry-after') === '1' && (await r.text()) === '{"error":"temporarily_unavailable"}');
      check('audit AS: limiter_unavailable recorded', audits.some((e) => e.event === 'oauth.throttled' && e.outcome === 'limiter_unavailable'));
    } finally {
      await c1.close();
    }

    // Header mode without the header: shared bucket + audit; never global-only.
    const lim = createFixedWindowRateLimiter({ windowMs: 60_000 });
    const c2 = await startCluster(1, { audit: (e) => audits.push(e), preAuth: { limiter: lim, addressSource: parseClientAddressSource('header:x-real-ip'), perAddress: 2, global: 1000 } });
    try {
      const st: number[] = [];
      for (const h of [{}, { 'x-real-ip': 'garbage' }, { 'x-forwarded-for': '198.51.100.1' }, { 'x-real-ip': '203.0.113.9' }] as Record<string, string>[]) st.push((await fetch(`${c2.origin}/oauth/jwks`, { headers: h })).status);
      check('R-3 AS: missing / invalid / XFF-only requests share the bounded unresolved bucket; a valid address has its own', JSON.stringify(st) === '[200,200,429,200]', st);
      check('R-3 AS: oauth.address_unresolved audited with reason codes', audits.filter((e) => e.event === 'oauth.address_unresolved').map((e) => e.errorCode).join(',') === 'missing,invalid,missing');
    } finally {
      await c2.close();
    }

    // The store becomes unavailable mid-flow: no code, no token.
    const mode = { down: false };
    const mem = createMemoryAdapterStore();
    class FlakyAdapter {
      private readonly inner: InstanceType<OAuthStore['factory']>;
      constructor(name: string) {
        this.inner = new mem.factory(name);
      }
      private gate() {
        if (mode.down) throw new StoreUnavailableError('timeout');
      }
      async upsert(...a: Parameters<InstanceType<OAuthStore['factory']>['upsert']>) { this.gate(); return this.inner.upsert(...a); }
      async find(id: string) { this.gate(); return this.inner.find(id); }
      async findByUid(uid: string) { this.gate(); return this.inner.findByUid(uid); }
      async findByUserCode(code: string) { this.gate(); return this.inner.findByUserCode(code); }
      async consume(id: string) { this.gate(); return this.inner.consume(id); }
      async destroy(id: string) { this.gate(); return this.inner.destroy(id); }
      async revokeByGrantId(id: string) { this.gate(); return this.inner.revokeByGrantId(id); }
    }
    const flaky: OAuthStore = { ...mem, factory: FlakyAdapter as unknown as OAuthStore['factory'] };
    const c3 = await startCluster(2, { audit: (e) => audits.push(e), adapterStore: flaky, keys: sharedKeys() });
    try {
      mode.down = true;
      const b = new Browser(c3.origin, USER_A);
      const out = await authorize(c3, b, { consent: true });
      check('R-2 AS: store unavailable during authorization -> no code issued (503 / error, never a code)', !out.code && (out.stoppedStatus === 503 || !!out.error), out);
      mode.down = false;
      const ok = await authorize(c3, new Browser(c3.origin, USER_A), { consent: true });
      mode.down = true;
      const tok = ok.code ? await redeemCode(c3, ok.code, ok.verifier) : undefined;
      check('R-2 AS: store unavailable at the token endpoint -> 503, no access or refresh token', tok?.status === 503 && !tok.json.access_token && !tok.json.refresh_token, tok);
      const verified = await c3.instances[0].verifyAccessToken('synthetic-token', c3.resource).then(() => 'returned', (e) => (isStoreUnavailableError(e) ? 'unavailable' : 'other'));
      check('R-2 AS: token verification with the store down throws StoreUnavailableError (mapped to 503 by /api/mcp)', verified === 'unavailable', verified);
      mode.down = false;
      const recovered = await connect(c3, USER_A);
      check('R-2 AS: recovery -- once the store answers again, the full flow issues a token', recovered.token?.status === 200 && !!recovered.token.json.access_token);
      check('audit AS: store_unavailable recorded, no token_issued while down', audits.some((e) => e.outcome === 'store_unavailable') && audits.filter((e) => e.event === 'oauth.token_issued').length === 1);
    } finally {
      await c3.close();
    }
  }

  summary('AURA-MCP-02-I2b-S2 staging-blocker offline');
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : 'error');
  process.exit(1);
});
