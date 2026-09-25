import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { parseJsonObject } from '../../../../../lib/request';
import { movePlannedActivity, MovePlanError, type MovePlanErrorCode } from '../../../../../lib/planMove';

const STATUS_BY_CODE: Record<MovePlanErrorCode, number> = {
  NOT_FOUND: 404,
  INVALID_DESTINATION: 400,
  INVALID_STATE: 409,
  ALREADY_MOVED: 409,
  CONFLICT: 409,
  HAS_LINKED_MOMENT: 409,
};

/**
 * Move is its own lifecycle outcome ("same intention, different time"): never
 * DELETE/cancel + create. Success returns the MOVED original and its UPCOMING
 * successor; a retry of an already-successful Move returns the same pair.
 */
export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  const raw = body?.newStartAt;
  const newStartAt = typeof raw === 'string' ? new Date(raw) : null;
  if (!newStartAt || !Number.isFinite(newStartAt.getTime())) {
    return NextResponse.json({ error: 'newStartAt must be a valid ISO instant.', code: 'INVALID_DESTINATION' }, { status: 400 });
  }

  try {
    const { from, to } = await movePlannedActivity(session.userId, params.planId, { newStartAt });
    return NextResponse.json({ from, plan: to });
  } catch (err) {
    if (err instanceof MovePlanError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: STATUS_BY_CODE[err.code] });
    }
    return NextResponse.json({ error: 'Could not move plan.' }, { status: 500 });
  }
}
