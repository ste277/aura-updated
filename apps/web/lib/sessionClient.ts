/**
 * AURA-AUTH-SESSION-01-I2 -- client-side session outcomes (design §3 B6, §7 D8, §9).
 *
 * - A 503 (or any non-2xx, or no network) from GET /api/auth/session is
 *   "unknown": the client keeps what it has and retries. It is NEVER read as
 *   signed out, and no local state is dropped (N7).
 * - Sign-out succeeds ONLY on a 200 from POST /api/auth/logout, which the
 *   server sends only after the revocation is durably committed. Otherwise it
 *   retries once automatically, then reports failure ("Couldn't sign out. Try
 *   again.") and the user stays signed in. There is no local-only logout.
 *
 * Framework-free so it is directly testable.
 */

export type SessionBootstrap<T = unknown> =
  | { readonly kind: 'signed_in'; readonly data: T }
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'unknown' };

type FetchLike = (input: string, init?: { method?: string; cache?: 'no-store' }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

export async function fetchSessionBootstrap<T extends { user?: unknown }>(fetchImpl: FetchLike): Promise<SessionBootstrap<T>> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl('/api/auth/session', { cache: 'no-store' });
  } catch {
    return { kind: 'unknown' };
  }
  if (!res.ok) return { kind: 'unknown' };
  let data: T;
  try {
    data = (await res.json()) as T;
  } catch {
    return { kind: 'unknown' };
  }
  if (!data || typeof data !== 'object') return { kind: 'unknown' };
  return data.user ? { kind: 'signed_in', data } : { kind: 'signed_out' };
}

export const SIGN_OUT_FAILED_MESSAGE = "Couldn't sign out. Try again.";
export const SIGN_OUT_RETRY_DELAY_MS = 1000;

/** 'signed_out' only after a 200 (revocation durably committed); 'failed' after one automatic retry. */
export async function signOutDurably(
  fetchImpl: FetchLike,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<'signed_out' | 'failed'> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchImpl('/api/auth/logout', { method: 'POST' });
      if (res.status === 200) return 'signed_out';
    } catch {
      // network failure: the outcome is unknown, so it is not a sign-out
    }
    if (attempt === 1) await wait(SIGN_OUT_RETRY_DELAY_MS);
  }
  return 'failed';
}
