/**
 * AURA-ANDROID-REL-04 IR-01 (R2) -- edge-runtime reading of the `as_session`
 * token for middleware.ts. Same format and secret rules as lib/auth.ts
 * (base64url JSON body + "." + base64url HMAC-SHA256; `exp` in ms), using Web
 * Crypto because middleware runs on the edge runtime. Used ONLY to compare a
 * stated expected account with the session's account; it grants nothing.
 */
const MIN_SECRET_LENGTH = 32;

function secret(): string | null {
  const configured = process.env.AUTH_SECRET;
  if (configured && configured.length >= MIN_SECRET_LENGTH) return configured;
  if (process.env.NODE_ENV === 'production') return null; // lib/auth.ts refuses to run; routes fail closed
  return 'dev-only-insecure-secret-change-me';
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let keyPromise: Promise<CryptoKey> | null = null;
let keyFor: string | null = null;

export type EdgeSession = { status: 'none' } | { status: 'invalid' } | { status: 'unverifiable' } | { status: 'valid'; userId: string };

/**
 * AURA-ANDROID-REL-04 (R3) -- distinguishes "no cookie", "cookie present but
 * invalid/expired" (the route will answer 401), and "cookie present but the
 * edge cannot verify it" (secret unavailable): callers must fail CLOSED on
 * 'unverifiable', never treat it as "no session".
 */
export async function readEdgeSession(token: string | undefined | null): Promise<EdgeSession> {
  if (!token) return { status: 'none' };
  if (!secret()) return { status: 'unverifiable' };
  const userId = await sessionUserIdFromToken(token);
  return userId ? { status: 'valid', userId } : { status: 'invalid' };
}

/** The session's userId, or null when absent/invalid/expired/unverifiable. */
export async function sessionUserIdFromToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const s = secret();
  if (!s) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    if (!keyPromise || keyFor !== s) {
      keyFor = s;
      keyPromise = crypto.subtle.importKey('raw', new TextEncoder().encode(s), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    }
    const ok = await crypto.subtle.verify('HMAC', await keyPromise, b64urlToBytes(sig), new TextEncoder().encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body)));
    if (payload?.exp && Date.now() > payload.exp) return null;
    return typeof payload?.userId === 'string' ? payload.userId : null;
  } catch {
    return null;
  }
}
