/**
 * AURA-MCP-02-I2b-S8 -- offline regression tests for the consolidated
 * security remediation. Synthetic keys, users and clients only; no database.
 *
 *   R-3   request-origin pinning: a forged Host / X-Forwarded-* never reaches
 *         discovery, endpoint URLs, the interaction redirect or the resume URL
 *   R-6   signing-key integrity (RSA consistency, EC point, sign/verify probe,
 *         required alg) and secret strength; no value in any error message
 *   S3-3  a store outage on the interaction page answers 503, not 400
 *   S3-4  one configured client-address source for the AS and /api/mcp
 *   S3-5  bounded address parsing (no quadratic trim)
 *   S3-6  keyed address buckets (no address in limiter keys)
 *   S3-7  shard keys encode the ceiling and shard count
 *   S5    COMMIT confirmed only by its command tag; COMMIT round trip bounded
 */
import http from 'http';
import { generateKeyPairSync, randomBytes } from 'crypto';
import { ephemeralOAuthKeys, estimateSecretBits, loadOAuthKeysFromEnv, validateSigningJwks } from '../packages/mcp-tools/src/auth/keys';
import { createMemoryAdapterStore } from '../packages/mcp-tools/src/auth/memoryAdapter';
import type { OAuthStore } from '../packages/mcp-tools/src/auth/oauthStore';
import { parseIp } from '../packages/mcp-tools/src/security/clientAddress';
import { boundedStatement, commitConfirmed, StoreUnavailableError, transactionTimeouts, type BoundedPool } from '../packages/mcp-tools/src/security/deadline';
import { buildPreAuthRules, createBucketHasher, deriveBucketKey } from '../packages/mcp-tools/src/security/preAuthRules';
import { preAuthAddressSources } from '../apps/web/lib/mcpLocalOAuth';
import { CLIENT, REDIRECT, USER_A, b64, check, startCluster, summary } from './mcpOAuthI2bHarness';
import { MCP_SCOPE } from '../packages/mcp-tools/src/http/remoteMcpHandler';
import { createHash } from 'crypto';

process.on('beforeExit', () => {
  console.error('FAIL test ended before its summary');
  process.exit(1);
});

const EVIL = 'evil.attacker.example';

/** Raw HTTP with arbitrary Host / forwarded headers (fetch cannot set Host) and a cookie jar. */
function rawClient(origin: string) {
  const u = new URL(origin);
  const jar = new Map<string, string>([['aura', USER_A]]);
  return async (path: string, o: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          host: u.hostname,
          port: u.port,
          path,
          method: o.method ?? 'GET',
          headers: {
            host: `${EVIL}:4443`,
            'x-forwarded-host': `${EVIL}`,
            'x-forwarded-proto': 'https',
            'x-forwarded-port': '4443',
            forwarded: `host=${EVIL};proto=https`,
            cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
            ...(o.headers ?? {}),
          },
        },
        (res) => {
          let body = '';
          res.on('data', (d) => (body += d));
          res.on('end', () => {
            for (const sc of res.headers['set-cookie'] ?? []) {
              const [pair] = sc.split(';');
              const i = pair.indexOf('=');
              if (/expires=Thu, 01 Jan 1970/i.test(sc)) jar.delete(pair.slice(0, i));
              else jar.set(pair.slice(0, i), pair.slice(i + 1));
            }
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
          });
        },
      );
      req.on('error', reject);
      if (o.body) req.write(o.body);
      req.end();
    });
}

function jwkOf(kind: 'rsa' | 'ec', opts: Record<string, unknown> = {}): Record<string, unknown> {
  const kp = kind === 'rsa' ? generateKeyPairSync('rsa', { modulusLength: 2048, ...opts }) : generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return kp.privateKey.export({ format: 'jwk' }) as Record<string, unknown>;
}
const jwks = (...keys: Record<string, unknown>[]) => JSON.stringify({ keys });
const rejects = (f: () => unknown, mustNotContain: string[] = []): boolean => {
  try {
    f();
    return false;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return mustNotContain.every((s) => !m.includes(s));
  }
};
const strong = () => randomBytes(32).toString('base64url');

async function main() {
  // ------------------------------------------------------------------ R-6
  {
    const rsa: Record<string, unknown> = { ...jwkOf('rsa'), kid: 'rsa-ok-1', alg: 'RS256' };
    const ps = { ...jwkOf('rsa'), kid: 'rsa-ps-1', alg: 'PS256' };
    const ec: Record<string, unknown> = { ...jwkOf('ec'), kid: 'ec-ok-1', alg: 'ES256' };
    check('R-6 valid RS256, PS256 and ES256 keys are accepted', !rejects(() => validateSigningJwks(jwks(rsa, ps, ec))));
    check('R-6 ephemeral (local) keys still validate', !rejects(() => validateSigningJwks(JSON.stringify(ephemeralOAuthKeys().jwks))));
    const { alg: _alg, ...noAlg } = rsa;
    check('R-6 a key without alg is refused', rejects(() => validateSigningJwks(jwks({ ...noAlg, kid: 'no-alg-1' }))));
    check('R-6 alg that does not match kty is refused', rejects(() => validateSigningJwks(jwks({ ...rsa, alg: 'ES256' }))));
    const rnd = (v: unknown) => b64(randomBytes(Buffer.from(String(v), 'base64url').length));
    const variants: [string, Record<string, unknown>][] = [
      ['random d, dp, dq (S3 reproduction: signs tokens that do not verify)', { d: rnd(rsa.d), dp: rnd(rsa.dp), dq: rnd(rsa.dq) }],
      ['only d randomised', { d: rnd(rsa.d) }],
      ['only dp randomised', { dp: rnd(rsa.dp) }],
      ['only qi randomised', { qi: rnd(rsa.qi) }],
      ['p and q swapped with a foreign prime', { p: jwkOf('rsa').p }],
    ];
    for (const [label, patch] of variants) {
      const bad: Record<string, unknown> = { ...rsa, ...patch, kid: 'rsa-bad-1' };
      check(`R-6 inconsistent RSA key refused: ${label}`, rejects(() => validateSigningJwks(jwks(bad)), [String(bad.d), String(bad.p)]));
    }
    check('R-6 RSA public exponent other than 65537 is refused', rejects(() => validateSigningJwks(jwks({ ...jwkOf('rsa', { publicExponent: 3 }), kid: 'rsa-e3-1', alg: 'RS256' }))));
    const other = jwkOf('ec');
    check('R-6 EC key whose public point is not derived from d is refused', rejects(() => validateSigningJwks(jwks({ ...ec, x: other.x, y: other.y, kid: 'ec-bad-1' })), [String(ec.d)]));
    check('R-6 a public-only key is refused', rejects(() => validateSigningJwks(jwks({ kty: 'RSA', n: rsa.n, e: rsa.e, kid: 'pub-only-1', alg: 'RS256' }))));

    const base = { AURA_MCP_OAUTH_JWKS: jwks(rsa), AURA_MCP_OAUTH_COOKIE_KEYS: strong(), AURA_MCP_OAUTH_PAIRWISE_SALT: strong(), AURA_MCP_AUDIT_KEY: strong() };
    check('R-6 CSPRNG secrets (base64url) are accepted', !rejects(() => loadOAuthKeysFromEnv(base)));
    check('R-6 CSPRNG secrets (hex, 64 chars) are accepted', !rejects(() => loadOAuthKeysFromEnv({ ...base, AURA_MCP_AUDIT_KEY: randomBytes(32).toString('hex') })));
    const weak: [string, string][] = [
      ['32 x "a" (S3 reproduction)', 'a'.repeat(32)],
      ['32 x "b"', 'b'.repeat(32)],
      ['32 x "0"', '0'.repeat(32)],
      ['"ab" repeated', 'ab'.repeat(16)],
      ['"0123456789" repeated (periodic)', '0123456789'.repeat(4)],
      ['a short word repeated', 'secret!'.repeat(6)],
    ];
    for (const [label, v] of weak) {
      check(`R-6 weak cookie key refused: ${label}`, rejects(() => loadOAuthKeysFromEnv({ ...base, AURA_MCP_OAUTH_COOKIE_KEYS: v }), [v]));
      check(`R-6 weak audit key refused: ${label}`, rejects(() => loadOAuthKeysFromEnv({ ...base, AURA_MCP_AUDIT_KEY: v }), [v]));
    }
    check('R-6 entropy estimate: 32 x "a" is 0 bits, a 32-byte base64url secret is >= 128', estimateSecretBits('a'.repeat(32)) === 0 && estimateSecretBits(strong()) >= 128);
  }

  // ------------------------------------------------------------------ S3-5
  {
    const t0 = process.hrtime.bigint();
    const r1 = parseIp(' '.repeat(64_000));
    const r2 = parseIp(`x${' '.repeat(64_000)}x`);
    const r3 = parseIp(`1${' '.repeat(100_000)}203.0.113.9`);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    check('S3-5 long blank runs (incl. the quadratic "x"+64,000 blanks+"x", 2.9 s before) are rejected in < 20 ms', r1 === null && r2 === null && r3 === null && ms < 20, ms);
    check('S3-5 normal values with surrounding OWS still parse', parseIp('  203.0.113.9 ')?.address === '203.0.113.9' && parseIp('\t2001:DB8::1 ')?.address === '2001:db8::1');
  }

  // ------------------------------------------------------------------ S3-6 / S3-7
  {
    const key = deriveBucketKey(strong());
    const h1 = createBucketHasher(key);
    const h2 = createBucketHasher(key);
    const rules = buildPreAuthRules('preauth-mcp', '2001:db8:1:2::77', { perAddress: 120, global: 6000 }, () => 5, h1);
    check('S3-7 shard key encodes ceiling and shard count', rules[0].key === 'preauth-mcp:global:g6000n16:5' && rules[0].limit === 375, rules);
    check('S3-7 a different configuration uses a different row', buildPreAuthRules('preauth-mcp', null, { perAddress: 120, global: 480, globalShards: 4 }, () => 0)[0].key === 'preauth-mcp:global:g480n4:0');
    check('S3-6 address bucket is a keyed hash: no address text in the key', /^preauth-mcp:addr:h:[0-9a-f]{32}$/.test(rules[1].key) && !rules[1].key.includes('2001') && !rules[1].key.includes('db8'), rules[1].key);
    const same = buildPreAuthRules('preauth-mcp', '2001:db8:1:2::99', { perAddress: 120, global: 6000 }, () => 0, h2)[1].key;
    check('S3-6 instances sharing the key agree; the /64 grouping is preserved', same === rules[1].key);
    check('S3-6 different networks get different keys', buildPreAuthRules('preauth-mcp', '2001:db8:1:3::1', { perAddress: 120, global: 6000 }, () => 0, h1)[1].key !== rules[1].key);
    check('S3-6 a different key gives unrelated buckets', createBucketHasher(deriveBucketKey(strong()))('v4:203.0.113.9') !== h1('v4:203.0.113.9'));
    check('S3-6 the shared unresolved bucket stays readable', buildPreAuthRules('preauth-as', null, { perAddress: 120, global: 6000 }, () => 0, h1)[1].key === 'preauth-as:addr:unresolved');
    check('S3-6 a short bucket key is refused', rejects(() => createBucketHasher(Buffer.alloc(16))));
  }

  // ------------------------------------------------------------------ S3-4
  {
    const unset = preAuthAddressSources({});
    check('S3-4 unset: AS uses the TCP peer (local dev), /api/mcp uses none', unset.authorizationServer.kind === 'socket' && unset.mcp.kind === 'none');
    const set = preAuthAddressSources({ AURA_MCP_CLIENT_ADDRESS_SOURCE: 'header:x-vercel-forwarded-for' });
    check('S3-4 configured: the AS and /api/mcp use the SAME source', JSON.stringify(set.authorizationServer) === JSON.stringify(set.mcp) && set.mcp.kind === 'header');
    check('S3-4 an unsupported source still throws (fail closed)', rejects(() => preAuthAddressSources({ AURA_MCP_CLIENT_ADDRESS_SOURCE: 'header:x-forwarded-for' })));
  }

  // ------------------------------------------------------------------ S5 (unit, fake connection)
  {
    const fakePool = (commit: () => Promise<unknown>) => {
      const st = { releasedWithError: false, released: false };
      return {
        st,
        pool: <BoundedPool>(<unknown>{
          connect: async () => ({
            query: async (t: string) => (t === 'COMMIT' ? commit() : { rows: [{ ok: 1 }], rowCount: 1, command: t.startsWith('BEGIN') ? 'SET' : 'UPDATE' }),
            release: (err?: unknown) => {
              st.released = true;
              st.releasedWithError = !!err;
            },
          }),
        }),
      };
    };
    const opts = { deadlineMs: 500, statementTimeoutMs: 200, lockTimeoutMs: 100, commitDeadlineMs: 150 };
    const ok = fakePool(async () => ({ rows: [], rowCount: null, command: 'COMMIT' }));
    const r = await boundedStatement(ok.pool, 'UPDATE x', [], opts);
    check('S5 confirmed COMMIT resolves and returns the connection cleanly', r.rowCount === 1 && ok.st.released && !ok.st.releasedWithError);
    const rb = fakePool(async () => ({ rows: [], rowCount: null, command: 'ROLLBACK' }));
    const e1 = await boundedStatement(rb.pool, 'UPDATE x', [], opts).then(() => null, (e) => e);
    check('S5 a COMMIT answered with the ROLLBACK tag is a failure (StoreUnavailableError), connection destroyed', e1 instanceof StoreUnavailableError && rb.st.releasedWithError);
    const missing = fakePool(async () => ({ rows: [], rowCount: null }));
    const e2 = await boundedStatement(missing.pool, 'UPDATE x', [], opts).then(() => null, (e) => e);
    check('S5 a COMMIT result without a tag is not treated as confirmed', e2 instanceof StoreUnavailableError);
    const hang = fakePool(() => new Promise(() => undefined));
    const t0 = Date.now();
    const e3 = await boundedStatement(hang.pool, 'UPDATE x', [], opts).then(() => null, (e) => e);
    const waited = Date.now() - t0;
    check('S5 a COMMIT that never answers fails at the COMMIT deadline (unknown outcome -> failure), connection destroyed', e3 instanceof StoreUnavailableError && e3.reason === 'timeout' && waited < 450 && hang.st.releasedWithError, waited);
    check('S5 commitConfirmed only for the COMMIT tag', commitConfirmed({ command: 'COMMIT' }) && !commitConfirmed({ command: 'ROLLBACK' }) && !commitConfirmed(undefined));
    check('S3-8 transaction BEGIN sets idle_in_transaction_session_timeout locally', transactionTimeouts({ statementTimeoutMs: 1, lockTimeoutMs: 2, idleInTransactionTimeoutMs: 3 }).includes("SET LOCAL idle_in_transaction_session_timeout = '3ms'"));
  }

  // ------------------------------------------------------------------ R-3 origin pinning
  {
    const c = await startCluster(1);
    try {
      const raw = rawClient(c.origin);
      const disco = await raw('/.well-known/openid-configuration');
      const doc = JSON.parse(disco.body) as Record<string, unknown>;
      const urls = Object.entries(doc).filter(([, v]) => typeof v === 'string' && /^https?:\/\//.test(v)) as [string, string][];
      check('R-3 discovery with forged Host/X-Forwarded-*: issuer and every endpoint URL use the configured origin', disco.status === 200 && doc.issuer === c.origin && urls.length >= 4 && urls.every(([, v]) => v.startsWith(`${c.origin}/`) || v === c.origin), urls);
      check('R-3 discovery body never contains the forged host', !disco.body.includes(EVIL));
      const rfc = await raw('/.well-known/oauth-authorization-server');
      check('R-3 RFC 8414 metadata likewise pinned', rfc.status === 200 && !rfc.body.includes(EVIL));

      const verifier = b64(randomBytes(32));
      const challenge = b64(createHash('sha256').update(verifier).digest());
      const q = new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource: c.resource, code_challenge: challenge, code_challenge_method: 'S256', state: 's' });
      let res = await raw(`/oauth/authorize?${q}`);
      const hops: string[] = [];
      let code: string | null = null;
      for (let i = 0; i < 12 && !code; i += 1) {
        const loc = res.headers.location;
        if (loc) hops.push(loc);
        if (res.status >= 300 && res.status < 400 && loc) {
          if (loc.startsWith(REDIRECT)) {
            code = new URL(loc).searchParams.get('code');
            break;
          }
          const next = new URL(loc, c.origin);
          res = await raw(`${next.pathname}${next.search}`);
          continue;
        }
        if (res.status === 200 && /name="csrf"/.test(res.body)) {
          const csrf = /name="csrf" value="([^"]+)"/.exec(res.body)?.[1] as string;
          const action = /action="([^"]+\/confirm)"/.exec(res.body)?.[1] as string;
          res = await raw(action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: c.origin }, body: `csrf=${encodeURIComponent(csrf)}` });
          continue;
        }
        break;
      }
      check('R-3 full flow with forged origin headers on every request completes and delivers a code', !!code, { hops, status: res.status });
      check('R-3 no redirect in the flow (interaction, resume, callback) points at the forged host', hops.length >= 3 && hops.every((h) => !h.includes(EVIL)), hops);
      check('R-3 absolute redirects use the configured origin (or the registered redirect URI)', hops.filter((h) => /^https?:/.test(h)).every((h) => h.startsWith(`${c.origin}/`) || h.startsWith(REDIRECT)), hops);
    } finally {
      await c.close();
    }
  }

  // ------------------------------------------------------------------ S3-3
  {
    const base = createMemoryAdapterStore();
    const fail = { interaction: false };
    const Base = base.factory as unknown as new (name: string) => { find(id: string): Promise<unknown> };
    class Flaky extends Base {
      constructor(private readonly model: string) {
        super(model);
      }
      async find(id: string) {
        if (fail.interaction && this.model === 'Interaction') throw new StoreUnavailableError('timeout');
        return super.find(id);
      }
    }
    const store: OAuthStore = { ...base, factory: Flaky as unknown as OAuthStore['factory'] };
    const c = await startCluster(1, { adapterStore: store });
    try {
      const verifier = b64(randomBytes(32));
      const q = new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource: c.resource, code_challenge: b64(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', state: 's' });
      const first = await fetch(`${c.origin}/oauth/authorize?${q}`, { redirect: 'manual', headers: { cookie: `aura=${USER_A}` } });
      const loc = first.headers.get('location') as string;
      const cookies = first.headers.getSetCookie().map((s) => s.split(';')[0]).join('; ');
      fail.interaction = true;
      const page = await fetch(new URL(loc, c.origin), { redirect: 'manual', headers: { cookie: `aura=${USER_A}; ${cookies}` } });
      fail.interaction = false;
      check('S3-3 interaction page with the store unavailable: 503 (was 400 "Request expired"), retry-after, no Location', page.status === 503 && page.headers.get('retry-after') === '1' && !page.headers.get('location'), [page.status]);
      const again = await fetch(new URL(loc, c.origin), { redirect: 'manual', headers: { cookie: `aura=${USER_A}; ${cookies}` } });
      check('S3-3 a genuinely unknown interaction still answers 400 (unchanged)', (await fetch(`${c.origin}/oauth/interaction/unknownuid123`, { redirect: 'manual', headers: { cookie: `aura=${USER_A}` } })).status === 400 && again.status !== 503);
    } finally {
      await c.close();
    }
  }

  summary('AURA-MCP-02-I2b-S8 offline security');
}

main().catch((e) => {
  console.error('FAIL unexpected error', e instanceof Error ? e.message : e);
  process.exit(1);
});
