import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, SESSION_UNAVAILABLE, sessionUnavailableResponse } from '../../../../../../../lib/session';
import { updateGoalActivityRhythmSettings } from '../../../../../../../lib/db';
import { parseJsonObject } from '../../../../../../../lib/request';
import { validateGoalActivityRhythm } from '../../../../../../../lib/goalActivityRhythm';
import {
  isGoalActivityRhythmPaused,
  normalizeGoalActivityRhythmPreferences,
  parseGoalActivityRhythmPreferencesPatch,
  type GoalActivityRhythmSettingsUpdate,
} from '../../../../../../../lib/goalActivityRhythmPreferences';

/**
 * Goals V2 Rhythm R5, extended by AURA-MR1 -- the one allowed path for
 * changing an EXISTING GoalActivity's Rhythm settings after creation. A pure
 * policy change: PATCH, not POST.
 *
 * Body (every field optional, at least one required):
 *   rhythm       -- { kind: 'NONE' } | { kind: 'N_PER_WEEK', targetPerWeek }
 *                   (R5's original field; `{ rhythm }` alone behaves exactly
 *                   as before, except that switching to NONE now also clears
 *                   MR1's preferences/pause, which mean nothing for NONE).
 *   preferences  -- { preferredWeekdays?, preferredTimeOfDay?,
 *                   preferredDurationMinutes? }; an absent key is unchanged,
 *                   null (or [] for weekdays) clears it.
 *   paused       -- true pauses (no new rhythm sessions recommended or
 *                   created; existing plans untouched), false resumes.
 *
 * Every value is server-validated through the canonical validators -- a
 * client's own pre-validation is never trusted -- and the merged result is
 * validated as a whole under a row lock (updateGoalActivityRhythmSettings).
 * Ownership: the session's user, the Goal and the activity must all match,
 * otherwise 404 (another user's rhythm can never be read or modified).
 */
export async function PATCH(req: NextRequest, { params }: { params: { goalId: string; goalActivityId: string } }) {
  const session = await getSessionFromRequest(req);
  if (session === SESSION_UNAVAILABLE) return sessionUnavailableResponse();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const update: GoalActivityRhythmSettingsUpdate = {};

  if (body.rhythm !== undefined) {
    if (body.rhythm === null || typeof body.rhythm !== 'object') {
      return NextResponse.json({ error: 'rhythm must be an object with a kind field.' }, { status: 400 });
    }
    const validated = validateGoalActivityRhythm(body.rhythm as { kind: unknown; targetPerWeek?: unknown });
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
    update.rhythm = validated.rhythm;
  }

  if (body.preferences !== undefined) {
    const parsed = parseGoalActivityRhythmPreferencesPatch(body.preferences);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    update.preferences = parsed.value;
  }

  if (body.paused !== undefined) {
    if (typeof body.paused !== 'boolean') return NextResponse.json({ error: 'paused must be true or false.' }, { status: 400 });
    update.paused = body.paused;
  }

  if (update.rhythm === undefined && update.preferences === undefined && update.paused === undefined) {
    return NextResponse.json({ error: 'At least one of rhythm, preferences or paused is required.' }, { status: 400 });
  }

  // AURA-MP-4-R1 -- optional: the person the caller acted for (My People
  // sends it), so a change made from a stale person screen cannot apply to a
  // rhythm whose person was removed.
  let expectedSavedPersonId: string | undefined;
  if (body.savedPersonId !== undefined) {
    if (typeof body.savedPersonId !== 'string' || !body.savedPersonId.trim()) return NextResponse.json({ error: 'savedPersonId must be a person id.' }, { status: 400 });
    expectedSavedPersonId = body.savedPersonId.trim();
  }

  const result = await updateGoalActivityRhythmSettings(session.userId, params.goalId, params.goalActivityId, update, { expectedSavedPersonId });
  if (result.status === 'NOT_FOUND') return NextResponse.json({ error: 'Goal activity not found.' }, { status: 404 });
  if (result.status === 'PERSON_LINK_CHANGED') {
    return NextResponse.json({ error: 'This rhythm was paused because the person it was with was removed. Nothing was changed.', code: 'PERSON_LINK_CHANGED' }, { status: 409 });
  }
  if (result.status === 'INVALID') return NextResponse.json({ error: result.error }, { status: 400 });

  const activity = result.activity;
  return NextResponse.json({
    ...activity,
    rhythmPaused: isGoalActivityRhythmPaused(activity),
    rhythmPreferences: normalizeGoalActivityRhythmPreferences(activity),
  });
}
