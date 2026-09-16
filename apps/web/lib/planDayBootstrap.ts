/**
 * Day Constructor V1 -- PR F2 planning-date hardening.
 *
 * The ONE place F2's authoritative planning date is established -- from a
 * real server clock read and the authenticated user's own timezone, never
 * the browser's clock (this ticket's own section 3/13: no client clock
 * read may determine the planning civil date). `/plan-day/page.tsx` (a
 * Server Component) calls `resolvePlanDayServerProps` with the real
 * cookie-reading/`auth.ts`/`db.ts` primitives injected; every actual
 * decision lives here, fully testable with no framework-specific cookie
 * API import at all -- mirroring PR F1's own
 * `handleDayConstructorPreviewRequest` pattern exactly
 * (dayConstructorPreviewRequest.ts): a thin framework adapter wiring real
 * closures into a plain, DI-tested function.
 */

import { getDatePartsInTimezone } from './timezone';

export interface PlanDayBootstrap {
  timezone: string;
  planningDate: string;
}

/** Pure. The one civil-date derivation this entire feature performs --
 * reused verbatim by both the FIXED-time assembly (planDayEntry.ts) and
 * the preview request's own `targetDate` (this ticket's own section 7),
 * so both can never disagree about which day is being planned. */
export function resolvePlanDayBootstrap(userTimezone: string, now: Date): PlanDayBootstrap {
  return { timezone: userTimezone, planningDate: getDatePartsInTimezone(userTimezone, now).dateStr };
}

export interface PlanDayBootstrapDeps {
  /** `() => cookies().get(SESSION_COOKIE_NAME)?.value` in production. */
  getSessionToken: () => string | undefined;
  /** `verifySessionToken` (auth.ts), passed by reference -- the SAME
   * canonical verification every route in this app already uses (this
   * ticket's own section 15: reuse the existing mechanism, never a
   * second auth model). */
  verifySession: (token: string) => { userId: string } | null;
  /** `getUserById` (db.ts), passed by reference. */
  getUser: (userId: string) => Promise<{ timezone: string } | null>;
  /** The authoritative server clock, read exactly once. */
  now: () => Date;
}

/**
 * `null` means "not authenticated" -- the caller (page.tsx) passes this
 * through to `PlanDayClient` as absent props, which redirects to Home
 * exactly like this app's own established client-side pattern
 * (window.location.href), never a second, server-side redirect mechanism
 * (this ticket's own section 15/19: no new architecture).
 */
export async function resolvePlanDayServerProps(deps: PlanDayBootstrapDeps): Promise<PlanDayBootstrap | null> {
  const token = deps.getSessionToken();
  if (!token) return null;

  const session = deps.verifySession(token);
  if (!session) return null;

  const user = await deps.getUser(session.userId);
  if (!user) return null;

  return resolvePlanDayBootstrap(user.timezone, deps.now());
}
