import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { createCapture, listCapturesWithLinkedPlanStatus, getCaptureWithLinkedPlanStatus } from '../../../lib/db';
import { parseJsonObject } from '../../../lib/request';
import { validateCaptureTitle, isActiveCaptureState } from '../../../lib/captures';
import { toCaptureView } from '../../../lib/captureApi';

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const rows = await listCapturesWithLinkedPlanStatus(session.userId);
  return NextResponse.json(rows.map(toCaptureView).filter((capture) => isActiveCaptureState(capture.derivedState)));
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const checked = validateCaptureTitle(body.title);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const created = await createCapture(session.userId, checked.title);
  const row = await getCaptureWithLinkedPlanStatus(session.userId, created.id);
  return NextResponse.json(toCaptureView(row!));
}
