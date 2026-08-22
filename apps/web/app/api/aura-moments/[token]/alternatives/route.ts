import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { getAuraMomentForOwner, getUserById } from '../../../../../lib/db';
import { buildPersonalMuhurtaContextForUser } from '../../../../../lib/natalContext';
import { getSavedPersonNatalContext } from '../../../../../lib/savedPersonNatalContext';
import { findAuraMomentAlternatives } from '../../../../../lib/auraMomentAlternatives';
import { resolveTzOffsetMinutes } from '../../../../../lib/timezone';
import { DailyAssistantContext } from '../../../../../../../packages/recommendation/src/dailyAssistant';

/**
 * Owner-authenticated -- runs a fresh, PRIVATE search for alternatives to a
 * moment the recipient asked to reschedule (Muhurtham occasion search for a
 * MUHURTHAM-sourced moment, Timing Search / everyday shared timing for a
 * PLAN-sourced one -- see findAuraMomentAlternatives() for the routing).
 * Never invoked automatically ("Do not automatically run a potentially
 * expensive search when the owner opens the page") -- only when this
 * endpoint is explicitly called (the owner's "Find another time" button).
 *
 * Recomputes both natal contexts server-side on every call -- AuraMoment
 * never snapshots natal data, so there is nothing to reuse from the
 * original share; getAuraMomentForOwner() resolves the SavedPerson id from
 * the AURAMOMENT itself, never trusting one from the request body. Unlike
 * the old MUHURTHAM-only version of this route, an incomplete profile is
 * NOT fetched-then-rejected up front for a PLAN moment -- findAuraMomentAlternatives()
 * itself decides what each source/scope actually requires (MUHURTHAM+SHARED
 * still hard-requires both profiles, exactly as before; PLAN degrades
 * gracefully instead).
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const moment = await getAuraMomentForOwner(session.userId, params.token);
  if (!moment) return NextResponse.json({ error: 'Moment not found.' }, { status: 404 });

  if (moment.responseState !== 'ANOTHER_TIME' || !moment.responsePreference) {
    return NextResponse.json({ error: 'This moment has no reschedule preference to act on yet.' }, { status: 400 });
  }

  const now = new Date();
  const ownerContext: DailyAssistantContext = {
    now,
    latitude: user.latitude,
    longitude: user.longitude,
    timezone: user.timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
    personalContext: buildPersonalMuhurtaContextForUser(user),
  };
  const savedPersonContext = moment.savedPersonId ? (await getSavedPersonNatalContext(moment.savedPersonId, session.userId)) ?? undefined : undefined;

  const outcome = findAuraMomentAlternatives({ auraMoment: moment, ownerContext, savedPersonContext });
  return NextResponse.json(outcome);
}
