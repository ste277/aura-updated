import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { listAllPersonOccasionsForOwner, listSavedPeople } from '../../../../../lib/db';
import { isMyPeopleEnabled } from '../../../../../lib/myPeopleGate';
import { listUpcomingOccasions } from '../../../../../lib/personOccasions';
import { userLocalToday } from '../../../../../lib/myPeopleRoutes';

/**
 * AURA-MP-1 -- upcoming special days for the signed-in user, computed on
 * read in the user's own timezone (nothing is stored). `?days=` 1-60,
 * default 30. In-app data only: no push, email or other notification is
 * ever sent from this (design 4.4). 404 while My People is switched off.
 */
// AURA-MP-1: the switch is read per request -- never prerender this route
// at build time (a build-time 404 would outlive turning the switch on).
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isMyPeopleEnabled()) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const rawDays = req.nextUrl?.searchParams.get('days');
  const days = rawDays == null ? 30 : Number(rawDays);
  if (!Number.isInteger(days) || days < 1 || days > 60) {
    return NextResponse.json({ error: 'days must be a whole number from 1 to 60.' }, { status: 400 });
  }

  const today = await userLocalToday(session.userId);
  if (!today) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const [people, occasions] = await Promise.all([listSavedPeople(session.userId), listAllPersonOccasionsForOwner(session.userId)]);
  const peopleById = new Map(people.map((p) => [p.id, { name: p.name }]));
  return NextResponse.json(listUpcomingOccasions(occasions, peopleById, today.date, days));
}
