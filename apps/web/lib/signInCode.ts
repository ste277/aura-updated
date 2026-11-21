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
