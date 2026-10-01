import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../../../lib/session';
import { setGoalActivityRhythm } from '../../../../../../../lib/db';
import { parseJsonObject } from '../../../../../../../lib/request';
import { validateGoalActivityRhythm } from '../../../../../../../lib/goalActivityRhythm';

/**
 * Goals V2 Rhythm R5 -- the one allowed path for changing an EXISTING
 * GoalActivity's Rhythm policy after creation (this ticket's own section
 * 20's "small inline edit" decision -- see this ticket's own doc comments
 * in GoalDetailClient.tsx/db.ts for why editing is included rather than
 * creation-only). A pure policy change: PATCH, not POST, since it mutates
 * an existing resource's field rather than creating anything. `rhythm` is
 * required and server-validated through the canonical R2 validator -- the
 * client's own pre-validation (immediate UI feedback only) is never
 * trusted (this ticket's own section 19).
 */
export async function PATCH(req: NextRequest, { params }: { params: { goalId: string; goalActivityId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  if (body.rhythm === undefined || body.rhythm === null || typeof body.rhythm !== 'object') {
    return NextResponse.json({ error: 'rhythm is required and must be an object with a kind field.' }, { status: 400 });
  }
  const validated = validateGoalActivityRhythm(body.rhythm as { kind: unknown; targetPerWeek?: unknown });
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const activity = await setGoalActivityRhythm(session.userId, params.goalId, params.goalActivityId, validated.rhythm);
  if (!activity) return NextResponse.json({ error: 'Goal activity not found.' }, { status: 404 });
  return NextResponse.json(activity);
}
