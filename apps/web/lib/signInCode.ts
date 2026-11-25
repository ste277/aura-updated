/**
 * AURA-READY-03-F2 -- the one client call that asks the EXISTING sign-in
 * endpoint (POST /api/auth/request-link) for a 6-digit code, shared by the
 * Home sign-in screen and the guest /find save flow for both the first send
 * and "Resend code".
 *
 * Nothing about authentication changes here: the server still decides
 * everything (open registration, the 3-per-10-minutes quota, the
 * local-development-only magic link, the identical response for new and
 * existing accounts). This only turns its response into one of three
 * outcomes the screens can show.
 */

import { DEADLINE, beginTransition, boundedExchange, isJsonMediaType, readSessionAnswer, withAuthLock } from './accountSession';

/** Client-side pause between sends, so a quick double-tap or impatient
 * re-tap can't burn the user's server quota (3 requests per 10 minutes). The
 * server's own limit is unchanged and still authoritative. */
export const RESEND_COOLDOWN_SECONDS = 30;

export const SIGN_IN_OFFLINE_MESSAGE = "Couldn't reach the server. Check your connection and try again.";

export type SignInCodeRequestResult =
  | { kind: 'SENT'; devLoginCode: string | null; devLoginUrl: string | null }
  | { kind: 'RATE_LIMITED'; message: string }
  | { kind: 'FAILED'; message: string };

export async function requestSignInCode(
  body: { email: string; guestStateToken?: string | null },
  fetchImpl: typeof fetch = fetch
): Promise<SignInCodeRequestResult> {
  let res: Response;
  try {
    res = await fetchImpl('/api/auth/request-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body.guestStateToken ? { email: body.email, guestStateToken: body.guestStateToken } : { email: body.email }),
    });
  } catch (err) {
    console.error('request-link failed:', err);
    return { kind: 'FAILED', message: SIGN_IN_OFFLINE_MESSAGE };
  }
  const data = await res.json().catch(() => null);
  if (res.status === 429) {
    return { kind: 'RATE_LIMITED', message: data?.error ?? 'Too many sign-in requests. Please wait a few minutes and try again.' };
  }
  if (!res.ok) {
    return { kind: 'FAILED', message: data?.error ?? `Sign-in request failed (${res.status}). Try again.` };
  }
  return {
    kind: 'SENT',
    devLoginCode: typeof data?.devLoginCode === 'string' ? data.devLoginCode : null,
    devLoginUrl: typeof data?.devLoginUrl === 'string' ? data.devLoginUrl : null,
  };
}

// ---------------------------------------------------------------------------
// AURA-ANDROID-REL-04 IR-01 / IR-03 (R2) -- code verification as a
// coordinated auth transition, shared by the Home sign-in screen and /find.
//
//  - Runs under the same cross-tab auth lock as sign-out, so a pending
//    logout's response can't clear this sign-in's cookie (and vice versa).
//  - The server names the account the code signed in (`userId`); the client
//    then requires a FRESH, strictly parsed session answer for that same
//    account before anything is bound to it. A competing sign-in elsewhere
//    therefore can't rebind a pending action (e.g. the /find save).
//  - Every stage is bounded.
// ---------------------------------------------------------------------------

export const VERIFY_TIMEOUT_MS = 15_000;
export const SIGN_IN_BUSY_MESSAGE = 'Another window is signing in or out. Try again in a moment.';
export const SIGN_IN_UNCONFIRMED_MESSAGE = "Signed in, but Aura couldn't confirm which account is active. Check your connection and try again.";

export type VerifySignInResult =
  | { kind: 'VERIFIED'; userId: string }
  | { kind: 'REJECTED'; message: string }
  | { kind: 'FAILED'; message: string }
  | { kind: 'BUSY'; message: string }
  | { kind: 'UNCONFIRMED'; message: string };

async function readVerifyAnswer(res: Response): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string | null } | null> {
  if (res.redirected || res.type === 'opaqueredirect') return null;
  if (!isJsonMediaType(res.headers?.get?.('content-type'))) return res.status >= 400 && res.status < 500 ? { ok: false, status: res.status, error: null } : null;
  let body: unknown;
  try { body = await res.json(); } catch { return null; }
  if (res.status === 200) {
    const b = body as { ok?: unknown; userId?: unknown };
    return b && b.ok === true && typeof b.userId === 'string' && b.userId ? { ok: true, userId: b.userId } : null;
  }
  if (res.status >= 400 && res.status < 500) {
    const err = (body as { error?: unknown })?.error;
    return { ok: false, status: res.status, error: typeof err === 'string' ? err : null };
  }
  return null;
}

export async function verifySignInCode(body: { email: string; code: string }, fetchImpl: typeof fetch = (i, n) => fetch(i, n)): Promise<VerifySignInResult> {
  const r = await withAuthLock(async (): Promise<VerifySignInResult> => {
    const tx = beginTransition('signing-in');
    if (!tx) return { kind: 'BUSY', message: SIGN_IN_BUSY_MESSAGE };
    let answer: Awaited<ReturnType<typeof readVerifyAnswer>> | typeof DEADLINE = null;
    try {
      answer = await boundedExchange(fetchImpl, '/api/auth/verify-code', {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      }, VERIFY_TIMEOUT_MS, readVerifyAnswer);
    } catch {
      answer = null;
    }
    if (answer && answer !== DEADLINE && !answer.ok) {
      // A definitive refusal of the code: no session was issued.
      tx.end('resumed');
      return { kind: 'REJECTED', message: answer.error ?? `That code did not work (${answer.status}). Try again.` };
    }
    if (!answer || answer === DEADLINE) {
      // Unknown whether a session was issued: re-verify before anything is bound.
      tx.end('unknown');
      return { kind: 'FAILED', message: SIGN_IN_OFFLINE_MESSAGE };
    }
    let session: Awaited<ReturnType<typeof readSessionAnswer>> | typeof DEADLINE = null;
    try {
      session = await boundedExchange(fetchImpl, '/api/auth/session', { cache: 'no-store', credentials: 'same-origin', redirect: 'error' }, VERIFY_TIMEOUT_MS, readSessionAnswer);
    } catch {
      session = null;
    }
    if (session && session !== DEADLINE && session.kind === 'user' && session.id === answer.userId) {
      tx.end({ switchedTo: answer.userId });
      return { kind: 'VERIFIED', userId: answer.userId };
    }
    tx.end('unknown');
    return { kind: 'UNCONFIRMED', message: SIGN_IN_UNCONFIRMED_MESSAGE };
  });
  return r ?? { kind: 'BUSY', message: SIGN_IN_BUSY_MESSAGE };
}
