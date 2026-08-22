import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { revokeAuraMoment } from '../../../../../lib/db';

/**
 * Authenticated + ownership-scoped -- revokeAuraMoment() only ever updates a
 * row matching BOTH publicToken AND ownerUserId (db.ts), so a token cannot
 * be revoked by anyone but the user who created it, even though the same
 * token is otherwise bearer-access for viewing/responding.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  try {
    const moment = await revokeAuraMoment(session.userId, params.token);
    return NextResponse.json({ id: moment.id, status: moment.status });
  } catch {
    return NextResponse.json({ error: 'Moment not found.' }, { status: 404 });
  }
}
