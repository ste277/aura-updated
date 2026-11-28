import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../../lib/session';
import { getPersonOccasionByIdForOwner, markPersonOccasionDismissed } from '../../../../../../lib/db';
import { parseJsonObject } from '../../../../../../lib/request';
import { isMyPeopleServerEnabled } from '../../../../../../lib/myPeopleGate';
import { dismissalKeyFor, isOccasionSurfaced, nextOccurrence, type OccasionDismissScope } from '../../../../../../lib/personOccasions';
import { userLocalToday } from '../../../../../../lib/myPeopleRoutes';

/**
 * AURA-MP-3 -- dismiss a special day's Home card (design 4.4 / 5.7).
 * POST { scope: "NOT_NOW" | "NOT_THIS_YEAR" }.
 *
 * - 404 while My People is disabled on the SERVER, and for another owner's
 *   or an unknown special day (never 403: ids cannot be probed).
 * - Never trusts a client date: the occurrence is re-resolved here from the
 *   stored day and the owner's own timezone, and only a day that is
 *   currently surfaced (inside its reminder window) can be dismissed (409).
 * - Writes one ReminderAttention row (see lib/personOccasions.ts). It hides
 *   the card only; the special day itself is never changed or deleted.
 */
export const dynamic = 'force-dynamic';

const SCOPES = new Set<OccasionDismissScope>(['NOT_NOW', 'NOT_THIS_YEAR']);

export async function POST(req: NextRequest, { params }: { params: { occasionId: string } }) {
  if (!isMyPeopleServerEnabled()) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });
  const scope = body.scope as OccasionDismissScope;
  if (!SCOPES.has(scope)) return NextResponse.json({ error: 'scope must be NOT_NOW or NOT_THIS_YEAR.' }, { status: 400 });

  const occasion = await getPersonOccasionByIdForOwner(session.userId, params.occasionId);
  if (!occasion) return NextResponse.json({ error: 'Special day not found.' }, { status: 404 });
  const today = await userLocalToday(session.userId);
  if (!today) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const next = nextOccurrence(occasion, today.date);
  if (!next || !isOccasionSurfaced(next.daysUntil, occasion.remindDaysBefore)) {
    return NextResponse.json({ error: 'This special day is not being shown right now.' }, { status: 409 });
  }

  await markPersonOccasionDismissed(session.userId, occasion.id, new Date(dismissalKeyFor(next.date, next.daysUntil, scope)));
  return NextResponse.json({ ok: true, date: next.date });
}
