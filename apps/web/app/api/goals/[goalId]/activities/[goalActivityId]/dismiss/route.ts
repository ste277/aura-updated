import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../../../lib/session';
import { dismissGoalActivity, PersonLinkChangedError } from '../../../../../../../lib/db';

export async function POST(req: NextRequest, { params }: { params: { goalId: string; goalActivityId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  // AURA-MP-4-R2 -- an optional body { savedPersonId }: the person the caller
  // acted for (My People sends it). A bodyless request (Goals) is unchanged.
  let expectedSavedPersonId: string | undefined;
  const body = await req.json().catch(() => null);
  if (body && typeof body === 'object' && (body as Record<string, unknown>).savedPersonId !== undefined) {
    const value = (body as Record<string, unknown>).savedPersonId;
    if (typeof value !== 'string' || !value.trim()) return NextResponse.json({ error: 'savedPersonId must be a person id.' }, { status: 400 });
    expectedSavedPersonId = value.trim();
  }

  let activity;
  try {
    activity = await dismissGoalActivity(session.userId, params.goalId, params.goalActivityId, { expectedSavedPersonId });
  } catch (err) {
    if (err instanceof PersonLinkChangedError) {
      return NextResponse.json({ error: 'This rhythm was paused because the person it was with was removed. Nothing was changed.', code: 'PERSON_LINK_CHANGED' }, { status: 409 });
    }
    throw err;
  }
  if (!activity) return NextResponse.json({ error: 'Goal activity not found.' }, { status: 404 });
  return NextResponse.json(activity);
}
