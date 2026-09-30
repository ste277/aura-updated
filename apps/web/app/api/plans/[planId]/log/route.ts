import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { logPlannedActivity } from '../../../../../lib/db';
import { parseJsonObject } from '../../../../../lib/request';

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  // Goals V2 G2.2.2 -- OPTIONAL body. parseJsonObject returns null for no
  // body / an empty body / malformed JSON (request.ts's own established
  // behavior), which every existing caller (Home/Right Now's
  // createPlanExecutor, the Plan tab) already sends -- all continue exactly
  // as before. Only a basic shape check happens here (finite number); the
  // real semantic validation ("is this value valid for THIS Goal
  // activity's completion requirement?") lives entirely in
  // resolveCompletionActualValue/logPlannedActivity, never duplicated here.
  const body = await parseJsonObject(req);
  let actualValue: number | undefined;
  if (body && body.actualValue !== undefined && body.actualValue !== null) {
    if (typeof body.actualValue !== 'number' || !Number.isFinite(body.actualValue)) {
      return NextResponse.json({ error: 'actualValue must be a finite number.' }, { status: 400 });
    }
    actualValue = body.actualValue;
  }

  try {
    const result = await logPlannedActivity(session.userId, params.planId, actualValue !== undefined ? { actualValue } : undefined);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not log plan.' }, { status: 400 });
  }
}
