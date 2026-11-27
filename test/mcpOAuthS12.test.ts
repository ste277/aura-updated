/**
 * AURA-MCP-02-I2b-S12 -- offline regressions for the four S11 independent
 * review residuals (no database). Synthetic values only.
 *
 *   R-P2-1  structured authorization-redirect validation (no substring match)
 *   R-P2-2  bounded limiter causes reach the SANITIZED audit output
 *   R-P3-1  the original absolute budget instant; ROLLBACK / retry / final
 *           boundaries in the limiter; one exact-deadline comparison
 *   R-P3-2  explicit secret formats; hex-lexical exclusivity; canonical
 *           decoding and decoded lengths; material never transformed
 */
import { createHash, randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import { validateAuthorizationRedirect } from '../packages/mcp-tools/src/auth/authorizationServer';
import { assessConfiguredSecret, assessSecret, loadOAuthKeysFromEnv } from '../packages/mcp-tools/src/auth/keys';
import { sanitizeAuditEvent } from '../packages/mcp-tools/src/security/audit';
import { boundedStatement, budgetedDeadlineAt, expiredAt, heldStatement, runWithRequestBudget, setDeadlineClockForTests, StoreUnavailableError, type BoundedPool } from '../packages/mcp-tools/src/security/deadline';
import { createPostgresRateLimiter } from '../packages/mcp-tools/src/security/postgresRateLimit';
import { LIMITER_UNAVAILABLE_CAUSES } from '../packages/mcp-tools/src/security/rateLimit';
import { check, sharedKeys, summary } from './mcpOAuthI2bHarness';

const failure = (p: Promise<unknown>) => p.then(() => null, (e) => e as unknown);
let fake = 0;
const fakeClock = () => {
  fake = 5_000_000;
  setDeadlineClockForTests(() => fake);
};

/** Fake pg pool whose statements can move the fake clock and return chosen results. */
function scripted(onQuery: (text: string) => { advance?: number; result?: unknown } | void) {
  const st = { statements: [] as string[], clean: 0, destroyed: 0 };
  const pool = <BoundedPool>(<unknown>{
    connect: async () =>
      Object.assign(new EventEmitter(), {
        query: async (t: string) => {
          const head = t.split(';')[0].trim().split(/\s+/)[0];
          st.statements.push(head);
          const r = onQuery(t) ?? {};
          if (r.advance) fake += r.advance;
          return r.result ?? { rows: [], rowCount: 1, command: head === 'COMMIT' ? 'COMMIT' : head === 'BEGIN' ? 'SET' : head };
        },
        release: (err?: unknown) => {
          if (err) st.destroyed += 1;
          else st.clean += 1;
        },
      }),
  });
  return { pool, st };
}

async function main() {
  // ------------------------------------------------------------------ R-P2-1
  {
    const iss = 'https://aura.example';
    const cb = 'https://client.example/callback';
    const code = randomBytes(32).toString('base64url');
    const v = (location: string, over: Partial<{ status: number; redirectUri: string; state: string | undefined }> = {}) =>
      validateAuthorizationRedirect({ status: over.status ?? 303, location, code, redirectUri: over.redirectUri ?? cb, state: 'state' in over ? over.state : 'st-1', issuer: iss });
    const ok = `${cb}?code=${code}&state=st-1&iss=${encodeURIComponent(iss)}`;
    const cases: [string, boolean, boolean][] = [
      ['valid query-mode redirect (code, state, iss)', v(ok), true],
      ['valid with status 302', v(ok, { status: 302 }), true],
      ['valid without iss', v(`${cb}?code=${code}&state=st-1`), true],
      ['code in the PATH', v(`${cb}/${code}?code=${code}&state=st-1`), false],
      ['code in the FRAGMENT', v(`${ok}#${code}`), false],
      ['any fragment at all', v(`${ok}#x`), false],
      ['code in an UNRELATED parameter (and the code param)', v(`${ok}&x=${code}`), false],
      ['code ONLY in an unrelated parameter (same status, wrong location)', v(`${cb}?x=${code}&state=st-1`), false],
      ['DUPLICATE code parameters', v(`${cb}?code=${code}&code=${code}&state=st-1`), false],
      ['a second, different code parameter', v(`${ok}&code=other`), false],
      ['changed callback HOST', v(`https://evil.example/callback?code=${code}&state=st-1`), false],
      ['changed callback PATH', v(`https://client.example/callback2?code=${code}&state=st-1`), false],
      ['changed callback SCHEME', v(`http://client.example/callback?code=${code}&state=st-1`), false],
      ['changed STATE', v(`${cb}?code=${code}&state=st-2`), false],
      ['MISSING state when one was requested', v(`${cb}?code=${code}`), false],
      ['state present although none was requested', v(`${cb}?code=${code}&state=x`, { state: undefined }), false],
      ['no state requested, none present', v(`${cb}?code=${code}`, { state: undefined }), true],
      ['wrong iss', v(`${cb}?code=${code}&state=st-1&iss=https%3A%2F%2Fevil.example`), false],
      ['an unexpected extra parameter', v(`${ok}&extra=1`), false],
      ['userinfo in the URL', v(`https://u:p@client.example/callback?code=${code}&state=st-1`), false],
      ['status 200', v(ok, { status: 200 }), false],
      ['status 307', v(ok, { status: 307 }), false],
      ['relative location', v(`/callback?code=${code}&state=st-1`), false],
    ];
    for (const [label, got, want] of cases) check(`R-P2-1 ${want ? 'accepted' : 'refused'}: ${label}`, got === want, { got });
    const reg = 'https://client.example/cb?tenant=a&mode=x';
    check('R-P2-1 registered callback query parameters are PRESERVED (accepted when intact)', validateAuthorizationRedirect({ status: 303, location: `https://client.example/cb?tenant=a&mode=x&code=${code}&state=s`, code, redirectUri: reg, state: 's', issuer: iss }));
    check('R-P2-1 a registered parameter that was dropped or changed is refused', !validateAuthorizationRedirect({ status: 303, location: `https://client.example/cb?tenant=b&mode=x&code=${code}&state=s`, code, redirectUri: reg, state: 's', issuer: iss }) && !validateAuthorizationRedirect({ status: 303, location: `https://client.example/cb?mode=x&code=${code}&state=s`, code, redirectUri: reg, state: 's', issuer: iss }));
  }

  // ------------------------------------------------------------------ R-P3-1
  try {
    fakeClock();
    {
      // The review's probe: 50 ms decision budget, +100 ms on ROLLBACK -> a normal "user" refusal before S12.
      const p = scripted((t) => {
        if (t.startsWith('WITH want')) return { result: { rows: [{ key: 'user:x', cnt: 9, retry: 5, ok: false, bumped: 0 }], rowCount: 1 } };
        if (t === 'ROLLBACK') return { advance: 100 };
        return undefined;
      });
      const d = await createPostgresRateLimiter({ pool: p.pool as never, windowMs: 60_000, decisionDeadlineMs: 50, lockTimeoutMs: 100, statementTimeoutMs: 50 }).check([{ key: 'user:x', limit: 5 }]);
      check('R-P3-1 review probe: a ROLLBACK acknowledged after the 50 ms deadline is NOT reported as a timely 429 -> unavailable/deadline, no COMMIT', !d.allowed && d.limitedBy === 'unavailable' && d.cause === 'deadline' && !p.st.statements.includes('COMMIT'), { d, st: p.st.statements });
    }
    {
      // Missing-row ROLLBACK that crosses the deadline: no further attempt (no second BEGIN).
      const p = scripted((t) => {
        if (t.startsWith('WITH want')) return { result: { rows: [], rowCount: 0 } };
        if (t === 'ROLLBACK') return { advance: 100 };
        return undefined;
      });
      const d = await createPostgresRateLimiter({ pool: p.pool as never, windowMs: 60_000, decisionDeadlineMs: 50, lockTimeoutMs: 100, statementTimeoutMs: 50 }).check([{ key: 'user:x', limit: 5 }]);
      const begins = p.st.statements.filter((s) => s === 'BEGIN').length;
      check('R-P3-1 a missing-row ROLLBACK past the deadline does not start another attempt (1 BEGIN), -> deadline', !d.allowed && d.cause === 'deadline' && begins === 1, { d, begins });
    }
    {
      // Exactly AT the deadline counts as expired everywhere (one comparison: now >= instant).
      check('R-P3-1 expiredAt: the deadline instant itself is expired; one tick before is not', expiredAt(100, 100) && !expiredAt(100, 99.999));
      const atPool = scripted((t) => (t === 'COMMIT' ? { advance: 300 } : undefined)); // ack lands exactly at deadlineMs 300
      const e = await failure(boundedStatement(atPool.pool, 'UPDATE x', [], { deadlineMs: 300, statementTimeoutMs: 100, lockTimeoutMs: 50 }));
      check('R-P3-1 store: a COMMIT acknowledged EXACTLY at the deadline is a failure (outcome unknown), never a success', e instanceof StoreUnavailableError, String(e));
      const h = await heldStatement(scripted((t) => (t === 'COMMIT' ? { advance: 200 } : undefined)).pool, 'UPDATE x', [], { deadlineMs: 300, statementTimeoutMs: 100, lockTimeoutMs: 50, holdMs: 1000 });
      check('R-P3-1 held: a COMMIT acknowledged EXACTLY at its bound -> unknown', (await h.commit(200)) === 'unknown');
      const lp = scripted((t) => {
        if (t.startsWith('WITH want')) return { result: { rows: [{ key: 'user:x', cnt: 0, retry: 5, ok: true, bumped: 1 }], rowCount: 1 } };
        if (t === 'COMMIT') return { advance: 50 };
        return undefined;
      });
      const d = await createPostgresRateLimiter({ pool: lp.pool as never, windowMs: 60_000, decisionDeadlineMs: 50, lockTimeoutMs: 100, statementTimeoutMs: 50 }).check([{ key: 'user:x', limit: 5 }]);
      check('R-P3-1 limiter: a COMMIT confirmed EXACTLY at the deadline -> commit_late (counted, not admitted)', !d.allowed && d.cause === 'commit_late', d);
    }
    {
      // The ORIGINAL budget instant is used, even if the clock moves between reads.
      const instant = await runWithRequestBudget(100, async () => {
        const start = fake;
        fake += 60;
        return { got: budgetedDeadlineAt(3000), want: start + 100 };
      });
      check('R-P3-1 the store deadline is the request budget\'s ORIGINAL instant (not now + a remaining-time sample)', instant.got === instant.want, instant);
      let reads = 0;
      setDeadlineClockForTests(() => fake + (reads += 1) * 30); // every clock read is 30 ms later (gaps between reads)
      const drift = await runWithRequestBudget(100, async () => {
        const first = budgetedDeadlineAt(3000);
        const second = budgetedDeadlineAt(3000);
        return { first, second };
      });
      check('R-P3-1 gaps between clock reads cannot stretch the budget: the instant is stable across reads', drift.first === drift.second, drift);
      setDeadlineClockForTests(() => fake);
    }
  } finally {
    setDeadlineClockForTests(null);
  }

  // ------------------------------------------------------------------ R-P3-2
  {
    // The review's overlap: 35 characters of only 8 lower-case hex symbols (invalid hex, canonical base64url).
    // Deterministic, NON-periodic sequence over 8 symbols (an LCG), like the review's synthetic value.
    let seed = 7;
    // 34 symbols from the generator's high bits, then 'c' (its 2 low bits are 0, so 35 chars stay canonical base64url).
    const overlap = Array.from({ length: 34 }, () => 'abcdef01'[((seed = (seed * 1103515245 + 12345) % 2147483648) >>> 16) % 8]).join('') + 'c';
    const untagged = assessSecret(overlap);
    check('R-P3-2 the overlap value is canonical base64url (the ambiguity is real) and not periodic', Buffer.from(overlap, 'base64url').toString('base64url') === overlap && new Set(overlap).size === 8, overlap);
    check('R-P3-2 the untagged hex-lexical overlap value gets NO base64url credit (legacy text rule) and is refused', untagged.format === 'text' && !untagged.ok && untagged.reason !== 'repeated_block', untagged);
    const declared = assessConfiguredSecret(`base64url:${overlap}`);
    check('R-P3-2 even DECLARED as base64url, 8 distinct symbols over 35 characters is refused (low variety for that alphabet)', !declared.ok && declared.reason !== undefined, declared);
    const hex16 = randomBytes(16).toString('hex');
    const b24 = randomBytes(24).toString('base64');
    const u32 = randomBytes(32).toString('base64url');
    const t1 = assessConfiguredSecret(`hex:${hex16}`);
    const t2 = assessConfiguredSecret(`base64:${b24}`);
    const t3 = assessConfiguredSecret(`base64url:${u32}`);
    check('R-P3-2 declared canonical values: decoded lengths 16 / 24 / 32 bytes = 128 / 192 / 256 bits', t1.ok && t1.bits === 128 && t2.ok && t2.bits === 192 && t3.ok && t3.bits === 256, [t1, t2, t3]);
    const nonCanon: [string, string][] = [
      ['hex: odd length', `hex:${hex16}a`],
      ['hex: mixed case', `hex:${hex16.slice(0, 28)}ABcd`],
      ['base64: missing padding', `base64:${randomBytes(23).toString('base64').replace(/=+$/, '')}`],
      ['base64: url alphabet', `base64:${u32.replace(/[A-Za-z0-9]/, '-')}`],
      ['base64url: padded', `base64url:${randomBytes(23).toString('base64url')}=`],
      ['base64url: impossible length (4n+1)', `base64url:${randomBytes(24).toString('base64url')}A`],
    ];
    for (const [label, raw] of nonCanon) check(`R-P3-2 refused as not canonical: ${label}`, assessConfiguredSecret(raw).reason === 'not_canonical', assessConfiguredSecret(raw));
    const pad = randomBytes(32).toString('base64');
    const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const i = alpha.indexOf(pad[pad.length - 2]);
    const badPad = `base64:${pad.slice(0, -2)}${alpha[(i & ~3) | ((i + 1) & 3)]}=`;
    check('R-P3-2 refused as not canonical: base64 with non-canonical pad bits', assessConfiguredSecret(badPad).reason === 'not_canonical');
    check('R-P3-2 declared but only 15 decoded bytes (120 bits) is refused', assessConfiguredSecret(`hex:${randomBytes(15).toString('hex')}`).reason === 'weak');

    const jwks = JSON.stringify(sharedKeys().jwks);
    const tagged = () => `base64url:${randomBytes(32).toString('base64url')}`;
    const env = (o: Record<string, string>) => ({ AURA_MCP_OAUTH_JWKS: jwks, AURA_MCP_OAUTH_COOKIE_KEYS: tagged(), AURA_MCP_OAUTH_PAIRWISE_SALT: tagged(), AURA_MCP_AUDIT_KEY: tagged(), ...o });
    const throws = (o: Record<string, string>) => {
      try {
        loadOAuthKeysFromEnv(env(o));
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    };
    const legacy = randomBytes(32).toString('base64url');
    for (const role of ['AURA_MCP_OAUTH_COOKIE_KEYS', 'AURA_MCP_OAUTH_PAIRWISE_SALT', 'AURA_MCP_AUDIT_KEY']) {
      const m = throws({ [role]: legacy });
      check(`R-P3-2 new configuration must declare its format: an untagged ${role} is refused (value not echoed)`, !!m && /declare the format/.test(m) && !m.includes(legacy), m);
    }
    const cur = tagged();
    const keys = loadOAuthKeysFromEnv(env({ AURA_MCP_OAUTH_COOKIE_KEYS: `${cur},${legacy}` }));
    check('R-P3-2 compatibility path: an untagged RETAINED cookie key is accepted (legacy rule)', keys.cookieKeys.length === 2);
    check('R-P3-2 no secret material is transformed: the loader returns every value byte for byte (tag included)', keys.cookieKeys[0] === cur && keys.cookieKeys[1] === legacy);
    const weakRetained = throws({ AURA_MCP_OAUTH_COOKIE_KEYS: `${cur},${'a'.repeat(32)}` });
    check('R-P3-2 a weak untagged RETAINED key is still refused by the legacy rule', !!weakRetained && /too predictable/.test(weakRetained), weakRetained);
    const overlapRetained = throws({ AURA_MCP_OAUTH_COOKIE_KEYS: `${cur},${overlap}` });
    check('R-P3-2 the review\'s overlap value as a retained key is refused (no format credit)', !!overlapRetained, overlapRetained);
    for (const [label, gen] of [
      ['hex: 16 B', () => `hex:${randomBytes(16).toString('hex')}`],
      ['hex: 32 B upper', () => `hex:${randomBytes(32).toString('hex').toUpperCase()}`],
      ['base64: 16 B', () => `base64:${randomBytes(16).toString('base64')}`],
      ['base64: 32 B', () => `base64:${randomBytes(32).toString('base64')}`],
      ['base64url: 16 B', () => `base64url:${randomBytes(16).toString('base64url')}`],
      ['base64url: 32 B', () => `base64url:${randomBytes(32).toString('base64url')}`],
    ] as [string, () => string][]) {
      let refused = 0;
      for (let k = 0; k < 10_000; k += 1) if (!assessConfiguredSecret(gen()).ok) refused += 1;
      check(`R-P3-2 declared ${label}: 10,000 CSPRNG samples all accepted`, refused === 0, refused);
    }
  }

  // ------------------------------------------------------------------ R-P2-2 (sanitizer)
  {
    for (const cause of LIMITER_UNAVAILABLE_CAUSES) {
      const out = sanitizeAuditEvent({ event: 'mcp.request', outcome: 'limiter_unavailable', limitedBy: 'unavailable', cause });
      check(`R-P2-2 audit sanitizer keeps the bounded cause "${cause}"`, out.cause === cause);
    }
    const raw = sanitizeAuditEvent({ event: 'oauth.throttled', outcome: 'limiter_unavailable', limitedBy: 'unavailable', cause: 'error: password authentication failed for user "aura"' });
    check('R-P2-2 a raw error string in the cause field is DROPPED (never logged)', raw.cause === undefined && !JSON.stringify(raw).includes('password'), raw);
  }

  // ------------------------------------------------------------------ S12 review P3 §4.1 correction
  {
    const HEX = '0123456789abcdefABCDEF';
    const NONHEX_URL = 'GHIJKLMNOPQRSTUVWXYZghijklmnopqrstuvwxyz-_';
    const pick = (alpha: string) => alpha[randomBytes(1)[0] % alpha.length];
    // The two reported cases (and the base64url variant): refused, with the right reason.
    let r1 = 0;
    let r2 = 0;
    let r3 = 0;
    for (let k = 0; k < 2000; k += 1) {
      if (assessConfiguredSecret(`base64:${randomBytes(12).toString('hex')}`).reason === 'ambiguous_encoding') r1 += 1;
      if (assessConfiguredSecret(`base64url:${randomBytes(16).toString('hex')}`).reason === 'ambiguous_encoding') r2 += 1;
      if (!assessSecret(Array.from(randomBytes(32), (b) => 'ghijGHIJ'[b % 8]).join('')).ok) r3 += 1;
    }
    check('P3-corr reported case 1: "base64:" + openssl rand -hex 12 -> refused (ambiguous_encoding) 2000/2000', r1 === 2000, r1);
    check('P3-corr variant: "base64url:" + openssl rand -hex 16 -> refused (ambiguous_encoding) 2000/2000', r2 === 2000, r2);
    check('P3-corr reported case 2: untagged 32 chars of "ghijGHIJ" (retained-key path) -> refused 2000/2000', r3 === 2000, r3);
    // Near-hex (a few characters edited) and padded forms are refused too.
    const nearHexUrl = `base64url:${Array.from({ length: 21 }, () => pick(HEX)).join('')}g`; // 22 chars; 'g' keeps it canonical
    check('P3-corr near-hex: 21 hex chars + 1 non-hex under "base64url:" -> ambiguous_encoding', assessConfiguredSecret(nearHexUrl).reason === 'ambiguous_encoding', assessConfiguredSecret(nearHexUrl));
    const paddedAllHex = `base64:${Array.from({ length: 21 }, () => pick(HEX)).join('')}A==`; // canonical 16-byte base64 made of hex-alphabet chars
    check('P3-corr a PADDED canonical base64 body made only of hex-alphabet chars -> ambiguous_encoding (padding ignored)', Buffer.from(paddedAllHex.slice(7), 'base64').toString('base64') === paddedAllHex.slice(7) && assessConfiguredSecret(paddedAllHex).reason === 'ambiguous_encoding', paddedAllHex);
    const untaggedNear = `${randomBytes(16).toString('hex').slice(0, 31)}g`;
    check('P3-corr untagged near-hex (31 hex + "g"): no base64 credit (legacy rule) and refused', assessSecret(untaggedNear).format === 'text' && !assessSecret(untaggedNear).ok, assessSecret(untaggedNear));
    check('P3-corr "hex:" with a hex body is unaffected (accepted, 128 bits)', assessConfiguredSecret(`hex:${randomBytes(16).toString('hex')}`).bits === 128 && assessConfiguredSecret(`hex:${randomBytes(16).toString('hex')}`).ok);
    // Exact boundary of the hex-heavy test (P(X >= k | n, 22/64) <= 1e-8), for a 43-char base64url body.
    const lnC = (n: number, j: number) => { let r = 0; for (let i = 1; i <= j; i += 1) r += Math.log(n - j + i) - Math.log(i); return r; };
    const tail = (n: number, k: number) => { let t = 0; for (let j = k; j <= n; j += 1) t += Math.exp(lnC(n, j) + j * Math.log(22 / 64) + (n - j) * Math.log(42 / 64)); return t; };
    const n = 43;
    let thr = 0;
    while (tail(n, thr) > 1e-8) thr += 1;
    const build = (hexCount: number) => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const chars = [...Array.from({ length: hexCount }, () => pick(HEX)), ...Array.from({ length: n - 1 - hexCount }, () => pick(NONHEX_URL))];
        for (let i = chars.length - 1; i > 0; i -= 1) {
          const j = randomBytes(1)[0] % (i + 1);
          [chars[i], chars[j]] = [chars[j], chars[i]];
        }
        const v = `${chars.join('')}w`; // 'w' (index 48) keeps 43 chars canonical; not hex
        const a = assessConfiguredSecret(`base64url:${v}`);
        if (a.reason !== 'run' && a.reason !== 'skewed' && a.reason !== 'low_variety') return a;
      }
      return null;
    };
    const below = build(thr - 1);
    const at = build(thr);
    check(`P3-corr boundary (n=43): ${thr - 1} hex-alphabet chars accepted, ${thr} refused as ambiguous_encoding`, !!below && below.ok === true && !!at && at.reason === 'ambiguous_encoding', { thr, below, at });
    // Legitimate secrets: no false refusals from the new checks (AURA-MCP-CI-01).
    // Samples come from a FIXED seed, so the same 10,000 values are used on
    // every run, and each verdict is checked against the documented policy:
    // an untagged hex value with no a-f letter (probability ~2.9e-7 per
    // 16-byte sample) is judged as legacy text and refused BY POLICY, so
    // "never refused" was not a valid assertion for fresh CSPRNG draws.
    const seeded = (tag: string, i: number, len: number) => {
      let out = Buffer.alloc(0);
      for (let b = 0; out.length < len; b += 1) out = Buffer.concat([out, createHash('sha256').update(`aura-ci01-s12:${tag}:${i}:${b}`).digest()]);
      return out.subarray(0, len);
    };
    const always = () => true;
    // Untagged hex policy: hex credit needs >= 1 a-f letter; a digits-only value
    // is legacy text judged by the S8 rule, which ALWAYS refuses 32 digits
    // (at most 32 * log2(10) ~= 106 bits < 128). Only 16-byte hex is sampled here.
    const hexPolicy = (v: string) => /[a-f]/i.test(v);
    for (const [label, gen, f, expectOk] of [
      ['declared base64: 16 B', (i) => `base64:${seeded('db64-16', i, 16).toString('base64')}`, assessConfiguredSecret, always],
      ['declared base64url: 16 B', (i) => `base64url:${seeded('db64u-16', i, 16).toString('base64url')}`, assessConfiguredSecret, always],
      ['declared base64url: 32 B', (i) => `base64url:${seeded('db64u-32', i, 32).toString('base64url')}`, assessConfiguredSecret, always],
      ['untagged retained base64url 32 B', (i) => seeded('b64u-32', i, 32).toString('base64url'), assessSecret, always],
      ['untagged retained base64 24 B', (i) => seeded('b64-24', i, 24).toString('base64'), assessSecret, always],
      ['untagged retained hex 16 B', (i) => seeded('hex16', i, 16).toString('hex'), assessSecret, hexPolicy],
    ] as [string, (i: number) => string, (v: string) => { ok: boolean }, (v: string) => boolean][]) {
      let mismatches = 0;
      let byPolicy = 0;
      for (let k = 0; k < 10_000; k += 1) {
        const v = gen(k);
        const want = expectOk(v);
        if (!want) byPolicy += 1;
        if (f(v).ok !== want) mismatches += 1;
      }
      check(`P3-corr no false refusal: ${label} (10,000 fixed-seed samples; verdicts match policy; ${byPolicy} refused by policy)`, mismatches === 0, { mismatches, byPolicy });
    }
    // Reproduction (CI-01): a digits-only untagged hex value, as a fresh CSPRNG
    // draw occasionally yields, is refused by policy, so the previous
    // "refused === 0 over random samples" assertion failed on it by chance.
    const digitsOnly = '64976964540383724985906370631171';
    check('P3-corr CI-01 reproduction: digits-only untagged hex is refused by policy (the old random-sample assertion fails on it)', assessSecret(digitsOnly).ok === false);
    check('P3-corr CI-01: the same value declared "hex:" is accepted', assessConfiguredSecret(`hex:${digitsOnly}`).ok === true);
    // Loader: refusals never echo the value; a legitimate retained key passes unchanged.
    const jwks = JSON.stringify(sharedKeys().jwks);
    const tagged = () => `base64url:${randomBytes(32).toString('base64url')}`;
    const env = (o: Record<string, string>) => ({ AURA_MCP_OAUTH_JWKS: jwks, AURA_MCP_OAUTH_COOKIE_KEYS: tagged(), AURA_MCP_OAUTH_PAIRWISE_SALT: tagged(), AURA_MCP_AUDIT_KEY: tagged(), ...o });
    const msg = (o: Record<string, string>) => {
      try {
        loadOAuthKeysFromEnv(env(o));
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    };
    const hexUnderB64 = `base64:${randomBytes(12).toString('hex')}`;
    const m1 = msg({ AURA_MCP_AUDIT_KEY: hexUnderB64 });
    check('P3-corr loader: hex under "base64:" refused, advises "hex:", value not echoed', !!m1 && /declare it as "hex:"/.test(m1) && !m1.includes(hexUnderB64.slice(7)), m1);
    const lowVar = Array.from(randomBytes(32), (b) => 'ghijGHIJ'[b % 8]).join('');
    const cur = tagged();
    const m2 = msg({ AURA_MCP_OAUTH_COOKIE_KEYS: `${cur},${lowVar}` });
    check('P3-corr loader: low-variety untagged RETAINED key refused, value not echoed', !!m2 && !m2.includes(lowVar), m2);
    const legacy = randomBytes(32).toString('base64url');
    const kept = loadOAuthKeysFromEnv(env({ AURA_MCP_OAUTH_COOKIE_KEYS: `${cur},${legacy}` }));
    check('P3-corr loader: a legitimate untagged retained key is accepted and returned byte for byte', kept.cookieKeys[1] === legacy && kept.cookieKeys[0] === cur);
  }

  summary('AURA-MCP-02-I2b-S12 offline');
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : 'error');
  process.exit(1);
});
