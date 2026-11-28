import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, SESSION_UNAVAILABLE, sessionUnavailableResponse } from '../../../../lib/session';
import { archiveHabit } from '../../../../lib/db';

export async function DELETE(req: NextRequest, { params }: { params: { habitId: string } }) {
  const session = await getSessionFromRequest(req);
  if (session === SESSION_UNAVAILABLE) return sessionUnavailableResponse();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  await archiveHabit(session.userId, params.habitId);
  return NextResponse.json({ archived: true });
}
