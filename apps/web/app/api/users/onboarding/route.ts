import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { markOnboardingResolved } from '../../../../lib/db';

/**
 * Onboarding V1 PR 2 -- First-Run Reliability Correction. The one
 * authenticated write that marks the Welcome/Confirm Location/
 * Recommendation journey resolved for the CALLING user only --
 * `session.userId` comes from the verified session cookie, never from the
 * request body, so this can never resolve (or be asked to resolve)
 * anyone else's account. Idempotent: a repeated call is a no-op (see
 * markOnboardingResolved's own doc comment) and always returns the
 * user's current, authoritative resolution state either way.
 */
export async function PATCH(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const user = await markOnboardingResolved(session.userId);
  if (!user) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  return NextResponse.json({
    onboardingResolved: user.onboardingResolvedAt != null,
    onboardingResolvedAt: user.onboardingResolvedAt,
  });
}
