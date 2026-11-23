import { createPrivateKey, generateKeyPairSync, randomBytes } from 'crypto';

/**
 * AURA-MCP-02-I2b -- signing and cookie key configuration for the Aura
 * authorization server, with rotation.
 *
 * Inputs (deployment secrets; never logged, never committed):
 *   AURA_MCP_OAUTH_JWKS         JSON `{"keys":[...]}` of PRIVATE JWKs. The
 *                               FIRST key signs; the others stay published in
 *                               /oauth/jwks so tokens they signed keep
 *                               verifying during rotation.
 *   AURA_MCP_OAUTH_COOKIE_KEYS  comma-separated secrets (>= 32 chars each).
 *                               The FIRST signs cookies; the others are still
 *                               accepted (rotation window).
 *   AURA_MCP_OAUTH_PAIRWISE_SALT  >= 32 chars; derives the per-client ID-token
 *                               subject (ID tokens never carry the Aura id).
 *   AURA_MCP_AUDIT_KEY          >= 32 chars; keys the audit `userRef`.
 *
 * Rotation procedure: add the new key FIRST in the list, keep the old one
 * after it for at least the longest token/cookie lifetime (ID token 5 min,
 * session cookie 1 h, refresh tokens up to their absolute lifetime for
 * cookie-bound state), then remove it.
 *
 * Accepted signing keys: RSA >= 2048 bits (RS256/PS256) or EC P-256 (ES256),
 * each with a unique `kid`, `use` "sig" (or absent). Anything else throws, so
 * a misconfigured deployment fails at startup instead of signing with a weak
 * or public key.
 *
 * `ephemeralOAuthKeys()` is for local development and tests only: fresh
 * random keys per process.
 */
export interface OAuthKeyMaterial {
  jwks: { keys: Record<string, unknown>[] };
  cookieKeys: string[];
  pairwiseSalt: string;
  auditKey: string;
  /** "configured" for deployment secrets, "ephemeral" for local/test keys. */
  source: 'configured' | 'ephemeral';
}

const MIN_SECRET = 32;
const ALLOWED_ALGS: Record<string, string[]> = { RSA: ['RS256', 'PS256'], EC: ['ES256'] };

export function ephemeralOAuthKeys(): OAuthKeyMaterial {
  const jwk = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' }) as Record<string, unknown>;
  return {
    jwks: { keys: [{ ...jwk, kid: `local-${randomBytes(6).toString('hex')}`, use: 'sig', alg: 'RS256' }] },
    cookieKeys: [randomBytes(32).toString('base64url')],
    pairwiseSalt: randomBytes(32).toString('base64url'),
    auditKey: randomBytes(32).toString('base64url'),
    source: 'ephemeral',
  };
}

function secretList(name: string, value: string | undefined): string[] {
  const list = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) throw new TypeError(`${name} is required`);
  for (const s of list) if (s.length < MIN_SECRET) throw new TypeError(`${name}: every key must be at least ${MIN_SECRET} characters`);
  if (new Set(list).size !== list.length) throw new TypeError(`${name}: duplicate keys`);
  return list;
}

function secret(name: string, value: string | undefined): string {
  const v = (value ?? '').trim();
  if (v.length < MIN_SECRET) throw new TypeError(`${name} must be at least ${MIN_SECRET} characters`);
  return v;
}

export function validateSigningJwks(raw: string | undefined): { keys: Record<string, unknown>[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? '');
  } catch {
    throw new TypeError('AURA_MCP_OAUTH_JWKS must be JSON {"keys":[...]}');
  }
  const keys = (parsed as { keys?: unknown })?.keys;
  if (!Array.isArray(keys) || keys.length === 0) throw new TypeError('AURA_MCP_OAUTH_JWKS must contain at least one key');
  const kids = new Set<string>();
  for (const [i, k] of keys.entries()) {
    if (!k || typeof k !== 'object') throw new TypeError(`AURA_MCP_OAUTH_JWKS key ${i} is not an object`);
    const jwk = k as Record<string, unknown>;
    const kty = String(jwk.kty ?? '');
    const kid = jwk.kid;
    if (typeof kid !== 'string' || !/^[A-Za-z0-9._-]{4,64}$/.test(kid)) throw new TypeError(`AURA_MCP_OAUTH_JWKS key ${i} needs a kid (4-64 of A-Za-z0-9._-)`);
    if (kids.has(kid)) throw new TypeError('AURA_MCP_OAUTH_JWKS kids must be unique');
    kids.add(kid);
    if (!ALLOWED_ALGS[kty]) throw new TypeError(`AURA_MCP_OAUTH_JWKS key ${kid}: kty must be RSA or EC`);
    if (jwk.alg !== undefined && !ALLOWED_ALGS[kty].includes(String(jwk.alg))) throw new TypeError(`AURA_MCP_OAUTH_JWKS key ${kid}: alg not allowed`);
    if (jwk.use !== undefined && jwk.use !== 'sig') throw new TypeError(`AURA_MCP_OAUTH_JWKS key ${kid}: use must be "sig"`);
    if (typeof jwk.d !== 'string') throw new TypeError(`AURA_MCP_OAUTH_JWKS key ${kid}: must be a PRIVATE key`);
    let key;
    try {
      key = createPrivateKey({ key: jwk as never, format: 'jwk' });
    } catch {
      throw new TypeError(`AURA_MCP_OAUTH_JWKS key ${kid}: not a valid private key`);
    }
    const details = key.asymmetricKeyDetails ?? {};
    if (kty === 'RSA' && !((details.modulusLength ?? 0) >= 2048)) throw new TypeError(`AURA_MCP_OAUTH_JWKS key ${kid}: RSA keys must be >= 2048 bits`);
    if (kty === 'EC' && details.namedCurve !== 'prime256v1') throw new TypeError(`AURA_MCP_OAUTH_JWKS key ${kid}: EC keys must use P-256`);
  }
  return { keys: keys.map((k) => ({ use: 'sig', ...(k as Record<string, unknown>) })) };
}

/** Loads and validates deployment key material from the environment. Throws on anything missing or weak. */
export function loadOAuthKeysFromEnv(env: Record<string, string | undefined>): OAuthKeyMaterial {
  const jwks = validateSigningJwks(env.AURA_MCP_OAUTH_JWKS);
  const cookieKeys = secretList('AURA_MCP_OAUTH_COOKIE_KEYS', env.AURA_MCP_OAUTH_COOKIE_KEYS);
  const pairwiseSalt = secret('AURA_MCP_OAUTH_PAIRWISE_SALT', env.AURA_MCP_OAUTH_PAIRWISE_SALT);
  const auditKey = secret('AURA_MCP_AUDIT_KEY', env.AURA_MCP_AUDIT_KEY);
  const all = [...cookieKeys, pairwiseSalt, auditKey];
  if (new Set(all).size !== all.length) throw new TypeError('cookie keys, pairwise salt and audit key must all be different');
  return { jwks, cookieKeys, pairwiseSalt, auditKey, source: 'configured' };
}
