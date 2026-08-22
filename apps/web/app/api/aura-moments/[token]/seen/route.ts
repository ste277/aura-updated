import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { markAuraMomentResponseSeen } from '../../../../../lib/db';

/**
 * Owner-authenticated only (brief section 6: "Do not use the public
 * bearer-link response endpoint") -- marks ONE moment's response as seen.
 * Ownership-scoped in the same query (markAuraMomentResponseSeen), so a
 * token that isn't this owner's silently matches nothing rather than
 * revealing whether it exists for someone else.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const moment = await markAuraMomentResponseSeen(session.userId, params.token);
  if (!moment) return NextResponse.json({ error: 'Moment not found.' }, { status: 404 });

  return NextResponse.json({ id: moment.id, ownerSeenResponseAt: moment.ownerSeenResponseAt });
}
