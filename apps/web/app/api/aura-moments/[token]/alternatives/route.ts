import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { getAuraMomentForOwner, getUserById } from '../../../../../lib/db';
import { buildPersonalMuhurtaContextForUser } from '../../../../../lib/natalContext';
import { getSavedPersonNatalContext } from '../../../../../lib/savedPersonNatalContext';
import { findAuraMomentAlternatives } from '../../../../../lib/auraMomentAlternatives';
import { resolveTzOffsetMinutes } from '../../../../../lib/timezone';
import { DailyAssistantContext } from '../../../../../../../packages/recommendation/src/dailyAssistant';

/**
 * Owner-authenticated (brief section 20) -- runs a fresh, PRIVATE Shared
 * Muhurtham search for alternatives to a moment the recipient asked to
 * reschedule. Never invoked automatically (brief section 5: "Do not
 * automatically run a potentially expensive Shared search when the owner
 * opens the page") -- only when this endpoint is explicitly called (the
 * owner's "Find another time" button).
 *
 * Recomputes both natal contexts server-side on every call (brief section
 * 11) -- AuraMoment never snapshots natal data, so there is nothing to
 * reuse from the original share; getAuraMomentForOwner() resolves the
 * SavedPerson id from the AURAMOMENT itself, never trusting one from the
 * request body (brief section 20).
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const moment = await getAuraMomentForOwner(session.userId, params.token);
  if (!moment) return NextResponse.json({ error: 'Moment not found.' }, { status: 404 });

  if (moment.scope !== 'SHARED' || !moment.savedPersonId) {
    return NextResponse.json({ error: 'Alternatives are only available for Shared Muhurtham moments.' }, { status: 400 });
  }
  if (moment.responseState !== 'ANOTHER_TIME' || !moment.responsePreference) {
    return NextResponse.json({ error: 'This moment has no reschedule preference to act on yet.' }, { status: 400 });
  }

  const ownerPersonalContext = buildPersonalMuhurtaContextForUser(user);
  if (!ownerPersonalContext) {
    return NextResponse.json({ status: 'USER_PROFILE_INCOMPLETE' }, { status: 200 });
  }
  const savedPersonContext = await getSavedPersonNatalContext(moment.savedPersonId, session.userId);
  if (!savedPersonContext) {
    return NextResponse.json({ status: 'SAVED_PERSON_PROFILE_INCOMPLETE' }, { status: 200 });
  }

  const now = new Date();
  const ownerContext: DailyAssistantContext = {
    now,
    latitude: user.latitude,
    longitude: user.longitude,
    timezone: user.timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
    personalContext: ownerPersonalContext,
  };

  const outcome = findAuraMomentAlternatives({ auraMoment: moment, ownerContext, savedPersonContext });
  return NextResponse.json(outcome);
}
