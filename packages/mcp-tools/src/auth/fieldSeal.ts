import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'crypto';

/**
 * AURA-MCP-02-I2b-R1 (I2b-R-1) -- authenticated encryption for the few
 * sensitive identifiers `oidc-provider` keeps inside stored payloads and
 * must read back.
 *
 * Primitives (Node `crypto`, no custom cryptography):
 *   - AES-256-GCM, a fresh random 96-bit IV per value, 128-bit tag;
 *   - per-key encryption keys derived with HKDF-SHA-256 from the configured
 *     OAuth cookie keys (AURA_MCP_OAUTH_COOKIE_KEYS) with a dedicated
 *     salt/info, so the cookie-signing secret itself is never used as an
 *     encryption key and no new secret is required;
 *   - associated data binds every ciphertext to its model, row and field
 *     (`<model>\0<storage key>\0<field>`), so a value cannot be moved to
 *     another record or field without failing authentication.
 *
 * Format: `v1.<kid>.<iv>.<ciphertext>.<tag>` (base64url). `kid` is a short
 * HMAC of the derived key, used only to pick the key during rotation.
 *
 * Rotation: values are sealed with the FIRST key and opened with whichever
 * configured key matches `kid` (same order as cookie-key rotation). Removing
 * a key makes values sealed under it unreadable, which fails closed (the
 * interaction or session is treated as missing; both are short-lived).
 *
 * Any malformed, unknown-key or tampered value throws FieldSealError; callers
 * treat the record as not found. A sealer cannot be built without keys.
 */
export class FieldSealError extends Error {
  constructor(message = 'sealed field could not be opened') {
    super(message);
    this.name = 'FieldSealError';
  }
}

export interface FieldSealer {
  seal(plaintext: string, aad: string): string;
  open(sealed: string, aad: string): string;
  isSealed(value: unknown): value is string;
}

const PREFIX = 'v1';
const MIN_KEY = 32;
const b64 = (b: Buffer) => b.toString('base64url');

export function createFieldSealer(secrets: readonly string[]): FieldSealer {
  if (!Array.isArray(secrets) || secrets.length === 0) throw new TypeError('field encryption requires at least one key');
  if (secrets.some((s) => typeof s !== 'string' || s.length < MIN_KEY)) throw new TypeError(`field encryption keys must be at least ${MIN_KEY} characters`);
  if (new Set(secrets).size !== secrets.length) throw new TypeError('field encryption keys must be distinct');
  const keys = secrets.map((secret) => {
    const key = Buffer.from(hkdfSync('sha256', secret, 'aura-mcp-oauth-field-seal-v1', 'aes-256-gcm', 32));
    const kid = createHmac('sha256', key).update('kid').digest('hex').slice(0, 12);
    return { key, kid };
  });
  const byKid = new Map(keys.map((k) => [k.kid, k.key]));

  return {
    isSealed: (value): value is string => typeof value === 'string' && value.startsWith(`${PREFIX}.`),
    seal(plaintext, aad) {
      const { key, kid } = keys[0];
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(aad, 'utf8'));
      const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [PREFIX, kid, b64(iv), b64(ct), b64(cipher.getAuthTag())].join('.');
    },
    open(sealed, aad) {
      const parts = typeof sealed === 'string' ? sealed.split('.') : [];
      if (parts.length !== 5 || parts[0] !== PREFIX) throw new FieldSealError('malformed sealed field');
      const key = byKid.get(parts[1]);
      if (!key) throw new FieldSealError('unknown field key');
      const iv = Buffer.from(parts[2], 'base64url');
      const tag = Buffer.from(parts[4], 'base64url');
      if (iv.length !== 12 || tag.length !== 16) throw new FieldSealError('malformed sealed field');
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(Buffer.from(aad, 'utf8'));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
      } catch {
        throw new FieldSealError('sealed field failed authentication');
      }
    },
  };
}
