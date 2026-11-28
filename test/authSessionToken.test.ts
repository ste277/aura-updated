/**
 * AURA-AUTH-SESSION-01-I1 -- v2 session token, key derivation, cookie helpers
 * and SQL literal guards. No database, no network.
 *
 *   npx ts-node test/authSessionToken.test.ts
 *
 * Synthetic secrets and ids only.
 */
import { createHmac, hkdfSync, randomUUID } from 'crypto';

// lib/auth.ts resolves AUTH_SECRET at import. A synthetic test secret, set
// before the module is loaded (require, not a hoisted import).
const LEGACY_SECRET = 'test-only-auth-secret-0123456789-abcdefghij';
process.env.AUTH_SECRET = LEGACY_SECRET;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const authLib = require('../apps/web/lib/auth') as typeof import('../apps/web/lib/auth');

import {
  createSessionTokenV2,
  deriveSessionKey,
  generateSessionId,
  hashSessionId,
  sessionCookieClearList,
  sessionCookieName,
  sessionCookieOptions,
  verifySessionTokenV2,
  INSECURE_SESSION_COOKIE_NAME,
  LEGACY_SESSION_COOKIE_NAME,
  MIN_SESSION_SECRET_LENGTH,
  SECURE_SESSION_COOKIE_NAME,
  SESSION_IAT_SKEW_MS,
  SESSION_TTL_MS,
  type SessionKey,
} from '../apps/web/lib/authSessionToken';
import { sqlInteger, sqlLiteral } from '../apps/web/lib/authSessionDb';
import { SESSION_UNAVAILABLE_MESSAGE, SessionVerificationUnavailableError } from '../apps/web/lib/sessionErrors';

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail !== undefined ? ` -- ${JSON.stringify(detail)}` : ''}`);
}
function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');

const key = deriveSessionKey(LEGACY_SECRET);
const otherKey = deriveSessionKey('a-completely-different-secret-value-9876543210');
const now = Date.UTC(2026, 10, 27, 12, 0, 0);
const sid = generateSessionId();
const uid = randomUUID();
const claims = { sid, uid, iat: now, exp: now + SESSION_TTL_MS };

// --- Ids and hashing -----------------------------------------------------------
check('generateSessionId: 43 base64url characters', /^[A-Za-z0-9_-]{43}$/.test(sid));
const ids = new Set(Array.from({ length: 1000 }, generateSessionId));
check('generateSessionId: 1 000 ids are unique', ids.size === 1000);
const h = hashSessionId(sid);
check('hashSessionId: 43 base64url characters, deterministic, differs from the id', /^[A-Za-z0-9_-]{43}$/.test(h) && h === hashSessionId(sid) && h !== sid);
check('hashSessionId: rejects a malformed id', throws(() => hashSessionId('short')) && throws(() => hashSessionId(`${sid}'`)));

// --- Key derivation ----------------------------------------------------------
check('deriveSessionKey: rejects a missing or short secret', throws(() => deriveSessionKey('')) && throws(() => deriveSessionKey('x'.repeat(MIN_SESSION_SECRET_LENGTH - 1))) && throws(() => deriveSessionKey(undefined as unknown as string)));
check('deriveSessionKey: key bytes are not enumerable (never serialized or logged)', JSON.stringify(key) === '{"purpose":"aura-session-v2"}' && Object.keys(key).join(',') === 'purpose', JSON.stringify(key));
check('createSessionTokenV2: refuses a forged key object', throws(() => createSessionTokenV2({ purpose: 'aura-session-v2' } as SessionKey, claims)));
check('verifySessionTokenV2: refuses a forged key object', throws(() => verifySessionTokenV2({ purpose: 'aura-session-v2' } as SessionKey, 'a.b')));

// --- Round trip ----------------------------------------------------------------
const token = createSessionTokenV2(key, claims);
const verified = verifySessionTokenV2(key, token, now + 1000);
check('round trip: verifies and returns exactly the claims', !!verified && verified.sid === sid && verified.uid === uid && verified.iat === claims.iat && verified.exp === claims.exp, verified);
check('round trip: the token does not contain the raw secret', !token.includes(LEGACY_SECRET));

// --- Rejection: other token types signed with the same base secret -------------
// I2: the v1 issuer is removed; this is byte-for-byte what it produced (sign() over
// {userId, email, exp} with the CURRENT AUTH_SECRET) -- design §4.3 roll-forward test.
const legacySession = authLib.sign({ userId: uid, email: 'person@example.test', exp: now + SESSION_TTL_MS });
const magicLink = authLib.createMagicLinkToken('person@example.test');
const guestState = authLib.sign({ activityId: 'x', horizon: 'TODAY', timePreference: 'ANY', durationMinutes: 30, cityName: 'Chennai', candidateStart: 'a', candidateEnd: 'b', exp: now + 60000 });
const previewTok = authLib.sign({ k: 'dc-preview-item', v: 1, f: [uid, 'x'] });
const recompositionTok = authLib.sign({ k: 'rdr-proposal', v: 1, f: [uid, 'x'] });
const confused = authLib.sign({ typ: 'aura.session', v: 2, sid, uid, iat: now, exp: now + SESSION_TTL_MS });
for (const [name, t] of [
  ['v1 session token', legacySession],
  ['magic-link token', magicLink],
  ['guest-state token', guestState],
  ['Day Constructor preview token', previewTok],
  ['recomposition token', recompositionTok],
  ['a v2-shaped payload signed with the legacy key', confused],
] as const) {
  check(`rejects a ${name} signed with the same AUTH_SECRET`, verifySessionTokenV2(key, t, now + 1000) === null);
}
check('the legacy verify() rejects a v2 token', authLib.verify(token) === null);
check('I2: the v1 session API is removed from lib/auth.ts (createSessionToken / verifySessionToken / SESSION_COOKIE_NAME)', !('createSessionToken' in authLib) && !('verifySessionToken' in authLib) && !('SESSION_COOKIE_NAME' in authLib));
check('rejects a token signed with a key from a different secret', verifySessionTokenV2(otherKey, token, now + 1000) === null);

// --- Rejection: malformed and tampered -------------------------------------------
const [body, sig] = token.split('.');
const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
check('rejects a tampered signature', verifySessionTokenV2(key, `${body}.${flipped}`, now + 1000) === null);
check('rejects a tampered body (original signature, different uid)', verifySessionTokenV2(key, `${b64({ typ: 'aura.session', v: 2, sid, uid: randomUUID(), iat: now, exp: now + 1000 })}.${sig}`, now + 10) === null);
for (const [name, t] of [
  ['an empty string', ''],
  ['a non-string', 42],
  ['three segments', `${body}.${sig}.x`],
  ['one segment', body],
  ['non-base64url characters', `${body}=.${sig}`],
  ['an overlong token', `${'a'.repeat(1100)}.${sig}`],
] as const) {
  check(`rejects ${name}`, verifySessionTokenV2(key, t as unknown, now + 1000) === null);
}

// Field-level rejections: build tokens through the real signer where the claims
// are representable, and assert the verifier's own field checks for the rest.
check('rejects an expired token (now == exp)', verifySessionTokenV2(key, token, claims.exp) === null);
check('rejects an expired token (now > exp)', verifySessionTokenV2(key, token, claims.exp + 1) === null);
check('rejects iat more than 60 s in the future', verifySessionTokenV2(key, token, now - SESSION_IAT_SKEW_MS - 1) === null);
check('accepts iat within the 60 s skew', verifySessionTokenV2(key, token, now - SESSION_IAT_SKEW_MS + 1000) !== null);
check('create: refuses a malformed sid', throws(() => createSessionTokenV2(key, { ...claims, sid: 'short' })));
check('create: refuses a non-UUID uid', throws(() => createSessionTokenV2(key, { ...claims, uid: 'not-a-uuid' })));
check('create: refuses exp <= iat', throws(() => createSessionTokenV2(key, { ...claims, exp: claims.iat })));
check('create: refuses a lifetime beyond 30 days', throws(() => createSessionTokenV2(key, { ...claims, exp: claims.iat + SESSION_TTL_MS + 2 * SESSION_IAT_SKEW_MS })));
check('create: refuses non-integer times', throws(() => createSessionTokenV2(key, { ...claims, iat: 1.5 })));

// Payload-shape rules need CORRECTLY SIGNED tokens with bad payloads, which
// the public signer refuses to make. Re-derive the key independently from the
// documented HKDF parameters (which also pins those parameters).
const rawKey = Buffer.from(hkdfSync('sha256', LEGACY_SECRET, 'aura.session', 'aura-session-v2', 32));
const forge = (payload: unknown) => {
  const bd = b64(payload);
  return `${bd}.${createHmac('sha256', rawKey).update(bd).digest('base64url')}`;
};
check('HKDF parameters match the design (re-derived token verifies)', verifySessionTokenV2(key, forge({ typ: 'aura.session', v: 2, sid, uid, iat: now, exp: now + 1000 }), now + 10) !== null);
const base = { typ: 'aura.session', v: 2, sid, uid, iat: now, exp: now + 1000 };
for (const [name, payload] of [
  ['wrong typ', { ...base, typ: 'aura.magic' }],
  ['wrong version (1)', { ...base, v: 1 }],
  ['wrong version (string "2")', { ...base, v: '2' }],
  ['missing sid', { typ: base.typ, v: 2, uid, iat: now, exp: now + 1000 }],
  ['malformed sid', { ...base, sid: 'x' }],
  ['malformed uid', { ...base, uid: 'person@example.test' }],
  ['an extra field', { ...base, email: 'person@example.test' }],
  ['an array payload', [base]],
  ['string times', { ...base, iat: String(now), exp: String(now + 1000) }],
  ['exp before iat', { ...base, exp: now - 1 }],
] as const) {
  check(`rejects a correctly signed token with ${name}`, verifySessionTokenV2(key, forge(payload), now + 10) === null);
}
check('rejects a correctly signed non-JSON body', verifySessionTokenV2(key, (() => { const bd = Buffer.from('not json').toString('base64url'); return `${bd}.${createHmac('sha256', rawKey).update(bd).digest('base64url')}`; })(), now) === null);

// --- Cookies ---------------------------------------------------------------------
check('cookie name: __Host- prefix only when Secure', sessionCookieName(true) === SECURE_SESSION_COOKIE_NAME && SECURE_SESSION_COOKIE_NAME.startsWith('__Host-') && sessionCookieName(false) === INSECURE_SESSION_COOKIE_NAME);
const expiresAt = new Date(now + SESSION_TTL_MS);
const opts = sessionCookieOptions(expiresAt, true, now);
check('cookie options: HttpOnly, Secure, SameSite=Lax, Path=/, no Domain', opts.httpOnly === true && opts.secure === true && opts.sameSite === 'lax' && opts.path === '/' && !('domain' in opts), opts);
check('cookie options: Max-Age derived from expiresAt', opts.maxAge === SESSION_TTL_MS / 1000, opts.maxAge);
check('cookie options: Max-Age never exceeds 30 days', sessionCookieOptions(new Date(now + SESSION_TTL_MS * 2), true, now).maxAge === SESSION_TTL_MS / 1000);
check('cookie options: refuses an expired or invalid expiresAt', throws(() => sessionCookieOptions(new Date(now - 1), true, now)) && throws(() => sessionCookieOptions(new Date('nope'), true, now)));
const clearSecure = sessionCookieClearList(true);
check('clear (secure): __Host-as_sid, as_sid and legacy as_session, all Secure, Path=/, Max-Age=0', clearSecure.map((c) => c.name).join(',') === [SECURE_SESSION_COOKIE_NAME, INSECURE_SESSION_COOKIE_NAME, LEGACY_SESSION_COOKIE_NAME].join(',') && clearSecure.every((c) => c.options.secure && c.options.path === '/' && c.options.maxAge === 0 && !('domain' in c.options)));
const clearInsecure = sessionCookieClearList(false);
check('clear (insecure): as_sid and as_session only (a __Host- cookie cannot exist there)', clearInsecure.map((c) => c.name).join(',') === [INSECURE_SESSION_COOKIE_NAME, LEGACY_SESSION_COOKIE_NAME].join(','));
check('legacy cookie name is the v1 name, as_session (cleared only, never read)', LEGACY_SESSION_COOKIE_NAME === 'as_session');

// --- SQL literal guards ------------------------------------------------------------
check('sqlLiteral: accepts a valid idHash / userId / reason', sqlLiteral(h, 'idHash') === `'${h}'` && sqlLiteral(uid, 'userId') === `'${uid}'` && sqlLiteral('logout', 'reason') === `'logout'`);
for (const [name, v, kind] of [
  ['a quote', `${h.slice(0, 42)}'`, 'idHash'],
  ['a backslash', `${h.slice(0, 42)}\\`, 'idHash'],
  ['a NUL', `${h.slice(0, 42)}\u0000`, 'idHash'],
  ['an overlong value', `${h}A`, 'idHash'],
  ['an injection attempt', `' OR '1'='1`, 'idHash'],
  ['a non-UUID', 'x; DROP TABLE "User"', 'userId'],
  ['an unknown reason', 'logout; --', 'reason'],
  ['a non-string', 42, 'userId'],
] as const) {
  check(`sqlLiteral: rejects ${name}`, throws(() => sqlLiteral(v as unknown, kind)));
}
check('sqlInteger: bounds and integers only', sqlInteger(5, 1, 10) === '5' && throws(() => sqlInteger(0, 1, 10)) && throws(() => sqlInteger(1.5, 1, 10)) && throws(() => sqlInteger('5' as unknown, 1, 10)));

// --- Error contract ----------------------------------------------------------------
const e = new SessionVerificationUnavailableError('deadline');
check('error: fixed message, name, reason and outcome (R1); nothing else', e.message === SESSION_UNAVAILABLE_MESSAGE && e.name === 'SessionVerificationUnavailableError' && e.reason === 'deadline' && e.outcome === 'uncertain' && Object.keys(e).sort().join(',') === 'name,outcome,reason' && !JSON.stringify(e).includes('@'));
check('error: confirmed-failure reasons default to outcome failed', ['acquire', 'statement_timeout', 'lock_timeout', 'constraint'].every((r) => new SessionVerificationUnavailableError(r as 'acquire').outcome === 'failed'));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
