/**
 * AURA-AUTH-02 -- magic-link sign-in is a LOCAL DEVELOPMENT convenience only.
 *
 * Deployed environments (Vercel Preview and Production, and any other hosted
 * server) sign users in with the emailed 6-digit code alone. A magic link is a
 * bearer credential in a GET URL, so it can end up in request logs, browser
 * history and Referer headers; it is therefore never issued or accepted there.
 *
 * The gate is FAIL-CLOSED. Magic links are enabled only when ALL of these hold:
 *
 *   1. AURA_LOCAL_MAGIC_LINKS is exactly "true"     -- an explicit opt-in that a
 *                                                     developer sets in their own
 *                                                     .env.local; absent, empty or
 *                                                     any other value means OFF.
 *   2. NODE_ENV is exactly "development"            -- `next dev`; `next build` /
 *                                                     `next start` (every deployed
 *                                                     server) run as "production".
 *   3. none of VERCEL, VERCEL_ENV, VERCEL_URL is set -- Vercel sets these on every
 *                                                     build and at runtime, so a
 *                                                     copied opt-in can't turn the
 *                                                     links on in Preview/Production.
 *
 * No request data (Host, X-Forwarded-*, client IP) is consulted: client-supplied
 * headers are never proof of where the server runs. Anything ambiguous -- an
 * unknown NODE_ENV, a missing opt-in, a Vercel marker -- leaves the gate closed.
 */
export const LOCAL_MAGIC_LINK_FLAG = 'AURA_LOCAL_MAGIC_LINKS';

type Env = Record<string, string | undefined>;

export function magicLinksEnabled(env: Env = process.env): boolean {
  if (env[LOCAL_MAGIC_LINK_FLAG] !== 'true') return false;
  if (env.NODE_ENV !== 'development') return false;
  if (env.VERCEL || env.VERCEL_ENV || env.VERCEL_URL) return false;
  return true;
}

/** The response GET /api/auth/verify returns whenever the gate is closed. */
export const MAGIC_LINK_DISABLED_MESSAGE =
  'Sign-in links are not available. Enter the 6-digit code from your sign-in email instead.';
