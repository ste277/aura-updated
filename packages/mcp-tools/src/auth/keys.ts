import { constants, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from 'crypto';

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
 * I2b-S8 (I2b-R-6) -- integrity and strength, independent of what the
 * runtime's key import happens to check:
 *   - `alg` is REQUIRED (RS256, PS256 or ES256) and must match `kty`;
 *   - RSA: public exponent 65537; all CRT members present; n = p*q,
 *     e*d = 1 mod lcm(p-1, q-1), dp = d mod (p-1), dq = d mod (q-1),
 *     qi*q = 1 mod p (an inconsistent key can sign tokens that do not
 *     verify against the published key -- a self-inflicted outage);
 *   - EC: the public point is the one derived from `d`;
 *   - every key must sign a probe that VERIFIES against a key built from
 *     its PUBLIC members only (what /oauth/jwks publishes);
 *   - secrets (every cookie key -- current AND retained rotation keys --,
 *     the pairwise salt and the audit key): >= 32 characters and >= 128
 *     bits by the estimate of `assessSecret` (I2b-S10), which is FORMAT-
 *     AWARE so genuine CSPRNG output is never refused:
 *       hex (one case, >= 1 letter)        4 bits per character
 *       base64 / base64url (>= 2 of lower,
 *         upper, digit; padding allowed)   6 bits per character
 *       anything else                      the S8 character-frequency
 *                                          (Shannon) estimate, >= 10
 *                                          distinct characters
 *     A secret passes on EITHER estimate (so nothing the S8 rule accepted
 *     is newly refused), subject to mistake vetoes: no repeated block, and
 *     for hex / base64 no run of >= 12 characters that repeat or step by
 *     one in the format's own alphabet and no character far more frequent
 *     than chance allows (a uniform random string trips a veto with
 *     probability < 1e-11).
 *     Supported formats: `openssl rand -hex 16` (or longer) and
 *     `openssl rand -base64 24` / `-base64 32` (or base64url). This is a
 *     floor against obvious mistakes, not a proof of randomness: a derived
 *     or hand-picked string in one of these formats can pass, so generate
 *     secrets with a CSPRNG.
 * Error messages name the variable and the kid only, never a value.
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

const MIN_SECRET_BITS = 128;
const MIN_DISTINCT = 10;

/** Character-frequency (Shannon) entropy estimate of a secret, in bits. */
export function estimateSecretBits(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const n = [...value].length;
  let perChar = 0;
  for (const c of counts.values()) perChar -= (c / n) * Math.log2(c / n);
  return perChar * n;
}

/** True when the value is a shorter block repeated (e.g. "0123456789" x 4): its entropy estimate overstates it. */
function periodic(v: string): boolean {
  for (let p = 1; p <= v.length / 2; p += 1) {
    let same = true;
    for (let i = p; i < v.length && same; i += 1) same = v[i] === v[i - p];
    if (same) return true;
  }
  return false;
}

const HEX_ALPHABET = '0123456789abcdef';
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** Longest run (in the format's alphabet order) whose steps are all the same value in {-1, 0, +1}: "aaaa", "0123", "fedc", "WXYZab". */
function longestStepRun(v: string, alphabet: string): number {
  let best = 1;
  let run = 1;
  let step = 0;
  for (let i = 1; i < v.length; i += 1) {
    const d = alphabet.indexOf(v[i]) - alphabet.indexOf(v[i - 1]);
    if (d >= -1 && d <= 1) {
      run = run > 1 && d === step ? run + 1 : 2;
      step = d;
    } else run = 1;
    if (run > best) best = run;
  }
  return best;
}

/** log P(X >= k) for X ~ Binomial(n, p). */
function logBinomialTail(n: number, p: number, k: number): number {
  const lg = (x: number) => logGamma(x + 1);
  let m = -Infinity;
  const terms: number[] = [];
  for (let j = k; j <= n; j += 1) {
    const t = lg(n) - lg(j) - lg(n - j) + j * Math.log(p) + (n - j) * Math.log(1 - p);
    terms.push(t);
    if (t > m) m = t;
  }
  return m + Math.log(terms.reduce((acc, t) => acc + Math.exp(t - m), 0));
}
/** Lanczos log-gamma (sufficient precision for these bounds). */
function logGamma(z: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61503916999185, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i += 1) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
const freqLimits = new Map<string, number>();
/** Smallest count k such that SOME character appearing >= k times has probability <= 1e-12 for a uniform random string. */
function maxCountLimit(n: number, alphabetSize: number): number {
  const key = `${n}:${alphabetSize}`;
  const hit = freqLimits.get(key);
  if (hit !== undefined) return hit;
  let k = 1;
  while (k <= n && Math.log(alphabetSize) + logBinomialTail(n, 1 / alphabetSize, k) > Math.log(1e-12)) k += 1;
  freqLimits.set(key, k);
  return k;
}

export type SecretFormat = 'hex' | 'base64' | 'text';
export interface SecretAssessment {
  ok: boolean;
  format: SecretFormat;
  /** Estimated strength, bits (format-aware; see the module comment). */
  bits: number;
  /** Why it was refused (a code, never the value). */
  reason?: 'short' | 'weak' | 'repeated_block' | 'run' | 'skewed' | 'low_variety';
}

/**
 * I2b-S10 (I2b-R-6 compatibility): format-aware secret strength. Genuine
 * CSPRNG output in a supported format is accepted with probability
 * > 1 - 1e-11 (the S8 character-frequency floor refused EVERY 16-byte hex
 * secret and about 1 in 6000 24-byte base64 / 20-byte hex secrets).
 * Strings outside the supported formats keep the S8 rule unchanged.
 */
export function assessSecret(v: string): SecretAssessment {
  const hasCase = (re: RegExp) => re.test(v);
  let format: SecretFormat = 'text';
  let bits: number;
  let core = v;
  if (/^(?:[0-9a-f]+|[0-9A-F]+)$/.test(v) && /[a-fA-F]/.test(v)) {
    format = 'hex';
    bits = 4 * v.length;
  } else if ((/^[A-Za-z0-9+/]+={0,2}$/.test(v) || /^[A-Za-z0-9_-]+$/.test(v)) && [/[a-z]/, /[A-Z]/, /[0-9]/].filter(hasCase).length >= 2) {
    format = 'base64';
    core = v.replace(/=+$/, '');
    bits = 6 * core.length;
  } else {
    bits = estimateSecretBits(v);
  }
  const out = (reason?: SecretAssessment['reason']): SecretAssessment => ({ ok: !reason, format, bits, ...(reason ? { reason } : {}) });
  if (v.length < MIN_SECRET) return out('short');
  if (periodic(v)) return out('repeated_block');
  if (format !== 'text') {
    // Mistake vetoes for the CSPRNG formats; a uniform random string trips them with probability < 1e-11.
    const alphabet = format === 'hex' ? HEX_ALPHABET : /[-_]/.test(core) ? B64URL_ALPHABET : B64_ALPHABET;
    if (longestStepRun(format === 'hex' ? core.toLowerCase() : core, alphabet) >= 12) return out('run');
    const counts = new Map<string, number>();
    let max = 0;
    for (const ch of core) {
      const c = (counts.get(ch) ?? 0) + 1;
      counts.set(ch, c);
      if (c > max) max = c;
    }
    if (max >= maxCountLimit(core.length, format === 'hex' ? 16 : 64)) return out('skewed');
  }
  // Accept on the S8 estimate (unchanged, so nothing S8 accepted is newly refused) OR on the format-aware one.
  const s8 = new Set(v).size >= MIN_DISTINCT && estimateSecretBits(v) >= MIN_SECRET_BITS;
  if (s8) return { ...out(), bits: Math.max(bits, estimateSecretBits(v)) };
  if (format !== 'text' && bits >= MIN_SECRET_BITS) return out();
  return out(new Set(v).size < MIN_DISTINCT && format === 'text' ? 'low_variety' : 'weak');
}

function strongEnough(v: string): boolean {
  return assessSecret(v).ok;
}

function secretList(name: string, value: string | undefined): string[] {
  const list = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) throw new TypeError(`${name} is required`);
  for (const s of list) if (s.length < MIN_SECRET) throw new TypeError(`${name}: every key must be at least ${MIN_SECRET} characters`);
  for (const s of list) if (!strongEnough(s)) throw new TypeError(`${name}: a key is too predictable (needs >= ${MIN_SECRET_BITS} bits of estimated entropy; use a CSPRNG)`);
  if (new Set(list).size !== list.length) throw new TypeError(`${name}: duplicate keys`);
  return list;
}

function secret(name: string, value: string | undefined): string {
  const v = (value ?? '').trim();
  if (v.length < MIN_SECRET) throw new TypeError(`${name} must be at least ${MIN_SECRET} characters`);
  if (!strongEnough(v)) throw new TypeError(`${name} is too predictable (needs >= ${MIN_SECRET_BITS} bits of estimated entropy; use a CSPRNG)`);
  return v;
}

function b64uInt(v: unknown): bigint | null {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]+$/.test(v)) return null;
  const hex = Buffer.from(v, 'base64url').toString('hex');
  return hex ? BigInt(`0x${hex}`) : null;
}
const gcd = (a: bigint, b: bigint): bigint => {
  while (b) [a, b] = [b, a % b];
  return a;
};

/** I2b-S8: RSA private-key consistency (all members, not just what OpenSSL happens to use). */
function rsaConsistent(jwk: Record<string, unknown>): boolean {
  const [n, e, d, p, q, dp, dq, qi] = ['n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi'].map((k) => b64uInt(jwk[k]));
  if (!n || !e || !d || !p || !q || !dp || !dq || !qi) return false;
  if (e !== 65537n) return false;
  if (p * q !== n || p === q) return false;
  const lambda = ((p - 1n) * (q - 1n)) / gcd(p - 1n, q - 1n);
  return (e * d) % lambda === 1n && d % (p - 1n) === dp && d % (q - 1n) === dq && (qi * q) % p === 1n;
}

const PROBE = Buffer.from('aura-mcp-oauth-key-probe-v1');
function signVerifies(alg: string, priv: KeyObject, pub: KeyObject): boolean {
  try {
    if (alg === 'ES256') return verify('sha256', PROBE, { key: pub, dsaEncoding: 'ieee-p1363' }, sign('sha256', PROBE, { key: priv, dsaEncoding: 'ieee-p1363' }));
    if (alg === 'PS256') {
      const o = { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 };
      return verify('sha256', PROBE, { key: pub, ...o }, sign('sha256', PROBE, { key: priv, ...o }));
    }
    return verify('sha256', PROBE, pub, sign('sha256', PROBE, priv));
  } catch {
    return false;
  }
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
    if (typeof jwk.alg !== 'string') throw new TypeError(`AURA_MCP_OAUTH_JWKS key ${kid}: alg is required (${ALLOWED_ALGS[kty].join(' or ')})`);
    if (!ALLOWED_ALGS[kty].includes(jwk.alg)) throw new TypeError(`AURA_MCP_OAUTH_JWKS key ${kid}: alg not allowed`);
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
    // I2b-S8 (I2b-R-6): integrity, then a sign/verify probe against the PUBLIC members only.
    if (kty === 'RSA' && !rsaConsistent(jwk)) throw new TypeError(`AURA_MCP_OAUTH_JWKS key ${kid}: inconsistent RSA private key (or exponent other than 65537)`);
    let pub: KeyObject;
    try {
      pub = createPublicKey({ key: (kty === 'RSA' ? { kty, n: jwk.n, e: jwk.e } : { kty, crv: jwk.crv, x: jwk.x, y: jwk.y }) as never, format: 'jwk' });
    } catch {
      throw new TypeError(`AURA_MCP_OAUTH_JWKS key ${kid}: invalid public members`);
    }
    if (kty === 'EC') {
      const derived = createPublicKey(key).export({ format: 'jwk' }) as Record<string, unknown>;
      if (derived.x !== jwk.x || derived.y !== jwk.y) throw new TypeError(`AURA_MCP_OAUTH_JWKS key ${kid}: EC public point does not match the private key`);
    }
    if (!signVerifies(jwk.alg, key, pub)) throw new TypeError(`AURA_MCP_OAUTH_JWKS key ${kid}: signature probe does not verify against the published key`);
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
