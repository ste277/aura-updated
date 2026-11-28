import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { createPersonRhythm, getSavedPersonForOwner, listPersonRhythms, type GoalActivity } from '../../../../../lib/db';
import { parseJsonObject } from '../../../../../lib/request';
import { isMyPeopleServerEnabled } from '../../../../../lib/myPeopleGate';
import { parseRelationshipRhythmRequest } from '../../../../../lib/myPeopleRhythms';
import { isGoalActivityRhythmPaused, normalizeGoalActivityRhythmPreferences } from '../../../../../lib/goalActivityRhythmPreferences';

/**
 * AURA-MP-4 (62025) -- a person's Relationship Rhythms.
 *
 *   GET  -> the owner's live rhythms with this person.
 *   POST { choice, title, targetPerWeek, preferences?, goal } -> creates ONE
 *        weekly rhythm under a new visible goal ({kind:"NEW", title}) or an
 *        existing active goal ({kind:"EXISTING", goalId}). Only this explicit
 *        request ever creates a relationship goal or rhythm (R1).
 *
 * 404 while My People is disabled on the SERVER, and for another owner's or
 * an unknown person or goal (never 403). Edit, pause, resume and remove reuse
 * the existing Life Rhythm routes (/api/goals/:goalId/activities/:id/rhythm
 * and /dismiss) unchanged.
 */
export const dynamic = 'force-dynamic';

const view = (a: GoalActivity & { goalTitle?: string }) => ({
  id: a.id,
  goalId: a.goalId,
  goalTitle: a.goalTitle ?? null,
  title: a.title,
  activityId: a.activityId,
  targetPerWeek: a.rhythmTargetPerWeek,
  paused: isGoalActivityRhythmPaused(a),
  preferences: normalizeGoalActivityRhythmPreferences(a),
  savedPersonId: a.savedPersonId,
});

export async function GET(req: NextRequest, { params }: { params: { personId: string } }) {
  if (!isMyPeopleServerEnabled()) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  const person = await getSavedPersonForOwner(session.userId, params.personId);
  if (!person) return NextResponse.json({ error: 'Person not found.' }, { status: 404 });
  const rows = await listPersonRhythms(session.userId, person.id);
  return NextResponse.json(rows.map(view));
}

export async function POST(req: NextRequest, { params }: { params: { personId: string } }) {
  if (!isMyPeopleServerEnabled()) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });
  const parsed = parseRelationshipRhythmRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const result = await createPersonRhythm(session.userId, params.personId, parsed.value);
  if (result.status === 'PERSON_NOT_FOUND') return NextResponse.json({ error: 'Person not found.' }, { status: 404 });
  if (result.status === 'GOAL_NOT_FOUND') return NextResponse.json({ error: 'Goal not found.' }, { status: 404 });
  if (result.status === 'GOAL_NOT_ACTIVE') return NextResponse.json({ error: 'That goal is archived. Choose an active goal or create a new one.' }, { status: 409 });
  return NextResponse.json({ ...view({ ...result.activity, goalTitle: result.goal.title }), goalCreated: result.goalCreated }, { status: 201 });
}
