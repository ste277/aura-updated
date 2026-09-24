import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { removeCapture } from '../../../../lib/db';

export async function DELETE(req: NextRequest, { params }: { params: { captureId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const result = await removeCapture(session.userId, params.captureId);
  // 404 for both "doesn't exist" and "not yours" -- never reveal another user's Capture.
  if (result === 'NOT_FOUND') return NextResponse.json({ error: 'Capture not found.' }, { status: 404 });
  if (result === 'HAS_LIVE_PLAN') return NextResponse.json({ error: 'This is planned right now. Cancel the plan first.' }, { status: 409 });
  return NextResponse.json({ removed: result });
}
