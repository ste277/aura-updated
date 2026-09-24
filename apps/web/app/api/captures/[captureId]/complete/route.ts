import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { completeCapture } from '../../../../../lib/db';
import { toCaptureView } from '../../../../../lib/captureApi';

export async function POST(req: NextRequest, { params }: { params: { captureId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const outcome = await completeCapture(session.userId, params.captureId);
  if (outcome.result === 'NOT_FOUND') return NextResponse.json({ error: 'Capture not found.' }, { status: 404 });
  if (outcome.result === 'DISMISSED') return NextResponse.json({ error: 'This capture was removed.' }, { status: 409 });
  if (outcome.result === 'HAS_LIVE_PLAN') return NextResponse.json({ error: 'This is planned right now. Complete the planned activity instead.' }, { status: 409 });
  return NextResponse.json(toCaptureView(outcome.capture));
}
