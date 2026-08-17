import { createHmac, timingSafeEqual, randomInt } from 'crypto';

// Deliberately minimal — a hand-rolled signed-token helper rather than pulling in
// a JWT library, since all we need is "tamper-evident payload with an expiry."
// Swap for `jose` or NextAuth if the auth surface grows beyond magic links.

const SECRET = process.env.AUTH_SECRET ?? 'dev-only-insecure-secret-change-me';

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: object): string {
  const body = base64url(JSON.stringify(payload));
  const sig = createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify<T>(token: string): T | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expectedSig = createHmac('sha256', SECRET).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload as T;
  } catch {
    return null;
  }
}

export interface MagicLinkPayload {
  email: string;
  exp: number;
}

export function createMagicLinkToken(email: string): string {
  const payload: MagicLinkPayload = { email, exp: Date.now() + 15 * 60 * 1000 }; // 15 min
  return sign(payload);
}

export function verifyMagicLinkToken(token: string): MagicLinkPayload | null {
  return verify<MagicLinkPayload>(token);
}

export interface SessionPayload {
  userId: string;
  email: string;
  exp: number;
}

export function createSessionToken(userId: string, email: string): string {
  const payload: SessionPayload = { userId, email, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 }; // 30 days
  return sign(payload);
}

export function verifySessionToken(token: string): SessionPayload | null {
  return verify<SessionPayload>(token);
}

export const SESSION_COOKIE_NAME = 'as_session';

// --- One-time sign-in codes -------------------------------------------------
// The 6-digit code exists because magic-link emails open in the system
// browser, not a native shell's webview — the code can be typed anywhere.
// Codes are stored server-side (AuthCode table) as an HMAC, never plaintext.

export const AUTH_CODE_TTL_MS = 15 * 60 * 1000;
export const AUTH_CODE_MAX_ATTEMPTS = 5;

export function generateAuthCode(): string {
  // crypto.randomInt avoids modulo bias; always 6 digits, leading zeros kept.
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashAuthCode(email: string, code: string): string {
  // Bind the hash to the email so a code row can't be replayed for another
  // address even if rows were somehow mixed up.
  return createHmac('sha256', SECRET).update(`${email.toLowerCase()}:${code}`).digest('base64url');
}

export function authCodeHashesEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}
