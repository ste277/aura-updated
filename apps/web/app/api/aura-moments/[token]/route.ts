import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { deleteAuraMoment } from '../../../../lib/db';

/**
 * Permanently removes a moment from the owner's list -- scoped to REVOKED
 * only (db.ts's deleteAuraMoment), so a moment must always be revoked
 * first (the deliberate "this link no longer works" step) before it can be
 * cleared away. Authenticated + ownership-scoped, same pattern as revoke.
 */
export async function DELETE(req: NextRequest, { params }: { params: { token: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  try {
    await deleteAuraMoment(session.userId, params.token);
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: 'Moment not found or cannot be removed.' }, { status: 404 });
  }
}
