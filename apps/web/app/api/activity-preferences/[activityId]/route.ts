import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { parseJsonObject } from '../../../../lib/request';
import {
  validateActivityId,
  validatePreferredDurationMinutes,
  setPreferredActivityDuration,
  clearPreferredActivityDuration,
} from '../../../../lib/activityPreferences';

/**
 * Explicit Duration Preferences API V1 -- SET + CLEAR, both ownership-scoped
 * via session.userId (never accepted from the request body/query/params --
 * the request body's only consumed field is preferredDurationMinutes; any
 * other field, including a client-submitted userId, is silently ignored).
 * activityId/duration validation reuses the foundation's own exported pure
 * validators (validateActivityId/validatePreferredDurationMinutes) before
 * calling the mutating service helper, translating any rejection into a
 * deterministic 400 -- matches this repo's established validate-before-call
 * convention (see apps/web/lib/savedPersonRequest.ts), no new error
 * hierarchy.
 *
 * The try/catch below wraps ONLY the two pure, synchronous validators --
 * never the subsequent setPreferredActivityDuration/
 * clearPreferredActivityDuration call. Validation has already succeeded by
 * that point (the service re-validates too, but that can only re-confirm,
 * never newly fail), so any exception the service call raises past this
 * point is a genuine infrastructure/DB failure, not a client input error --
 * it must propagate uncaught (Next.js's default 500), never get relabeled
 * as a 400. Matches this repo's own convention of never letting the
 * service throw in the normal, already-validated request path.
 */

export async function PUT(req: NextRequest, { params }: { params: { activityId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  if (typeof body.preferredDurationMinutes !== 'number') {
    return NextResponse.json({ error: 'preferredDurationMinutes (number) is required.' }, { status: 400 });
  }

  let activityId: string;
  let preferredDurationMinutes: number;
  try {
    activityId = validateActivityId(params.activityId);
    preferredDurationMinutes = validatePreferredDurationMinutes(body.preferredDurationMinutes);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid request.' }, { status: 400 });
  }

  await setPreferredActivityDuration({ userId: session.userId, activityId, preferredDurationMinutes });
  return NextResponse.json({ activityId, preferredDurationMinutes });
}

export async function DELETE(req: NextRequest, { params }: { params: { activityId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  let activityId: string;
  try {
    activityId = validateActivityId(params.activityId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid request.' }, { status: 400 });
  }

  await clearPreferredActivityDuration({ userId: session.userId, activityId });
  return NextResponse.json({ cleared: true });
}
