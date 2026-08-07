import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { archiveHabit } from '../../../../lib/db';

export async function DELETE(req: NextRequest, { params }: { params: { habitId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  await archiveHabit(session.userId, params.habitId);
  return NextResponse.json({ archived: true });
}
