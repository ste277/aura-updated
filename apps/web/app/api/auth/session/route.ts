import { NextRequest, NextResponse } from 'next/server';
import { recordVisit } from '../../../../lib/db';
import {
  clearLegacySessionCookie,
  getSessionWithUserFromRequest,
  hasLegacySessionCookie,
  sessionUnavailableResponse,
  SESSION_UNAVAILABLE,
} from '../../../../lib/session';

// AURA-AUTH-SESSION-01-I2 (E3) -- the client's session bootstrap. 503 means
// "unknown" (the client must not treat it as signed out); { user: null } means
// not authenticated. Never sets or renews the session cookie (B4). A legacy v1
// `as_session` cookie is never read; it is cleared (cutover, N6).
export async function GET(req: NextRequest) {
  const session = await getSessionWithUserFromRequest(req);
  if (session === SESSION_UNAVAILABLE) return sessionUnavailableResponse();
  if (!session) {
    const res = NextResponse.json({ user: null });
    if (hasLegacySessionCookie(req)) clearLegacySessionCookie(res);
    return res;
  }
  const user = session.user;

  // VisitLog analytics -- deliberately independent of onboarding (see
  // recordVisit's own doc comment). Its return value (none) carries no
  // onboarding signal and is never used to decide anything below.
  await recordVisit(user.id);

  // Onboarding V1 PR 2 -- First-Run Reliability Correction: `onboardingResolved`
  // is read directly off the user row this route already fetched -- zero
  // extra query, same established pattern as `locationConfirmed`. A durable,
  // check-not-consume fact (see markOnboardingResolved's own doc comment):
  // reading it here never changes it, so any number of callers (this route
  // is itself called from both page.tsx and GuestFindClient.tsx) can check
  // it repeatedly without one "using up" the signal for the others.
  const res = NextResponse.json({ user, onboardingResolved: user.onboardingResolvedAt != null });
  if (hasLegacySessionCookie(req)) clearLegacySessionCookie(res);
  return res;
}
