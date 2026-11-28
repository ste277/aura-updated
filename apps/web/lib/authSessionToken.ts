/**
 * AURA-AUTH-SESSION-01-I1 -- v2 session token and cookie primitives
 * (AURA_AUTH_SESSION_01_REVOCATION_DESIGN.md §2.2, §5).
 *
 *   payload = { typ: "aura.session", v: 2, sid, uid, iat, exp }
 *   token   = base64url(JSON(payload)) "." base64url(HMAC-SHA256(K_session, body))
 *   K_session = HKDF-SHA256(ikm = secret, salt = "aura.session", info = "aura-session-v2", 32 bytes)
 *
 * The token only NAMES a session. It is valid only while the matching
 * "AuthSession" row exists, is not revoked and has not expired -- that check
 * is lib/authSessionStore.ts, not this module.
 *
 * DORMANT AND ISOLATED:
 *   - Nothing in the application imports this module yet
 *     (test/authSessionDormancy.test.ts). The existing as_session cookie and
 *     lib/auth.ts tokens are unchanged.
 *   - This module reads no environment variable and does no work at import.
 *     The key exists only when a caller passes a secret to deriveSessionKey().
 *   - The key is domain-separated from AUTH_SECRET's direct use by lib/auth.ts
 *     sign()/verify(), so no existing token (v1 session, magic link, guest
 *     state, preview or recomposition token) verifies here, and a v2 token
 *     does not verify under the legacy verify().
 */
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'crypto';

export const SESSION_TOKEN_TYPE = 'aura.session';
export const SESSION_TOKEN_VERSION = 2;
export const SESSION_TTL_DAYS = 30;
/** The fixed lifetime is 720 ELAPSED hours from creation (R1), never calendar days. */
export const SESSION_TTL_HOURS = SESSION_TTL_DAYS * 24;
export const SESSION_TTL_MS = SESSION_TTL_HOURS * 60 * 60 * 1000;
/** Tolerated forward clock skew for `iat`. */
export const SESSION_IAT_SKEW_MS = 60 * 1000;
export const MIN_SESSION_SECRET_LENGTH = 32;
/** Longest token accepted for parsing (a real token is ~260 characters). */
export const MAX_SESSION_TOKEN_LENGTH = 1024;

/** A session id: 32 random bytes, base64url without padding (43 characters). */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** "AuthSession"."idHash": base64url SHA-256, also 43 characters (enforced by a CHECK in 0055). */
export const SESSION_ID_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** "User".id values are UUIDs (Prisma @default(uuid())). */
export const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KEY_SALT = 'aura.session';
const KEY_INFO = 'aura-session-v2';
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const PAYLOAD_KEYS = ['exp', 'iat', 'sid', 'typ', 'uid', 'v'];

const sessionKeys = new WeakSet<object>();

/** An opaque derived key. Only deriveSessionKey() can produce one. */
export interface SessionKey {
  readonly purpose: 'aura-session-v2';
}

interface SessionKeyInternal extends SessionKey {
  readonly bytes: Buffer;
}

export interface SessionTokenClaims {
  sid: string;
  uid: string;
  /** Issued-at, epoch milliseconds. */
  iat: number;
  /** Expiry, epoch milliseconds -- copied from the row's database-set expiresAt. */
  exp: number;
}

/**
 * HKDF-SHA256 subkey for v2 session tokens. Throws on a missing or short
 * secret, so a weak key can never be produced silently.
 */
export function deriveSessionKey(secret: string): SessionKey {
  if (typeof secret !== 'string' || secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new TypeError(`The session secret must be at least ${MIN_SESSION_SECRET_LENGTH} characters.`);
  }
  const bytes = Buffer.from(hkdfSync('sha256', secret, KEY_SALT, KEY_INFO, 32));
  // Non-enumerable: the key bytes never appear in JSON.stringify, console.log
  // or object spread.
  const key = Object.defineProperty({ purpose: KEY_INFO }, 'bytes', { value: bytes, enumerable: false }) as SessionKeyInternal;
  Object.freeze(key);
  sessionKeys.add(key);
  return key;
}

function keyBytes(key: SessionKey): Buffer {
  if (!key || typeof key !== 'object' || !sessionKeys.has(key)) {
    throw new TypeError('A key from deriveSessionKey() is required.');
  }
  return (key as SessionKeyInternal).bytes;
}

/** A new 256-bit session id from the CSPRNG. */
export function generateSessionId(): string {
  return randomBytes(32).toString('base64url');
}

/** The stored form of a session id. The raw id is never stored. */
export function hashSessionId(sid: string): string {
  if (typeof sid !== 'string' || !SESSION_ID_PATTERN.test(sid)) {
    throw new TypeError('Malformed session id.');
  }
  return createHash('sha256').update(sid, 'utf8').digest('base64url');
}

function signBody(bytes: Buffer, body: string): string {
  return createHmac('sha256', bytes).update(body).digest('base64url');
}

function validClaims(c: SessionTokenClaims): boolean {
  return (
    typeof c.sid === 'string' &&
    SESSION_ID_PATTERN.test(c.sid) &&
    typeof c.uid === 'string' &&
    USER_ID_PATTERN.test(c.uid) &&
    Number.isSafeInteger(c.iat) &&
    Number.isSafeInteger(c.exp) &&
    c.iat > 0 &&
    c.exp > c.iat &&
    c.exp - c.iat <= SESSION_TTL_MS + SESSION_IAT_SKEW_MS
  );
}

export function createSessionTokenV2(key: SessionKey, claims: SessionTokenClaims): string {
  const bytes = keyBytes(key);
  if (!claims || !validClaims(claims)) throw new TypeError('Invalid session token claims.');
  const payload = {
    typ: SESSION_TOKEN_TYPE,
    v: SESSION_TOKEN_VERSION,
    sid: claims.sid,
    uid: claims.uid,
    iat: claims.iat,
    exp: claims.exp,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${signBody(bytes, body)}`;
}

/**
 * Strict verification. Returns the claims, or null for anything that is not a
 * well-formed, correctly signed, unexpired v2 session token. Never throws for
 * bad input (only for a missing key, which is a programming error).
 */
export function verifySessionTokenV2(key: SessionKey, token: unknown, now: number = Date.now()): SessionTokenClaims | null {
  const bytes = keyBytes(key);
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_SESSION_TOKEN_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!BASE64URL.test(body) || !BASE64URL.test(sig)) return null;

  const expected = Buffer.from(signBody(bytes, body));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const keys = Object.keys(p).sort();
  if (keys.length !== PAYLOAD_KEYS.length || keys.some((k, i) => k !== PAYLOAD_KEYS[i])) return null;
  if (p.typ !== SESSION_TOKEN_TYPE || p.v !== SESSION_TOKEN_VERSION) return null;

  const claims = { sid: p.sid, uid: p.uid, iat: p.iat, exp: p.exp } as SessionTokenClaims;
  if (!validClaims(claims)) return null;
  if (claims.iat > now + SESSION_IAT_SKEW_MS) return null;
  if (now >= claims.exp) return null;
  return claims;
}

// --- Cookies -----------------------------------------------------------------

/** Used whenever the cookie is Secure (every Vercel deployment). `__Host-` makes the browser require Secure, Path=/ and no Domain. */
export const SECURE_SESSION_COOKIE_NAME = '__Host-as_sid';
/** Local http development only (including the Android emulator over cleartext). */
export const INSECURE_SESSION_COOKIE_NAME = 'as_sid';
/** The v1 cookie (lib/auth.ts SESSION_COOKIE_NAME). Only ever cleared from here, never read. */
export const LEGACY_SESSION_COOKIE_NAME = 'as_session';

export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
}

export function sessionCookieName(secure: boolean): string {
  return secure ? SECURE_SESSION_COOKIE_NAME : INSECURE_SESSION_COOKIE_NAME;
}

/**
 * Attributes for issuing the session cookie. Max-Age is derived from the
 * row's database-set expiresAt; it is a client hint only (the server checks
 * expiry itself). No Domain attribute: the cookie is host-only.
 */
export function sessionCookieOptions(expiresAt: Date, secure: boolean, now: number = Date.now()): SessionCookieOptions {
  if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) throw new TypeError('expiresAt must be a valid Date.');
  const maxAge = Math.floor((expiresAt.getTime() - now) / 1000);
  if (maxAge <= 0) throw new RangeError('Refusing to issue an already-expired session cookie.');
  return { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: Math.min(maxAge, SESSION_TTL_MS / 1000) };
}

export interface SessionCookieClear {
  name: string;
  options: Omit<SessionCookieOptions, 'maxAge'> & { maxAge: 0 };
}

/**
 * Every session cookie name to clear, with attributes the browser will accept
 * for the deletion. A `__Host-` cookie can only be cleared with Secure and
 * Path=/, and can only exist on a secure origin, so it is listed only there.
 */
export function sessionCookieClearList(secure: boolean): SessionCookieClear[] {
  const options = { httpOnly: true as const, secure, sameSite: 'lax' as const, path: '/' as const, maxAge: 0 as const };
  const names = secure
    ? [SECURE_SESSION_COOKIE_NAME, INSECURE_SESSION_COOKIE_NAME, LEGACY_SESSION_COOKIE_NAME]
    : [INSECURE_SESSION_COOKIE_NAME, LEGACY_SESSION_COOKIE_NAME];
  return names.map((name) => ({ name, options: { ...options } }));
}
