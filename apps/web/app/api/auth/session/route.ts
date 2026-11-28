import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE_NAME } from '../../../../lib/auth';
import { getUserById, recordVisit } from '../../../../lib/db';

// AURA-ANDROID-REL-04 IR-03 (R2) -- a session answer must never be served
// from a cache: clients decide which account is signed in from it.
const noStore = (body: unknown) => NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return noStore({ user: null });

  const session = verifySessionToken(token);
  if (!session) return noStore({ user: null });

  const user = await getUserById(session.userId);
  if (!user) return noStore({ user: null });

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
  return noStore({ user, onboardingResolved: user.onboardingResolvedAt != null });
}
